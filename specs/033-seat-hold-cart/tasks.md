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
  first, bring this branch up to `main` and keep both. Issue #126 (sales open until `endsAt`, not yet
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

- [ ] T001 Cut `033-seat-hold-cart-impl` from `033-seat-hold-cart-spec` (or from `main` once the
  spec PR has merged); `npm ci`; `npm run ci` green before any change, so a later failure is this
  feature's. Record any test that fails on the untouched branch.

---

## Phase 2: Tests first (all must fail before Phases 3 and 4)

- [ ] T002 [P] [US2] `backend/test/integration/reservations.boundaries.e2e-spec.ts`, "the 2-minute
  wait" (FR-006, research R4, data-model): rewrite the cases to the new rule, keeping the database
  clock technique of the file (`held`, `ended`): for `EXPIRED`, `RELEASED`, `LOGOUT`, a seat of an
  ended reservation is refused one second before `endedAt + 2 minutes` (`409 SEAT_COOLDOWN`,
  `details.availableAt` exactly the reservation's `endedAt` + 2 minutes, the message "Your
  reservation of Section A, Row 1, Seat 5 ended less than 2 minutes ago. You can reserve it again at
  HH:MM:SS UTC.") and allowed at exactly 2 minutes; a seat released **while the reservation keeps
  another seat** is held again at once through the API (`200`, the same `expiresAt`; replaces "Re-adding
  the released seat … waits too"); a seat released at minute 1 of a reservation that then ends at
  minute 4 is refused until minute 6, not minute 3; `BOUGHT` and `CLOSED` start no wait; another
  customer never waits. Must fail (today the re-hold is `409`, and the wait runs from the hold's
  release).
- [ ] T003 [P] [US5] The hold allowance (FR-008, research R5): `backend/test/unit/attempt-limits.spec.ts`
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
- [ ] T004 [P] [US1] [US2] `backend/test/integration/reservations.e2e-spec.ts`, a click-by-click flow
  through the API (quickstart S10; FR-003, FR-004, FR-006, FR-019): hold seat 5 (`201`), seat 6
  (`200`, `expiresAt` unchanged), release 6 (`200`, 5 left, same end), hold 6 (`200`, same end),
  release 5 and 6 (`reservation: null`), hold 5 (`409 SEAT_COOLDOWN`), hold 8 (`201`, a new
  `expiresAt` 5 minutes from now), buy 8 with `createOrder` (`201`); every response matches the
  contract (`expectToMatchContract`). Must fail at the re-hold of 6.
- [ ] T005 [P] [US1] [US2] [US5] `customer-app/test/seat-hold-click.test.tsx` (new; FR-001 to FR-011,
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
  is in flight sends a release after the answer; a pending seat is named "…, holding";
  `SEAT_TAKEN` drops that seat, names it in the alert, and the queue goes on; `SEAT_COOLDOWN` says
  "Your reservation of … ended less than 2 minutes ago. You can hold it again at {time} {zone}." in
  the viewer's zone; `429` shows "Too many tries. You can try again in N seconds." above the map,
  open seats do nothing (`aria-disabled`) until it ends, queued holds are dropped, a held seat still
  releases; `TICKET_LIMIT_REACHED` and the 10-seat cap keep held seats; with seats held, the other
  ticket types' radios are disabled with the note (FR-005) and no release is sent; Add to cart
  navigates to `/cart` and sends nothing; the 1-minute warning once and the "ran out" alert at 0;
  a no-answer click reverts the seat and reloads the map. Must fail.
- [ ] T006 [P] [US1] [US3] [US4] `customer-app/test/cart.test.tsx` (new; FR-012 to FR-015, FR-017;
  research R8, R9): `/cart` with no reservations shows the empty text; with two reservations (two
  events, one without tiers) lists both newest first, each with the event's name linked, date and
  time in the venue's zone, ticket type and price (or the base price), seats, a countdown from its
  own `secondsLeft`, the total, Change seats linking to the event, and Buy tickets; one Name on
  tickets field with `017`'s messages; Buy tickets sends one `POST /events/{id}/orders` with that
  reservation's `tierId`, seats, `quantity`, the name, and a request id kept across Check again; the
  confirmation lists the codes and seats and the entry leaves the cart; `5xx` or no answer shows "We
  couldn't confirm whether your order went through" with Check again; `429 BUY` shows the countdown
  above that entry's button; `RESERVATION_REQUIRED` with `expired` drops the entry with the ran-out
  message; at 0 the entry drops with the alert; a stream change that reloads `mine` without the
  reservation drops the entry within the test's 2 seconds; the top bar has a Cart link. Must fail.
- [ ] T007 [US1] Update the existing Customer app tests written against Reserve seats and Confirm
  purchase, keeping what each checks (SC-006): `seat-holds.test.tsx`, `seats.test.tsx`,
  `rate-limit.test.tsx` (the hold wait now on a seat click; the buy wait on Confirm order and on the
  cart's Buy tickets), `holder-name-field.test.tsx` (seated: the field is in the cart), and every
  other file that presses Reserve seats or Confirm purchase or reads "Reserved for you" (`grep -lE
  "Reserve seats|Confirm purchase|Reserved for you|Release seats" customer-app/test`; check
  `keyboard`, `seat-stream`, `ticket-limit`, `purchase`, `theme-classes` too). General-admission
  cases stay as they are. The ones that assert the old flow must fail before T017.
- [ ] T008 [P] [US1] [US2] `e2e/tests/033-seat-hold-cart.spec.ts` (new; quickstart S1, S2, S6), title
  exactly `033 S1/S2/S6: a customer holds seats by clicking them, lets one go and takes it back, adds them to the cart, and buys them there`:
  a seated event made through the API helpers; as a customer (`customerFor(testInfo, n)`, a free
  index), click two seats; the Your seats box's countdown reads 5:00 or 4:5x and has not increased
  after the second; click one held seat, then again (held, no refusal); Add to cart; the Cart page
  lists both seats and a countdown; fill the name; Buy tickets; "Order confirmed" with both seats;
  the cart is empty; no Reserve seats, Release, or Confirm purchase button appeared. Must fail.
- [ ] T009 [P] [US1] [US5] Update the browser tests that hold seats, titles unchanged so their
  quickstarts' rows stay right: `006-007-tickets.spec.ts` (`007 S3`: click the seats, Add to cart,
  the name in the cart, Buy tickets), `015-seat-holds.spec.ts` (`015 S2`: the first customer's
  clicks hold the seats, released by clicking them), `026-rate-limits.spec.ts` (`026 S2`: fill the
  hold allowance through the API until a `429` with at least 3 seconds; a seat click is refused
  with the countdown above the map, the held seat stays, and the next click after the wait holds
  it; raise the loop's bound for 10 in 5 seconds). Must fail.

---

## Phase 3: Backend (US2, US5)

- [ ] T010 [US2] `backend/src/reservations/reservations.service.ts` `assertNoWait` (research R4,
  data-model): the query joins the reservation, requires `r."endedAt" IS NOT NULL`, and computes
  `r."endedAt" + interval '2 minutes'` as `availableAt`; the message as T002. T002 and T004 pass;
  every other `reservations.*`, `orders.*`, and `seat-holds.*` integration test passes unchanged.
- [ ] T011 [US5] `backend/src/attempt-limits/attempt-limits.config.ts` (research R5):
  `AttemptLimits` is `Record<RateLimitedAction, { perMinute; perFiveSeconds }>`; `BUY` from
  `RATE_LIMIT_PER_MINUTE` / `RATE_LIMIT_PER_5_SECONDS` (10, 3), `HOLD` from
  `RATE_LIMIT_HOLD_PER_MINUTE` / `RATE_LIMIT_HOLD_PER_5_SECONDS` (30, 10), each pair checked as now.
- [ ] T012 [US5] `attempt-limits.service.ts` picks the pair by kind in `tryAttempt`; the module and
  its comments; `test/setup/test-app.ts` (T003). T003 passes; the buy tests pass unchanged.
- [ ] T013 Run the contract tests (`backend/test/contract/`) and the Backend's whole suite: every
  response matches the contract; the route and role coverage unchanged.

---

## Phase 4: Customer app (US1–US5)

- [ ] T014 [US1] `customer-app/src/use-buy.ts` (new) from `GetTickets.tsx`'s `confirm()` (research
  R8): the request id kept per purchase, `401`, the `429 BUY` wait with its announcement and refocus,
  `5xx` and no answer to the unknown outcome, refusals; and `components/OrderConfirmation.tsx`
  (moved `Confirmation`). General admission on the event page uses both; its tests pass unchanged.
- [ ] T015 [US1] [US5] `customer-app/src/use-hold-queue.ts` (new; research R6): the ordered queue of
  holds and releases, one in flight, the cancel and reverse rules, the `429` and `401` and no-answer
  handling, each answer adopted with `lastWrite` as today.
- [ ] T016 [US1] `SeatPicker.tsx`: `pending` seats (holding or releasing) pressed as they will be and
  named "…, holding" / "…, releasing"; `chosen` (picks) removed; `full` counts held and pending.
- [ ] T017 [US1] [US2] `GetTickets.tsx`, seated half (research R6, R7, R9, R10; FR-001 to FR-011,
  FR-015, FR-016): picks, `reserve()`, Remove, the "Reserved for you" box, Release, Release seats,
  Confirm purchase, the Name on tickets field, and the tier change's silent release removed; seat
  clicks through the queue; other tiers disabled with the note while held; the Your seats box (the
  countdown, the seats, the total, Add to cart linking to `/cart`); the status region's hold and
  release messages; refusals in the alert; the hold wait above the map; the `SEAT_COOLDOWN` wording.
  T005 and T007 pass.
- [ ] T018 [US1] `components/HoldCountdown.tsx` (new) and `.hold-countdown` /
  `.hold-countdown__time` in `customer-app/src/styles.css` (theme tokens only; 32 px mono, tabular
  numbers): the timer (not announced) and the 1-minute status region, used by T017 and T019; the
  theme drift test passes.
- [ ] T019 [US1] [US3] [US4] `customer-app/src/pages/Cart.tsx` (new; research R8): the list from
  `GET /me/reservations`, each entry's event and tiers, `useSeatStream(eventId, { withMine: true })`
  per entry, the name field, Buy tickets through `use-buy.ts`, the confirmation in place, the
  run-out and released messages, the empty state. T006 passes.
- [ ] T020 [US1] `App.tsx`: the `/cart` route and the **Cart** nav link after My tickets.
- [ ] T021 Run the whole Customer app suite: every test passes; `GetTickets.tsx`'s header comment
  cites `033` instead of `015` research R13's "Reserve seats".

---

## Phase 5: Browser tests, documentation, review, pull request

- [ ] T022 `e2e/stack/docker-compose.e2e.yml`: `RATE_LIMIT_HOLD_PER_MINUTE: '30'` and
  `RATE_LIMIT_HOLD_PER_5_SECONDS: '10'`, literally, beside the buy pair (`026` FR-018). T008 and
  T009 pass on the `e2e` stack.
- [ ] T023 `specs/033-seat-hold-cart/quickstart.md`: the Automation rows S1, S2, S6 become `Automated:
  \`<T008's exact title>\`` (S2 keeping its note on the refusal); `npm test`'s quickstart-marks check
  passes.
- [ ] T024 README: the rate-limits paragraph names the hold pair and its defaults (30, 10) and the buy
  pair (10, 3); "What the system does" describes holding seats by clicking them, the countdown, and
  buying from the Cart; the `033` status row (tasks count and code status).
- [ ] T025 `npm run ci` locally, green; record the counts per workspace and the Backend's and Customer
  app's line coverage (each at or above 80%).
- [ ] T026 Run the Backend suite three times in a row, the Customer app suite three times, and `npm
  run test:tz` (the cooldown time in the viewer's zone); record the counts. The `e2e` job on GitHub
  runs T008 and T009; record its time.
- [ ] T027 Independent review by a separate Claude session (Constitution III) of the implementation
  against spec.md, plan.md, research.md, and the contract; fix the findings; record the round here.
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
