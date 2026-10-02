---
description: "Task list for Admin Ticket Tiers and Search"
---

# Tasks: Admin Ticket Tiers and Search

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) →
[`contracts/openapi.yaml`](../../contracts/openapi.yaml) (1.2.0, already applied),
[quickstart.md](./quickstart.md)

**Tests**: **REQUIRED and written first** (FR-011, Constitution VI). In each phase, write the test
tasks and confirm they **fail** before the implementation tasks below them.

## Format: `[ID] [P?] [Story] Description`

## Ground rules

- **Do not change the contract.** It is at 1.2.0 with types regenerated. Raise any gap.
- Money is a decimal string end to end; `numeric(10,2)` in the database.
- Every tier write and every event capacity change locks the event row first (research R2).
- Reuse the Admin app's existing CSS classes; add no styling.

---

## Phase 1: Setup

- [ ] T001 Run `npm test` and record the baseline in this line.

## Phase 2: Foundational

- [ ] T002 Add `TIER_NAME_TAKEN` to `ERROR_CODES` in `packages/shared/src/errors.ts`, and `packages/shared/src/tier.ts` (`TicketTier`, `TicketTierInput`, `TicketTierUpdate`) exported from `index.ts`.
- [ ] T003 Add `TicketTier` to `backend/prisma/schema.prisma` and create `backend/prisma/migrations/20261001000000_ticket_tiers/migration.sql` per data-model.md (table, FK cascade, index, three CHECKs, `ticket_tier_event_name_unique`).
- [ ] T004 `backend/test/setup/reset-db.ts`: truncate `"TicketTier"` too.

## Phase 3: User Story 1 - Ticket Tiers (P1) 🎯 MVP

### Tests ⚠️ write first

- [ ] T005 [P] [US1] `backend/test/integration/tiers.crud.e2e-spec.ts`: create (price `"120.00"` out, trimmed name), list ordered by price then name, update, delete (`204`, then `404`), tier of another event is `404`, unknown event `404`, deleting the event deletes its tiers, validation `400` (negative price, three decimals, quantity 0, empty name).
- [ ] T006 [P] [US1] `backend/test/integration/tiers.capacity.e2e-spec.ts`: fill exactly to capacity (accepted), one over (`409 CAPACITY_EXCEEDED`, `details.remaining`), update that would exceed refused while shrinking is accepted, event capacity lowered below the tier total refused (`details.tierTotal`) and to exactly the total accepted, **10 concurrent creates of 200 into a 1,000 event → exactly 5 succeed and the total is 1,000**, duplicate name ignoring case `409 TIER_NAME_TAKEN` on create and on rename.
- [ ] T007 [P] [US1] `backend/test/integration/tiers.authz.e2e-spec.ts`: customer and agent can list but get `403` on create, update, delete; no token `401`.
- [ ] T008 [P] [US1] `admin-app/test/tiers.test.tsx`: event page lists tiers and "Allocated N of M"; adding posts the typed values and shows the new tier; a `409 CAPACITY_EXCEEDED` shows the banner and keeps the inputs; edit saves via PATCH; remove asks to confirm and sends DELETE only after OK.

### Implementation

- [ ] T009 [US1] `backend/src/tiers/` module, controller (`/events/:id/tiers`, `/events/:id/tiers/:tierId`, `@Roles` per contract), DTOs, service with the locked transaction (R2) and name pre-check (R3); register in `app.module.ts`.
- [ ] T010 [US1] `events.service.ts`: run `updateOnce` in a transaction that locks the event row and refuses capacity below the tier total.
- [ ] T011 [US1] `prisma-exception.filter.ts`: map `P2002` on the tier name index to `409 TIER_NAME_TAKEN`.
- [ ] T012 [US1] `admin-app/src/api/tiers.ts` and `admin-app/src/components/TierSection.tsx`; render it on `EventDetail.tsx`.

## Phase 4: User Story 2 - Event Search (P2)

- [ ] T013 [P] [US2] `backend/test/integration/events.search.e2e-spec.ts`: `q` ignoring case and spaces, blank `q` ignored, `from` inclusive, `to` exclusive, combined with `locationId`, order kept, `from >= to` `400`, malformed `from` `400`, malformed `locationId` `400`.
- [ ] T014 [P] [US2] `admin-app/test/search.test.tsx` (events): submitting sends `q`, `locationId`, `from`, `to` (local-day instants); filters read back from the URL on load; no matches shows the message and **Clear** resets.
- [ ] T015 [US2] `backend/src/events/dto/list-events.query.ts` and filters in `events.service.ts` `findAll`.
- [ ] T016 [US2] `admin-app/src/api/events.ts` `listEvents(filters)`; filter form in `EventList.tsx`.

## Phase 5: User Story 3 - Venue Search (P3)

- [ ] T017 [P] [US3] `backend/test/integration/locations.search.e2e-spec.ts`: `q` matches name or address ignoring case; order kept; too long `400`.
- [ ] T018 [P] [US3] `admin-app/test/search.test.tsx` (venues): search sends `q`, reads it from the URL, shows "No venues match".
- [ ] T019 [US3] `ListLocationsQuery` and filter in `locations.{controller,service}.ts`; search form in `LocationList.tsx`.

## Phase 6: Polish

- [ ] T020 Update `README.md` (status table, feature list).
- [ ] T021 `npm run lint`, `npm run build`, boundary and drift checks pass.
- [ ] T022 `npm test` passes. Record counts.
- [ ] T023 `docker compose up --build -d`, quickstart T1–T4 pass. Record the result.

## Dependencies

Phase 1 → 2 → US1 → US2 → US3 → Polish. US2 and US3 are independent of US1 and of each other
once Phase 2 is done.
