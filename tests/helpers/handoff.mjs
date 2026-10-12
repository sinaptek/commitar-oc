// Minimal validator for protocol/handoff.schema.json (required, enums, gate shape). No deps.
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const schema = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../protocol/handoff.schema.json"), "utf8"))

export function validateHandoff(h) {
  const errs = []
  for (const k of schema.required) if (!(k in h)) errs.push(`missing ${k}`)
  if (h.version !== schema.properties.version.const) errs.push("bad version")
  for (const k of ["phase", "status"]) if (k in h && !schema.properties[k].enum.includes(h[k])) errs.push(`bad ${k}`)
  for (const g of h.gates ?? []) if (typeof g.command !== "string" || typeof g.passed !== "boolean") errs.push("bad gate")
  return errs
}
