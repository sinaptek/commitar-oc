# Phase pipeline

Tool-agnostic. Each phase has an owner role and a deterministic exit gate.

| Phase | Role | Exit gate |
|-------|------|-----------|
| SPEC | mega | spec written, acceptance criteria listed, baseline suite recorded (see gates.md) |
| RED | tester | new tests exist and fail for the right reason |
| GREEN | implementer | all tests pass |
| AUDIT | auditor | tests, lint and typecheck pass; findings addressed |
| COMMIT | mega | clean tree, one commit per phase |

If the auditor labels a finding DEFECT (a stated requirement broken, user data or input silently lost, or a crash on reasonable input), loop back (only for a DEFECT in this change; pre-existing defects are reported to the user): tester adds a failing regression test (RED), implementer fixes (GREEN), auditor runs again.
Gates are commands (tests, lint, typecheck), never model opinion. State goes to the HANDOFF file.

## Advisory steps (optional, never a gate)
- `@software-architect` before SPEC, only when the user asks for a design: returns a recommendation and a decision record as text; the result feeds the spec.
- `@code-reviewer` after AUDIT, only when the user asks: findings ranked BLOCKER / SUGGESTION / NIT. They are opinion. Only the deterministic gates decide whether a phase passes or a commit is made.

