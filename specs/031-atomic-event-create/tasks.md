---
description: "Task list for All-or-Nothing Event Scheduling"
---

# Tasks: All-or-Nothing Event Scheduling

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R12),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) (contract 1.23.0),
[quickstart.md](./quickstart.md) (S0–S10)

**Issue**: [#127](https://github.com/Trughouse-Holdings/QueuePass/issues/127). The implementation
PR's **description** says `fixes #127` on its own line. No commit message on either branch may
contain "fixes #127", "closes #127", or "resolves #127".

**Tests**: **REQUIRED and written first** (Constitution VI). Write the test tasks of Phase 2 and
confirm they **fail** before the implementation tasks of Phases 3 and 4.

## Ground rules

- **Fresh session** (Constitution III): implement on branch `031-atomic-event-create-impl` in a
  Claude session that starts from these files only. While the spec and plan PR is open, cut it from
  `031-atomic-event-create-spec` and carry in every change that PR's review makes; once it merges,
  bring it up to `main`. A gap in the spec or plan is fixed there, not worked around in code.
- **Commits** cite the spec, the task IDs, and the issue: `Impl 031: plan and write the setup in
  createLocked (T009–T011, #127)`.
- **Contract first**: the contract (1.23.0) and `api-schema.ts` come from the spec PR. The
  implementation does not change `contracts/openapi.yaml`, `packages/shared/`, `backend/prisma/`, or
  any other shared surface; if it finds it must, the change goes to the spec PR first.
- **Spec `030`**: its spec PR is merged and this branch is rebased onto it (contract 1.23.0 on
  `030`'s 1.22.0, constitution 3.9.3 on 3.9.2; research R12). Its implementation (`EventsService.
  findAll`, the Admin event list) does not overlap this feature's code; if it merges first, rebase
  and keep both.
- **One independent review** (Constitution III) of the implementation branch before its PR (T021).
- **`npm run ci` locally** before pushing (T019), then **CI green on GitHub**, the `test` and `e2e`
  checks, before merge (T023).
- **The team stack** (Compose project `queuepass-team`, its Backend and apps run from
  `C:\Users\mahdi\hello_world\QueuePass-team` with `run-host.mjs`) holds every fixed port and the
  team's data. Walk on a Compose project of your own (`-p qp031`); stop the team stack only with
  Mahdi's go in the session, with `docker compose -p queuepass-team stop` (never `down`, never `-v`),
  and restore it afterwards (quickstart S0, S10).
- **Path B on this machine** (README "When the images can't be built"): the app images cannot be
  built here, so the Compose path (A) is walked by CI's `e2e` job and the hand walk uses path B.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US3 from spec.md

---

## Phase 1: Setup

- [x] T001 Cut `031-atomic-event-create-impl` from `031-atomic-event-create-spec` (or from `main` once
  the spec PR has merged); `npm ci`; `npm run ci` green before any change, so a later failure is this
  feature's. Record any test that fails on the untouched branch.
  **Done** (2026-11-09): cut from `main` at `f9d083b` (the spec PR merged); `npm ci`. The first
  `npm run ci` ran while T002–T005 were being written into the worktree, so it picked up the new
  files: format, lint, build, the root scripts (85), shared (793), and every other Backend suite
  (106 suites, 1233 tests) passed; only the two new 031 files failed, as they must. No test fails
  on the untouched branch.

---

## Phase 2: Tests first (all must fail before Phases 3 and 4)

- [x] T002 [P] [US1] [US2] [US3] `backend/test/integration/events.create-setup.e2e-spec.ts` (new;
  FR-001 to FR-004, research R4, R11), the successes: a general-admission schedule with two types
  saves the event and both, with their quantities; a seated schedule at a venue with three sections,
  two types, one section unsold, saves `reservedSeating: true`, `totalTicketCapacity` the layout's
  total, each type's quantity its sections' seats (0 for a type with none), and exactly the two
  mappings, and `GET /events/{id}/seats` shows them; a body without `tiers` and `reservedSeating`,
  and one with `tiers: []`, are answered as before (the same `201` body fields as a request made the
  old way); every response passes `expectToMatchContract`. Must fail (the fields are unknown:
  `400`).
- [x] T003 [P] [US1] [US2] [US3] Same file, the refusals (FR-003 to FR-006, SC-001): for each, the
  status, code, and path (`details.field`, or the start of a `details.fields` entry), and **the
  counts of `Event`, `TicketTier`, and `SectionTier` rows unchanged**: a repeated name (`Floor` /
  `floor`, and `Floor` / ` Floor `; `409 TIER_NAME_TAKEN`, `tiers.1.name`); a missing quantity
  without reserved seating (`400`, `tiers.0.quantity`); a quantity with it (`tiers.0.quantity`);
  a non-empty `sectionIds` without it (`tiers.0.sectionIds`; `sectionIds: []` without it is
  accepted); `null` for `reservedSeating`, `tiers`, and a type's `sectionIds` (each `400`; every
  entry starts with the field's place; `tiers: null` gives three entries and `sectionIds: null`
  four, as research R9 lists, which is accepted); 51 ticket types (`tiers may hold at most 50 ticket types`); `tiers: [5]`
  (an entry exactly `tiers.tiers must be a list of ticket types, each an object with a name and a
  price`); a section of another venue's layout and a random
  UUID (`tiers.0.sectionIds`, the message saying to reload); a section under two types
  (`tiers.1.sectionIds`); a repeated id in one `sectionIds` (`400`, `tiers.0.sectionIds`); reserved
  seating at a venue without a layout (`reservedSeating`); `totalTicketCapacity` with reserved seating
  (`totalTicketCapacity`); `maxTicketsPerCustomer` above the layout's total (`400`, as today);
  quantities over the capacity (`409 CAPACITY_EXCEEDED`, `details.field: tiers`, `totalTicketCapacity`,
  `tierTotal`); malformed fields in two types at once (both listed, each with its path); an unknown
  field in a type (`tiers: [{ …, colour: 'red' }]`: an entry exactly `tiers.0.property colour should
  not exist`); every entry of every `400` in this file starts with `tiers`, `reservedSeating`, or
  `totalTicketCapacity` (no class-validator default message); a scheduling conflict with ticket types (`409 SCHEDULING_CONFLICT`); the order of
  R4 (a request with both a conflict and a repeated name gets the conflict; one with a repeated name
  and a bad section in a later type gets the name). And **a failure after the first write** (FR-015):
  make the mapping insert fail after the event and its types were written (a Jest spy on the
  transaction client's `sectionTier.createMany`, or a test-only trigger that raises on `SectionTier`
  insert for one event name, dropped after the test; pick the less invasive and record it here); the
  answer is a `500` envelope and no rows remain. Must fail.
  **Done**: 30 cases with T002's; all failed before T009–T011 (the fields unknown, `400`). The
  failure after the first write uses **a Jest spy** on `PrismaService.$transaction` that hands the
  callback a proxy of the transaction client whose `sectionTier.createMany` throws (after recording
  that the event and its two types were written in the transaction): no database object to create
  or drop. That request is sent without the request helper's automatic contract check, since the
  contract declares no `500` for `createEvent` and this one is injected; its body is still the
  standard envelope. The "every `400` entry starts with `tiers`, `reservedSeating`, or
  `totalTicketCapacity`" check covers the refusals about the new fields; the limit-above-the-layout
  case keeps today's `maxTicketsPerCustomer …` entry, as T003 says (`400`, as today).
- [x] T004 [P] [US2] `backend/test/unit/event-setup.spec.ts` (new; research R4, R9):
  `planEventSetup` for every branch of R4 steps 2, 4, 5, with the paths and messages of T003, the
  seat sums, the capacity from the layout, and that it never throws for a request without `tiers`
  and `reservedSeating`. Must fail (no module).
  **Done**: 16 cases, `seatingCapacity` and `planEventSetup`; failed (no module).
- [x] T005 [P] [US3] `backend/test/integration/events.create-setup.concurrency.e2e-spec.ts` (new;
  FR-007, SC-006, research R11): ten rounds of two schedules for overlapping windows at one venue,
  each with three ticket types, sent at once: one `201` and one `409 SCHEDULING_CONFLICT` per round,
  and the ticket types in the database are exactly the winner's. And a seated schedule racing a layout
  save at its venue (the layout's sections replaced), ten rounds: either the schedule is refused
  (`400`, `tiers.<i>.sectionIds`) with nothing saved, or it is saved and the layout save then leaves
  it with no mappings and its types at 0 (`007` research R11); never a `SectionTier` row whose section
  is gone. Must fail (the fields are unknown).
  **Done**: both cases failed before T011.
- [x] T006 [P] [US1] [US2] `admin-app/test/event-create-atomic.test.tsx` (new; FR-008 to FR-012,
  SC-003, SC-004, research R5, R11): a general-admission schedule sends exactly one `POST /events`
  whose body has `tiers` with names, prices, and quantities, and no `reservedSeating`, `sectionIds`,
  `POST /events/{id}/tiers`, or `PUT /events/{id}/seating`; at a venue with a layout and reserved
  seating, `reservedSeating: true` and each type's `sectionIds` from the section selects (Not for sale
  in none); a `409 TIER_NAME_TAKEN` with `details.field: 'tiers.1.name'` shows its message in the
  banner and beside ticket type 2, whose name input has `aria-invalid="true"` and is described by the
  message; every value, the chosen picture included, stays; no picture upload; no navigation; a `400`
  whose `details.fields` has `tiers.0.sectionIds …` shows beside ticket type 1's seats line; a `409
  CAPACITY_EXCEEDED` with `field: 'tiers'` beside the ticket types; scheduling again clears them and,
  answered `201`, uploads the picture and opens the event; a rejected `fetch` (a `TypeError`) shows
  FR-011's message with a link to `/events` and keeps every value; "Seating setup not finished"
  appears nowhere; a `502` with a non-envelope body gives the same no-answer message, and a `500`
  with the envelope the banner as today; a `409 TIER_NAME_TAKEN` without `details.field` shows in
  the banner only. Must fail.
  **Done**: 12 cases; 9 failed before T013 (the database-backstop, `500`-with-envelope, and
  refusal-keeps-values parts already held with the old code). Placement is checked through
  `type-<n>-error`, `seats-<n>-error`, `tiers-error`, and `no-answer`.
- [x] T007 [US1] Update the existing Admin tests written against the old create sequence (SC-005),
  keeping what each checks: `event-seating-create.test.tsx` (the create flow and its refusal, now one
  request; its "Finish on the event page" case becomes "nothing saved, values kept"),
  `images-field.test.tsx` (the "Seating setup not finished" cases: a refused schedule sends no
  picture and keeps them), and every other create flow that stubs `POST /events/{id}/tiers` or `PUT
  /events/{id}/seating` (`grep -lE "events/new" admin-app/test` then check each:
  `capacity.test.tsx`, `delete-flows.event.test.tsx`, `event-doors-open.test.tsx`,
  `event-form.tz.test.tsx`, `theme-classes.test.tsx`, `ticket-limit.test.tsx`; edit flows such as
  `event-types-edit.test.tsx` stay as they are). The ones that assert the old sequence must fail
  before T013.
  **Done**: `event-seating-create.test.tsx` (the create case now one request; "Finish on the event
  page" became "saves nothing, keeps every value"), `images-field.test.tsx` (the request order; the
  two refusal cases), and the `POST …/tiers` and `PUT …/seating` stubs removed from `capacity`,
  `delete-flows.event`, `event-doors-open`, `event-form.tz`, and `ticket-limit` (`theme-classes`
  stubs only reads). Before T013, 17 cases in these files failed. **Gap in the list**:
  `event-types-edit.test.tsx` also holds a create case ("scheduling a general-admission event")
  asserting the old sequence; it failed after T013 and was moved to the one request with the same
  checks (the base price, each type's body). Its edit cases are unchanged.
- [x] T008 [P] [US1] `e2e/tests/031-atomic-event-create.spec.ts` (new; quickstart S3, FR-015), title
  exactly `031 S3: a refused ticket type on Schedule shows its error beside it, keeps the form filled, and creates no event`:
  as `admin1`, a venue made through the API helpers, Schedule event with a unique name and ticket
  types `Floor` and `floor`; the message beside ticket type 2; the name, times, and both types still
  filled; `GET /events?q=<name>` through the API helper finds none; rename to `Balcony`, schedule; the
  event page opens with both types; the search finds exactly one. Must fail.
  **Code done**; it signs in as `adminFor(testInfo)` (`admin2`–`admin4`), not `admin1`, which
  `e2e/fixtures/apps.ts` leaves for people (spec `022` R8). Not run locally (the Compose images
  cannot be built here); before T011 and T014 it could only fail (the old form said "Seating setup
  not finished" and left the event). It runs in CI's `e2e` job on the PR.

---

## Phase 3: Backend (US1, US2, US3)

- [x] T009 [US3] `backend/src/events/dto/event-tier.dto.ts` (new) and `create-event.dto.ts` (research
  R9, which lists every decorator and its message): `EventTierDto extends CreateTierDto` with
  `sectionIds?: string[]`; `CreateEventDto.reservedSeating?: boolean` and `tiers?: EventTierDto[]`
  (at most 50). Every decorator has its own message starting with its property name; `null` is
  refused with `@ValidateIf(… !== undefined)`, not skipped by `@IsOptional()`. T003's malformed,
  `null`, size, and unknown field cases pass.
- [x] T010 [US1] [US2] `backend/src/events/event-setup.ts` (new; research R4, R9):
  `planEventSetup(dto, venue, sections)` (pure; R4 steps 2, 4, 5 with their messages, paths, and
  codes, built with the project's envelope helpers: `conflict()` for `409`s, `BadRequestException({
  message: [...] })` for `400`s) and `writeEventSetup(tx, eventId, plan)` (each type with
  `tx.ticketTier.create` in order, its quantity from the plan; one `tx.sectionTier.createMany`). T004
  passes.
  **Done**: step 2 is also exported as `seatingCapacity`, which `createLocked` calls before the
  capacity checks (R4's order) and `planEventSetup` calls again (pure, the same answer).
- [x] T011 [US1] [US2] [US3] `backend/src/events/events.service.ts` `createLocked` (research R4):
  after the times and doors, with `reservedSeating` read the venue's sections (`tx.section.findMany`,
  in the transaction that holds the venue `FOR SHARE`) and refuse as R4 step 2; the capacity is the
  layout's total; the existing capacity, limit, and conflict checks; `planEventSetup`; then
  `tx.event.create` with `reservedSeating` and the capacity, and `writeEventSetup`. A request
  without the new fields takes exactly today's path. T002, T003, T005 pass; every existing
  `events.*` integration test still passes unchanged.
  **Done**: T002, T003, T005 pass; no existing Backend test changed.
- [x] T012 [US3] Run the contract tests (`backend/test/contract/`) and the Backend's whole suite:
  the route and role coverage is unchanged and every `createEvent` response matches the contract.
  **Done**: 109 suites, 1277 tests, all pass; lines 97.17%.

---

## Phase 4: Admin app (US1, US2)

- [x] T013 [US1] [US2] `admin-app/src/api/events.ts`: `createEvent` takes
  `ApiComponents['schemas']['EventInput']` from `@queuepass/shared`; `EventForm.tsx` `scheduleEvent`
  builds the one request (research R5: `reservedSeating: true` only when reserved seating is chosen
  at a venue with a layout; each type's `name`, `price` trimmed; `quantity` without reserved
  seating; `sectionIds` from `sectionType` with it) and returns the id; remove `setupRefused`, its
  state, and its banner; the picture steps unchanged. T006's request cases and T007 pass.
- [x] T014 [US1] [US2] `EventForm.tsx` (research R5, FR-010): `fieldErrors(error)` reads
  `details.field` or each `details.fields` entry's leading path (`/^(tiers(?:\.(\d+)\.(\w+))?|reservedSeating|totalTicketCapacity) /`
  or exactly the path for `details.field`) and returns the messages for ticket type *i*, the ticket
  types, and the seating choice; render each beside its place in a `<span className="field__hint"
  role="alert" id=…>`, with `aria-invalid` and `aria-describedby` on that type's inputs (a
  `sectionIds` message beside type *i*'s seats line in the seating part); cleared when Schedule event
  is clicked again. T006's placement cases pass.
  **Done**: a `details.fields` entry is placed by the contract's rule (`tiers.<i>.` is type *i*; any
  other start with `tiers` the ticket types, so `tiers.tiers must be …` lands there too;
  `reservedSeating` / `totalTicketCapacity` the seating); `details.field` by its exact path. The
  input whose field is named gets `aria-invalid` and `aria-describedby`; a message naming no known
  field (an unknown property) marks every input of that type. The messages are derived from the
  error, so clearing the error on Schedule clears them.
- [x] T015 [US1] `admin-app/src/api/client.ts` and `EventForm.tsx` (FR-011, research R5, R6):
  `ApiError` gains `enveloped`, a third constructor parameter defaulting to `true`, passed `false`
  only by `unwrap`'s fallback for a body without the envelope (the other direct constructions stay
  as they are);
  when the schedule request throws anything that is not an `ApiError`, or an `ApiError` with status
  `>= 500` and `enveloped` false, show in the banner "No answer from QueuePass, so the event may or may not
  have been scheduled. Check the Events list before scheduling it again." with a link to `/events`;
  keep every value. A `5xx` with the envelope is shown as an error, as today. T006's network and
  gateway cases pass.
  **Done**: the no-answer banner (`data-testid="no-answer"`, "Could not save", the message with
  "Events list" linked) applies only to the schedule request; an Edit save is unchanged (FR-013).
- [x] T016 [US1] Run the whole Admin suite: every test passes; `EventForm.tsx`'s comment on
  `scheduleEvent` cites `031` (research R4, R5) instead of `008` R10.
  **Done**: 43 files, 375 tests, all pass.

---

## Phase 5: Documentation, review, pull request

- [ ] T017 `specs/031-atomic-event-create/quickstart.md`: the Automation row S3 becomes
  `Automated: \`<T008's exact title>\``; `npm test`'s quickstart-marks check passes. T008 passes on
  the `e2e` stack.
  **Quickstart part done** (the row; the marks check passes, 30 quickstarts). **Pending**: T008 on
  the `e2e` stack, in CI's `e2e` job on the PR.
- [x] T018 README: the `031` status row (tasks count and code status); where "What the system does"
  describes scheduling an event with ticket types and seating, say it is saved in one step, all or
  nothing.
  **Done**: the "Event scheduling" bullet, the status paragraph, and the `031` row (18/23 tasks,
  **Built (review pending)**).
- [x] T019 `npm run ci` locally, green; record the counts per workspace and the Backend's and Admin
  app's line coverage (each at or above 80%).
  **Done** (2026-11-09, head `c6d844d`): `npm run ci` green, exit 0, first try, with `KEYCLOAK_URL`
  and `KEYCLOAK_HEALTH_URL` set to `http://127.0.0.1:9` so the live seed tests skip (28 skipped,
  "Keycloak not reachable"). Counts: root scripts 85; shared 793; Backend 1277 (109 suites);
  admin-app 375; customer-app 335; booth-app 94; seed 262 passed, 28 skipped; quick test:tz (Los
  Angeles) pass. Line coverage: shared 96.77%, Backend 97.17%, admin-app 97.41%, customer-app
  97.65%, booth-app 93.44%, seed 99.41%.
- [ ] T020 Run the Backend suite three times in a row (the concurrency file included), the Admin
  suite three times, and `npm run test:tz`; record the counts. The `e2e` job on GitHub runs T008;
  record its time.
  **Local part done**: the Backend suite three times in a row, 1277/1277 each (109 suites, the
  concurrency file included; 199 s, 236 s, 214 s; lines 97.17%); the Admin suite three times,
  375/375 each (43 files); `npm run test:tz` all pass in America/New_York, UTC,
  America/Los_Angeles, and Pacific/Honolulu for shared, Backend (unit), admin, customer, and booth.
  **Pending**: the `e2e` job on GitHub (T008) and its time.
- [ ] T021 Independent review by a separate Claude session (Constitution III) of the implementation
  against spec.md, plan.md, research.md, and the contract; fix the findings; record the round here.
- [ ] T022 Running-system walk, quickstart S0–S10, on a stack of its own (`-p qp031`) or path B with
  Mahdi's go for the team stack's ports (ground rules); record each scenario's result here
  (Constitution VI smoke test).
- [ ] T023 Push and open the implementation PR (after the spec PR has merged and the branch is up to
  date with `main`): description says `fixes #127`, lists the review, the walk, the test counts, and
  that no shared surface is touched. Wait for CI green on GitHub (`test` and `e2e`) on the final
  commit; merge only when green and approved.

---

## Dependencies & Execution Order

- **Setup (T001)** → **Tests (T002–T008)** → **Backend (T009–T012)** → **Admin (T013–T016)** →
  **Polish (T017–T023)**.
- T009 → T010 → T011 → T012. T004 passes after T010; T002, T003, T005 after T011.
- T013 → T014 → T015 → T016. The Admin phase needs no running Backend (its tests stub the API), so
  it may start beside Phase 3 once T006 and T007 are written.
- T008 passes only after T011 and T014. T017 after T008 passes.

### Parallel opportunities

- T002–T003 (one file), T004, T005, T006, T008: different files, written together; T007 after T006
  (same helpers).
- The Admin phase beside the Backend phase (above).

## Implementation Strategy

- **MVP**: T001–T013: the Backend saves the whole schedule in one transaction and the form sends
  one request. On its own it meets US1's core (a refusal saves nothing; the values stay) and US2,
  US3.
- Then the field placement (T014), the no-answer message (T015), the browser test, the README, and
  the PR.

## Review record (spec branch)

- **Round 1** (independent Claude session, 2026-11-09): 2 must-fix, 4 should-fix, 3 nits. All fixed
  in the `Review 031: spec review round 1` commit, after a rebase onto `main`.
  - M1: spec `030`'s spec PR merged (`10bd53f`) → rebased onto `main`: constitution 3.9.3 with row
    `031` after `030`'s (next free `032`), the Sync Impact Report this amendment's only; contract
    1.23.0 on `030`'s `listEvents` change and corrected examples; `api-schema.ts` regenerated;
    README keeps both rows; "not merged" text updated (spec Assumptions, Edge Cases; research R10,
    R12; contracts/README; tasks ground rules).
  - M2: the "path then a space" promise broke for unknown nested fields, non-object entries, and
    class-validator's default messages → every new decorator has its own message (R9, T009); the
    contract and R3 describe the two other forms (`tiers.<i>.property <name> should not exist`,
    `tiers.tiers must be a list …`) and the client's rule; T003 pins the exact entries and that no
    default message appears.
  - S1: a `5xx` without the envelope (a gateway error after the commit) is treated as no answer;
    `ApiError.enveloped` (FR-011, R5, R6, R9, T006, T015).
  - S2: R3's stale sentence about the list-versus-example mismatch dropped (`030` fixed the
    examples).
  - S3: a **non-empty** `sectionIds` is refused without reserved seating; `[]` accepted (FR-004, R4,
    T003, contract).
  - S4: the planner compares names with `toLowerCase()`; the database's `P2002` backstop answers
    `TIER_NAME_TAKEN` without `details.field`, which the form shows in the banner only (R4,
    data-model, contract, T006).
  - N1: R3 says `020`/`025` use `details.field` on `400`s; only the key is reused.
  - N2: `tiers` capped at 50 with `@ArrayMaxSize` (a layout's section cap), `sectionIds` too (R9,
    contract, spec Assumptions).
  - N3: `null` for `reservedSeating`, `tiers`, or `sectionIds` is refused (`@ValidateIf`, as #117),
    documented in the contract (R9, T003).
- **Round 2** (independent Claude session, 2026-11-09; the reviewer ran the real Nest
  `ValidationPipe`, and every promised string comes out exactly as written): no must-fix, 1
  should-fix, 3 nits; the reviewer's verdict: only minor findings remain. All fixed in the `Review
  031: spec review round 2` commit.
  - S1: R4's backstop paragraph split the guarantee table → moved below it.
  - N1: R3: `tiers` as a JSON object is validated as one ticket type (`tiers.property a should not
    exist`, `tiers.name must be a string`; `@IsArray`'s message lost), `tiers: [[1]]` gives
    `tiers.0.tiers must be a list …`; all still start with `tiers`.
  - N2: `tiers: null` gives three entries and `sectionIds: null` four; listed in R9 and accepted in
    T003 (the form never sends `null`).
  - N3: `enveloped` is a constructor parameter defaulting to `true`; only `unwrap`'s fallback passes
    `false` (R5, R9, T015).
- **Open findings**: none.

## Review record (implementation branch)

_Left for the implementation's review (T021)._
