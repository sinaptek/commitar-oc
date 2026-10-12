import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { saveNote, slug } from "../adapters/opencode/templates/vault-core.mjs"
import { generate, loadRoles } from "../adapters/opencode/generate.mjs"
import { initVault } from "../cli/vault.mjs"
import { doctor } from "../cli/doctor.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const mkVault = () => { const d = mkdtempSync(join(tmpdir(), "vault-")); writeFileSync(join(d, "_CLAUDE.md"), "x"); return d }
const now = new Date("2026-03-04T10:00:00Z")
const base = { kind: "spec", project: "My App", title: "Slugify spec", summary: "Goal: x", now }

test("spec note has AI-first frontmatter, preamble and stable name", () => {
  const v = mkVault()
  const r = saveNote({ vaultPath: v, ...base })
  assert.equal(r.path, join(v, "Architecture", "my-app-spec.md"))
  const t = readFileSync(r.path, "utf8")
  assert.match(t, /^---\ndate: 2026-03-04\ntype: architecture\ntags:\n  - architecture\n  - my-app\nai-first: true\nproject: my-app\n/)
  assert.match(t, /## For future agent/)
  assert.match(t, /Goal: x/)
})

test("saving a spec twice overwrites; devlog is dated", () => {
  const v = mkVault()
  saveNote({ vaultPath: v, ...base, summary: "one" })
  saveNote({ vaultPath: v, ...base, summary: "two" })
  assert.match(readFileSync(join(v, "Architecture", "my-app-spec.md"), "utf8"), /two/)
  assert.equal(saveNote({ vaultPath: v, ...base, kind: "devlog" }).path, join(v, "Dev Logs", "2026-03-04-my-app-slugify-spec.md"))
})

test("banned unicode is converted to ASCII", () => {
  const v = mkVault()
  const r = saveNote({ vaultPath: v, ...base, title: "A — B", summary: "it’s “ok” …" })
  const t = readFileSync(r.path, "utf8")
  assert.doesNotMatch(t, /[—–‘’“”…]/)
  assert.match(t, /it's "ok" \.\.\./)
})

test("secrets, bad kinds, missing vault and empty input are refused without writing", () => {
  const v = mkVault()
  for (const summary of ["key sk-abcdefghijklmnopqrstuvwxyz1234", "password = hunter2hunter2", "-----BEGIN RSA PRIVATE KEY-----"]) {
    const r = saveNote({ vaultPath: v, ...base, summary })
    assert.equal(r.ok, false); assert.match(r.error, /secret/)
  }
  assert.equal(existsSync(join(v, "Architecture")), false)
  assert.match(saveNote({ vaultPath: v, ...base, kind: "x" }).error, /unknown kind/)
  assert.match(saveNote({ vaultPath: tmpdir(), ...base }).error, /not an initialized vault/)
  assert.match(saveNote({ vaultPath: v, ...base, summary: "  " }).error, /empty/)
})

test("path traversal in project/title cannot escape the folder", () => {
  const v = mkVault()
  const r = saveNote({ vaultPath: v, ...base, project: "../../etc", title: "../x" })
  assert.ok(r.path.startsWith(join(v, "Architecture")))
  assert.equal(slug("../../x"), "x")
})

test("generator adds vault tool and mega instruction only when configured", () => {
  const models = JSON.parse(readFileSync(join(root, "models.json"), "utf8"))
  const roles = loadRoles(join(root, "protocol/roles"))
  const off = generate({ models, roles })
  assert.equal(off[".opencode/tools/vault_save.ts"], undefined)
  assert.doesNotMatch(off[".opencode/agents/mega.md"], /Knowledge vault/)
  const on = generate({ models, roles, vault: { path: "/v/ault" } })
  assert.match(on[".opencode/tools/vault_save.ts"], /const VAULT = "\/v\/ault"/)
  assert.match(on[".opencode/agents/mega.md"], /Knowledge vault[\s\S]*never depends on the vault/)
  assert.doesNotMatch(on[".opencode/agents/tester.md"], /vault_save/)
})

test("initVault refuses a non-empty non-vault dir and unknown commands", () => {
  const src = mkdtempSync(join(tmpdir(), "sb-"))
  mkdirSync(join(src, "scripts")); mkdirSync(join(src, "commands"))
  writeFileSync(join(src, "scripts/bootstrap_vault.py"), "")
  writeFileSync(join(src, "commands/a.md"), "")
  const dir = mkdtempSync(join(tmpdir(), "notvault-")); writeFileSync(join(dir, "stuff"), "1")
  assert.throws(() => initVault({ config: { path: dir, commands: ["a"], owner: "o", preset: "builder" }, source: src, run: () => ({ ok: true, out: "" }) }), /not empty/)
  assert.throws(() => initVault({ config: { path: dir, commands: ["zzz"], owner: "o", preset: "builder" }, source: src }), /unknown command/)
})

test("doctor flags an uninitialized vault", () => {
  const d = mkdtempSync(join(tmpdir(), "d-")); writeFileSync(join(d, "opencode.json"), "{}"); mkdirSync(join(d, ".opencode/agents"), { recursive: true })
  const run = (c, a) => (a[0] === "models" ? { ok: true, out: "p/a" } : { ok: true, out: "1.0" })
  const rs = doctor({ dir: d, models: { aliases: { strong: "p/a" } }, run, smoke: false, vault: { path: join(d, "nope") } })
  assert.match(rs.find((r) => r.name === "vault").detail, /vault init/)
})
