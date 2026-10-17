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
- Working: `init` (`--scratch-vault` keeps test runs out of the shared vault), `doctor`, `handoff export`, `persona add`, `vault init`, gates tool, vault_save tool.
  `npm test` runs everything. Start with `README.md`; verified OpenCode facts are in `docs/opencode-schema.md`.
- `.opencode/` is the old hand-edited config kept only as a reference. `skills/*.py` were dropped.
- `dev/` and `obsidian-second-brain/` are vendored sources, gitignored (origins in README). Used only by the
  installers; never depend on their paths at runtime. Trim personas, don't load all.
- Full pipeline verified on a generated project with OpenCode 2.0.27 (real subagents, gates, vault_save), for both a new function and a bug fix on existing code; see docs/opencode-schema.md. Failure path verified (contradictory tests: stops at GREEN, `gate_failed`, no commit); retry cap is enforced by the gates tool (3rd failed GREEN run says stop; unit tested, and a real model stopped on it and mega reported instead of editing the test helper); a wrong test (isPrime(91)) was gamed by hard-coding until the role rules were tightened; rerun stopped and asked the user; vault commands verified in a scratch vault (docs/opencode-schema.md). Never run `opencode` inside this repo: use a separate project dir.
  Also tried on a real greenfield repo (gestor-de-tareas: core, CLI and four bug fixes, 106 tests): see the trial summary at the end of docs/opencode-schema.md.
- Open: HCP side exists as a pinned contract package (branch handoff-contract in commitar-hcp, unpushed), the HCP side ingests handoffs (pure `ingestHandoff` mapper plus `CommitarNextAdapter` and `POST /api/handoffs`, pushed on branch handoff-contract; the HCP web UI does not show decision requests yet); RED is classified for node:test, vitest and pytest (other runners: non-zero exit), CI passes on 1.19.0 (config validation only; runtime checked by hand on 1.19.0 and 2.0.27; repo is public at github.com/sinaptek/commitar-oc), commitar-oc has no command that sends a handoff to HCP yet (`handoff export` only writes the file).

## Rules
- Validate generated config with `opencode debug config` (locally installed: 2.0.27, which ignores `.opencode/tools`; tools are generated as a v2 plugin too. CI pins 1.19.0; both versions verified at runtime, see docs/opencode-schema.md). Known past errors: `permission` vs `permissions`, `sse` type, `mcp` vs `remote`.
- AUDIT must rest on deterministic gates (tests, lint, typecheck), since free models judge poorly.
- No claude-mem in v1; vault + HANDOFF file instead.
- No secrets in the repo.

## Environment
Shared dir: owned by mixed users `commitar` / `mariano` (group `sinaptek`). Keep files group-writable.
