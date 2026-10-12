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

test("unknown alias fails loudly", () => {
  assert.throws(() => resolveModel(models, "nope"), /unknown model alias/)
})

test("init output passes opencode debug config", () => {
  const dir = mkdtempSync(join(tmpdir(), "coc-"))
  const r = spawnSync("node", [join(root, "cli/commitar-oc.mjs"), "init", dir], { encoding: "utf8" })
  assert.equal(r.status, 0, r.stderr + r.stdout)
  assert.ok(existsSync(join(dir, ".opencode/agents/mega.md")))
})
