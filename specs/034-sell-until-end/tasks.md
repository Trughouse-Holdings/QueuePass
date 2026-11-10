---
description: "Task list for Sell Tickets Until the Event Ends"
---

# Tasks: Sell Tickets Until the Event Ends

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R12),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) (`ENDED`,
`inProgress`, the sales window, 1.26.0), [quickstart.md](./quickstart.md) (S0–S8)

**Issue**: [#126](https://github.com/Trughouse-Holdings/QueuePass/issues/126). The implementation
PR's **description** says `fixes #126` on its own line. No commit message on either branch may
contain "fixes #126", "closes #126", or "resolves #126".

**Tests**: **REQUIRED and written first** (Constitution VI). Write the test tasks of Phase 2 and
confirm they **fail** before the implementation tasks that follow.

## Ground rules

- **Fresh session** (Constitution III): implement on branch `034-sell-until-end-impl` in a Claude
  session that starts from these files only. While the spec and plan PR is open, cut it from
  `034-sell-until-end-spec` and carry in every change that PR's review makes; once it merges, bring
  it up to `main`. A gap in the spec or plan is fixed there, not worked around in code.
- **Commits** cite the spec, the task IDs, and the issue: `Impl 034: orders and holds close at the
  event's end (T009–T011, #126)`.
- **The contract is in place** from the spec PR (1.26.0, `STARTED` still listed, `inProgress`
  optional, `api-schema.ts` regenerated, `order.ts` widened). The implementation PR changes the shared
  surface only as T014 says (`STARTED` out, `inProgress` required, still 1.26.0; `api-schema.ts`;
  `order.ts` narrowed), and says so in its description, because every team member approves it. Any
  other contract change goes back to the spec branch (or, after it merges, a `Clarify 034` PR).
- **`033`'s implementation first** (research R10): branch `033-seat-hold-cart-impl` reworks
  `GetTickets.tsx`, moves the confirmation to `components/OrderConfirmation.tsx`, adds the Cart, and
  changes `assertNoWait` in `reservations.service.ts`. Check `main` at T001: if `033`'s implementation
  has merged, build on it (T017 edits `OrderConfirmation.tsx`); if not, ask Mahdi whether to wait, and
  if he says go, build on `main` as it is and say in the PR which of the two must merge what.
- **`032`'s implementation** (PR #151) also edits `contracts/openapi.yaml` and regenerates
  `api-schema.ts`: whichever lands second keeps both, regenerates, and reruns `node
  scripts/check-contract-drift.mjs`.
- **One independent review** (Constitution III) of the implementation branch before its PR (T023).
- **`npm run ci` locally** before pushing (T021), then **CI green on GitHub**, the `test` and `e2e`
  checks, before merge (T025).
- **The team stack**: compose project `queuepass-team`, its Backend and apps run from
  `C:\Users\mahdi\hello_world\QueuePass-team` with `run-host.mjs`, holds every fixed port (5432, 8080,
  3000, 5173–5175). Do not stop it or write to it without Mahdi saying so in the session; walk on a
  stack of your own (`-p qp034`) when the ports are free, otherwise ask (T024).
- **Path B on this machine** (README "When the images can't be built"): the app images cannot be
  built here, so the Compose path (A) is walked by CI's `e2e` job (T008) and the hand walk uses path B.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US4 from spec.md

---

## Phase 1: Setup

- [ ] T001 Cut `034-sell-until-end-impl` from `034-sell-until-end-spec` (or from `main` once the spec
  PR has merged), after deciding on `033` (ground rules); `npm ci`; `npm run ci` green before any
  change, so a later failure is this feature's. Confirm `api-schema.ts` has `salesClosed: "CANCELLED" |
  "ENDED" | "STARTED" | null` and `inProgress?: boolean` in `Availability`. Record which of `033`'s and
  `032`'s implementations are on the base.

---

## Phase 2: Tests first (all must fail before the implementation)

- [ ] T002 [P] [US1] [US2] `backend/test/integration/orders.sales-closed.e2e-spec.ts`, rewritten as
  "Sales close at the end time" (FR-001, FR-002, FR-005, SC-001, SC-002; research R1, R8, R11). Events
  through the API, relative to the real time (a helper like today's `startingIn`, taking the start and
  the end offsets):
  - started 1 minute ago, ends in 3 hours: `201`, one order.
  - started 3 hours ago, ends in 10 seconds: `201` (just before the end).
  - created ending in an hour, then moved by SQL so `endsAt` is 1 second before the test's own `new
    Date()` (with `startsAt` and `doorsOpenAt` moved back by the same amount, keeping
    `event_doors_open_range` and the end after the start): `409`, `SALES_CLOSED`, message `Sales for
    Season Opener closed when it ended.`, `order.count()` 0.
  - the same with `endsAt` set to the test's `new Date()` immediately before the request (at the
    end): `409 SALES_CLOSED`. With real time this is the end just reached (the request arrives at or
    a few milliseconds after it); "one millisecond before" is not tested (research R1, R11). The
    order check reads the Backend's process clock (research R1), the same as the test's, so the
    instants are the test's, never the database's `now()`, which runs in the container.
  - in progress, then cancelled: `409 EVENT_CANCELLED`.
  - a `requestId` order placed while in progress, the event then moved past its end: the repeat is
    `200` with the same order id.
  - every response matches the contract (the authed client checks it).
  Must fail (today an order after the start is refused).
- [ ] T003 [P] [US1] [US2] `backend/test/integration/reservations.e2e-spec.ts` (FR-003, FR-005): "is
  409 SALES_CLOSED once the event has started" becomes "…once it has ended" (moved past its end as
  in T002), with the new message; add "reserves seats for an event in progress" (`201`, the seats
  held) and "reserves seats for an event ending in 10 seconds" (`201`, just before the end). Must
  fail.
- [ ] T004 [P] [US2] `backend/test/integration/reservations.admin-changes.e2e-spec.ts` (FR-004,
  SC-003; research R3): "the sweep ends every hold once the event has started" becomes two cases: a
  reservation on an event moved by SQL to have started (not ended) survives `sweepOnce()` (still open,
  no `CLOSED` hold); moved past its end, the next `sweepOnce()` ends every hold `CLOSED`, sets
  `endedAt`, and the seat stream publishes the seats open (as the existing case asserts). `expiresAt`
  unchanged. Must fail (today the first case ends the holds).
- [ ] T005 [P] [US4] `backend/test/integration/availability.e2e-spec.ts` (FR-006, FR-007): ahead → `{
  salesClosed: null, inProgress: false }`; in progress → `{ null, true }`; ended (moved by SQL) → `{
  'ENDED', false }`; cancelled in progress → `{ 'CANCELLED', true }`; the existing `STARTED`
  expectation (line ~80) replaced; `inProgress` asserted on every case. Must fail.
- [ ] T006 [P] [US1] An entry integration test (`backend/test/integration/entry.lookup.e2e-spec.ts` or
  `entry.admit.e2e-spec.ts`, whichever builds its fixture through the API) (FR-013, SC-006; research
  R6): an event that started 30 minutes ago and ends in 2 hours; a customer orders one ticket (after
  the start); as a gate agent, `lookupEntryTicket` with that event as the gate returns it admittable,
  and `admitTicket` admits it. Must fail (the order is refused today).
- [ ] T007 [P] [US1] [US2] [US3] Customer app (FR-008 to FR-012; research R4, R5): new
  `customer-app/test/started-notice.test.tsx` with the app's API stubs and `vi.setSystemTime`, an event
  in `America/New_York` from 7:00 PM to 10:00 PM local:
  - availability `{ salesClosed: null, inProgress: true }`, tickets left: the panel's first paragraph
    after its heading is "This event has already started (began at 7:00 PM EST). You can still buy
    tickets until it ends at 10:00 PM EST." (use a November date, EST); the form is offered; the
    event page's header (outside the panel) does not contain "already started".
  - the event ending 1:00 AM the next local day: "until it ends at Nov 21, 2026, 1:00 AM EST" (with the
    date that fixture uses).
  - in progress and sold out: "This event has already started (began at 7:00 PM EST)." and no "You
    can still buy tickets"; the sold-out message. In progress with `customerLimit.remaining: 0`: the
    same first sentence and the limit message. In progress, seated, with no section on sale: the
    same first sentence and "No seats are on sale for this event yet." (FR-010).
  - **One clock on the page** (FR-017): with the browser clock (`vi.setSystemTime`) 3 minutes after
    the event's `endsAt` and availability `{ salesClosed: null, inProgress: true }` (the Backend's
    clock behind), the page shows no "This event has ended." once availability has loaded, and shows
    the notice. With the browser clock 3 minutes **before** `endsAt` (a slow clock) and availability
    `{ ENDED, false }`, "This event has ended." is shown, so the line follows availability, not the
    clock. A cancelled event whose end has passed by the browser clock, with `{ CANCELLED,
    inProgress: false }`, keeps the line; with `{ CANCELLED, inProgress: true }`, no line. Before
    availability answers (a pending stub), the page follows `030`'s rule. **A reload keeps the last
    answer**: with the browser clock 3 minutes past `endsAt` and availability `{ salesClosed: null,
    inProgress: true }` (no line, the form offered), confirm an order the stub refuses (`409
    SOLD_OUT`), leaving the availability reload that follows pending: still no line, and no fallback
    to `030`'s clock; then let the reload answer `{ ENDED, false }`: the line appears. An answer `{
    salesClosed: 'STARTED' }` without `inProgress` follows `030`'s rule.
  - `{ CANCELLED, inProgress: true }`: no "already started"; the cancelled message.
  - `{ null, false }`: no notice.
  - `{ ENDED, false }`: the "Sales closed" badge and "Sales closed: this event has ended."; no "already
    started" anywhere in the panel.
  - after confirming an order whose stubbed `createdAt` is after the event's start: the confirmation
    says "This event has already started (began at 7:00 PM EST). Your tickets admit you until it
    ends at 10:00 PM EST."; with `createdAt` before the start: no such line.
    `customer-app/test/purchase-unavailable.test.tsx`, its three stale spots (research R8): the test
    "shows Sales closed, and no form, once the event has started" (~line 90) becomes "…once the
    event has ended" with `salesClosed: 'ENDED'` and "Sales closed: this event has ended."; the
    status-badge table row `{ salesClosed: 'STARTED' }` → `'ENDED'` (~118); the refusal stub "Sales
    for Early Show closed when it started." → "…closed when it ended." (~130).
    `customer-app/test/format.test.ts`: the helper (T015). Must fail.
- [ ] T008 [US1] `e2e/tests/034-sell-until-end.spec.ts` (new; quickstart S1, S2; research R11): one
  test, `034 S1/S2: a customer buys a ticket for an event that has already started and sees the notice
  on the panel and the confirmation`. Setup through the API as `adminFor(testInfo)`: a venue of its
  own (`uniqueName`, Louisville, Eastern), an event that started 10 minutes ago and ends 2 hours from
  now, base price only. As `customerFor(testInfo, N)` (a slot no other test uses), open its page:
  the panel shows "This event has already started (began at" and "You can still buy tickets until it
  ends at"; buy one ticket with a holder name; the confirmation shows "Your tickets admit you until it
  ends at". Then, as `agentFor(testInfo, M)` through `apiFor`, look the ticket up for that event and
  admit it: admitted. Must fail until T010 and T016, T017.

---

## Phase 3: Backend (US1, US2, US4)

- [ ] T009 [US2] `backend/src/common/event-lock.ts` (research R1): `LockedEvent.endsAt: Date` with the
  comment "Spec 034 FR-001: sales close at this instant." in place of `startsAt`; `lockEvent` selects
  `"endsAt"` in place of `"startsAt"`. The build shows every reader; today only `orders.service.ts`.
- [ ] T010 [US1] [US2] `backend/src/orders/orders.service.ts` `createLocked`: `new Date() >=
  event.endsAt` → `conflict('SALES_CLOSED', \`Sales for ${event.name} closed when it ended.\`)`, the
  comment citing `034` FR-001 (half-open, at `endsAt` closed). T002 passes.
- [ ] T011 [US1] [US2] `backend/src/reservations/reservations.service.ts`: `salesClosed()` selects
  `now() >= "endsAt"`, its comment "whether the event has ended"; `reserveLocked`'s message "…closed when
  it ended."; `hold-sweeper.ts`: `e."endsAt" <= now()` in `sweepOnce`, and the two comments ("their event
  has ended", "Sales close when the event ends"). T003 and T004 pass.
- [ ] T012 [US4] `backend/src/events/availability.service.ts` (research R2): one `now = new Date()`;
  `salesClosed`: `CANCELLED`, else `now >= event.endsAt ? 'ENDED' : null`; `inProgress: event.startsAt
  <= now && now < event.endsAt`; the header comment cites `034`. T005 passes.
- [ ] T013 `backend/src/scripts/demo-data.ts`: Season Opener's comment as research R8. Run the
  Backend's whole suite: every test passes; T006 passes; no other test asserted the old instant (if one
  did, update it and record it here).

---

## Phase 4: Contract and shared types (shared surface)

- [ ] T014 `contracts/openapi.yaml` (contracts/README.md, step 2): `STARTED` removed from
  `Availability.salesClosed.enum` and its description; `inProgress` added to `Availability.required`,
  its description's last sentence "Always sent."; version stays 1.26.0. `npm run generate:api`;
  `node scripts/check-contract-drift.mjs` passes. `packages/shared/src/order.ts`: `SalesClosedReason =
  'CANCELLED' | 'ENDED'`, `inProgress: boolean`, comments without `STARTED`. Every workspace builds; the
  contract tests pass.

---

## Phase 5: Customer app (US1–US3)

- [ ] T015 [US1] `customer-app/src/format.ts` `startedNotice(startsAt, endsAt, timeZone, at, kind)`
  (research R4, R5): `{start}` and `{end}` by `formatEventEnd(at, …, zone)`; `kind` `'buy'` → "This event
  has already started (began at {start}). You can still buy tickets until it ends at {end}.", `'first'`
  → the first sentence, `'admit'` → "… Your tickets admit you until it ends at {end}."; or an equivalent
  shape, one helper for the three. `format.test.ts` passes.
- [ ] T016 [US1] [US2] [US3] `GetTickets.tsx` (FR-008 to FR-011): keep the time availability loaded;
  the notice paragraph (class `note`) directly under the panel's heading when `inProgress &&
  salesClosed === null`, full when the panel offers a way to get tickets, first sentence otherwise;
  `ENDED` → badge "Sales closed", "Sales closed: this event has ended."; no `STARTED` branch left.
  `pages/EventDetail.tsx` (FR-017; research R4): `GetTickets` reports each availability load to the
  page on every answer (a callback prop; not on `loading`, so the last answer is kept while
  `useLoad` re-keys), and "This event has ended." then shows when `salesClosed === 'ENDED'`, or when
  `salesClosed === 'CANCELLED' && !inProgress && hasEnded(e.endsAt, loadedAt)`, never while
  `inProgress`; before any answer, or if none arrives, `hasEnded(e.endsAt, loadedAt)` as `030`.
- [ ] T017 [US1] The confirmation (FR-012): in `OrderConfirmation.tsx` once `033`'s implementation has
  merged (so the cart's confirmation shows it too), else in `Confirmation` in `GetTickets.tsx`: the line
  under its heading when `order.createdAt >= event.startsAt`. T007 passes; the whole Customer suite
  passes.

---

## Phase 6: Browser tests, documentation, review, pull request

- [ ] T018 `e2e/tests/029-demo-checkpoint.spec.ts`: "Sales closed: this event has already started." →
  "Sales closed: this event has ended."; its comment. T008 and `029 S2` pass on the `e2e` stack.
- [ ] T019 `specs/034-sell-until-end/quickstart.md`: the Automation rows S1 and S2 become `Automated:
  \`<T008's exact title>\`` (S2 keeping its note); `npm test`'s quickstart-marks check passes.
- [ ] T020 README: "Getting tickets" says sales close when an event ends, and that from its start the
  page says it has already started and until when tickets are on sale (`034`); `006`'s status-row
  summary "sales close when an event starts" → "…ends (`034`)"; the `034` status row (tasks count and
  code status); the demo-data paragraphs if they say sales closed at the start.
- [ ] T021 `npm run ci` locally, green; record the counts per workspace and the Backend's and Customer
  app's line coverage (each at or above 80%).
- [ ] T022 Run the Backend suite three times in a row, the Customer app suite three times, and `npm run
  test:tz` (the notice's times in several zones); record the counts. The `e2e` job on GitHub runs T008
  and T018; record its time.
- [ ] T023 Independent review by a separate Claude session (Constitution III) of the implementation
  against spec.md, plan.md, research.md, and the contract; fix the findings; record the round here.
- [ ] T024 Running-system walk, quickstart S0–S8, on a stack of its own (`-p qp034`) or path B with
  Mahdi's go for the team stack's ports (ground rules), in a browser; record each scenario's result here
  (Constitution VI smoke test).
- [ ] T025 Push and open the implementation PR (after the spec PR has merged and the branch is up to
  date with `main`): description says `fixes #126`, lists the review, the walk, the test counts, the
  shared-surface change of T014, and which of `033`'s and `032`'s implementations it is built on. Wait
  for CI green on GitHub (`test` and `e2e`) on the final commit; merge only when green and approved.

---

## Dependencies & Execution Order

- **Setup (T001)** → **Tests (T002–T008)** → **Backend (T009–T013)** → **Contract (T014)** →
  **Customer app (T015–T017)** → **Polish (T018–T025)**.
- T009 → T010; T011 and T012 after T009 only for the build. T002 passes after T010; T003 and T004 after
  T011; T005 after T012; T006 after T010.
- T014 after T012 (the Backend then always sends `inProgress` and never `STARTED`, so requiring them
  keeps every response matching).
- T015 → T016 → T017. The Customer app phase needs no running Backend (its tests stub the API), so it
  may start beside Phase 3 once T007 is written.
- T008 passes only after T010, T016, and T017. T019 after T008 passes.

### Parallel opportunities

- T002 to T008: different files, written together.
- The Customer app phase beside the Backend phase (above).

## Implementation Strategy

- **MVP**: T001–T013: sales and holds open until the end, availability saying so. A customer can
  already buy after the start; the panel still lacks the notice.
- Then the contract's tightening (T014), the notice and the confirmation (T015–T017), the browser tests,
  the README, and the PR.

## Review record (spec branch)

- **Round 1** (independent Claude session, 2026-11-09): no must-fix; 3 should-fix (one decided by the
  orchestrating session), 7 nits. All fixed in the `Review 034: spec review round 1` commit, and the
  Sync Impact Report's wording in a `Constitution:` commit.
  - S1: the two-step contract change cited `032` as a precedent, but making its fields required at
    1.24.0 is only proposed in PR #151, still open → "as PR #151 proposes for `032`", and the reason
    keeping 1.26.0 is acceptable under Principle I: the contract approved here already announces the
    final shape (research R2, plan Constitution Check I, contracts/README, spec Assumptions).
  - S2: start-based rules left without a note → dated notes on `006` (US2's narrative, SC-004), `007`
    (its "Events that started or were cancelled" edge case), and `033` (a reservation ending elsewhere
    when "the event starts"; the coordination assumption's "not yet specced"); listed in R9, FR-016,
    and the constitution's Impact line.
  - S3: two clocks on one page, the event page's `030` "This event has ended." (browser clock) beside
    the panel (Backend clock). **Decided by the orchestrating session**: once the panel's availability
    has loaded, the line follows `salesClosed === 'ENDED'` (never while `inProgress`); before that,
    `030`'s rule → spec Clarifications, Edge Cases, FR-017; research R4; data-model; plan; T007 (a
    fast browser clock near the end shows no "ended" line while the Backend says in progress); T016;
    a dated note on `030` FR-014.
  - N1: `getEventAvailability`'s "(`STARTED` is no longer sent)" → "…once 034 is implemented";
    `api-schema.ts` regenerated.
  - N2: T007 and R8 name the three stale spots in `purchase-unavailable.test.tsx` (~90, ~118, ~130).
  - N3: T002's "at the end" with real time is the end just reached; spec Edge Cases, R11, and T002 say
    "one millisecond before" cannot be tested without the injectable clock R1 rejects.
  - N4: FR-010 aligned with R4: the first sentence only whenever a closed message applies (sold out,
    the limit, or no seats on sale yet); T007 adds the no-seats case; data-model.
  - N5: plan row VI's hold just before the end → T003 and R11 add it.
  - N6: Sync Impact Report: `015`'s "Sales closed" edge case (not an entity); the spec PR's
    `packages/shared` changes (`api-schema.ts`, `order.ts`) named.
  - N7: R8 says where the notice can be seen: Demo Tonight from 1 hour after a reset, or an event
    scheduled with a past start (quickstart S0).
- **Round 2** (independent Claude session, 2026-11-09): 1 must-fix, 1 should-fix, 2 nits. All fixed
  in the `Review 034: spec review round 2` commit, and the Sync Impact Report's wording in a
  `Constitution:` commit.
  - M1: FR-017 showed "This event has ended." exactly when availability says `ENDED`, but
    availability says `CANCELLED` whatever the time, so a cancelled event that has ended lost the
    line (against this spec's edge case and `030` FR-014) → **decided by the orchestrating
    session**: once availability has loaded, the line shows when `salesClosed === 'ENDED'`, or when
    `salesClosed === 'CANCELLED' && !inProgress` and `030`'s browser-clock rule says ended; never
    while `inProgress` (spec Clarifications and FR-017, research R4, data-model, T007, T016, the
    `030` FR-014 note, the constitution's Impact line).
  - S1: T007's one-clock test also runs `{ ENDED, false }` with the browser clock before `endsAt` (a
    slow clock), so it proves the line follows availability, not the clock; spec Edge Cases says so.
  - N1: FR-017, R4, and T016 keep the last availability answer while `useLoad` re-keys to `loading`
    (reloads, seatings), and use `030`'s rule when no answer ever arrives; T007 covers a pending
    reload.
  - N2: the `006` FR-014 dated note's long line rewrapped.
- **Round 3** (independent Claude session, 2026-11-09): the reviewer's verdict: **only minor
  findings remain**; FR-017's rule holds for every reachable combination. 1 should-fix, 5 nits. All
  fixed in the `Review 034: spec review round 3` commit, and the Sync Impact Report's wording in a
  `Constitution:` commit.
  - S1: T007's "pending reload keeps the last answer" case could not be produced (`ENDED` and
    `CANCELLED` show no purchase controls, so nothing triggers a reload) → rewritten: browser clock 3
    minutes past `endsAt`, availability `{ null, inProgress: true }` (no line), a refused order whose
    availability reload stays pending: still no line and no fallback to `030`'s clock; the reload
    then answers `{ ENDED, false }` and the line appears.
  - N1: `STARTED` (in the enum until T014): an answer saying `STARTED` or without `inProgress` counts
    as no answer, so `030`'s rule applies (FR-017, R4, T007).
  - N2: FR-017 and R4: a failed reload after a first answer also keeps the last answer.
  - N3: the constitution's Impact line names the clock ("the browser's clock when the event loaded").
  - N4: the cancelled-and-ended edge case: a slow browser clock keeps the line hidden for a while
    after the Backend's end, because availability says `CANCELLED` whatever the time.
  - N5: plan Summary: the line follows availability rather than the browser's clock, except for a
    cancelled event.
- **Open findings**: none.
