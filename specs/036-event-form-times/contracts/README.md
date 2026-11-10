# Contract Changes: Event Form Times

The single contract is [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) (Constitution I).
**This feature does not change it.** The version stays **1.27.0** (spec `035`, on `main` after
PRs #155 and #156).

The Admin event form still sends `doorsOpenAt`, `startsAt`, and `endsAt` on `createEvent` and
`updateEvent` as it does today (venue-local times with the venue offset, `020` FR-018, `025`
FR-007). No new field, operation, error code, or example.

Mahdi's `034-sell-until-end-impl` is still at 1.26.0 and is not touched. Because this feature does
not bump the version, there is no collision.

`packages/shared/src/api-schema.ts` is not regenerated for this feature. `node
scripts/check-contract-drift.mjs` must still pass on an unchanged contract.
