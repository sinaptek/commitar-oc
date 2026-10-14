# Gates

A project declares its deterministic gates in `commitar.json` at its root:

```json
{ "name": "my-project", "gates": { "test": "npm test", "lint": "npm run lint", "typecheck": "npm run typecheck" } }
```

- `test` is required. `lint` and `typecheck` are optional; a missing optional gate is skipped, a missing `test` fails.
- A gate passes iff its command exits 0. Output is kept (tail only) for the agents.
- RED expects `test` to **fail** (`expect: "fail"`); GREEN and AUDIT expect pass.
- When a `phase` is given, the tool updates `HANDOFF.json` (see `handoff.schema.json`), deterministically, with no model input:
  latest gate results per phase, `spec` (`SPEC.md` or `spec.md`, or `spec` in `commitar.json`), `commits` since the first
  handoff write (baseline in `.commitar/base`), `next`, and `status` (`done` only after a passing COMMIT gate with a commit).
  `init` adds `HANDOFF.json` and `.commitar/` to the project's `.gitignore`.
- Agents never decide a gate's result; they only report the tool's output.

## Known limitation: RED
`expect: "fail"` only checks for a non-zero exit. A test file that does not even load (bad import,
syntax error) also satisfies it. A missing-implementation import error is a legitimate RED, so
this cannot be filtered by output heuristics. The GREEN gate catches a broken test file, so
a bad RED costs a retry, not a wrong result. Seen in the first toy run (tester imported a
nonexistent `expect` from `node:test`).
