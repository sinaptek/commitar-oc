# HANDOFF into paid commitar / HCP: questions for the owner

Date: 2026-10-17. Status: proposal, nothing is stored or wired.

## What exists
- commitar-oc writes `HANDOFF.json` (contract v1: `protocol/handoff.schema.json`, `protocol/CONTRACT.md`, golden sample
  `protocol/handoff.example.json`).
- commitar-hcp has a pinned copy of the contract and a pure mapper, `ingestHandoff`, in
  `packages/handoff-contract` (branch `handoff-contract`, local, 24 tests). It turns one handoff into a WorkItem, one
  OperationRun per gate and one Evidence per gate. No I/O. Nothing in the HCP server calls it.

## 1. Is this status mapping acceptable?

| Handoff `status` | WorkItem status | Why |
|---|---|---|
| `pending` | `DRAFT` | nothing has run |
| `in_progress` | `IN_PROGRESS` | a phase gate passed, the pipeline is not finished |
| `gate_failed` | `WAITING_FOR_HUMAN` | a gate failed or the retry cap was reached; a person must decide |
| `done` | `EVIDENCE_ATTACHED` | COMMIT gate passed with a commit; verifying and accepting is HCP's call |

Never produced: Verification (a handoff has no independent verifier), Decision, VERIFIED, ACCEPTED, CLOSED.
Gate `passed` means the phase's expectation was met, so a passed RED gate means the tests failed as expected.
A wrong guess is a one-line change in `workItemStatusFor` until data is stored under it.

Also unconfirmed: the phase names (`SPEC, RED, GREEN, AUDIT, COMMIT`) and the four status values.

## 2. Which Program does an ingested project belong to?
The handoff only carries a `project` string. The mapper takes `programId` from the caller. Options:
- one fixed Program for all commitar-oc projects,
- one Program per project,
- the person importing picks one.

## 3. Is there an HCP worker for commitar-oc?
Not today. The mapper assumes an AI worker `worker-commitar-oc` with authority `ATTACH_EVIDENCE`. Who creates it, and
with what authority, is an authority-model decision.

## 4. What does paid commitar need from a handoff?
- **Read-only display:** show the work, its gates and its evidence. One-way, no contract change.
- **Trigger for a human decision:** a handoff in `gate_failed` or `done` raises a Decision for a person. Still one-way.
- **Two-way:** a human outcome (for example more evidence requested) flows back to the free-tier loop. The contract has
  no field for that; it needs `version: 2`.

## 5. Where does real data live?
HCP's `DemoCommitarAdapter` is the frozen, seeded demo (see `docs/DEMO-TRUTH-BOUNDARY.md`). The documented place for real
data is a `CommitarNextAdapter` behind `CommitarClient`. The proposal is to not add an import method to the demo adapter
or to `CommitarClient`, so demo and real records never share a store.

## What we need back
A yes or no on the table in section 1, and an answer to sections 2 to 4. Wiring starts only after that.
