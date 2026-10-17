#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { existsSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { generate, loadRoles } from "../adapters/opencode/generate.mjs"
import { doctor, format, isToolRepo, projectVaultPath } from "./doctor.mjs"
import { exportHandoff } from "./handoff.mjs"
import { addPersona } from "./personas.mjs"
import { initVault, initScratchVault } from "./vault.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

export function loadVaultConfig() {
  const p = join(root, "vault.json")
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null
}

export function validate(dir) {
  const r = spawnSync("opencode", ["debug", "config"], { cwd: dir, encoding: "utf8" })
  if (r.error) return { ok: false, output: `cannot run opencode: ${r.error.message}` }
  return { ok: r.status === 0, output: (r.stderr || r.stdout).trim() }
}

function init(target, { scratchVault = false } = {}) {
  if (isToolRepo(target)) { console.error(`${target} is the commitar-oc repo itself; run init on a separate project directory`); process.exit(1) }
  const models = JSON.parse(readFileSync(join(root, "models.json"), "utf8"))
  // Gate commands feed the bash allowlist; re-run init after editing commitar.json.
  let gates
  try { gates = JSON.parse(readFileSync(join(target, "commitar.json"), "utf8")).gates } catch {}
  // --scratch-vault: vault_save writes to <project>/.commitar/vault instead of the shared vault (for test runs).
  const vault = scratchVault ? initScratchVault({ dir: target, base: loadVaultConfig() }) : loadVaultConfig()
  const files = generate({ models, roles: loadRoles(join(root, "protocol/roles")), vault, ...(gates && { gates }) })
  for (const [rel, content] of Object.entries(files)) {
    const path = join(target, rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
    console.log(`wrote ${rel}`)
  }
  const cfg = join(target, "commitar.json")
  if (!existsSync(cfg)) {
    writeFileSync(cfg, JSON.stringify({ name: basename(target), gates: { test: "npm test" }, probe: "node {file}" }, null, 2) + "\n")
    console.log("wrote commitar.json (edit the gate commands and the probe command)")
  }
  // Pipeline state must never be committed: HANDOFF.json and .commitar/ are local by design.
  const gi = join(target, ".gitignore")
  const have = existsSync(gi) ? readFileSync(gi, "utf8") : ""
  const missing = ["HANDOFF.json", ".commitar/"].filter((l) => !have.split("\n").includes(l))
  if (missing.length) {
    writeFileSync(gi, have + (have && !have.endsWith("\n") ? "\n" : "") + missing.join("\n") + "\n")
    console.log(`wrote .gitignore (${missing.join(", ")})`)
  }
  const v = validate(target)
  if (!v.ok) { console.error(`opencode rejected the generated config:\n${v.output}`); process.exit(1) }
  console.log("opencode debug config: ok")
}

function runDoctor(args) {
  const smoke = !args.includes("--no-smoke")
  const dir = resolve(args.find((a) => !a.startsWith("--")) ?? ".")
  const models = JSON.parse(readFileSync(join(root, "models.json"), "utf8"))
  const shared = loadVaultConfig()
  const own = projectVaultPath(dir)
  const results = doctor({ dir, models, smoke, vault: own ? { ...(shared ?? {}), path: own } : shared })
  console.log(format(results))
  process.exit(results.every((r) => r.ok) ? 0 : 1)
}

function runHandoff(args) {
  const [sub, ...a] = args
  if (sub !== "export") { console.error("usage: commitar-oc handoff export [dir] [--out dir]"); process.exit(1) }
  const oi = a.indexOf("--out")
  const outDir = oi >= 0 ? resolve(a[oi + 1]) : undefined
  const dir = resolve(a.find((x, i) => !x.startsWith("--") && (oi < 0 || i !== oi + 1)) ?? ".")
  const r = exportHandoff({ dir, outDir })
  if (r.error) { console.error(r.error); process.exit(1) }
  r.warnings.forEach((w) => console.warn(`warn: ${w}`))
  console.log(`exported to ${r.out}`)
}

function runPersona(args) {
  const [sub, ...a] = args
  const flag = (n, d) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : d }
  const slugs = a.filter((x, i) => !x.startsWith("--") && !(i > 0 && a[i - 1].startsWith("--") && a[i - 1] !== "--force"))
  if (sub !== "add" || !slugs.length) { console.error("usage: commitar-oc persona add <slug...> [--model fast|strong] [--edit allow|ask|deny] [--bash allow|ask|deny] [--force]"); process.exit(1) }
  for (const slug of slugs) {
    try {
      const r = addPersona({ source: resolve(flag("source", join(root, "dev/agency-agents"))), rolesDir: join(root, "protocol/roles"), slug,
        model: flag("model", "fast"), edit: flag("edit", "deny"), bash: flag("bash", "ask"), force: a.includes("--force") })
      console.log(`added ${r.target} (${r.original} -> ${r.chars} chars)`)
    } catch (e) { console.error(e.message); process.exit(1) }
  }
}

function runVault(args) {
  const config = loadVaultConfig()
  if (args[0] !== "init" || !config) { console.error(config ? "usage: commitar-oc vault init" : "no vault.json: vault features are disabled"); process.exit(1) }
  try { initVault({ config, source: join(root, "obsidian-second-brain") }).forEach((x) => console.log(x)); console.log(`vault ready at ${config.path}`) }
  catch (e) { console.error(e.message); process.exit(1) }
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === "init") init(resolve(rest.find((a) => !a.startsWith("--")) ?? "."), { scratchVault: rest.includes("--scratch-vault") })
else if (cmd === "doctor") runDoctor(rest)
else if (cmd === "handoff") runHandoff(rest)
else if (cmd === "persona") runPersona(rest)
else if (cmd === "vault") runVault(rest)
else { console.error("usage: commitar-oc init [dir] [--scratch-vault] | doctor [dir] [--no-smoke] | handoff export [dir] [--out dir] | persona add <slug...> | vault init"); process.exit(cmd ? 1 : 0) }
