import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { trimPersona, slugify, addPersona, renderRole } from "../cli/personas.mjs"
import { parseRole, generate, loadRoles } from "../adapters/opencode/generate.mjs"

const PERSONA = `---
name: Test Wizard
description: Writes tests: carefully, with colons
color: red
emoji: 🧪
---

# Test Wizard Agent

You are **Test Wizard**.

## 🧠 Your Identity & Memory

- **Role**: tester
- **Memory**: you remember everything

## 📋 Your Technical Deliverables

\`\`\`js
// huge example
\`\`\`

## 🎯 Your Core Mission

Write good tests.

\`\`\`
## not a heading inside a fence
\`\`\`

## 📈 Success Metrics

- 100%
`

test("slugify strips emoji and punctuation", () => assert.equal(slugify("🧪 Test Wizard!"), "test-wizard"))

test("trim keeps identity and mission, drops deliverables, metrics, memory lines and code", () => {
  const t = trimPersona(PERSONA)
  assert.equal(t.name, "test-wizard")
  assert.match(t.body, /You are \*\*Test Wizard\*\*/)
  assert.match(t.body, /## Your Identity & Memory/)
  assert.match(t.body, /## Your Core Mission/)
  assert.doesNotMatch(t.body, /Deliverables|Success Metrics|huge example|remember everything|^# Test Wizard Agent/m)
  assert.doesNotMatch(t.body, /not a heading inside a fence/)
})

test("persona without frontmatter is rejected", () => assert.throws(() => trimPersona("# nope"), /frontmatter/))

test("rendered role round-trips through parseRole, colons in description intact", () => {
  const role = renderRole(trimPersona(PERSONA), { rev: "abc", sourceFile: "x/y.md" })
  const { meta } = parseRole(role)
  assert.equal(meta.description, "Writes tests: carefully, with colons")
  assert.equal(meta.name, "test-wizard")
  assert.equal(meta.permission.edit, "deny")
  assert.match(role, /source: agency-agents@abc/)
})

test("addPersona finds it in any division, refuses overwrite without force", () => {
  const src = mkdtempSync(join(tmpdir(), "src-"))
  mkdirSync(join(src, "testing"))
  writeFileSync(join(src, "testing", "testing-wizard.md"), PERSONA)
  const roles = mkdtempSync(join(tmpdir(), "roles-"))
  const r = addPersona({ source: src, rolesDir: roles, slug: "testing-wizard" })
  assert.match(readFileSync(r.target, "utf8"), /name: test-wizard/)
  assert.throws(() => addPersona({ source: src, rolesDir: roles, slug: "testing-wizard" }), /exists/)
  assert.doesNotThrow(() => addPersona({ source: src, rolesDir: roles, slug: "testing-wizard", force: true }))
  assert.throws(() => addPersona({ source: src, rolesDir: roles, slug: "nope" }), /not found/)
})

test("generated agents quote descriptions once and mega lists the specialists", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const models = JSON.parse(readFileSync(join(root, "models.json"), "utf8"))
  const files = generate({ models, roles: loadRoles(join(root, "protocol/roles")) })
  const cr = files[".opencode/agents/code-reviewer.md"]
  assert.match(cr, /^description: "Expert code reviewer[^"]*"$/m)
  assert.doesNotMatch(cr, /description: "\\"/)
  const mega = files[".opencode/agents/mega.md"]
  assert.match(mega, /## Available subagents/)
  for (const n of ["tester", "implementer", "auditor", "code-reviewer", "software-architect"]) assert.match(mega, new RegExp(`- @${n}:`))
  assert.doesNotMatch(mega, /- @mega:/)
})
