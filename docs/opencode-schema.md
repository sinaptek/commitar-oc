# OpenCode config schema (verified 2026-10-12)

Source: https://opencode.ai/config.json, pinned at `adapters/opencode/schema/config.schema.json`.
Fetched without installing OpenCode; the CLI itself is still unverified on this machine.

## Resolves the past errors
- `permission` (singular) is correct. Value is `ask|allow|deny` or an object keyed by
  tool (`read, edit, glob, grep, list, bash, task, external_directory, todowrite, question,
  webfetch, websearch, lsp, doom_loop, skill`, plus arbitrary keys). Rules may be per-pattern.
- MCP `type` is `local` (needs `command: string[]`) or `remote` (needs `url`). There is no `sse`.
  Both are `additionalProperties: false`. Local takes `environment`, `cwd`, `timeout` (ms).
- Agent `tools` is deprecated: use `permission`. `maxSteps` is deprecated: use `steps`.

## Top-level keys
shell, logLevel, server, command, skills, references, watcher, snapshot, plugin, share,
autoshare, autoupdate, disabled_providers, enabled_providers, model, small_model, default_agent,
subagent_depth, username, mode, agent, provider, mcp, formatter, lsp, instructions, layout,
permission, tools, attachment, enterprise, tool_output, compaction, experimental.

## Agents (`agent.<name>`)
Fields: model, variant, temperature, top_p, prompt, disable, description, mode
(`subagent|primary|all`), hidden, options, color, steps, permission. Built-ins: plan, build,
general, explore, title, summary, compaction. Model is `provider/model` and is validated against
the models.dev schema.

## Commands (`command.<name>`)
Fields: template (required), description, agent, model, variant, subtask. Nothing else allowed.

## Provider
Keys: api, name, env, id, npm, whitelist, blacklist, options, models. A local proxy is
`provider.<id>.options.baseURL`, as in the reference config.

## Verified with OpenCode 1.19.0 (npm `opencode-ai`, installed globally)
- `opencode debug config` resolves and prints the merged config, and exits 1 with a message on
  invalid config (e.g. `permissions`). Use it as the headless validation gate in `doctor` and tests.
  It runs without provider credentials.
- Agent markdown at `.opencode/agents/<name>.md` is picked up: frontmatter `description`, `mode`,
  `permission`; body becomes `prompt`. The file name is the agent name.
- `opencode debug agent <name>`, `opencode debug paths`, `opencode mcp`, `opencode models`
  are available for doctor checks.
- npm skipped the package postinstall (allow-scripts); the CLI still runs.

## Still to verify
- Custom tool and plugin file format (`.opencode/tools`, `plugin`).
- (done) Real model run: `opencode run -m opencode/big-pickle` and `opencode/nemotron-3.5-lightning-free` answer with no credentials.

## Custom tools (verified)
`.opencode/tools/<name>.ts` with `export default tool({description, args, execute})` from
`@opencode-ai/plugin` registers a tool named `<name>` (checked via `opencode debug agent build`).
Multiple named exports become `<file>_<export>`. OpenCode auto-creates `.opencode/package.json`,
`node_modules/` and `.gitignore` on first run, so generated dirs will contain those.

## Non-interactive runs (verified)
- `opencode run` with `ask` permissions (our roles' default for edit/bash) hangs with no output.
  Use `--auto` (approves anything not explicitly `deny`) only in disposable dirs or CI.
- With `--auto`, `mega` delegates via the `task` tool and `@tester` writes files as expected.
- Free models can stall: always wrap calls in a timeout (doctor uses 60s).
- Useful: `--format json` emits raw events (`text`, `tool_use`, `step_start/finish`).

## Full pipeline run (toy project, free models, 2026-10-12)
SPEC, RED, GREEN, AUDIT and COMMIT all completed via `mega` -> `task` -> subagents, each gate through the
`gates` tool, one commit, HANDOFF.json left uncommitted. Took ~9 min for the first three phases
plus a resume (`opencode run --continue`) for the rest: free models are slow, so budget long timeouts
and run in the background. HANDOFF.json passed the schema checks in tests.

## Handoff export
`commitar-oc handoff export [dir] [--out dir]` validates `HANDOFF.json` against
`protocol/handoff.schema.json`, adds `exportedAt` and `git` state, and writes `handoff.json` + `handoff.md`
(with the spec inline) to `<dir>/.commitar/handoff/`. Paid commitar should consume `handoff.json`;
the schema in `protocol/` is the contract (dependency points from HCP to the protocol).

## Personas
`commitar-oc persona add <division-slug...> [--model fast|strong] [--edit ...] [--bash ...] [--force]`
copies a persona from the vendored `dev/agency-agents` into `protocol/roles/`, trimmed (keeps identity,
mission, rules, workflow, checklist, communication; drops code samples, metrics, memory fluff), read-only by
default, with a provenance comment (source file + catalog commit). The tracked copy is the source of truth;
`dev/` is only needed when adding. `mega` gets an auto-generated roster of subagents.
