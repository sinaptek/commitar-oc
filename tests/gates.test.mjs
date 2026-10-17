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

test("retry cap: the 3rd failed GREEN run in a row says stop, in the output and in HANDOFF next", () => {
  const d = proj({ test: "exit 1" })
  const run = () => runGates({ cwd: d, phase: "GREEN" })
  const a = run(), b = run()
  assert.equal(a.capReached, false)
  assert.equal(b.capReached, false)
  assert.doesNotMatch(summarize(b), /RETRY CAP/)
  const c = run()
  assert.equal(c.greenFailures, 3)
  assert.equal(c.capReached, true)
  assert.match(summarize(c), /RETRY CAP REACHED \(3 failed GREEN runs in a row\): stop now/)
  const h = JSON.parse(readFileSync(join(d, "HANDOFF.json"), "utf8"))
  assert.equal(h.status, "gate_failed")
  assert.match(h.next, /RETRY CAP REACHED/)
  assert.deepEqual(validateHandoff(h), [])
  assert.equal(run().greenFailures, 4) // keeps saying stop
})

test("retry cap: a pass or another phase resets the count; RED failures and phase-less runs never count", () => {
  const d = proj({ test: "exit 1" })
  const fail = (phase, expect) => runGates({ cwd: d, phase, expect })
  fail("GREEN"); fail("GREEN")
  assert.equal(fail("RED", "pass").greenFailures, 0) // new phase resets
  fail("GREEN"); fail("GREEN")
  writeFileSync(join(d, "commitar.json"), JSON.stringify({ name: "p", gates: { test: "true" } }))
  assert.equal(runGates({ cwd: d, phase: "GREEN" }).greenFailures, 0) // a pass resets
  writeFileSync(join(d, "commitar.json"), JSON.stringify({ name: "p", gates: { test: "exit 1" } }))
  for (let i = 0; i < 5; i++) assert.equal(runGates({ cwd: d, phase: "RED" }).capReached, false)
  for (let i = 0; i < 5; i++) assert.equal(runGates({ cwd: d }).capReached, false)
  assert.equal(runGates({ cwd: d, phase: "GREEN" }).greenFailures, 1)
})

import { testTotals } from "../adapters/opencode/templates/gates-core.mjs"

test("test totals come from node:test's summary lines and appear in the gate summary", () => {
  assert.deepEqual(testTotals("ℹ tests 100\nℹ suites 18\nℹ pass 98\nℹ fail 2\nℹ cancelled 0\n"), { tests: 100, pass: 98, fail: 2 })
  assert.equal(testTotals("ok\n"), null)
  const d = mkdtempSync(join(tmpdir(), "gates-totals-"))
  writeFileSync(join(d, "commitar.json"), JSON.stringify({ gates: { test: "printf 'ℹ tests 7\\nℹ pass 7\\nℹ fail 0\\n'" } }))
  const r = runGates({ cwd: d })
  assert.deepEqual(r.results[0].totals, { tests: 7, pass: 7, fail: 0 })
  assert.match(summarize(r), /PASS test \(.*\) exit=0 tests=7 pass=7 fail=0/)
  writeFileSync(join(d, "commitar.json"), JSON.stringify({ gates: { test: "echo plain" } }))
  assert.doesNotMatch(summarize(runGates({ cwd: d })), /tests=/)
})


// vitest 5.0.5 output captured from real runs (missing module, parse failure, assertion failure, no files, summaries).
const VT_MISSING = ` RUN  v5.0.5 /proj

 ❯ src/a.test.js (0 test)
⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/a.test.js [ src/a.test.js ]
Error: Cannot find module './foo.js' imported from /proj/src/a.test.js
 ❯ src/a.test.js:2:1

 Test Files  1 failed (1)
      Tests  no tests
`
const VT_PARSE = ` RUN  v5.0.5 /proj

 ❯ src/a.test.js (0 test)
⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/a.test.js [ src/a.test.js ]
RolldownError: Parse failure: Parse failed with 1 error:
Unexpected token

 Test Files  1 failed (1)
      Tests  no tests
`
const VT_ASSERT = ` RUN  v5.0.5 /proj

 ❯ src/a.test.js (2 tests | 1 failed) 7ms
   × x 6ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/a.test.js > x
AssertionError: expected 1 to be 2 // Object.is equality

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
`
const VT_NOFILES = ` RUN  v5.0.5 /proj

No test files found, exiting with code 1
`

test("vitest RED: accepts a missing implementation module and a real failing assertion", () => {
  assert.deepEqual(classifyRed(VT_MISSING, "/proj"), { ok: true })
  assert.deepEqual(classifyRed(VT_ASSERT, "/proj"), { ok: true })
})

test("vitest RED: rejects a parse failure, a missing package and a run without test files", () => {
  assert.equal(classifyRed(VT_PARSE, "/proj").ok, false)
  assert.match(classifyRed(VT_PARSE, "/proj").reason, /failed to load/)
  assert.equal(classifyRed(VT_MISSING.replace("'./foo.js'", "'left-pad'"), "/proj").ok, false)
  assert.equal(classifyRed(VT_NOFILES, "/proj").ok, false)
  assert.match(classifyRed(VT_NOFILES, "/proj").reason, /no test files/)
})

test("vitest totals: passed, failed and the total in parentheses", () => {
  assert.deepEqual(testTotals(VT_ASSERT), { tests: 2, pass: 1, fail: 1 })
  assert.deepEqual(testTotals(" Test Files  3 passed (3)\n      Tests  29 passed (29)\n"), { tests: 29, pass: 29, fail: 0 })
  assert.deepEqual(testTotals("      Tests  2 failed | 27 passed | 1 skipped (30)\n"), { tests: 30, pass: 27, fail: 2 })
  assert.equal(testTotals(VT_MISSING), null)
})

test("vitest RED through runGates: parse failure is rejected, missing module accepted", () => {
  const mk = (out) => {
    const d = proj({ test: `printf '%s' "$VT" ; exit 1` })
    return d
  }
  const run = (out) => { process.env.VT = out; try { return runGates({ cwd: mk(out), only: ["test"], expect: "fail", phase: "RED" }) } finally { delete process.env.VT } }
  assert.equal(run(VT_PARSE.replaceAll("/proj", "/x")).passed, false)
  assert.match(run(VT_PARSE).results[0].output, /RED REJECTED/)
  assert.equal(run(VT_MISSING).passed, true)
})

// pytest 9.1.1 output captured from real runs.
const PY_MISSING = `==================================== ERRORS ====================================
__________________________ ERROR collecting test_a.py __________________________
ImportError while importing test module '/proj/test_a.py'.
Traceback:
test_a.py:1: in <module>
    from slugger import slugify
E   ModuleNotFoundError: No module named 'slugger'
=========================== short test summary info ============================
ERROR test_a.py
!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
1 error in 0.07s
`
const PY_NAME = PY_MISSING.replace("ModuleNotFoundError: No module named 'slugger'", "ImportError: cannot import name 'slugify' from 'slugger' (/proj/slugger.py)")
const PY_NAME_FOREIGN = PY_NAME.replace("/proj/slugger.py", "/usr/lib/python3/site-packages/slugger.py")
const PY_SYNTAX = `__________________________ ERROR collecting test_a.py __________________________
E     File "/proj/test_a.py", line 1
E       def test_x(): assert (1 +
E   SyntaxError: '(' was never closed
=========================== short test summary info ============================
ERROR test_a.py
!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
1 error in 0.13s
`
const PY_ASSERT = `F.                                                                       [100%]
=================================== FAILURES ===================================
E   assert 1 == 2
test_a.py:1: AssertionError
=========================== short test summary info ============================
FAILED test_a.py::test_x - assert 1 == 2
1 failed, 1 passed, 1 skipped in 0.01s
`
const PY_FIXTURE = `E   RuntimeError: boom
=========================== short test summary info ============================
ERROR test_a.py::test_x - RuntimeError: boom
1 error in 0.01s
`
const PY_NONE = `

no tests ran in 0.00s
`

test("pytest RED: accepts a missing module, a missing name in a project module and a failing assertion", () => {
  assert.deepEqual(classifyRed(PY_MISSING, "/proj"), { ok: true })
  assert.deepEqual(classifyRed(PY_NAME, "/proj"), { ok: true })
  assert.deepEqual(classifyRed(PY_ASSERT, "/proj"), { ok: true })
})

test("pytest RED: rejects a syntax error, a name missing from a foreign module, a fixture error and a run without tests", () => {
  assert.match(classifyRed(PY_SYNTAX, "/proj").reason, /failed to collect.*SyntaxError/)
  assert.equal(classifyRed(PY_NAME_FOREIGN, "/proj").ok, false)
  assert.match(classifyRed(PY_FIXTURE, "/proj").reason, /fixture error/)
  assert.match(classifyRed(PY_NONE, "/proj").reason, /ran no tests/)
})

test("pytest totals: quiet and verbose summaries, errors count as failures, no tests gives none", () => {
  assert.deepEqual(testTotals(PY_ASSERT), { tests: 3, pass: 1, fail: 1 })
  assert.deepEqual(testTotals("============================== 2 passed in 0.00s ===============================\n"), { tests: 2, pass: 2, fail: 0 })
  assert.deepEqual(testTotals(PY_MISSING), { tests: 1, pass: 0, fail: 1 })
  assert.equal(testTotals(PY_NONE), null)
})

test("SPEC baseline with no tests at all is a legitimate fail; the same output is rejected at RED", () => {
  const d = proj({ test: `printf 'no tests ran in 0.00s\\n'; exit 5` })
  assert.equal(runGates({ cwd: d, only: ["test"], expect: "fail", phase: "SPEC" }).passed, true)
  const r = runGates({ cwd: d, only: ["test"], expect: "fail", phase: "RED" })
  assert.equal(r.passed, false)
  assert.match(r.results[0].output, /RED REJECTED: pytest ran no tests/)
  const v = proj({ test: `printf 'No test files found, exiting with code 1\\n'; exit 1` })
  assert.equal(runGates({ cwd: v, only: ["test"], expect: "fail", phase: "SPEC" }).passed, true)
})

