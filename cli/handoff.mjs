// handoff export: validate HANDOFF.json against protocol/handoff.schema.json and bundle it for paid commitar.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { dirname, join, resolve, relative, isAbsolute } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const schema = JSON.parse(readFileSync(join(root, "protocol/handoff.schema.json"), "utf8"))

// Small validator for the subset of JSON Schema our handoff schema uses (no deps).
export function validateHandoff(h) {
  const errs = []
  if (h === null || typeof h !== "object" || Array.isArray(h)) return ["not an object"]
  for (const k of schema.required) if (!(k in h)) errs.push(`missing required field "${k}"`)
  const props = schema.properties
  if ("version" in h && h.version !== props.version.const) errs.push(`version must be ${props.version.const}`)
  for (const k of ["project", "spec", "next"]) if (k in h && typeof h[k] !== "string") errs.push(`${k} must be a string`)
  for (const k of ["phase", "status"]) if (k in h && !props[k].enum.includes(h[k])) errs.push(`${k} must be one of ${props[k].enum.join("|")}`)
  if ("commits" in h && !(Array.isArray(h.commits) && h.commits.every((c) => typeof c === "string"))) errs.push("commits must be an array of strings")
  if ("gates" in h) {
    if (!Array.isArray(h.gates)) errs.push("gates must be an array")
    else h.gates.forEach((g, i) => {
      if (typeof g?.command !== "string") errs.push(`gates[${i}].command must be a string`)
      if (typeof g?.passed !== "boolean") errs.push(`gates[${i}].passed must be a boolean`)
      if ("output" in (g ?? {}) && typeof g.output !== "string") errs.push(`gates[${i}].output must be a string`)
    })
  }
  return errs
}

function git(dir, args, run) {
  const r = run("git", args, { cwd: dir })
  return r.ok ? r.out : null
}

function defaultRun(cmd, args, { cwd }) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" })
  return { ok: r.status === 0 && !r.error, out: (r.stdout ?? "").trim() }
}

export function buildBundle({ dir, run = defaultRun, now = new Date() }) {
  const path = join(dir, "HANDOFF.json")
  if (!existsSync(path)) return { error: "HANDOFF.json not found (run a phase with the gates tool first)" }
  let h
  try { h = JSON.parse(readFileSync(path, "utf8")) } catch (e) { return { error: `HANDOFF.json is not valid JSON: ${e.message}` } }
  const errors = validateHandoff(h)
  if (errors.length) return { error: `HANDOFF.json is invalid:\n- ${errors.join("\n- ")}` }

  const warnings = []
  const head = git(dir, ["rev-parse", "--short", "HEAD"], run)
  // HANDOFF.json and .commitar/ are uncommitted by design; they don't make the tree dirty.
  const dirty = (git(dir, ["status", "--porcelain"], run) ?? "").split("\n")
    .filter((l) => l && !/^\?\? (HANDOFF\.json|\.commitar\/?)$/.test(l)).join("\n")
  const gitInfo = head === null ? null : {
    branch: git(dir, ["rev-parse", "--abbrev-ref", "HEAD"], run),
    head,
    dirty: Boolean(dirty),
    recent: (git(dir, ["log", "-5", "--pretty=%h %s"], run) ?? "").split("\n").filter(Boolean),
  }
  if (!gitInfo) warnings.push("not a git repository: no git state recorded")
  if (gitInfo?.dirty) warnings.push("working tree has uncommitted changes")
  if (h.status === "gate_failed") warnings.push("last gate run FAILED: paid commitar should start by fixing it")
  if (h.gates === undefined || h.gates.length === 0) warnings.push("no gate results recorded")

  let spec = null
  if (h.spec) {
    const sp = resolve(dir, h.spec)
    const rel = relative(resolve(dir), sp)
    if (rel && !rel.startsWith("..") && !isAbsolute(rel) && existsSync(sp)) spec = readFileSync(sp, "utf8")
    else warnings.push(`spec "${h.spec}" not found inside the project`)
  } else if (existsSync(join(dir, "spec.md"))) {
    spec = readFileSync(join(dir, "spec.md"), "utf8")
    warnings.push('spec path not set in HANDOFF.json; used "spec.md"')
  } else warnings.push("no spec found")

  const json = { ...h, exportedAt: now.toISOString(), git: gitInfo }
  return { json, md: renderMarkdown(json, spec, warnings), warnings }
}

export function renderMarkdown(j, spec, warnings) {
  const L = [`# Handoff: ${j.project}`, "", `- Phase: **${j.phase}** (${j.status})`, `- Exported: ${j.exportedAt}`]
  if (j.git) L.push(`- Git: ${j.git.branch} @ ${j.git.head}${j.git.dirty ? " (dirty)" : ""}`)
  if (warnings.length) L.push("", "## Warnings", ...warnings.map((w) => `- ${w}`))
  if (j.next) L.push("", "## Next", j.next)
  if (j.gates?.length) {
    L.push("", "## Gates", ...j.gates.map((g) => `- ${g.passed ? "PASS" : "FAIL"} \`${g.command}\``))
    for (const g of j.gates.filter((x) => !x.passed && x.output)) L.push("", `Output of \`${g.command}\`:`, "```", g.output, "```")
  }
  const commits = j.git?.recent?.length ? j.git.recent : j.commits ?? []
  if (commits.length) L.push("", "## Commits", ...commits.map((c) => `- ${c}`))
  if (spec) L.push("", "## Spec", "", spec.trim())
  return L.join("\n") + "\n"
}

export function exportHandoff({ dir, outDir, ...opts }) {
  const b = buildBundle({ dir, ...opts })
  if (b.error) return b
  const out = outDir ?? join(dir, ".commitar", "handoff")
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, "handoff.json"), JSON.stringify(b.json, null, 2) + "\n")
  writeFileSync(join(out, "handoff.md"), b.md)
  return { ...b, out }
}
