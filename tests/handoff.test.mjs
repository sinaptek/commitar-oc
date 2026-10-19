import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "node:http"
import { validateHandoff, buildBundle, exportHandoff, pushHandoff } from "../cli/handoff.mjs"

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

test("markdown labels gates by phase and marks RED as expected fail", () => {
  const md = buildBundle({ dir: proj({ ...ok, gates: [{ phase: "RED", command: "t", passed: true }, { phase: "GREEN", command: "t", passed: false, output: "boom" }] }), run: noGit }).md
  assert.match(md, /- PASS RED `t` \(expected fail\)/)
  assert.match(md, /- FAIL GREEN `t`\n/)
  assert.match(md, /Output of GREEN `t`/)
})

// handoff push, against a real local HTTP server
const hcp = async (handler, fn) => {
  const seen = []
  const srv = createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => { seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body }); handler(req, res, seen) })
  })
  await new Promise((r) => srv.listen(0, "127.0.0.1", r))
  try { return await fn(`http://127.0.0.1:${srv.address().port}`, seen) } finally { srv.close() }
}
const reply = (code, obj) => (req, res) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)) }

test("push sends the exported bundle (with git state) to /api/handoffs with the bearer token", async () => {
  await hcp(reply(200, { workItemId: "oc:p", changed: true, decisionRequestId: null }), async (url, seen) => {
    const r = await pushHandoff({ dir: proj(ok, "# spec"), url, token: "tok", run: gitRun(false) })
    assert.equal(r.error, undefined)
    assert.deepEqual(r.result, { workItemId: "oc:p", changed: true, decisionRequestId: null })
    assert.equal(seen.length, 1)
    assert.equal(seen[0].method, "POST")
    assert.equal(seen[0].url, "/api/handoffs")
    assert.equal(seen[0].auth, "Bearer tok")
    const sent = JSON.parse(seen[0].body)
    assert.equal(sent.project, "p")
    assert.equal(sent.git.head, "abc123")
    assert.ok(sent.exportedAt)
  })
})

test("push sends no authorization header without a token", async () => {
  await hcp(reply(200, {}), async (url, seen) => {
    await pushHandoff({ dir: proj(ok), url, run: noGit })
    assert.equal(seen[0].auth, undefined)
  })
})

test("push reports the server's error for a 400 and a 401", async () => {
  await hcp(reply(400, { error: "Not a valid HANDOFF v1: version" }), async (url) => {
    assert.match((await pushHandoff({ dir: proj(ok), url, run: noGit })).error, /answered 400: Not a valid HANDOFF v1/)
  })
  await hcp(reply(401, { error: "Unauthorized" }), async (url) => {
    assert.match((await pushHandoff({ dir: proj(ok), url, run: noGit })).error, /answered 401: Unauthorized/)
  })
})

test("push does not send an invalid or missing HANDOFF.json", async () => {
  await hcp(reply(200, {}), async (url, seen) => {
    assert.match((await pushHandoff({ dir: proj(), url, run: noGit })).error, /not found/)
    assert.match((await pushHandoff({ dir: proj({ version: 1 }), url, run: noGit })).error, /invalid/)
    assert.equal(seen.length, 0)
  })
})

test("push fails clearly on a missing or bad url, an unreachable server, and a token over plain http to a remote host", async () => {
  const dir = proj(ok)
  assert.match((await pushHandoff({ dir, run: noGit })).error, /no HCP url/)
  assert.match((await pushHandoff({ dir, url: "nope", run: noGit })).error, /not a valid url/)
  assert.match((await pushHandoff({ dir, url: "ftp://x", run: noGit })).error, /http or https/)
  assert.match((await pushHandoff({ dir, url: "http://127.0.0.1:1", run: noGit, timeoutMs: 3000 })).error, /could not reach/)
  let called = false
  const spy = async () => { called = true; return { ok: true, text: async () => "{}" } }
  assert.match((await pushHandoff({ dir, url: "http://hcp.example.com", token: "t", fetchImpl: spy, run: noGit })).error, /refusing to send the token/)
  assert.equal(called, false)
  assert.equal((await pushHandoff({ dir, url: "http://hcp.example.com", token: "t", allowHttp: true, fetchImpl: spy, run: noGit })).error, undefined)
  assert.equal((await pushHandoff({ dir, url: "https://hcp.example.com", token: "t", fetchImpl: spy, run: noGit })).error, undefined)
})

test("the project's absolute path is scrubbed from gate command and output, in json and markdown", () => {
  const dir = proj()
  const h = { ...ok, status: "gate_failed", gates: [{ command: `node ${dir}/t.js`, passed: false, output: `Error at ${dir}/src/a.js:3\n    at ${dir}/node_modules/x` }] }
  writeFileSync(join(dir, "HANDOFF.json"), JSON.stringify(h))
  const b = buildBundle({ dir, run: noGit })
  assert.ok(!JSON.stringify(b.json).includes(dir) && !b.md.includes(dir))
  assert.equal(b.json.gates[0].output, "Error at <project>/src/a.js:3\n    at <project>/node_modules/x")
  assert.equal(readFileSync(join(dir, "HANDOFF.json"), "utf8").includes(dir), true) // the file on disk is left alone
})
