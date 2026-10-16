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

## Vault
Shared knowledge vault at the path in `vault.json` (currently `/home/commitar/sinaptek/vault`), separate from every
project. `commitar-oc vault init` bootstraps it (builder preset, via vendored obsidian-second-brain) and installs
only the subset of commands listed in `vault.json` through the vendored OpenCode adapter (AGENTS.md ~6 KB for 6
commands; the full set is 47). It never touches an existing non-empty directory that is not a vault.
Access: the vault dir carries a default ACL for group `sinaptek`, so both users can write.

Specs stay in the project; the handoff never depends on the vault. When `vault.json` exists, `init` also generates a
`vault_save` tool (kind `spec` or `devlog`) and tells `mega` to call it after the SPEC gate passes. The tool writes the
AI-first frontmatter and `## For future agent` preamble itself, converts banned unicode to ASCII, refuses text that
looks like a secret, overwrites the previous spec note for the same project, and returns an error string instead of
throwing so the pipeline is not blocked. Delete `vault.json` to turn all of this off.
The vault's own commands (/obsidian-find, /obsidian-recap, ...) are used by opening OpenCode inside the vault dir.

## OpenCode v2 (verified 2.0.27, package `@opencode/cli`)
- `.opencode/tools/*.ts` is **ignored** in v2. Custom tools register through plugins:
  `.opencode/plugins/<name>/index.ts` with `Plugin.define({id, setup(ctx)})` from `@opencode/plugin`,
  `ctx.tool.transform(editor => editor.add({name, description, input: <JSON Schema>, execute(input) -> {content}}))`.
  Project directory is `ctx.location.directory` (no `context.directory`).
- Models reach tools only through a generic `execute` tool (`tools.gates({...})`); the plugin load is silent on success.
- `opencode run` uses a shared background service that can hang; `--standalone` runs a private server and works.
- Generated output now contains both forms: `.opencode/tools/*.ts` (v1, CI pin 1.19.0)
  and `.opencode/plugins/commitar/index.ts` (v2). Verified live on 2.0.27: `gates` (writes HANDOFF.json) and `vault_save`.
- Subagents can use the custom tools too, but only if told how: role text must say they are called via `execute` as
  `tools.<name>(args)`. The generator appends that note to every agent whose role mentions `gates` / `vault_save`.
  Verified on a full toy pipeline: tester, implementer and auditor each recorded their own phase gate.

## Permissions (verified on 2.0.27)
- Agent frontmatter `permission:` accepts v1 syntax, normalized to v2 rules (`bash` -> `shell`). An object form works:
  `bash: {"*": ask, "node --test": allow, "node --test *": allow, "rm -rf *": deny}`; a `"bash <pattern>": allow` key is ignored
  and the `permissions:` array form also works. Last matching rule wins, so denies go last. A trailing ` *` also matches the bare command.
- `opencode debug agents` goes through the shared background service and can return a cached agent of the same name; use unique
  names when probing.
- Generated roles (bash `ask` in `protocol/roles`) get: gate commands from `commitar.json`, read-only git, `git add`/`commit` only for
  roles that may edit, and denies for `rm -rf`, `git push`, `git reset --hard`. Re-run `init` after editing `commitar.json`; `doctor`
  flags a stale allowlist. Interactive toy run: 12 prompts before, 3 after (a `sed`, a `mv`, and `git -c k=v commit`, none allowlisted).

## Both versions at runtime (checked 2026-10-14)
OpenCode 1.19.0 (installed to a scratch prefix with `npm i opencode-ai@1.19.0`) on a freshly `init`ed project: `gates` is a direct tool
call and writes HANDOFF.json, `vault_save` writes its note, an `@auditor` delegation records its own AUDIT gate, the bash allowlist
normalizes, and the extra `.opencode/plugins/commitar/` v2 plugin is ignored without any error. 2.0.27: see sections above. Not in CI
(it needs live model calls); re-check by hand when bumping either version.

## `edit` permissions at runtime (checked 2026-10-14)
- **2.0.27: `edit: ask` is not enforced.** The Write tool ran with no prompt in the TUI and in `run`, on a pristine project too.
  1.19.0 enforces it (`permission requested: edit (...); auto-rejecting` in non-interactive runs). `write` is an alias of `edit`.
- **`edit: deny` works on both:** on 2.0.27 the tool is removed from the agent's catalog.
- `--auto` approves every `ask`, so a read-only role with `bash: ask` could still write through bash (seen: `@auditor` ran
  `echo hello > file`). Hence roles with `edit: deny` now get `bash "*": deny` plus only the gate commands and read-only git;
  verified: the same probe under `--auto` no longer creates the file.
- Roles therefore use only `allow` / `deny` for edit (mega was `ask`, now `allow`: it writes SPEC.md and `ask` would block unattended v1 runs).
- The v2 `execute` tool has no `fs`/`require`/`import` (built-ins plus `fetch`), so it is not a write path.
- A probe agent with both edit and bash fully denied got "free tier can only be used from within OpenCode" from the free model service; keep at
  least one allowed shell pattern when probing.

## Full pipeline on a generated project (OpenCode 2.0.27, checked 2026-10-16)
Fresh `init` on a scratch project, `opencode` started inside it (default agent `mega`), one prompt: build `slug(text)` through SPEC, RED,
GREEN, AUDIT, COMMIT. Real `@tester`, `@implementer` and `@auditor` subagents ran, each calling `gates` (phase recorded in HANDOFF.json);
`vault_save` wrote its note; `handoff export` produced the bundle. About 40 minutes with free models.
- RED was classified correctly twice: missing module, then two real assertion failures.
- `mega` wrote a spec that contradicted itself (an invented `&` -> "and" rule); `@implementer` flagged it, `mega` fixed the spec and re-ran
  RED and GREEN. Nothing in the SPEC gate checks spec content.
- The project had no `package.json`, so `npm test` could not run; `mega` created one. `doctor` now flags this.
- The auditor reported results without pasting the raw gates output; its role now requires it.
- Running `opencode` inside this repo (not a generated project) loads the old `.opencode/` reference: no `mega`, no subagents, no `gates` or
  `vault_save`, and the model improvises. `init` and `doctor` now refuse this repo as a target.

## Bug fix on existing code (OpenCode 2.0.27, checked 2026-10-16)
Scratch project with a committed buggy `wordCount` (`split(" ")`) and two passing tests, `gates.test` = `node --test`. Same pipeline, prompt
gave four failing examples. (A first attempt ran in the finished slug project by mistake: `mega` asked, then planted its own buggy fixture,
so it tested nothing; always check the panel path.)
- RED failed on four real assertion mismatches (`3 !== 2`, `1 !== 0`, `5 !== 1`, `1 !== 3`); the two original tests kept passing.
- GREEN changed only `wordcount.js`. `@implementer` noticed the suggested one-liner `trim().split(/\s+/).length` returns 1 for `""` and added a guard.
- `@auditor` pasted the gates output verbatim and judged from it alone (the tightened role works live). Commit had exactly the three named files.
- `handoff export` labels gates by phase (`PASS RED ... (expected fail)`) and records the commit hash.
- `mega` still embellished the spec (carriage return, form feed, a Constraints section). Harmless, but SPEC content is unchecked.
- `vault_save` overwrites a note of the same name; test notes must be deleted by hand from the vault.
- Not yet exercised: a failing path (`gate_failed`, retry loop), the vault commands, swapping a model alias.
