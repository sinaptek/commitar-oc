# Gates

A project declares its deterministic gates in `commitar.json` at its root:

```json
{ "name": "my-project", "gates": { "test": "npm test", "lint": "npm run lint", "typecheck": "npm run typecheck" } }
```

- `test` is required. `lint` and `typecheck` are optional; a missing optional gate is skipped, a missing `test` fails.
- A gate passes iff its command exits 0. Output is kept (tail only) for the agents.
- RED expects `test` to **fail** (`expect: "fail"`); GREEN and AUDIT expect pass.
- SPEC records the baseline of the existing suite: `expect: "pass"` when it is green (new tests come in RED), `expect: "fail"` when
  the suite already exists and is red (stub implementation, bug report, known-failing tests). COMMIT expects pass.
- When a `phase` is given, the tool updates `HANDOFF.json` (see `handoff.schema.json`), deterministically, with no model input:
  latest gate results per phase, `spec` (`SPEC.md` or `spec.md`, or `spec` in `commitar.json`), `commits` since the first
  handoff write (baseline in `.commitar/base`), `next`, and `status` (`done` only after a passing COMMIT gate with a commit).
  `init` adds `HANDOFF.json` and `.commitar/` to the project's `.gitignore`.
- Agents never decide a gate's result; they only report the tool's output.

## RED check
`expect: "fail"` on the `test` gate is classified, not just "non-zero exit" (node:test output only; other
runners keep the plain non-zero rule). RED passes when at least one named test fails, or when the only
load errors are a missing implementation: `Cannot find module` for a relative or in-project path, or a
missing export from a relative module. It is rejected, with `RED REJECTED: <reason>` in the output, for a
syntax error, a bad import (e.g. `expect` from `node:test`), a missing package, or a non-zero exit with no
failing test. This is a heuristic on runner output, not proof the tests are good: GREEN still has to pass.
Not covered: other runners (jest, pytest, ...), and a test that fails for the wrong reason.
