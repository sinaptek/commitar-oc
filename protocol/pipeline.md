# Phase pipeline

Tool-agnostic. Each phase has an owner role and a deterministic exit gate.

| Phase | Role | Exit gate |
|-------|------|-----------|
| SPEC | mega | spec written, acceptance criteria listed, baseline suite recorded (see gates.md) |
| RED | tester | new tests exist and fail for the right reason |
| GREEN | implementer | all tests pass |
| AUDIT | auditor | tests, lint and typecheck pass; findings addressed |
| COMMIT | mega | clean tree, one commit per phase |

Gates are commands (tests, lint, typecheck), never model opinion. State goes to the HANDOFF file.
