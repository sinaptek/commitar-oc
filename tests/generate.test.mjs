import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { generate, loadRoles, resolveModel } from "../adapters/opencode/generate.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const models = JSON.parse(readFileSync(join(root, "models.json"), "utf8"))
const roles = loadRoles(join(root, "protocol/roles"))

test("agents use resolved model ids, never aliases", () => {
  const files = generate({ models, roles })
  assert.match(files[".opencode/agents/tester.md"], new RegExp(`model: ${models.aliases.fast}`))
  assert.doesNotMatch(files[".opencode/agents/tester.md"], /model: fast/)
})

test("no provider block unless a proxy is configured", () => {
  assert.equal(JSON.parse(generate({ models, roles })["opencode.json"]).provider, undefined)
  const proxied = { ...models, proxy: { provider: "openai", baseURL: "http://127.0.0.1:6768/v1" } }
  const cfg = JSON.parse(generate({ models: proxied, roles })["opencode.json"])
  assert.equal(cfg.provider.openai.options.baseURL, "http://127.0.0.1:6768/v1")
})

test("generator emits the gates tool and runner", () => {
  const files = generate({ models, roles })
  assert.match(files[".opencode/tools/gates.ts"], /tool\(\{/)
  assert.ok(files[".opencode/lib/gates-core.mjs"].includes("runGates"))
})

test("generator emits a v2 plugin registering gates (v2 ignores .opencode/tools)", () => {
  const files = generate({ models, roles })
  const plugin = files[".opencode/plugins/commitar/index.ts"]
  assert.match(plugin, /name: "gates"/)
  assert.match(plugin, /const VAULT = null/)
  assert.doesNotMatch(plugin, /vault-core/)
})

test("unknown alias fails loudly", () => {
  assert.throws(() => resolveModel(models, "nope"), /unknown model alias/)
})

test("init output passes opencode debug config", () => {
  const dir = mkdtempSync(join(tmpdir(), "coc-"))
  const r = spawnSync("node", [join(root, "cli/commitar-oc.mjs"), "init", dir], { encoding: "utf8" })
  assert.equal(r.status, 0, r.stderr + r.stdout)
  assert.ok(existsSync(join(dir, ".opencode/agents/mega.md")))
})

test("agents that mention gates are told to call it through execute", () => {
  const files = generate({ models, roles })
  for (const r of roles.filter((x) => /`gates`/.test(x.body))) {
    assert.match(files[`.opencode/agents/${r.meta.name}.md`], /through the `execute` tool as `tools\.<name>\(args\)`/)
  }
  assert.doesNotMatch(files[".opencode/agents/code-reviewer.md"], /Calling the tools/)
})

test("bash allowlist: gate commands and read-only git allowed, destructive denied, last match order", () => {
  const files = generate({ models, roles, gates: { test: "pytest -q", lint: "ruff check ." } })
  const tester = files[".opencode/agents/tester.md"]
  assert.match(tester, /bash:\n    "\*": ask\n/)
  for (const c of ['"pytest -q": allow', '"pytest -q *": allow', '"ruff check .": allow', '"git status *": allow', '"git commit *": allow']) assert.ok(tester.includes(c), c)
  assert.ok(tester.indexOf('"rm -rf *": deny') > tester.indexOf('"git commit *": allow'), "denies must come last")
  const auditor = files[".opencode/agents/auditor.md"]
  assert.doesNotMatch(auditor, /git (add|commit)/)
  assert.match(auditor, /bash:\n    "\*": deny\n/, "read-only roles must not be able to write through bash")
  assert.match(auditor, /edit: deny/)
  assert.match(generate({ models, roles })[".opencode/agents/mega.md"], /"npm test": allow/)
})

test("read-only git is allowed in the shapes models write, writes and pushes stay out", async () => {
  const { bashRules } = await import("../adapters/opencode/generate.mjs")
  const rules = bashRules({ test: "npm test" }, false)
  const allowed = new Set(rules.filter(([, e]) => e === "allow").map(([p]) => p))
  for (const sub of ["status", "diff", "log", "show"]) {
    for (const p of [`git ${sub}`, `git ${sub} *`, `git --no-pager ${sub}`, `git --no-pager ${sub} *`, `git -C * ${sub}`, `git -C * ${sub} *`]) assert.ok(allowed.has(p), p)
  }
  for (const p of ["git -C *", "git --no-pager *", "git *", "git add *", "git commit *", "git push *"]) assert.ok(!allowed.has(p), `${p} must not be allowed for a read-only role`)
  assert.equal(rules[0][1], "deny")
})
