# HANDOFF into paid commitar / HCP: proposals to confirm

Date: 2026-10-17. Status: proposal, nothing is stored or wired. For each point below we give a default and the reason
for it. The ask is to confirm or change it.

## What commitar-oc provides
- A one-way `HANDOFF.json` (contract v1: `protocol/handoff.schema.json`, `protocol/CONTRACT.md`, golden sample
  `protocol/handoff.example.json`): project name, spec path, phase, status, the latest gate result per phase, commits and
  a `next` line.
- Deterministic test results only. There is no independent verifier and no human decision in it.
- The CLI only exports. It does not run or control the agent loop.

## What commitar-hcp has so far
A pinned copy of the contract and a pure mapper, `ingestHandoff`, in `packages/handoff-contract` (branch
`handoff-contract`, local, 24 tests). It turns one handoff into a WorkItem, one OperationRun per gate and one Evidence per
gate. No I/O. Nothing in the HCP server calls it.

## 1. Status mapping
**Our proposal**, because a handoff proves only passing tests and a commit, nothing more:

| Handoff `status` | WorkItem status | What the handoff proves |
|---|---|---|
| `pending` | `DRAFT` | nothing has run |
| `in_progress` | `IN_PROGRESS` | a phase gate passed, the pipeline is not finished |
| `gate_failed` | `WAITING_FOR_HUMAN` | a gate failed or the retry cap was reached; a person must decide |
| `done` | `EVIDENCE_ATTACHED` | COMMIT gate passed with at least one commit; the most it can claim |

Never produced: Verification, Decision, VERIFIED, ACCEPTED, CLOSED. Gate `passed` means the phase's expectation was met,
so a passed RED gate means the tests failed as expected. Until data is stored under it, a change is one line in
`workItemStatusFor`.
**Confirm or change:** the table, and the phase names (`SPEC, RED, GREEN, AUDIT, COMMIT`) and status values it uses.

## 2. Program
**Our proposal:** one Program per project name, because the handoff carries only a `project` string.
**If you want grouping** (for example one Program for all commitar-oc work), the contract can add an optional field; that
is safe within v1. The mapper already takes `programId` from the caller.
**Confirm or change:** per project, or grouped, and if grouped, what the field should be.

## 3. Worker
**Our proposal:** a single AI worker for commitar-oc (`worker-commitar-oc`) with only `ATTACH_EVIDENCE` authority, because
the handoff supplies test evidence and nothing else. How HCP creates workers and assigns authority is HCP's decision.
**Confirm or change:** the worker, its authority, and who creates it.

## 4. Direction
**Our proposal:** one-way and read-only display, because that is all commitar-oc provides: the contract has no field for a
return path.
A trigger for a human decision (a handoff in `gate_failed` or `done` raises a Decision) can stay one-way and needs no
contract change. A two-way flow (a human outcome goes back to the free-tier loop) would be a request from the paid side
and needs `version: 2`.
**Confirm or change:** display only, or also raise a decision; whether two-way is wanted at all.

## 5. Where real data lives
**Our proposal:** behind a `CommitarNextAdapter`, as `docs/FUTURE-COMMITAR-NEXT-IMPORT.md` in HCP already says. No import
method on the demo adapter or on `CommitarClient`, so seeded demo records and real records never share a store
(`docs/DEMO-TRUTH-BOUNDARY.md`).
**Confirm or change:** this placement.

## What we need back
A confirm or a change on each of the five points. Wiring starts only after that.
