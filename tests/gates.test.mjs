import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { runGates, summarize } from "../adapters/opencode/templates/gates-core.mjs"
import { validateHandoff } from "./helpers/handoff.mjs"

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
