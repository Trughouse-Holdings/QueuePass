---
description: "Task list for Click to Hold a Seat, Add to Cart, Buy Before the Countdown Ends"
---

# Tasks: Click to Hold a Seat, Add to Cart, Buy Before the Countdown Ends

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R13),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) (contract 1.25.0),
[quickstart.md](./quickstart.md) (S0–S11)

**Issue**: [#135](https://github.com/Trughouse-Holdings/QueuePass/issues/135) (supersedes #131,
closed). The implementation PR's **description** says `fixes #135` on its own line. No commit
message on either branch may contain "fixes #135", "closes #135", or "resolves #135".

**Tests**: **REQUIRED and written first** (Constitution VI). Write the test tasks of Phase 2 and
confirm they **fail** before the implementation tasks of Phases 3 and 4.

## Ground rules

- **Fresh session** (Constitution III): implement on branch `033-seat-hold-cart-impl` in a Claude
  session that starts from these files only. While the spec and plan PR is open, cut it from
  `033-seat-hold-cart-spec` and carry in every change that PR's review makes; once it merges, bring
  it up to `main`. A gap in the spec or plan is fixed there, not worked around in code.
- **Commits** cite the spec, the task IDs, and the issue: `Impl 033: the click queue (T015, #135)`.
- **Contract first**: the contract (1.25.0), `api-schema.ts`, `.env.example`, and
  `docker-compose.yml` come from the spec PR. The implementation does not change
  `contracts/openapi.yaml`, `packages/shared/`, `backend/prisma/`, or any other shared surface
  (`useSeatStream` and the theme are used as they are); if it finds it must, the change goes to the
  spec PR first.
- **Work in flight**: the implementations of `030` (`030-hide-past-events-impl`: the customer event
  page for ended events, My tickets' Past section) and `032` (`032-drop-check-ins-impl`: My tickets'
  "Event over") do not touch `GetTickets.tsx`, the reservation rules, or the limits; if either merges
  first, bring this branch up to `main` and keep both. `032`'s implementation also edits
  `contracts/openapi.yaml` (it makes `checkInDetailsRemovedAt` required, still 1.24.0) and
  regenerates `api-schema.ts`: whichever of it and this feature's spec PR lands second keeps both
  contract changes, regenerates `api-schema.ts`, and reruns `node scripts/check-contract-drift.mjs`. Issue #126 (sales open until `endsAt`, not yet
  specced) will change `salesClosed`, the sweep, and the order check in the same files; whichever
  lands second keeps both (spec Assumptions).
- **One independent review** (Constitution III) of the implementation branch before its PR (T027).
- **`npm run ci` locally** before pushing (T025), then **CI green on GitHub**, the `test` and `e2e`
  checks, before merge (T029).
- **The team stack** (Compose project `queuepass-team`, its Backend and apps run from
  `C:\Users\mahdi\hello_world\QueuePass-team` with `run-host.mjs`) holds every fixed port and the
  team's data. Walk on a Compose project of your own (`-p qp033`); stop the team stack only with
  Mahdi's go in the session, with `docker compose -p queuepass-team stop` (never `down`, never `-v`),
  and restore it afterwards (quickstart S0, S11).
- **Path B on this machine** (README "When the images can't be built"): the app images cannot be
  built here, so the Compose path (A) is walked by CI's `e2e` job and the hand walk uses path B.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US5 from spec.md

---

## Phase 1: Setup

- [x] T001 Cut `033-seat-hold-cart-impl` from `033-seat-hold-cart-spec` (or from `main` once the
  spec PR has merged); `npm ci`; `npm run ci` green before any change, so a later failure is this
  feature's. Record any test that fails on the untouched branch.
  **Done** (2026-11-09): cut from `main` at `17b3b88` (the spec PR merged; 028 to 031
  implemented); `npm ci`. `main`'s own CI run at `17b3b88` is green. The local `npm run ci` before any
  change ran while T002 and T003 were being written into the worktree, so it picked up the new
  files: format, lint, build, and every other Backend suite passed; only the four rewritten 033
  files failed, as they must. No test fails on the untouched branch.

---

## Phase 2: Tests first (all must fail before Phases 3 and 4)

- [x] T002 [P] [US2] `backend/test/integration/reservations.boundaries.e2e-spec.ts`, "the 2-minute
  wait" (FR-006, research R4, data-model): rewrite the cases to the new rule, keeping the database
  clock technique of the file (`held`, `ended`): for `EXPIRED`, `RELEASED`, `LOGOUT`, a seat of an
  ended reservation is refused one second before `endedAt + 2 minutes` (`409 SEAT_COOLDOWN`,
  `details.availableAt` exactly the reservation's `endedAt` + 2 minutes, the message "Your
  reservation of Section A, Row 1, Seat 5 ended less than 2 minutes ago. You can reserve it again at
  HH:MM:SS UTC.") and allowed at exactly 2 minutes; a seat released **while the reservation keeps
  another seat** is held again at once through the API (`200`, the same `expiresAt`; replaces "Re-adding
  the released seat … waits too"); a seat released at minute 1 of a reservation that then ends at
  minute 4 is refused until minute 6, not minute 3; `BOUGHT` and `CLOSED` start no wait; another
  customer never waits; a seat released, held again, and bought in one reservation is refused later
  as `409 SEAT_TAKEN`, not `SEAT_COOLDOWN` (the sold check runs first, research R4); a hold released
  more than 8 minutes ago never blocks (the query's bound). Must fail (today the re-hold is `409`, and
  the wait runs from the hold's release).
- [x] T003 [P] [US5] The hold allowance (FR-008, research R5): `backend/test/unit/attempt-limits.spec.ts`
  (`attemptLimitsFromEnv` returns `{ BUY: { perMinute: 10, perFiveSeconds: 3 }, HOLD: {
  perMinute: 30, perFiveSeconds: 10 } }` with nothing set; each of the four settings read; each
  refused when not a whole number of at least 1, and a 5-second number above its minute's, naming
  the setting); `backend/test/integration/rate-limits.hold.e2e-spec.ts` with `attemptLimits:
  'defaults'` (exactly 10 of 20 simultaneous holds, each of its own seat, handled and 10 refused;
  the 31st hold attempt in a minute refused with the wait to the oldest's minute; releases never
  counted; the buy and hold allowances apart, buying still refused at its fourth in 5 seconds);
  `rate-limits.ordinary.e2e-spec.ts`'s start-up checks for the two new settings;
  `rate-limits.buy.e2e-spec.ts` unchanged and passing. `backend/test/setup/test-app.ts`:
  `attemptLimits` sets both pairs (`{ perMinute, perFiveSeconds }` for both kinds, or `'defaults'`
  deleting all four). Must fail.
- [x] T004 [P] [US1] [US2] `backend/test/integration/reservations.e2e-spec.ts`, a click-by-click flow
  through the API (quickstart S10; FR-003, FR-004, FR-006, FR-019): hold seat 5 (`201`), seat 6
  (`200`, `expiresAt` unchanged), release 6 (`200`, 5 left, same end), hold 6 (`200`, same end),
  release 5 and 6 (`reservation: null`), hold 5 (`409 SEAT_COOLDOWN`), hold 8 (`201`, a new
  `expiresAt` 5 minutes from now), buy 8 with `createOrder` (`201`); every response matches the
  contract (`expectToMatchContract`). Must fail at the re-hold of 6.
- [x] T005 [P] [US1] [US2] [US5] `customer-app/test/seat-hold-click.test.tsx` (new; FR-001 to FR-011,
  FR-016, FR-019; research R6, R7, R9, R10), with the API stubbed and fake timers: a click on an open
  seat sends one `POST …/reservation` with that seat and the seat is pressed and named "reserved by
  you"; the Your seats box shows "5:00" (or the answer's `secondsLeft`) in `.hold-countdown`, the
  seat, the total, and Add to cart; the status region says "Section A, Row 1, Seat 5 held. 4:59
  left."; a second seat's `200` keeps the countdown running; a click on a held seat sends one
  release and says "… released."; the last release removes the box and says the next seat starts a
  new 5 minutes, and the next hold's `201` restarts at 5:00; no button named Reserve seats, Remove,
  Release, Release seats, or Confirm purchase, and no Name on tickets field, on a seated event; three
  quick clicks send three requests one after another in click order (the second waits for the first
  answer); a second click on a queued, unsent seat sends nothing for it; a click on a seat whose hold
  is in flight sends a release after the answer; when a hold is refused, the release queued behind
  it for that seat is dropped (nothing more is sent for it), and when a release is refused or gets
  no answer, the hold queued behind it is dropped, including a double click on the only held seat
  whose release is refused (the seat stays held, one request sent); a pending seat is named "…,
  holding"; three quick clicks answered close together are three announcements in the status
  region, in order (research R10: the region appends, keeps at most 5, clears after 10 seconds),
  and that region has `role="status"` and `aria-atomic="false"`;
  `SEAT_TAKEN` drops that seat, names it in the alert, and the queue goes on; `SEAT_COOLDOWN` says
  "Your reservation of … ended less than 2 minutes ago. You can hold it again at {time} {zone}." in
  the viewer's zone; `429` shows "Too many tries. You can try again in N seconds." above the map,
  open seats do nothing (`aria-disabled`) until it ends, queued holds are dropped, a held seat still
  releases; `TICKET_LIMIT_REACHED` and the 10-seat cap keep held seats; with seats held, the other
  ticket types' radios are disabled with the note (FR-005) and no release is sent; Add to cart
  navigates to `/cart` and sends nothing; the 1-minute warning once and the "ran out" alert at 0;
  a no-answer click reverts the seat and reloads the map. Must fail.
- [x] T006 [P] [US1] [US3] [US4] `customer-app/test/cart.test.tsx` (new; FR-012 to FR-015, FR-017;
  research R8, R9): `/cart` with no reservations shows the empty text; with two reservations (two
  events, one without tiers) lists both newest first, each with the event's name linked, date and
  time in the venue's zone, ticket type and price (or the base price), seats, a countdown from its
  own `secondsLeft`, the total, Change seats linking to the event, and Buy tickets; one Name on
  tickets field with `017`'s messages; Buy tickets sends one `POST /events/{id}/orders` with that
  reservation's `tierId`, seats, `quantity`, the name, and a request id kept across Check again; the
  confirmation lists the codes and seats and the entry leaves the cart; `5xx` or no answer shows "We
  couldn't confirm whether your order went through" with Check again; `429 BUY` shows the countdown
  above that entry's button; `RESERVATION_REQUIRED` with `expired` drops the entry with the ran-out
  message; at 0 the entry drops with the alert; with fake timers, `GET /me/reservations` is read
  again about every second while `document.visibilityState` is `visible`, not while `hidden`, and
  at once on `visibilitychange` and `focus`; a read without a reservation drops its entry within 2
  seconds; **no seat stream is opened** (no `EventSource` or `/seats/stream` request), with **4 or
  more events** in the cart (each listed with its own countdown, event and tier reads made once per
  event, Buy tickets on the fourth sends its order at once); a tick while a read is in flight sends
  no second read, and an older answer arriving after a newer one is ignored; an entry whose Buy
  tickets is in flight, or in the unknown outcome with Check again, stays when a read lacks it, until
  the purchase settles; an entry gone from a read leads to one `GET /me/orders`: with an order for
  that event since the cart loaded, "Your seats for {event} were bought." with a link to My tickets,
  otherwise "Your reservation for {event} ended."; a read answered `401` stops the reads and signs in
  again; the top bar has a Cart link. Must fail.
- [x] T007 [US1] Update the existing Customer app tests written against Reserve seats and Confirm
  purchase, keeping what each checks (SC-006): `seat-holds.test.tsx`, `seats.test.tsx`,
  `rate-limit.test.tsx` (the hold wait now on a seat click; the buy wait on Confirm order and on the
  cart's Buy tickets), `holder-name-field.test.tsx` (seated: the field is in the cart), and every
  other file that presses Reserve seats or Confirm purchase or reads "Reserved for you" (`grep -lE
  "Reserve seats|Confirm purchase|Reserved for you|Release seats" customer-app/test`; check
  `keyboard`, `seat-stream`, `ticket-limit`, `purchase`, `theme-classes` too). General-admission
  cases stay as they are. The ones that assert the old flow must fail before T017.
- [x] T008 [P] [US1] [US2] `e2e/tests/033-seat-hold-cart.spec.ts` (new; quickstart S1, S2, S6), title
  exactly `033 S1/S2/S6: a customer holds seats by clicking them, lets one go and takes it back, adds them to the cart, and buys them there`:
  a seated event made through the API helpers; as a customer (`customerFor(testInfo, n)`, a free
  index), click two seats; the Your seats box's countdown reads 5:00 or 4:5x and has not increased
  after the second; click one held seat, then again (held, no refusal); Add to cart; the Cart page
  lists both seats and a countdown; fill the name; Buy tickets; "Order confirmed" with both seats;
  the cart is empty; no Reserve seats, Release, or Confirm purchase button appeared. Must fail.
- [x] T009 [P] [US1] [US5] Update the browser tests that hold seats, titles unchanged so their
  quickstarts' rows stay right: `006-007-tickets.spec.ts` (`007 S3`: click the seats, Add to cart,
  the name in the cart, Buy tickets), `015-seat-holds.spec.ts` (`015 S2`: the first customer's
  clicks hold the seats, released by clicking them), `026-rate-limits.spec.ts` (`026 S2`: fill the
  hold allowance through the API until a `429` with at least 3 seconds; a seat click is refused
  with the countdown above the map, the held seat stays, and the next click after the wait holds
  it; raise the loop's bound for 10 in 5 seconds). Must fail.
  **Done** (T002–T009): written first and seen failing before any implementation: Backend 16
  tests in 5 files (and the unit file's types); Customer app 77 tests in 9 files. The browser tests
  run on CI's `e2e` job. Two things the tasks left open, decided here: `createTestApp`'s
  `attemptLimits` also takes `{ BUY, HOLD }` (one pair per kind), so `rate-limits.ordinary` can
  check the hold pair's start-up refusals with a valid buy pair; and `033 S1/S2/S6` uses customer
  index 19, so `026 S2` now allows at most 8 repeats (indices 11 to 18). `my-tickets.test.tsx`'s
  header-links case gained Cart (FR-012).

---

## Phase 3: Backend (US2, US5)

- [x] T010 [US2] `backend/src/reservations/reservations.service.ts` `assertNoWait` (research R4,
  data-model): the query joins the reservation, requires `r."endedAt" IS NOT NULL` and `h."releasedAt"
  > now() - interval '8 minutes'`, and computes `r."endedAt" + interval '2 minutes'` as
  `availableAt`; the message as T002; in `reserveLocked`, the steps renumbered so step 4 is sold or
  held by others and step 5 the wait, with the comments ("Research R5, steps 1 to 7, in order" and
  each step's number) updated to say so. T002 and T004 pass;
  every other `reservations.*`, `orders.*`, and `seat-holds.*` integration test passes unchanged.
- [x] T011 [US5] `backend/src/attempt-limits/attempt-limits.config.ts` (research R5):
  `AttemptLimits` is `Record<RateLimitedAction, { perMinute; perFiveSeconds }>`; `BUY` from
  `RATE_LIMIT_PER_MINUTE` / `RATE_LIMIT_PER_5_SECONDS` (10, 3), `HOLD` from
  `RATE_LIMIT_HOLD_PER_MINUTE` / `RATE_LIMIT_HOLD_PER_5_SECONDS` (30, 10), each pair checked as now.
- [x] T012 [US5] `attempt-limits.service.ts` picks the pair by kind in `tryAttempt`; the module and
  its comments; `test/setup/test-app.ts` (T003). T003 passes; the buy tests pass unchanged.
- [x] T013 Run the contract tests (`backend/test/contract/`) and the Backend's whole suite: every
  response matches the contract; the route and role coverage unchanged.
  **Done**: 110 suites, 1309 tests, all pass; lines 97.17%.

---

## Phase 4: Customer app (US1–US5)

- [x] T014 [US1] `customer-app/src/use-buy.ts` (new) from `GetTickets.tsx`'s `confirm()` (research
  R8): the request id kept per purchase, `401`, the `429 BUY` wait with its announcement and refocus,
  `5xx` and no answer to the unknown outcome, refusals; and `components/OrderConfirmation.tsx`
  (moved `Confirmation`). General admission on the event page uses both; its tests pass unchanged.
- [x] T015 [US1] [US5] `customer-app/src/use-hold-queue.ts` (new; research R6): the ordered queue of
  holds and releases, one in flight, the cancel and reverse rules, the `429` and `401` and no-answer
  handling, each answer adopted with `lastWrite` as today.
- [x] T016 [US1] `SeatPicker.tsx`: `pending` seats (holding or releasing) pressed as they will be and
  named "…, holding" / "…, releasing"; `chosen` (picks) removed; `full` counts held and pending.
- [x] T017 [US1] [US2] `GetTickets.tsx`, seated half (research R6, R7, R9, R10; FR-001 to FR-011,
  FR-015, FR-016): picks, `reserve()`, Remove, the "Reserved for you" box, Release, Release seats,
  Confirm purchase, the Name on tickets field, and the tier change's silent release removed; seat
  clicks through the queue; other tiers disabled with the note while held; the Your seats box (the
  countdown, the seats, the total, Add to cart linking to `/cart`); the status region's hold and
  release messages; refusals in the alert; the hold wait above the map; the `SEAT_COOLDOWN` wording.
  T005 and T007 pass.
- [x] T018 [US1] `components/HoldCountdown.tsx` (new) and `.hold-countdown` /
  `.hold-countdown__time` in `customer-app/src/styles.css` (theme tokens only; 32 px mono, tabular
  numbers): the timer (not announced) and the 1-minute status region, used by T017 and T019; the
  theme drift test passes.
- [x] T019 [US1] [US3] [US4] `customer-app/src/pages/Cart.tsx` (new; research R8): the list from
  `GET /me/reservations` read again about every second while visible and on focus or becoming
  visible (paused while hidden), one read at a time, entries with a purchase in progress kept, a
  vanished entry explained through one `GET /me/orders`, `401` stops the reads and signs in, each
  entry's event and tiers read once, **no seat stream**, the name field, Buy tickets through `use-buy.ts`, the confirmation in place, the
  run-out and released messages, the empty state. T006 passes.
- [x] T020 [US1] `App.tsx`: the `/cart` route and the **Cart** nav link after My tickets.
- [x] T021 Run the whole Customer app suite: every test passes; `GetTickets.tsx`'s header comment
  cites `033` instead of `015` research R13's "Reserve seats".
  **Done**: 28 files, 395 tests, all pass; lines 97.98%. `seat-stream.test.tsx`'s two picks cases
  became seats marked unavailable with nothing sent (research R10: the "no longer available"
  messages go with picks).

---

## Phase 5: Browser tests, documentation, review, pull request

- [x] T022 `e2e/stack/docker-compose.e2e.yml`: `RATE_LIMIT_HOLD_PER_MINUTE: '30'` and
  `RATE_LIMIT_HOLD_PER_5_SECONDS: '10'`, literally, beside the buy pair (`026` FR-018). T008 and
  T009 pass on the `e2e` stack.
- [x] T023 `specs/033-seat-hold-cart/quickstart.md`: the Automation rows S1, S2, S6 become `Automated:
  \`<T008's exact title>\`` (S2 keeping its note on the refusal); `npm test`'s quickstart-marks check
  passes.
- [x] T024 README: the rate-limits paragraph names the hold pair and its defaults (30, 10) and the buy
  pair (10, 3); "What the system does" describes holding seats by clicking them, the countdown, and
  buying from the Cart; the `033` status row (tasks count and code status).
- [x] T025 `npm run ci` locally, green; record the counts per workspace and the Backend's and Customer
  app's line coverage (each at or above 80%).
  **Done** (2026-11-10, after merging `main` at `89d2349`, spec `034`'s PR): `npm run ci` green,
  exit 0, with `KEYCLOAK_URL` and `KEYCLOAK_HEALTH_URL` set to `http://127.0.0.1:9` so the live seed
  tests skip (28 skipped). Counts: root scripts 85; shared 793; Backend 1309 (110 suites);
  admin-app 402; customer-app 395 (28 files); booth-app 94; seed 262 passed, 28 skipped; quick
  test:tz (Los Angeles) pass. Line coverage: shared 96.77%, Backend 97.17%, admin-app 97.46%,
  customer-app 97.98%, booth-app 93.44%, seed 99.41%. (Also green before the merge, on `c45d545`.)
- [ ] T026 Run the Backend suite three times in a row, the Customer app suite three times, and `npm
  run test:tz` (the cooldown time in the viewer's zone); record the counts. The `e2e` job on GitHub
  runs T008 and T009; record its time.
  **Local part done** (on `c45d545`): the Backend suite three times in a row, 1309/1309 each (110
  suites; 212 s, 209 s, 195 s; lines 97.17%); the Customer app suite three times, 395/395 each (28
  files; lines 97.98%); `npm run test:tz` passed in America/New_York, UTC, America/Los_Angeles, and
  Pacific/Honolulu for every workspace except one admin-app timeout in Pacific/Honolulu (`venue page
  events > lists the venue's events in its zone`, 10 s under load; admin-app is untouched here),
  which passed on rerunning that zone. **Pending**: the `e2e` job on GitHub (T008, T009) and its
  time.
- [x] T027 Independent review by a separate Claude session (Constitution III) of the implementation
  against spec.md, plan.md, research.md, and the contract; fix the findings; record the round here.
  **Done**: code review rounds 1 and 2 on PR #154, recorded below, every finding fixed.
- [ ] T028 Running-system walk, quickstart S0–S11, on a stack of its own (`-p qp033`) or path B with
  Mahdi's go for the team stack's ports (ground rules), in a browser and with a screen reader or the
  accessibility tree for S1 and S2; record each scenario's result here (Constitution VI smoke test).
- [ ] T029 Push and open the implementation PR (after the spec PR has merged and the branch is up to
  date with `main`): description says `fixes #135`, lists the review, the walk, the test counts, and
  that no shared surface is touched. Wait for CI green on GitHub (`test` and `e2e`) on the final
  commit; merge only when green and approved.

---

## Dependencies & Execution Order

- **Setup (T001)** → **Tests (T002–T009)** → **Backend (T010–T013)** → **Customer app (T014–T021)**
  → **Polish (T022–T029)**.
- T010 → T013; T011 → T012 → T013. T002 and T004 pass after T010; T003 after T012.
- T014 → T015 → T016 → T017 → T018 → T019 → T020 → T021. The Customer app phase needs no running
  Backend (its tests stub the API), so it may start beside Phase 3 once T005 to T007 are written.
- T008 and T009 pass only after T010, T012, T017, T019, T020, and T022. T023 after T008 passes.

### Parallel opportunities

- T002, T003, T004, T005, T006, T008, T009: different files, written together; T007 after T005 and
  T006 (the same helpers).
- The Customer app phase beside the Backend phase (above).

## Implementation Strategy

- **MVP**: T001–T021: seats held by clicking, the wait's new rule, the hold allowance, the Your
  seats box, and the cart, which the issue makes one flow (Add to cart has nowhere to go without
  it). On their own, T010–T013 change nothing a customer sees except that a released seat can be
  clicked again at once.
- Then the browser tests' stack settings, the README, and the PR.

## Review record (spec branch)

- **Round 1** (independent Claude session, 2026-11-09): 1 must-fix, 5 should-fix (one of them
  Mahdi's decision), 3 nits. All fixed in the `Review 033: spec review round 1` commit.
  - M1: one `useSeatStream` per cart entry could fill the browser's six HTTP/1.1 connections per
    host (three events in two tabs), each downloading a full seat map and reloading
    `listMyReservations` on any seat change → the cart opens no seat stream; it reads
    `listMyReservations` about every second while visible, on focus and on becoming visible, and
    not while hidden; the connection budget is stated (FR-017, research R8, plan Performance Goals,
    data-model, T006 with 4+ events and no stream, T019).
  - S1: the click queue dropped nothing behind a refused or unanswered action → the opposite action
    queued for the same seat is dropped (FR-007, research R6, T005 with the double click on the
    only held seat).
  - S2: the new wait query no longer bounded `h."releasedAt"` → `AND h."releasedAt" > now() -
    interval '7 minutes'`, exact since a hold ends at most 5 minutes before its reservation
    (research R4, data-model, T002, T010).
  - S3: `032`'s implementation does edit the contract (`checkInDetailsRemovedAt` required, still
    1.24.0) and regenerates `api-schema.ts` → whichever lands second keeps both, regenerates, and
    reruns `check-contract-drift` (spec Assumptions, research R13, plan, contracts/README, tasks
    ground rules).
  - S4: a seat released, held again, and bought left a `RELEASED` hold in an ended reservation, so a
    later hold got `SEAT_COOLDOWN` instead of `SEAT_TAKEN` → the sold or taken check (step 5) runs
    before the wait (step 4) (research R4, data-model, contract, contracts/README, T002, T010).
  - S5: **Mahdi decided (2026-11-09, asked directly)**: holds get their own limit, 30 a minute and 10
    in any 5 seconds; buying keeps 10 and 3 → recorded as decided by Mahdi in spec Clarifications
    and Assumptions, research R5, the checklist, and `026`'s dated notes.
  - N1: the contract's description lines touched by `033` rewrapped to 100 characters.
  - N2: `releaseSeats` says the seats that left "released, run out, or on logout" wait; bought and
    admin-closed seats never do.
  - N3: the polite status region could drop announcements on fast clicks → it appends (keeps at most
    5 lines, cleared 10 seconds after the last); three quick clicks are three announcements (FR-016,
    research R10, T005).
- **Round 2** (independent Claude session, 2026-11-09): the reviewer's verdict: **only minor
  findings remain**. 2 should-fix, 3 nits. All fixed in the `Review 033: spec review round 2`
  commit.
  - S1: the cart's reads could drop an entry whose purchase was in flight or awaiting Check again,
    could not tell a purchase elsewhere from a release, could overlap, and ignored `401` → an entry
    with a purchase in progress is kept until it settles; a vanished entry leads to one
    `listMyOrders` read ("bought", linking My tickets, if an order for that event appeared since the
    cart loaded; otherwise "Your reservation for {event} ended."); one read in flight, older answers
    ignored; a `401` stops the reads and signs in again (spec Edge Cases, FR-017, research R8,
    data-model, T006, T019).
  - S2: the appending status region sets `aria-atomic="false"` (`role="status"` implies `true`; the
    rate-limit region stays atomic) (FR-016, research R10, T005).
  - N1: the `releasedAt` bound was called exact, but `endedAt` can trail by up to `LOCKING_TX`'s 15
    seconds → `interval '8 minutes'`, described as safe (research R4, data-model, T002, T010).
  - N2: "step 5 runs before step 4" → the steps are renumbered (4 the sold or taken check, 5 the
    wait), and T010 updates the code's step comments (research R4, data-model, T010).
  - N3: the checklist no longer lists the hold allowance and one request per click as open to review.
- **Open findings**: none.

## Review record (implementation branch)

- **Round 1** (code review on PR #154, 2026-11-10): 1 must-fix, 1 should-fix, 6 nits. All fixed
  in the `Review 033: code review round 1` commit, tests first (each new test seen failing on the
  code before it).
  - M1 (FR-016, `015` FR-012): another customer's live change to a seat whose hold was pending was
    skipped as this customer's own, so after the `SEAT_TAKEN` refusal the seat was drawn natively
    `disabled` and the keyboard focus fell to the page → the refusal marks the refused seat (and the
    seats it names) as unavailable while shown, so it stays focusable with `aria-disabled`, and the
    map is reloaded only when the stream is not live (a reload redraws the form). Found with it:
    the click queue called the handlers of the render that sent the click, so an answer saw stale
    page state → it calls the page's latest handlers when the answer comes. Test:
    `seat-stream.test.tsx` "keeps focus on a seat another customer took while this customer's hold
    of it was pending"; `seats.test.tsx`'s taken-seat case now expects the clicked seat focusable.
  - S2 (FR-012, FR-017): any non-401 failure to read an event marked it deleted for good, hiding a
    live reservation and saying the cart was empty, and every visit flashed "Your cart is empty"
    before the events were read → only a `404` hides an entry; other failures are read again with
    the next read of the reservations; "Loading your cart…" shows until every listed event is read.
    Tests: loading never empty, a `500` then success, a `404` not listed.
  - N3: the cart's sequence guard could never fire with one read at a time → removed; the test
    retitled ("applies its answer when it comes").
  - N4: a cart opened with under a minute left says the 1-minute warning on opening, once for that
    page, as the event page does → documented in `Cart.tsx`.
  - N5: "bought since the cart loaded" compared the Backend's `createdAt` with the browser's clock →
    an order counts as this reservation's when placed at or after the reservation's `createdAt`,
    both the Backend's times; a purchase in another tab within 2 seconds of the end is told as run
    out (documented). Tests: a browser clock weeks ahead still says bought; an older order says
    ended.
  - N6: `015 S2`'s 2 seconds now run from the second click, not across two holds.
  - N7: `App.tsx`'s comment wrapped at 100.
  - N8: `use-hold-queue.ts` guards only the request, so a handler that throws surfaces instead of
    reading as no answer; a comment says queued clicks keep sending after Add to cart leaves the
    page (harmless: the cart shows the result).
  - After round 1: the Customer app suite three times, 400/400 each (28 files; lines 98.12%); the
    reservation, seat-hold, order-reservation, and attempt-limit tests once, 10 suites, 121 tests,
    all pass.
- **Round 2** (code review on PR #154, 2026-11-10): no must-fix; 2 should-fix and 3 nits, the
  should-fixes' approach decided by the coordinator. All fixed in the `Review 033: code review
  round 2` commit, tests first.
  - S1 (FR-016, `015` FR-012): with the stream not live, round 1's `refresh()` called
    `live.reload()`, which empties the map, so the panel went back to "Loading tickets…" and the
    focus fell to the page → the Customer app never calls `live.reload()`: it reads
    `/events/{id}/seats` itself and shows that map over the stream's until the stream next changes
    it, and a reload of what is left or of the tiers keeps the last answer on screen, so the form is
    never redrawn after the first load (no change to the shared hook). Test: `seats.test.tsx`'s
    taken-seat case (no stream; the map's second read takes a moment, as over a network) keeps the
    same, focused seat button with `aria-disabled` and never shows "Loading tickets…".
  - S2 (FR-012, FR-017): an event whose details kept failing left the cart loading for good → its
    reads back off (1, 2, 4, 8, then every 10 seconds, each with the next read of the
    reservations), and after 3 failures its entry shows with "Details unavailable" (a link to the
    event), its seats, and its countdown; Buy tickets still buys (the order needs no details).
    Tests: the entry after 3 failures, bought; the backoff's tries over 45 seconds.
  - N3: "bought" also needs one of the reservation's seats on the order, so a general-admission or
    other-seats order in another tab does not call an ended reservation bought. Test.
  - N4: the click queue's handlers are updated in a layout effect, not during render; its comment
    says a queued answer after Add to cart can still sign in again or reload (harmless).
  - N5: `026 S2` checks the shown wait against the click's own `429` (`retryAfterSeconds`), not
    against 5 seconds, and waits for it to end accordingly.

