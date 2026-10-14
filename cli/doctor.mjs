// doctor: environment checks. `run(cmd, args, {cwd, timeout})` is injected so checks are testable.
import { spawnSync } from "node:child_process"
import { accessSync, constants, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export function defaultRun(cmd, args, { cwd, timeout = 30000 } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout })
  return {
    ok: r.status === 0 && !r.error,
    timedOut: r.error?.code === "ETIMEDOUT",
    out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim(),
    error: r.error?.message,
  }
}

const pass = (name, detail = "") => ({ name, ok: true, detail })
const fail = (name, detail) => ({ name, ok: false, detail })

export function doctor({ dir, models, run = defaultRun, smoke = true, smokeTimeoutMs = 60000, vault = null }) {
  const results = []

  const v = run("opencode", ["--version"])
  if (!v.ok) return [fail("opencode installed", v.error ?? "not found; run: npm i -g opencode-ai")]
  results.push(pass("opencode installed", v.out))
  const major = Number(/(\d+)\.\d+\.\d+/.exec(v.out)?.[1])
  const v2 = major >= 2

  try { accessSync(dir, constants.W_OK); results.push(pass("target dir writable", dir)) }
  catch { results.push(fail("target dir writable", `${dir} (check owner/group; keep it group-writable)`)) }

  for (const f of ["opencode.json", ".opencode/agents"]) {
    results.push(existsSync(join(dir, f)) ? pass(`generated: ${f}`) : fail(`generated: ${f}`, "missing; run: commitar-oc init"))
  }

  // OpenCode v2 ignores .opencode/tools and loads custom tools from plugins; v1 is the reverse.
  const toolFiles = v2 ? [".opencode/plugins/commitar/index.ts"] : [".opencode/tools/gates.ts"]
  const missingTools = toolFiles.filter((f) => !existsSync(join(dir, f)))
  results.push(missingTools.length ? fail("custom tools registered", `${missingTools.join(", ")} missing for OpenCode ${v2 ? "v2" : "v1"}; run: commitar-oc init`)
    : pass("custom tools registered", v2 ? "v2 plugin" : "v1 tools"))

  const gcfg = join(dir, "commitar.json")
  try {
    const g = JSON.parse(readFileSync(gcfg, "utf8"))
    results.push(typeof g.gates?.test === "string" && g.gates.test ? pass("commitar.json", `test gate: ${g.gates.test}`)
      : fail("commitar.json", 'no "gates.test" command; a missing test gate always fails'))
  } catch (e) {
    results.push(fail("commitar.json", e.code === "ENOENT" ? "missing; run: commitar-oc init" : `invalid JSON: ${e.message}`))
  }

  const cfg = run("opencode", ["debug", "config"], { cwd: dir })
  results.push(cfg.ok ? pass("opencode accepts config") : fail("opencode accepts config", cfg.out.split("\n").slice(0, 3).join(" | ")))

  const list = run("opencode", ["models"], { cwd: dir })
  const known = new Set(list.out.split("\n").map((l) => l.trim()))
  for (const [alias, id] of Object.entries(models.aliases)) {
    if (!list.ok) { results.push(fail(`alias ${alias}`, "cannot list models")); continue }
    if (!known.has(id)) { results.push(fail(`alias ${alias}`, `${id} not in \`opencode models\``)); continue }
    if (!smoke) { results.push(pass(`alias ${alias}`, `${id} (not smoke-tested)`)); continue }
    const t0 = Date.now()
    const s = run("opencode", ["run", ...(v2 ? ["--standalone"] : []), "-m", id, "Reply with the single word: ok"], { cwd: dir, timeout: smokeTimeoutMs })
    const secs = ((Date.now() - t0) / 1000).toFixed(1)
    results.push(
      s.ok && /\bok\b/i.test(s.out) ? pass(`alias ${alias}`, `${id} answered in ${secs}s`)
        : fail(`alias ${alias}`, s.timedOut ? `${id} timed out after ${smokeTimeoutMs / 1000}s (free models can stall)` : `${id}: ${s.out.slice(-200)}`),
    )
  }

  if (vault) {
    const ok = existsSync(join(vault.path, "_CLAUDE.md"))
    let writable = false
    try { accessSync(vault.path, constants.W_OK); writable = true } catch {}
    results.push(ok && writable ? pass("vault", vault.path) : fail("vault", `${vault.path} ${ok ? "is not writable by this user" : "is not an initialized vault; run: commitar-oc vault init"}`))
  }

  if (models.proxy) {
    const url = models.proxy.baseURL.replace(/\/v1\/?$/, "") + "/livez"
    const p = run("curl", ["-s", "-m", "5", "-o", "/dev/null", "-w", "%{http_code}", url])
    results.push(p.ok && p.out === "200" ? pass("proxy reachable", url) : fail("proxy reachable", `${url} -> ${p.out || "no response"}`))
  }
  return results
}

export function format(results) {
  return results.map((r) => `${r.ok ? "ok  " : "FAIL"} ${r.name}${r.detail ? ` - ${r.detail}` : ""}`).join("\n")
}
