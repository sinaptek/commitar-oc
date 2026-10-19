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
# edit ~/my-project/commitar.json: "test" is the project's real test command, "probe" is how the auditor runs a snippet ("node {file}", ".venv/bin/python {file}")
node cli/commitar-oc.mjs doctor ~/my-project   # checks install, config, models (live call), vault
cd ~/my-project && opencode                    # primary agent is mega
node cli/commitar-oc.mjs handoff export ~/my-project   # -> .commitar/handoff/{handoff.json,handoff.md}
```

Agents may run only the project's gate commands and read-only git without asking (plus `git add`/`commit` where they may edit; roles that cannot edit, such as the auditor, get no other shell access); `rm -rf`, `git push` and `git reset --hard` are denied and everything else asks. Re-run `init` after editing `commitar.json`.

The auditor also gets a `probe` tool: it runs a short snippet with the project's own interpreter (`commitar.json` `probe`) in a throwaway copy of the project, so a suspected defect is checked ("executed") instead of only read from code.
`.git`, `.commitar/`, `HANDOFF.json` and caches are not copied, `node_modules` and `.venv` are linked, the copy is deleted afterwards and the real project is untouched. It is not a sandbox: a snippet that deliberately writes through the linked dependency directories, or uses the network, is not stopped.

Free models are slow and can stall: allow minutes per phase. OpenCode 2.x: use `opencode run --standalone` (the shared background service can hang). Non-interactive `opencode run` hangs on
`ask` permissions; use `--auto` only in disposable directories.

## Commands

| Command | What it does |
|---|---|
| `init [dir] [--scratch-vault]` | Generate OpenCode config, agents and tools from `protocol/` + `models.json`; validate with `opencode debug config`. `--scratch-vault` points `vault_save` at `<dir>/.commitar/vault` (gitignored) instead of the shared vault: use it for test and scratch runs |
| `doctor [dir] [--no-smoke]` | Check OpenCode (version-aware: v2 plugin vs v1 tools), generated files, `commitar.json`, config validity, git identity, each model alias (60 s call), vault, proxy |
| `handoff export [dir] [--out dir]` | Validate `HANDOFF.json` against `protocol/handoff.schema.json`, add git state, write json + md |
| `handoff push [dir] [--url u] [--token t] [--allow-http]` | Build the same bundle and POST it to commitar-hcp (`<url>/api/handoffs`); `--url` / `COMMITAR_HCP_URL`, token from `COMMITAR_HCP_TOKEN` (preferred over the flag). Refuses to send a token over plain http to a non-local host unless `--allow-http`. One way: nothing is read back |
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
Defaults (checked 2026-10-17): `strong` = `opencode/glm-5.3-flash-free` (mega, implementer), `fast` = `opencode/deepseek-v4.1-flash-free`
(tester, auditor, code-reviewer, software-architect). Previous pair, kept as the fallback: `opencode/big-pickle` / `opencode/nemotron-3.5-lightning-free`.
Free models can be retired without notice: run `doctor` before a session. There is no fallback chain in v1. Headroom (context compression, runs on the Windows PC) is not a
router; to use it set `proxy` in `models.json`.

## Vendored sources (gitignored, needed only at install time)

| Dir | Origin | Used by |
|---|---|---|
| `obsidian-second-brain/` | github.com/eugeniughelbur/obsidian-second-brain (b8c52f8) | `vault init` |
| `dev/agency-agents/` | github.com/msitarzewski/agency-agents (3c95888) | `persona add` |
| `dev/prime-agent/` | inspiration only | nothing |

Clone them into those paths to use the installers; generated projects never depend on them.

## Known limits

- RED is classified for `node:test`, `vitest` and `pytest` (syntax or parse errors and bad imports are rejected; a missing implementation is accepted; vitest and pytest runs with no tests are rejected; pytest cannot tell a missing project module from a missing package, so any ModuleNotFoundError counts as a missing implementation). Other runners keep the plain non-zero-exit rule; see `protocol/gates.md`.
- The OpenCode adapter in obsidian-second-brain is marked deprecated upstream (works, may need replacing).
- CI (`.github/workflows/ci.yml`) runs `npm test` on OpenCode 1.19.0 and Node 24 (passing); CI only validates config; tool loading was checked by hand on both 1.19.0 and 2.0.27 (needs live model calls). Repo: https://github.com/sinaptek/commitar-oc

## License

MIT, see `LICENSE`. Derived persona files are credited in `THIRD_PARTY_NOTICES.md`.
