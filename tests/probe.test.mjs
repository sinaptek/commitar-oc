import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { runProbe, summarizeProbe } from "../adapters/opencode/templates/probe-core.mjs"

const proj = (cfg = { probe: "node {file}", gates: { test: "true" } }) => {
  const d = mkdtempSync(join(tmpdir(), "probe-"))
  writeFileSync(join(d, "commitar.json"), JSON.stringify(cfg))
  mkdirSync(join(d, "src"))
  writeFileSync(join(d, "src/lib.mjs"), "export const double = (n) => n * 2\n")
  writeFileSync(join(d, "HANDOFF.json"), "{}")
  return d
}
const leftovers = () => readdirSync(tmpdir()).filter((f) => f.startsWith("commitar-probe-"))

test("a snippet runs against the project's own modules and its output comes back", () => {
  const d = proj()
  const r = runProbe({ cwd: d, code: 'import { double } from "./src/lib.mjs"; console.log(double(21)); console.error("warn")' })
  assert.equal(r.ok, true)
  assert.equal(r.exitCode, 0)
  assert.match(r.output, /42/)
  assert.match(r.output, /warn/)
  assert.match(summarizeProbe(r), /^PROBE exit=0 \(executed in a throwaway copy of the project; nothing was kept\)\n/)
})

test("a failing snippet reports its exit code and error", () => {
  const r = runProbe({ cwd: proj(), code: 'throw new Error("boom")' })
  assert.equal(r.ok, true)
  assert.notEqual(r.exitCode, 0)
  assert.match(r.output, /boom/)
})

test("nothing the snippet does reaches the real project, and the copy is deleted", () => {
  const d = proj()
  const before = leftovers().length
  const code = 'import { writeFileSync, appendFileSync, existsSync } from "node:fs"; writeFileSync("src/lib.mjs", "BROKEN"); writeFileSync("new.txt", "x"); console.log(existsSync("HANDOFF.json"), existsSync(".git"))'
  const r = runProbe({ cwd: d, code })
  assert.match(r.output, /false false/, "HANDOFF.json and .git are not copied")
  assert.equal(readFileSync(join(d, "src/lib.mjs"), "utf8"), "export const double = (n) => n * 2\n")
  assert.equal(existsSync(join(d, "new.txt")), false)
  assert.equal(leftovers().length, before)
})

test("dependency directories are linked, so the project's own packages resolve", () => {
  const d = proj()
  mkdirSync(join(d, "node_modules/dep"), { recursive: true })
  writeFileSync(join(d, "node_modules/dep/package.json"), '{"name":"dep","type":"module","main":"i.js"}')
  writeFileSync(join(d, "node_modules/dep/i.js"), 'export default "from-dep"')
  const r = runProbe({ cwd: d, code: 'import dep from "dep"; console.log(dep)' })
  assert.match(r.output, /from-dep/)
})

test("a runaway snippet is stopped by the timeout", () => {
  const r = runProbe({ cwd: proj(), code: "while (true) {}", timeoutMs: 400 })
  assert.equal(r.ok, true)
  assert.equal(r.timedOut, true)
  assert.match(summarizeProbe(r), /timed out/)
})

test("output is truncated to the tail", () => {
  const r = runProbe({ cwd: proj(), code: 'console.log("a".repeat(5000) + "END")' })
  assert.ok(r.output.length <= 2000)
  assert.match(r.output, /END$/)
})

test("errors: no probe declared, no placeholder, no code, huge code, no commitar.json", () => {
  assert.match(summarizeProbe(runProbe({ cwd: proj({ gates: {} }), code: "1" })), /PROBE ERROR: probe is not declared/)
  assert.match(summarizeProbe(runProbe({ cwd: proj({ probe: "node x.js" }), code: "1" })), /not declared/)
  assert.match(summarizeProbe(runProbe({ cwd: proj(), code: "  " })), /no code/)
  assert.match(summarizeProbe(runProbe({ cwd: proj(), code: "x".repeat(20001) })), /longer than/)
  assert.match(summarizeProbe(runProbe({ cwd: mkdtempSync(join(tmpdir(), "probe-")), code: "1" })), /commitar.json unreadable/)
})

const hasPython = spawnSync("python3", ["--version"]).status === 0
test("python probe: the project root is importable and the extension is .py", { skip: !hasPython }, () => {
  const d = proj({ probe: "python3 {file}", gates: { test: "true" } })
  mkdirSync(join(d, "shop"))
  writeFileSync(join(d, "shop/__init__.py"), "")
  writeFileSync(join(d, "shop/m.py"), "def f(x): return x + 1\n")
  const r = runProbe({ cwd: d, code: "from shop.m import f\nprint(f(41))" })
  assert.equal(r.exitCode, 0)
  assert.match(r.output, /42/)
  assert.equal(existsSync(join(d, "shop/__pycache__")), false, "no bytecode written into the real project")
})

const GO = `${process.env.HOME}/go-sdk/go/bin`
const hasGo = spawnSync("go", ["version"], { env: { ...process.env, PATH: `${GO}:${process.env.PATH}` } }).status === 0
test("go probe: a package main snippet runs next to the project's library package", { skip: !hasGo }, () => {
  const d = mkdtempSync(join(tmpdir(), "probe-"))
  writeFileSync(join(d, "commitar.json"), JSON.stringify({ probe: `PATH=${GO}:$PATH go run {file}`, gates: { test: "true" } }))
  writeFileSync(join(d, "go.mod"), "module example.com/m\n\ngo 1.22\n")
  writeFileSync(join(d, "m.go"), "package m\n\nfunc Double(n int) int { return n * 2 }\n")
  const code = 'package main\n\nimport (\n\t"fmt"\n\t"example.com/m"\n)\n\nfunc main() { fmt.Println(m.Double(21)) }\n'
  const r = runProbe({ cwd: d, code })
  assert.equal(r.exitCode, 0, r.output)
  assert.match(r.output, /42/)
  assert.equal(existsSync(join(d, "probe_snippet")), false, "nothing written into the real project")
})
