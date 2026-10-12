// persona add: copy a persona from the vendored agency-agents catalog into protocol/roles, trimmed.
// The catalog is a vendored source; only the trimmed copy (with provenance) is tracked.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs"
import { join, basename } from "node:path"
import { spawnSync } from "node:child_process"

const KEEP = /identity|core mission|critical rules|workflow|checklist|communication style|review/i
const stripEmoji = (s) => s.replace(/[\p{Extended_Pictographic}️‍]/gu, "").replace(/\s+/g, " ").trim()

export const slugify = (s) => stripEmoji(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")

export function trimPersona(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) throw new Error("persona is missing frontmatter")
  const fm = Object.fromEntries(m[1].split("\n").map((l) => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2].trim().replace(/^["']|["']$/g, "")]))
  if (!fm.name || !fm.description) throw new Error("persona frontmatter needs name and description")

  const sections = []
  let cur = { heading: null, lines: [] }
  let inFence = false
  for (const line of m[2].split("\n")) {
    if (/^```/.test(line)) inFence = !inFence
    const h = !inFence && line.match(/^##\s+(.*)$/)
    if (h) { sections.push(cur); cur = { heading: stripEmoji(h[1]), lines: [] } } else cur.lines.push(line)
  }
  sections.push(cur)

  const out = []
  for (const s of sections) {
    if (s.heading !== null && !KEEP.test(s.heading)) continue
    let lines = s.lines
    if (s.heading === null) lines = lines.filter((l) => !/^# /.test(l)) // drop the H1 title
    lines = lines.filter((l) => !/^- \*\*Memory\*\*/.test(l))
    // drop fenced code blocks: examples are the token-heavy part
    let fence = false
    lines = lines.filter((l) => (/^```/.test(l) ? ((fence = !fence), false) : !fence))
    const body = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
    if (!body) continue
    out.push(s.heading ? `## ${s.heading}\n\n${body}` : body)
  }
  return { name: slugify(fm.name), description: fm.description, body: out.join("\n\n") }
}

export function findPersona(source, slug) {
  for (const div of readdirSync(source, { withFileTypes: true })) {
    if (!div.isDirectory()) continue
    const f = join(source, div.name, `${slug}.md`)
    if (existsSync(f)) return f
  }
  return null
}

export function sourceRev(source) {
  const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: source, encoding: "utf8" })
  return r.status === 0 ? r.stdout.trim() : "unknown"
}

export function renderRole({ name, description, body }, { model = "fast", edit = "deny", bash = "ask", sourceFile, rev }) {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\nmode: subagent\nmodel: ${model}\npermission:\n  edit: ${edit}\n  bash: ${bash}\n---\n<!-- source: agency-agents@${rev} ${sourceFile}; trimmed by commitar-oc persona add -->\n${body}\n`
}

export function addPersona({ source, rolesDir, slug, ...opts }) {
  const file = findPersona(source, slug)
  if (!file) throw new Error(`persona "${slug}" not found under ${source}`)
  const p = trimPersona(readFileSync(file, "utf8"))
  const target = join(rolesDir, `${p.name}.md`)
  if (existsSync(target) && !opts.force) throw new Error(`${target} exists (use --force)`)
  writeFileSync(target, renderRole(p, { ...opts, sourceFile: `${basename(join(file, ".."))}/${basename(file)}`, rev: sourceRev(source) }))
  return { target, chars: readFileSync(target, "utf8").length, original: readFileSync(file, "utf8").length }
}
