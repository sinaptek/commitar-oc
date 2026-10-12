import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { doctor } from "../cli/doctor.mjs"

const models = { aliases: { strong: "p/a", fast: "p/b" }, proxy: null }
const mkdir = () => {
  const d = mkdtempSync(join(tmpdir(), "doc-"))
  writeFileSync(join(d, "opencode.json"), "{}")
  mkdirSync(join(d, ".opencode/agents"), { recursive: true })
  return d
}
const fakeRun = (over = {}) => (cmd, args) => {
  const key = args.join(" ")
  if (over[key]) return over[key]
  if (key === "--version") return { ok: true, out: "1.0.0" }
  if (key === "debug config") return { ok: true, out: "{}" }
  if (key === "models") return { ok: true, out: "p/a\np/b" }
  if (args[0] === "run") return { ok: true, out: "ok" }
  return { ok: false, out: "unexpected" }
}
const failed = (rs) => rs.filter((r) => !r.ok).map((r) => r.name)

test("all green", () => assert.deepEqual(failed(doctor({ dir: mkdir(), models, run: fakeRun() })), []))

test("missing opencode stops early with install hint", () => {
  const rs = doctor({ dir: mkdir(), models, run: fakeRun({ "--version": { ok: false, error: "ENOENT" } }) })
  assert.equal(rs.length, 1)
  assert.match(rs[0].detail, /ENOENT/)
})

test("alias missing from opencode models fails", () => {
  const rs = doctor({ dir: mkdir(), models: { ...models, aliases: { strong: "p/zzz" } }, run: fakeRun() })
  assert.deepEqual(failed(rs), ["alias strong"])
})

test("smoke timeout is reported as such", () => {
  const rs = doctor({ dir: mkdir(), models, run: (c, a) => (a[0] === "run" ? { ok: false, timedOut: true, out: "" } : fakeRun()(c, a)) })
  assert.match(rs.find((r) => r.name === "alias strong").detail, /timed out/)
})

test("invalid config surfaces opencode's message", () => {
  const rs = doctor({ dir: mkdir(), models, run: fakeRun({ "debug config": { ok: false, out: "Configuration is invalid" } }) })
  assert.match(rs.find((r) => r.name === "opencode accepts config").detail, /invalid/)
})

test("--no-smoke skips model calls", () => {
  const calls = []
  doctor({ dir: mkdir(), models, smoke: false, run: (c, a) => (calls.push(a[0]), fakeRun()(c, a)) })
  assert.ok(!calls.includes("run"))
})

test("missing generated files are flagged", () => {
  const d = mkdtempSync(join(tmpdir(), "doc-"))
  assert.deepEqual(failed(doctor({ dir: d, models, run: fakeRun(), smoke: false })), ["generated: opencode.json", "generated: .opencode/agents"])
})
