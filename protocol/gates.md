# Gates

A project declares its deterministic gates in `commitar.json` at its root:

```json
{ "name": "my-project", "gates": { "test": "npm test", "lint": "npm run lint", "typecheck": "npm run typecheck" } }
```

- `test` is required. `lint` and `typecheck` are optional; a missing optional gate is skipped, a missing `test` fails.
- A gate passes iff its command exits 0. Output is kept (tail only) for the agents.
- RED expects `test` to **fail** (`expect: "fail"`); GREEN and AUDIT expect pass.
- When a `phase` is given, results are merged into `HANDOFF.json` (see `handoff.schema.json`).
- Agents never decide a gate's result; they only report the tool's output.
