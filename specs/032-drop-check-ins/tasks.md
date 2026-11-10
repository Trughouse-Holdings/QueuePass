---
description: "Task list for Drop Check-in Details a Week After the Event"
---

# Tasks: Drop Check-in Details a Week After the Event

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R12),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) (1.24.0),
[quickstart.md](./quickstart.md) (S0–S6)

**Issue**: [#129](https://github.com/Trughouse-Holdings/QueuePass/issues/129). The implementation
PR's **description** says `fixes #129` on its own line. No commit message on either branch may
contain "fixes #129", "closes #129", or "resolves #129".

**Tests**: **REQUIRED and written first** (Constitution VI). Write the test tasks of Phase 2 and
confirm they **fail** before the implementation tasks of Phase 3.

## Ground rules

- **Fresh session** (Constitution III): implement on branch `032-drop-check-ins-impl` in a Claude
  session that starts from these files only. While the spec and plan PR is open, cut it from
  `032-drop-check-ins-spec` and carry in every change that PR's review makes; once it merges, bring it
  up to `main`. A gap in the spec or plan is fixed there, not worked around in code.
- **Commits** cite the spec, the task IDs, and the issue: `Impl 032: the retention job (T008, T009,
  #129)`.
- **One independent review** (Constitution III) of the implementation branch before its PR (T020).
- **`npm run ci` locally** before pushing (T018), then **CI green on GitHub**, the `test` and `e2e`
  checks, before merge.
- **Never run the job against a database you did not create.** Its first start removes the details of
  every event that ended more than a week ago, for good. Walk it on a Compose project of your own
  (`-p qp032`). The team stack (compose project `queuepass-team`, its Backend and apps run from
  `C:\Users\mahdi\hello_world\QueuePass-team` with `run-host.mjs`) holds every fixed port and the team's
  data: do not start this branch's Backend against it, and do not stop it, without Mahdi saying so in
  the session (T019). If it must be stopped for a stretch, use `docker compose -p queuepass-team stop`
  (never `down`, never `-v`).
- **Spec `031`** (`031-atomic-event-create-spec`, open) changes `EventsService.create` and the
  contract (1.23.0); this feature changes `updateLocked`, `toResponse`, and the contract (1.24.0).
  Whichever merges second rebases and keeps both (research R10).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US4 from spec.md

---

## Phase 1: Setup

- [ ] T001 Cut `032-drop-check-ins-impl` from `032-drop-check-ins-spec` (or from `main` once the spec
  PR has merged); `npm ci`; `npm run ci` green before any change, so a later failure is this
  feature's.

---

## Phase 2: Tests first (all must fail before Phase 3)

- [ ] T002 [US1] [US2] `backend/test/integration/check-in-retention.e2e-spec.ts` (new; FR-001 to
  FR-006, FR-009, SC-001 to SC-004, research R4, R5, R11), with `createTestApp()` (interval 0) and its
  `FakeClock`; fixtures made through the services, then times and check-ins set directly with
  `prisma` (an event E ended at a fixed instant; its tickets admitted with all three columns, one with
  `checkedInAt` only, one void with an admission time; F ending 1 day after E; G not ended):
  - clock at `E.endsAt + 7 d − 1 min`: `app.get(CheckInRetention).removeDue()` returns no ids; every
    `Ticket` and `Event` row equal to before;
  - clock at `E.endsAt + 7 d`: E's tickets all have the three columns NULL (void one included); E has
    `checkInDetailsRemovedAt` = the clock and `keptCheckedInCount` = its valid admitted tickets; F's and
    G's rows equal to before;
  - a second `removeDue()` with the clock at `+ 8 d`: E unchanged (instant and count);
  - a cancelled event past its cutoff: removed, count 0; an event with no tickets: removed, count 0;
  - E's end moved 2 days later (through `PATCH`) before the cutoff: not removed at the old cutoff,
    removed at the new;
  - two `removeDue()` at once (`Promise.all`): E removed once, rows as after one run;
  - `GET /reports/sales` before and after E's removal: deep-equal but `generatedAt` and E's
    `checkInDetailsRemovedAt`; then E cancelled: its `checkedIn` 0 and the total down by its count;
  - a Nest testing module with `CHECK_IN_RETENTION_INTERVAL_MS` overridden to `60_000` and a due event:
    after `app.init()` (and a wait of at most 2 s for the start-up run), the event is removed; the
    module closed afterwards.
  Must fail (no module yet).
- [ ] T003 [P] [US1] `backend/test/integration/check-in-retention.constraints.e2e-spec.ts` (new;
  FR-015): raw SQL updates on an event: an instant without a count, a count without an instant, and a
  count of −1 each fail naming `event_check_ins_removed_together`; both set with 0 succeeds. Must fail
  (no columns yet).
- [ ] T004 [P] [US4] `backend/test/integration/events.check-ins-removed.e2e-spec.ts` (new; FR-008,
  SC-006, research R6): on an event marked removed (set directly): `PATCH` with a later `endsAt`, an
  earlier `startsAt`, or a different `doorsOpenAt` → `409 CHECK_IN_DETAILS_REMOVED`,
  `details.removedAt` its instant, the message naming the date in the venue's zone, the event unchanged;
  `PATCH` with the stored three instants and a new name → `200`, name changed; on an event not removed,
  a time change → `200`. Each response passes `expectToMatchContract(res, 'updateEvent')`. Also
  `getEvent`, `listMyOrders`, and `getSalesReport` include `checkInDetailsRemovedAt` (`null`, then the
  instant) and match the contract. Must fail.
- [ ] T005 [P] [US2] [US3] Admin app (Vitest; FR-009 to FR-013, research R7, R8):
  - `admin-app/test/check-ins-removed.test.tsx` (new): a removed event (fixture with
    `checkInDetailsRemovedAt` `2026-11-10T03:00:00Z`, venue `America/New_York`, report row `checkedIn`
    3): Attendees shows "Check-in details removed on Nov 9, 2026 (kept for 7 days after the event).",
    the summary "3 checked in", no "checked in" per ticket, "—" per order; with the report failing, the
    summary has no checked-in part; the Sales card shows 3 and the sentence; Reports shows 3 and
    "Details removed Nov 9, 2026" in that row only; EventForm shows a `409 CHECK_IN_DETAILS_REMOVED`
    message as its error banner with the values kept. A not-removed event: all as today.
  - `admin-app/test/export/attendee-rows.test.ts`: a removed event's table has every "Checked in" cell
    empty and the subtitle lines include the sentence and "3 tickets were checked in."; without a count,
    the sentence only. `sales-rows.test.ts`: a removed event's row has the report's `checkedIn`.
  Must fail.
- [ ] T006 [P] Customer app (Vitest; FR-014, research R9): `customer-app/test/check-ins-removed.test.tsx`
  (new): an order whose event has `checkInDetailsRemovedAt` set: each valid ticket reads "Event over",
  with no "Show entry code" or "Print ticket" link; a void ticket "Void"; `/my-tickets/<id>/print` for
  such a ticket shows "This ticket can't be printed."; an order whose event is not removed: as today.
  Must fail.

---

## Phase 3: Implementation

- [ ] T007 Shared (research R3; contracts/README.md): `CHECK_IN_RETENTION_DAYS = 7` in
  `packages/shared/src/event.ts` (exported), `Event.checkInDetailsRemovedAt?: string | null`;
  `packages/shared/src/order.ts`: the same on the My tickets order event and `EventSales`. Keep
  `api-schema.ts` as generated in the spec PR (`node scripts/check-contract-drift.mjs`).
- [ ] T008 Migration and schema (data-model.md): `20261110000000_check_in_retention/migration.sql`
  exactly as data-model.md; `schema.prisma` fields and comments; `npx prisma generate`. Makes T003
  pass.
- [ ] T009 [US1] `backend/src/entry/check-in-retention.ts` (research R5): `CHECK_IN_RETENTION_INTERVAL_MS`
  token, `CheckInRetention` with `onApplicationBootstrap` (one run, then the timer, when the interval
  is above 0), `onModuleDestroy`, `removeDue(now?)` with the running flag, the due query, and the
  per-event locked transaction (lock, re-check, count, empty the tickets, mark the event), each event's
  failure logged and skipped; one log line per run that removed anything. `EntryModule` provides it
  with `{ provide: CHECK_IN_RETENTION_INTERVAL_MS, useValue: 3_600_000 }`;
  `backend/test/setup/test-app.ts` overrides it with 0. Makes T002's removal cases pass.
- [ ] T010 [US2] `ReportsService.sales` (research R4): `checkedIn` is 0 for a cancelled event, else the
  kept count once removed, else the live count; `checkInDetailsRemovedAt` on each event row. Makes T002's
  report cases pass.
- [ ] T011 [US4] `EventsService` (research R6): in `updateLocked`, after the `CANCELLED` check, the
  `409 CHECK_IN_DETAILS_REMOVED` for a changed resolved `startsAt`, `endsAt`, or `doorsOpenAt` on a
  removed event (message date in the venue's zone, `details.removedAt`); `toResponse` sends
  `checkInDetailsRemovedAt`; `OrdersService.mine` adds it to the event summary. Check
  `backend/test/integration/demo-reset.e2e-spec.ts`'s fingerprint still passes (the new columns are
  NULL after every reset, research R10). Makes T004 pass.
- [ ] T012 [US3] Admin app (research R7, R8): `removedNote()` in `format.ts`; Attendees, SalesCard,
  Reports, EventForm's 409 banner; `attendeeTable` with the optional kept count; Attendees passes it.
  Makes T005 pass.
- [ ] T013 Customer app (research R9): `MyTickets.tsx` state and links; `PrintTicket.tsx` refusal.
  Makes T006 pass.

---

## Phase 4: Documentation, review, pull request

- [ ] T014 README: a short "Check-in retention" paragraph (what is removed, when, the constant, that a
  Backend start removes every event past its cutoff, what admins see); the `032` status row updated.
- [ ] T015 `contracts/openapi.yaml`: list `checkInDetailsRemovedAt` as required on `Event`,
  `OrderEvent`, and `EventSales` now that the Backend sends it (as `014`, `016` did; still 1.24.0, a
  note in the field descriptions "Required from 1.24.0 once implemented"); regenerate `api-schema.ts`.
- [ ] T016 Quickstart: confirm the Automation table (all Manual, with reasons) still holds.
- [ ] T017 Backend coverage: the job's error paths (one event failing, a deleted event) have tests, so
  the Backend stays above 80%.
- [ ] T018 `npm run ci` locally, three times, with `npm run test:tz` once; all green.
- [ ] T019 Walk the quickstart S0–S6 on `-p qp032` (or path B with Mahdi's go), recording each
  Expected as seen.
- [ ] T020 Independent review (Constitution III) of the implementation branch by a Claude session that
  did not write it; fix the findings; record them below.
- [ ] T021 Open the PR (`fixes #129` in the description, the review record, the walk), after the spec
  PR has merged; CI green.

---

## Dependencies & Execution Order

- **Setup (T001)** → **Tests (T002–T006)** → **Shared and schema (T007, T008)** → **Backend
  (T009–T011)** → **Admin (T012)** and **Customer (T013)** → **Docs and review (T014–T021)**.
- T008 before T009–T011. T010 needs T009's columns only. T012 and T013 need T007's types.
- T015 after T009–T011 (the Backend sends the fields).

### Parallel opportunities

- T003, T004, T005, T006 beside T002 (different workspaces and files).
- T012 and T013 once T007 is done.

## Implementation Strategy

- **MVP**: T001–T011: the Backend removes the details at the cutoff, keeps the counts, and locks the
  times. On its own it meets US1, US2 (report figures), and US4.
- Then the Admin app's sentence and attendee export (US3), the Customer app's labels, the README, and
  the PR.

## Review record (spec branch)

_Left for the spec branch's independent review._

## Review record (implementation branch)

_Left for the implementation's review (T020)._
