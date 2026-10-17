// vault init: bootstrap the shared vault and install a subset of obsidian-second-brain commands.
// Source is the vendored obsidian-second-brain (only needed at install time, never at runtime).
import { existsSync, mkdirSync, mkdtempSync, copyFileSync, cpSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"

export function defaultRun(cmd, args, { cwd, env } = {}) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" })
  return { ok: r.status === 0 && !r.error, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() }
}

export function initVault({ config, source, run = defaultRun }) {
  const steps = []
  if (!existsSync(join(source, "scripts/bootstrap_vault.py"))) throw new Error(`obsidian-second-brain not found at ${source} (vendored source; see CLAUDE.md)`)
  for (const c of config.commands) if (!existsSync(join(source, "commands", `${c}.md`))) throw new Error(`unknown command "${c}" (not in ${join(source, "commands")})`)

  const vault = config.path
  const bootstrapped = existsSync(join(vault, "_CLAUDE.md"))
  if (!bootstrapped) {
    if (existsSync(vault) && readdirSync(vault).length) throw new Error(`${vault} exists, is not empty and is not a vault; refusing to touch it`)
    const r = run("python3", [join(source, "scripts/bootstrap_vault.py"), "--path", vault, "--name", config.owner, "--preset", config.preset], { env: { OBSIDIAN_NO_STAR_PROMPT: "1" } })
    if (!r.ok) throw new Error(`bootstrap failed: ${r.out.slice(-400)}`)
    steps.push("bootstrapped vault")
  } else steps.push("vault already bootstrapped (left as is)")

  const stage = mkdtempSync(join(tmpdir(), "coc-vault-"))
  try {
    mkdirSync(join(stage, "commands"))
    for (const c of config.commands) copyFileSync(join(source, "commands", `${c}.md`), join(stage, "commands", `${c}.md`))
    for (const d of ["references", "scripts"]) cpSync(join(source, d), join(stage, d), { recursive: true })
    copyFileSync(join(source, "pyproject.toml"), join(stage, "pyproject.toml"))
    const out = join(stage, "_out")
    mkdirSync(out)
    const script = `set -e; REPO_ROOT='${source}'; source "$REPO_ROOT/adapters/lib.sh"; source "$REPO_ROOT/adapters/opencode/adapter.sh"; adapter_build '${stage}' '${out}'`
    const b = run("bash", ["-c", script])
    if (!b.ok) throw new Error(`adapter build failed: ${b.out.slice(-400)}`)
    cpSync(out, vault, { recursive: true })
    steps.push(`installed ${config.commands.length} commands (AGENTS.md + .opencode/)`)
  } finally { rmSync(stage, { recursive: true, force: true }) }

  run("chmod", ["-R", "g+rwX", vault])
  run("find", [vault, "-type", "d", "-exec", "chmod", "g+s", "{}", "+"])
  steps.push("group-writable")
  return steps
}

// Scratch vault: a throwaway vault inside the project's own (gitignored) .commitar/ folder, so test runs never write into the shared vault.
export function initScratchVault({ dir, base = null }) {
  const path = join(dir, ".commitar", "vault")
  mkdirSync(path, { recursive: true })
  const marker = join(path, "_CLAUDE.md")
  if (!existsSync(marker)) writeFileSync(marker, "# Scratch vault\n\nCreated by `commitar-oc init --scratch-vault`. Holds notes written by this project's runs only. Safe to delete.\n")
  return { ...(base ?? {}), path }
}
