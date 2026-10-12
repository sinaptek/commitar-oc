#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { generate, loadRoles } from "../adapters/opencode/generate.mjs"
import { doctor, format } from "./doctor.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

export function validate(dir) {
  const r = spawnSync("opencode", ["debug", "config"], { cwd: dir, encoding: "utf8" })
  if (r.error) return { ok: false, output: `cannot run opencode: ${r.error.message}` }
  return { ok: r.status === 0, output: (r.stderr || r.stdout).trim() }
}

function init(target) {
  const models = JSON.parse(readFileSync(join(root, "models.json"), "utf8"))
  const files = generate({ models, roles: loadRoles(join(root, "protocol/roles")) })
  for (const [rel, content] of Object.entries(files)) {
    const path = join(target, rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
    console.log(`wrote ${rel}`)
  }
  const v = validate(target)
  if (!v.ok) { console.error(`opencode rejected the generated config:\n${v.output}`); process.exit(1) }
  console.log("opencode debug config: ok")
}

function runDoctor(args) {
  const smoke = !args.includes("--no-smoke")
  const dir = resolve(args.find((a) => !a.startsWith("--")) ?? ".")
  const models = JSON.parse(readFileSync(join(root, "models.json"), "utf8"))
  const results = doctor({ dir, models, smoke })
  console.log(format(results))
  process.exit(results.every((r) => r.ok) ? 0 : 1)
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === "init") init(resolve(rest[0] ?? "."))
else if (cmd === "doctor") runDoctor(rest)
else { console.error("usage: commitar-oc init [dir] | doctor [dir] [--no-smoke]"); process.exit(cmd ? 1 : 0) }
