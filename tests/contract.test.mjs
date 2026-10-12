// Pins the v1 HANDOFF contract. A failure here means the contract changed: bump `version`
// for breaking changes, and update this pin and protocol/CONTRACT.md in the same commit.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { validateHandoff } from "../cli/handoff.mjs"

const proto = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "protocol")
const schema = JSON.parse(readFileSync(join(proto, "handoff.schema.json"), "utf8"))
const example = JSON.parse(readFileSync(join(proto, "handoff.example.json"), "utf8"))

test("v1 shape is pinned", () => {
  assert.equal(schema.properties.version.const, 1)
  assert.deepEqual(schema.required, ["version", "project", "phase", "status"])
  assert.deepEqual(schema.properties.phase.enum, ["SPEC", "RED", "GREEN", "AUDIT", "COMMIT"])
  assert.deepEqual(schema.properties.status.enum, ["pending", "in_progress", "gate_failed", "done"])
  assert.deepEqual(Object.keys(schema.properties).sort(),
    ["commits", "exportedAt", "gates", "git", "next", "phase", "project", "spec", "status", "version"])
})

test("golden sample validates and uses only known fields", () => {
  assert.deepEqual(validateHandoff(example), [])
  for (const k of Object.keys(example)) assert.ok(k in schema.properties, `unknown field ${k}`)
})

test("a consumer that ignores unknown fields still accepts a future optional field", () => {
  assert.deepEqual(validateHandoff({ ...example, someFutureField: 1 }), [])
})
