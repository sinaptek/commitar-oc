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
- A real model run through the proxy at 127.0.0.1:8765.
