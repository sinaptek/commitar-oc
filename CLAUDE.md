# commitar-oc

Free-tier companion to paid commitar. OpenCode is the engine; our logic lives in an
OpenCode-independent layer, and a thin CLI generates and validates the OpenCode config.
Full rationale: `docs/design-notes.md` (read it first).

## Architecture (target)
1. `protocol/` – tool-agnostic phase pipeline (spec, RED, GREEN, AUDIT, commit), agent roles,
   vault conventions, and the HANDOFF state file paid commitar can ingest. Plain md + JSON.
2. `adapters/opencode/` – templates → generated `opencode.json`, `agents/*.md`, commands, tools.
   Never hand-edit generated output. Model IDs live only in one alias file (`strong`, `fast`).
3. `cli/` – `init`, `doctor` (providers, MCP, paths), `handoff export`. Does not run the agent loop.
4. Models: aliases in `models.json` default to OpenCode free models (no key). No fallback chain in v1.
   Headroom (Windows PC, ports ~6767/6768) is context compression only, not a router: optional `proxy`.

## Current state
- Only reference material exists. `.opencode/` is the old hand-edited config (Windows path,
  claude-mem) kept as a reference for what the generator replaces. `skills/*.py` were dropped
  (stubs; `gates` tool and bash cover them).
- `dev/` (agency-agents, prime-agent) and `obsidian-second-brain/` are vendored sources, gitignored.
  Copy from them via the installer; never depend on their paths at runtime. Trim personas, don't load all.

## Rules
- Verify OpenCode's current config/plugin/agent schema before building the adapter (not yet installed
  on this machine). Known past errors: `permission` vs `permissions`, `sse` type, `mcp` vs `remote`.
- AUDIT must rest on deterministic gates (tests, lint, typecheck), since free models judge poorly.
- No claude-mem in v1; vault + HANDOFF file instead.
- No secrets in the repo.

## Environment
Shared dir: owned by mixed users `commitar` / `mariano` (group `sinaptek`). Keep files group-writable.
