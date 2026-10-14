# commitar-oc

Free-tier companion to paid commitar. [OpenCode](https://opencode.ai) is the engine; this repo holds
an engine-independent workflow (`protocol/`), a generator that turns it into OpenCode config, and a
small CLI. It does not run the agent loop. Rationale: `docs/design-notes.md`.

Start free, continue in paid commitar: every phase records its state in `HANDOFF.json`, which
`handoff export` validates and bundles for paid commitar.

## The workflow

`mega` (orchestrator) runs SPEC, RED, GREEN, AUDIT, COMMIT, delegating to `@tester`, `@implementer`,
`@auditor` (plus `@code-reviewer`, `@software-architect`). Phase gates are commands declared in the
project's `commitar.json` and run by the generated `gates` tool, never decided by a model. See
`protocol/pipeline.md` and `protocol/gates.md`.

## Quick start

Needs Node 24 (the version tested) and OpenCode (`npm i -g opencode-ai`). Default models are OpenCode's free ones: no key.

```bash
node cli/commitar-oc.mjs init ~/my-project     # writes opencode.json, .opencode/, commitar.json; validates with OpenCode
# edit ~/my-project/commitar.json so "test" is the project's real test command
node cli/commitar-oc.mjs doctor ~/my-project   # checks install, config, models (live call), vault
cd ~/my-project && opencode                    # primary agent is mega
node cli/commitar-oc.mjs handoff export ~/my-project   # -> .commitar/handoff/{handoff.json,handoff.md}
```

Free models are slow and can stall: allow minutes per phase. OpenCode 2.x: use `opencode run --standalone` (the shared background service can hang). Non-interactive `opencode run` hangs on
`ask` permissions; use `--auto` only in disposable directories.

## Commands

| Command | What it does |
|---|---|
| `init [dir]` | Generate OpenCode config, agents and tools from `protocol/` + `models.json`; validate with `opencode debug config` |
| `doctor [dir] [--no-smoke]` | Check OpenCode (version-aware: v2 plugin vs v1 tools), generated files, `commitar.json`, config validity, each model alias (60 s call), vault, proxy |
| `handoff export [dir] [--out dir]` | Validate `HANDOFF.json` against `protocol/handoff.schema.json`, add git state, write json + md |
| `persona add <slug...>` | Copy and trim a persona from the vendored agency-agents into `protocol/roles/` (read-only by default) |
| `vault init` | Bootstrap the shared vault and install the command subset from `vault.json` |

## Layout

```
protocol/            engine-independent: pipeline.md, gates.md, handoff.schema.json (+ example, CONTRACT.md), roles/*.md
adapters/opencode/   generate.mjs, templates/ (gates + vault tools), schema/ (pinned OpenCode schema)
cli/                 commitar-oc.mjs, doctor, handoff, personas, vault
models.json          the only place model IDs live (aliases strong / fast); optional `proxy`
vault.json           shared vault path and command subset (delete to disable vault features)
docs/                design-notes.md, opencode-schema.md (verified OpenCode facts)
tests/               npm test (node:test, no dependencies)
.opencode/           OLD hand-edited reference config; not generated, not used
```

Generated output is never hand-edited: change `protocol/` or `models.json` and run `init` again.

## Changing models

Edit the two aliases in `models.json` (IDs from `opencode models`). Roles only reference `strong` / `fast`.
There is no fallback chain in v1. Headroom (context compression, runs on the Windows PC) is not a
router; to use it set `proxy` in `models.json`.

## Vendored sources (gitignored, needed only at install time)

| Dir | Origin | Used by |
|---|---|---|
| `obsidian-second-brain/` | github.com/eugeniughelbur/obsidian-second-brain (b8c52f8) | `vault init` |
| `dev/agency-agents/` | github.com/msitarzewski/agency-agents (3c95888) | `persona add` |
| `dev/prime-agent/` | inspiration only | nothing |

Clone them into those paths to use the installers; generated projects never depend on them.

## Known limits

- RED is classified for `node:test` only (syntax errors and bad imports are rejected; a missing implementation is accepted). Other runners keep the plain non-zero-exit rule; see `protocol/gates.md`.
- The OpenCode adapter in obsidian-second-brain is marked deprecated upstream (works, may need replacing).
- CI (`.github/workflows/ci.yml`) runs `npm test` on OpenCode 1.19.0 and Node 24 (passing); the suite does not load plugins at runtime, so v1 tool loading is untested. Repo: https://github.com/sinaptek/commitar-oc
