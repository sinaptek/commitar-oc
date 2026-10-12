import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { validateHandoff, buildBundle, exportHandoff } from "../cli/handoff.mjs"

const ok = { version: 1, project: "p", phase: "AUDIT", status: "in_progress", gates: [{ command: "t", passed: true }] }
const noGit = () => ({ ok: false, out: "" })
const gitRun = (dirty) => (c, a) => {
  const k = a.join(" ")
  if (k === "rev-parse --short HEAD") return { ok: true, out: "abc123" }
  if (k === "rev-parse --abbrev-ref HEAD") return { ok: true, out: "main" }
  if (k === "status --porcelain") return { ok: true, out: dirty ? " M x" : "" }
  if (k.startsWith("log")) return { ok: true, out: "abc123 feat\n9f9f9f init" }
  return { ok: false, out: "" }
}
const proj = (h, spec) => {
  const d = mkdtempSync(join(tmpdir(), "ho-"))
  if (h !== undefined) writeFileSync(join(d, "HANDOFF.json"), typeof h === "string" ? h : JSON.stringify(h))
  if (spec) writeFileSync(join(d, "spec.md"), spec)
  return d
}

test("validator accepts a good handoff and rejects bad ones", () => {
  assert.deepEqual(validateHandoff(ok), [])
  assert.ok(validateHandoff({}).length >= 4)
  assert.match(validateHandoff({ ...ok, phase: "NOPE" })[0], /phase/)
  assert.match(validateHandoff({ ...ok, gates: [{ command: 1, passed: "y" }] }).join(), /command[\s\S]*passed/)
  assert.match(validateHandoff({ ...ok, version: 2 })[0], /version/)
  assert.deepEqual(validateHandoff([]), ["not an object"])
})

test("missing and corrupt HANDOFF.json give clear errors", () => {
  assert.match(buildBundle({ dir: proj(), run: noGit }).error, /not found/)
  assert.match(buildBundle({ dir: proj("{nope"), run: noGit }).error, /not valid JSON/)
  assert.match(buildBundle({ dir: proj({ version: 1 }), run: noGit }).error, /invalid[\s\S]*project/)
})

test("bundle includes git state, spec text and no warnings when clean", () => {
  const b = buildBundle({ dir: proj(ok, "# Spec\nbody"), run: gitRun(false), now: new Date("2026-01-01T00:00:00Z") })
  assert.equal(b.json.git.head, "abc123")
  assert.equal(b.json.exportedAt, "2026-01-01T00:00:00.000Z")
  assert.match(b.md, /## Spec[\s\S]*body/)
  assert.match(b.md, /- abc123 feat/)
  assert.ok(b.warnings.every((w) => /spec path not set/.test(w)))
})

test("warns on dirty tree, failed gates and non-git dirs", () => {
  const failed = { ...ok, status: "gate_failed", gates: [{ command: "t", passed: false, output: "boom" }] }
  const b = buildBundle({ dir: proj(failed, "s"), run: gitRun(true) })
  assert.match(b.warnings.join("|"), /uncommitted/)
  assert.match(b.warnings.join("|"), /FAILED/)
  assert.match(b.md, /FAIL `t`[\s\S]*boom/)
  assert.match(buildBundle({ dir: proj(ok, "s"), run: noGit }).warnings.join("|"), /not a git repository/)
})

test("spec path escaping the project is refused", () => {
  const b = buildBundle({ dir: proj({ ...ok, spec: "../../etc/passwd" }), run: noGit })
  assert.match(b.warnings.join("|"), /not found inside the project/)
  assert.doesNotMatch(b.md, /root:/)
})

test("export writes json and md to the out dir", () => {
  const d = proj(ok, "s")
  const r = exportHandoff({ dir: d, run: noGit })
  assert.ok(existsSync(join(r.out, "handoff.md")))
  assert.deepEqual(validateHandoff(JSON.parse(readFileSync(join(r.out, "handoff.json"), "utf8"))), [])
})

test("sibling directory with a shared prefix is not treated as inside the project", () => {
  const d = proj({ ...ok, spec: "../" + "x" })
  assert.match(buildBundle({ dir: d, run: noGit }).warnings.join("|"), /not found inside/)
})

test("CLI: dir argument and --out are honored", async () => {
  const { spawnSync } = await import("node:child_process")
  const { fileURLToPath } = await import("node:url")
  const cli = fileURLToPath(new URL("../cli/commitar-oc.mjs", import.meta.url))
  const d = proj(ok, "s")
  const out = mkdtempSync(join(tmpdir(), "out-"))
  assert.equal(spawnSync("node", [cli, "handoff", "export", d], { encoding: "utf8" }).status, 0)
  assert.ok(existsSync(join(d, ".commitar/handoff/handoff.json")))
  assert.equal(spawnSync("node", [cli, "handoff", "export", d, "--out", out], { encoding: "utf8" }).status, 0)
  assert.ok(existsSync(join(out, "handoff.md")))
  assert.equal(spawnSync("node", [cli, "handoff", "export", mkdtempSync(join(tmpdir(), "e-"))], { encoding: "utf8" }).status, 1)
})

test("HANDOFF.json and .commitar/ alone do not make the tree dirty", () => {
  const run = (c, a) => (a[0] === "status" ? { ok: true, out: "?? HANDOFF.json\n?? .commitar/" } : gitRun(false)(c, a))
  assert.doesNotMatch(buildBundle({ dir: proj(ok, "s"), run }).warnings.join("|"), /uncommitted/)
  const real = (c, a) => (a[0] === "status" ? { ok: true, out: "?? HANDOFF.json\n M src.js" } : gitRun(false)(c, a))
  assert.match(buildBundle({ dir: proj(ok, "s"), run: real }).warnings.join("|"), /uncommitted/)
})
