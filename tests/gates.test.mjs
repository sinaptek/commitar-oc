import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { runGates, summarize } from "../adapters/opencode/templates/gates-core.mjs"
import { validateHandoff } from "../cli/handoff.mjs"

const proj = (gates) => {
  const d = mkdtempSync(join(tmpdir(), "gates-"))
  if (gates) writeFileSync(join(d, "commitar.json"), JSON.stringify({ name: "p", gates }))
  return d
}

test("missing commitar.json fails, never passes", () => {
  const r = runGates({ cwd: proj() })
  assert.equal(r.passed, false)
  assert.match(r.error, /not found/)
})

test("passes only when every gate exits 0", () => {
  assert.equal(runGates({ cwd: proj({ test: "true", lint: "true" }) }).passed, true)
  const r = runGates({ cwd: proj({ test: "true", lint: "echo bad; exit 3" }) })
  assert.equal(r.passed, false)
  assert.equal(r.results.find((x) => x.name === "lint").exitCode, 3)
  assert.match(summarize(r), /GATES FAILED[\s\S]*bad/)
})

test("undeclared test gate fails", () => {
  const r = runGates({ cwd: proj({ lint: "true" }) })
  assert.equal(r.passed, false)
  assert.match(r.results.find((x) => x.name === "test").output, /not declared/)
})

test("optional gates are skipped when absent", () => {
  assert.deepEqual(runGates({ cwd: proj({ test: "true" }) }).results.map((r) => r.name), ["test"])
})

test("RED: expect fail inverts the result", () => {
  assert.equal(runGates({ cwd: proj({ test: "exit 1" }), expect: "fail" }).passed, true)
  assert.equal(runGates({ cwd: proj({ test: "true" }), expect: "fail" }).passed, false)
})

test("only filters gates", () => {
  const r = runGates({ cwd: proj({ test: "true", lint: "exit 1" }), only: ["test"] })
  assert.equal(r.passed, true)
  assert.equal(r.results.length, 1)
})

test("phase writes a schema-valid HANDOFF.json and preserves earlier fields", () => {
  const d = proj({ test: "exit 1" })
  writeFileSync(join(d, "HANDOFF.json"), JSON.stringify({ commits: ["abc"], next: "go" }))
  runGates({ cwd: d, phase: "GREEN" })
  const h = JSON.parse(readFileSync(join(d, "HANDOFF.json"), "utf8"))
  assert.equal(h.status, "gate_failed")
  assert.equal(h.phase, "GREEN")
  assert.deepEqual(h.commits, ["abc"])
  assert.deepEqual(validateHandoff(h), [])
})

test("output is truncated to the tail", () => {
  const r = runGates({ cwd: proj({ test: "head -c 10000 /dev/zero | tr '\\0' x; exit 1" }) })
  assert.ok(r.results[0].output.length <= 2000)
})

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"

const sh = (d, c) => spawnSync(c, { cwd: d, shell: true, encoding: "utf8" })
const gitProj = (gates) => {
  const d = proj(gates)
  sh(d, "git init -q && git config user.email t@e.invalid && git config user.name t && git add -A && git commit -qm init")
  return d
}
const read = (d) => JSON.parse(readFileSync(join(d, "HANDOFF.json"), "utf8"))

test("handoff lifecycle: spec, per-phase gates, commits since baseline, done only after a commit", () => {
  const d = gitProj({ test: "exit 0" })
  writeFileSync(join(d, "SPEC.md"), "# spec\n")
  runGates({ cwd: d, phase: "SPEC" })
  let h = read(d)
  assert.equal(h.spec, "SPEC.md")
  assert.deepEqual(h.commits, [])
  assert.match(h.next, /RED/)
  assert.ok(existsSync(join(d, ".commitar", "base")))

  sh(d, "git add -A && git commit -qm spec")
  runGates({ cwd: d, phase: "GREEN" })
  runGates({ cwd: d, phase: "GREEN" })
  h = read(d)
  assert.equal(h.commits.length, 1)
  assert.deepEqual(h.gates.map((g) => g.phase), ["SPEC", "GREEN"], "latest result per phase, no duplicates")

  runGates({ cwd: d, phase: "COMMIT" })
  h = read(d)
  assert.equal(h.status, "done")
  assert.deepEqual(validateHandoff(h), [])
})

test("COMMIT without any commit stays in_progress; a failing gate is gate_failed", () => {
  const d = gitProj({ test: "exit 0" })
  runGates({ cwd: d, phase: "COMMIT" })
  assert.equal(read(d).status, "in_progress")
  assert.match(read(d).next, /Commit the work/)
  writeFileSync(join(d, "commitar.json"), JSON.stringify({ name: "p", gates: { test: "exit 1" } }))
  runGates({ cwd: d, phase: "COMMIT" })
  assert.equal(read(d).status, "gate_failed")
})

import { classifyRed } from "../adapters/opencode/templates/gates-core.mjs"

const redProj = (file, body) => {
  const d = proj({ test: "node --test" })
  writeFileSync(join(d, file), body)
  return d
}
const red = (d) => runGates({ cwd: d, only: ["test"], expect: "fail", phase: "RED" })

test("RED accepts a real failing assertion", () => {
  const d = redProj("a.test.mjs", 'import {test} from "node:test"; import assert from "node:assert/strict"; test("adds", () => assert.equal(1+1, 3))')
  assert.equal(red(d).passed, true)
})

test("RED accepts a test whose implementation module does not exist yet", () => {
  const d = redProj("a.test.mjs", 'import {test} from "node:test"; import {f} from "./impl.js"; test("t", () => f())')
  assert.equal(red(d).passed, true)
})

test("RED accepts a missing export from an existing project module", () => {
  const d = redProj("a.test.mjs", 'import {test} from "node:test"; import {f} from "./impl.js"; test("t", () => f())')
  writeFileSync(join(d, "impl.js"), "export const g = 1\n")
  assert.equal(red(d).passed, true)
})

test("RED rejects a syntax error, a bad node:test import and a non-failing suite", () => {
  const syn = red(redProj("a.test.mjs", "syntax error here("))
  assert.equal(syn.passed, false)
  assert.match(syn.results[0].output, /^RED REJECTED/)
  const bad = red(redProj("a.test.mjs", 'import {test, expect} from "node:test"; test("t", () => expect(1))'))
  assert.equal(bad.passed, false)
  const green = red(redProj("a.test.mjs", 'import {test} from "node:test"; test("t", () => {})'))
  assert.equal(green.passed, false)
})

test("RED rule is skipped for runners that are not node:test", () => {
  assert.deepEqual(classifyRed("FAILED somehow", "/x"), { ok: true })
  const d = proj({ test: "echo boom; exit 3" })
  assert.equal(runGates({ cwd: d, only: ["test"], expect: "fail" }).passed, true)
})
