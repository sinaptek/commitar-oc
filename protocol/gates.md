# Gates

A project declares its deterministic gates in `commitar.json` at its root:

```json
{ "name": "my-project", "gates": { "test": "npm test", "lint": "npm run lint", "typecheck": "npm run typecheck" } }
```

- `test` is required. `lint` and `typecheck` are optional; a missing optional gate is skipped, a missing `test` fails.
- A gate passes iff its command exits 0. Output is kept (tail only) for the agents.
- RED expects `test` to **fail** (`expect: "fail"`); GREEN and AUDIT expect pass.
- SPEC records the baseline of the existing suite: `expect: "pass"` when it is green (new tests come in RED), `expect: "fail"` when
  the suite already exists and is red (stub implementation, bug report, known-failing tests). A project with no tests yet exits 0, so that is a green baseline: `expect: "pass"`.
  COMMIT expects pass.
- Retry cap: the tool counts consecutive failed GREEN runs (kept in `.commitar/green_failures`, not in HANDOFF.json). On the 3rd it appends
  `RETRY CAP REACHED ...: stop now, report ... to the user` to its output and sets HANDOFF `next` to the same text; every further failed GREEN run repeats it.
  A passing GREEN run, or a run of any other phase, resets the count. RED failures never count. The tool does not refuse to run: after the user decides, the next run proceeds normally.
- When a `phase` is given, the tool updates `HANDOFF.json` (see `handoff.schema.json`), deterministically, with no model input:
  latest gate results per phase, `spec` (`SPEC.md` or `spec.md`, or `spec` in `commitar.json`), `commits` since the first
  handoff write (baseline in `.commitar/base`), `next`, and `status` (`done` only after a passing COMMIT gate with a commit).
  `init` adds `HANDOFF.json` and `.commitar/` to the project's `.gitignore`.
- Agents never decide a gate's result; they only report the tool's output.
- For node:test, vitest, jest, go test (only with `-v`) and pytest, each result line also carries the runner's own totals (`tests=N pass=M fail=K`). Quote those numbers in reports; never compute or remember a test count.

## RED check
`expect: "fail"` on the `test` gate is classified, not just "non-zero exit" (node:test, vitest, jest, go test and pytest output; other
runners keep the plain non-zero rule). RED passes when at least one named test fails, or when the only
load errors are a missing implementation: `Cannot find module` for a relative or in-project path, or a
missing export from a relative module. It is rejected, with `RED REJECTED: <reason>` in the output, for a
syntax error, a bad import (e.g. `expect` from `node:test`), a missing package, or a non-zero exit with no
failing test. This is a heuristic on runner output, not proof the tests are good: GREEN still has to pass.
Jest: a suite that cannot load is accepted only for `Cannot find module` with a relative or in-project path; a syntax error, ReferenceError, ESM that jest cannot run or a missing package is rejected, and so is a run with no test files. Checked on jest 30 with CommonJS tests; transformer setups (babel-jest, ts-jest, ESM mode) print the same summary lines but were not run.
Go: a missing implementation is a compile error in a `_test.go` file (`undefined: X`, a missing method, a wrong argument count) or an import of a package of this module (the module path comes from `go.mod` in the project directory) that does not exist yet; those are accepted, as is a failing test or a panic inside one. A syntax error, an unused import or variable, a vet failure, any error in a non-test file, a missing third-party or standard package, a run with no packages and a package that fails with no failing test are rejected. Plain `go test` prints no counts, so use `go test -v ./...` as the test gate to get `tests=N pass=M fail=K` (top-level tests only; subtests are not counted again). Checked on Go 1.27.2 with default flags; `-json`, `-run` filters and `go test` run from a directory without `go.mod` were not.
Not covered: other runners (cargo test, ...), and a test that fails for the wrong reason.
