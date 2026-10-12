# HANDOFF contract

`handoff.schema.json` is the contract between commitar-oc (producer) and paid commitar (consumer).
`handoff.example.json` is a golden sample of what `commitar-oc handoff export` writes.

## Consumer rules (commitar-hcp)
- Keep your own pinned copy of the schema and the sample. Do not read this repo by path.
- Add a contract test: validate the sample against your copy. Update both copies deliberately.
- Ignore fields you do not know.

## Versioning
- Safe within a version: adding optional fields.
- Needs `version: 2` and a changelog entry: renaming or removing a field, making a field required,
  or changing phase/status values.
- `tests/contract.test.mjs` pins the current v1 shape; changing the schema fails it until you
  update the pin together with this file.

## Changelog
- v1 (2026-10-12): initial. Optional `exportedAt` and `git` are added by `handoff export`.

## Open questions (unanswered)
Phase names, status values and extra fields are unconfirmed against paid commitar; direction
(one-way or two-way) is undecided. Resolve before declaring v1 stable.
