import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { doctor } from "../cli/doctor.mjs"

const models = { aliases: { strong: "p/a", fast: "p/b" }, proxy: null }
const mkdir = () => {
  const d = mkdtempSync(join(tmpdir(), "doc-"))
  writeFileSync(join(d, "opencode.json"), "{}")
  mkdirSync(join(d, ".opencode/agents"), { recursive: true })
  mkdirSync(join(d, ".opencode/tools"), { recursive: true })
  mkdirSync(join(d, ".opencode/plugins/commitar"), { recursive: true })
  writeFileSync(join(d, ".opencode/tools/gates.ts"), "")
  writeFileSync(join(d, ".opencode/tools/probe.ts"), "")
  mkdirSync(join(d, ".opencode/lib"), { recursive: true })
  writeFileSync(join(d, ".opencode/lib/probe-core.mjs"), "")
  writeFileSync(join(d, ".opencode/plugins/commitar/index.ts"), "")
  writeFileSync(join(d, "package.json"), "{}")
  writeFileSync(join(d, "commitar.json"), JSON.stringify({ gates: { test: "npm test" }, probe: "node {file}" }))
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

test("smoke retries a timeout once", () => {
  let n = 0
  const rs = doctor({ dir: mkdir(), models, run: (c, a) => (a[0] === "run" ? (n++ === 0 ? { ok: false, timedOut: true, out: "" } : { ok: true, out: "ok" }) : fakeRun()(c, a)) })
  assert.ok(rs.find((r) => r.name === "alias strong").ok)
})

test("smoke names a retired model", () => {
  const rs = doctor({ dir: mkdir(), models, run: (c, a) => (a[0] === "run" ? { ok: false, out: "Error: Model unavailable: x" } : fakeRun()(c, a)) })
  assert.match(rs.find((r) => r.name === "alias strong").detail, /retired/)
})

test("--no-smoke skips model calls", () => {
  const calls = []
  doctor({ dir: mkdir(), models, smoke: false, run: (c, a) => (calls.push(a[0]), fakeRun()(c, a)) })
  assert.ok(!calls.includes("run"))
})

test("missing generated files are flagged", () => {
  const d = mkdtempSync(join(tmpdir(), "doc-"))
  assert.deepEqual(failed(doctor({ dir: d, models, run: fakeRun(), smoke: false })), ["generated: opencode.json", "generated: .opencode/agents", "custom tools registered", "commitar.json"])
})

test("v2 needs the plugin, v1 needs the tool files", () => {
  const v2 = (d) => fakeRun({ "--version": { ok: true, out: "opencode v2.0.27" } })
  const d = mkdir()
  assert.deepEqual(failed(doctor({ dir: d, models, run: v2() })), [])
  rmSync(join(d, ".opencode/plugins"), { recursive: true })
  assert.deepEqual(failed(doctor({ dir: d, models, run: v2() })), ["custom tools registered"])
  assert.deepEqual(failed(doctor({ dir: d, models, run: fakeRun() })), [])
  rmSync(join(d, ".opencode/tools"), { recursive: true })
  assert.deepEqual(failed(doctor({ dir: d, models, run: fakeRun() })), ["custom tools registered"])
})

test("commitar.json: missing, invalid and no test gate are flagged", () => {
  const d = mkdir()
  const f = join(d, "commitar.json")
  rmSync(f)
  assert.deepEqual(failed(doctor({ dir: d, models, run: fakeRun() })), ["commitar.json"])
  writeFileSync(f, "{nope")
  assert.match(doctor({ dir: d, models, run: fakeRun() }).find((r) => r.name === "commitar.json").detail, /invalid JSON/)
  writeFileSync(f, JSON.stringify({ gates: { lint: "x" }, probe: "node {file}" }))
  assert.deepEqual(failed(doctor({ dir: d, models, run: fakeRun() })), ["commitar.json"])
})

test("v2 smoke test runs standalone, v1 does not", () => {
  const seen = []
  const spy = (ver) => (c, a) => { if (a[0] === "run") seen.push(a.join(" ")); return fakeRun({ "--version": { ok: true, out: ver } })(c, a) }
  doctor({ dir: mkdir(), models, run: spy("2.0.27") })
  doctor({ dir: mkdir(), models, run: spy("1.19.0") })
  assert.ok(seen.slice(0, 2).every((x) => x.includes("--standalone")))
  assert.ok(seen.slice(2).every((x) => !x.includes("--standalone")))
})

test("stale bash allowlist is flagged after commitar.json changes", () => {
  const d = mkdir()
  writeFileSync(join(d, ".opencode/agents/mega.md"), '  bash:\n    "npm test": allow\n')
  assert.deepEqual(failed(doctor({ dir: d, models, run: fakeRun() })), [])
  writeFileSync(join(d, "commitar.json"), JSON.stringify({ gates: { test: "pytest -q" }, probe: "node {file}" }))
  const rs = doctor({ dir: d, models, run: fakeRun() })
  assert.deepEqual(failed(rs), ["bash allowlist"])
  assert.match(rs.find((r) => r.name === "bash allowlist").detail, /pytest -q/)
})

test("npm test gate without package.json is flagged", () => {
  const d = mkdir()
  rmSync(join(d, "package.json"))
  assert.deepEqual(failed(doctor({ dir: d, models, run: fakeRun() })), ["package.json"])
  writeFileSync(join(d, "commitar.json"), JSON.stringify({ gates: { test: "node --test" }, probe: "node {file}" }))
  assert.deepEqual(failed(doctor({ dir: d, models, run: fakeRun() })), [])
})

test("the commitar-oc repo itself is refused as a target", () => {
  const d = mkdir()
  mkdirSync(join(d, "adapters/opencode"), { recursive: true })
  mkdirSync(join(d, "protocol"), { recursive: true })
  writeFileSync(join(d, "adapters/opencode/generate.mjs"), "")
  writeFileSync(join(d, "protocol/pipeline.md"), "")
  const rs = doctor({ dir: d, models, run: fakeRun() })
  assert.deepEqual(failed(rs), ["target is a project"])
  assert.equal(rs.length, 1)
})

test("a missing probe command is flagged, a declared one passes", () => {
  const d = mkdir()
  writeFileSync(join(d, "commitar.json"), JSON.stringify({ gates: { test: "npm test" } }))
  const rs = doctor({ dir: d, models, run: fakeRun() })
  assert.deepEqual(failed(rs), ["probe"])
  assert.match(rs.find((r) => r.name === "probe").detail, /"probe": "node \{file\}"/)
  writeFileSync(join(d, "commitar.json"), JSON.stringify({ gates: { test: "npm test" }, probe: "python3 {file}" }))
  assert.deepEqual(failed(doctor({ dir: d, models, run: fakeRun() })), [])
})

