---
description: "Task list for Add to Calendar"
---

# Tasks: Add to Calendar

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R15),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) →
[`contracts/openapi.yaml`](../../contracts/openapi.yaml) (1.12.0, already applied),
[quickstart.md](./quickstart.md) (S0–S9)

**Issue**: [#50](https://github.com/Trughouse-Holdings/QueuePass/issues/50). The implementation
PR's **description** says `fixes #50` on its own line. No commit message on either branch may contain
"fixes #50", "closes #50", or "resolves #50" (a commit body with that line closed issues early when
017's spec PR merged).

**Tests**: **REQUIRED and written first** (Constitution VI). In each phase, write the test tasks and
confirm they **fail** before the implementation tasks below them.

## Ground rules

- **Fresh session** (Constitution III): implement on branch `019-add-to-calendar-impl` in a Claude
  session that starts from these files only. While the spec and plan PR is open, cut it from
  `019-add-to-calendar-spec` and carry in every change that PR's review makes; once it merges, rebase
  onto `main`. A gap in the spec or plan is fixed there, in a spec PR, not worked around in code.
- **Tested many times** (Mahdi, 2026-10-24). None of these may be skipped or shortened:
  1. **At least two independent review rounds** on this branch (T021, T022), each by a separate
     Claude session that did not write the code, and more rounds until a round finds only minor
     (LOW) issues. The constitution requires one; Mahdi requires two for this feature. The same
     applies to the spec branch before its PR.
  2. **Every affected workspace's suite three times in a row** (`packages/shared`, `backend`,
     `customer-app`) before the PR, with each run's result recorded (T018). A failure in any run is
     investigated and fixed, never retried away, and then all three runs are repeated.
  3. **The generator's tests under several time zones**: in the suite (four `TZ` values, T006) and
     from the shell under `UTC` (as in CI), `America/New_York` (the team's local zone), and
     `America/Los_Angeles` (T016).
  4. **`npm run ci` locally** before pushing (T020), then **CI green on GitHub** on the PR's final
     commit before merge (T025).
  5. **The running-system check in the browser** with **two events**, each imported into a calendar
     app through the `.ics` file and opened through the Google link (T023, quickstart S2–S5).
- **Contract**: 1.12.0 is final. The implementation makes only the change contracts/README.md names:
  add `address` to `OrderEvent.location`'s `required` and delete the sentence "Always sent once
  feature 019 is implemented, which adds it to `required`." (T004). Regenerate `api-schema.ts` with
  `npm run generate:api`. Raise any other gap.
- **One generator** (research R1, R13): only `customer-app/src/calendar.ts` writes iCalendar text,
  formats calendar times, builds the Google link, names the file, or decides eligibility. No React in
  it, no browser-only API except in the component, and no npm package added.
- **Exact constants** (research R3–R8, R12): CRLF line ends; fold at 75 octets of UTF-8 on code-point
  boundaries; `PRODID:-//QueuePass//Customer app//EN`; `METHOD:PUBLISH`;
  `UID:queuepass-event-<event id>`; UTC times `YYYYMMDDTHHMMSSZ` from `getUTC…` only; MIME type
  `text/calendar;charset=utf-8`; Google base
  `https://calendar.google.com/calendar/render?action=TEMPLATE` with only `text`, `dates`,
  `location`; file name at most 60 characters before `.ics`, `event.ics` as the fallback; object URL
  revoked 60 seconds after the click.
- **Nothing extra in the entry** (FR-004): no ticket code, holder name, price, order id, or account
  id in the file or the link. No `DESCRIPTION`, `URL`, `ORGANIZER`, `ATTENDEE`, `VALARM`, `TZID`, or
  `VTIMEZONE`.
- **No request for the file** (FR-010): the button never calls the API or `fetch`.
- **Shared surface**: `contracts/openapi.yaml` and `packages/shared/` are shared surface; the
  implementation PR needs every team member's approval (Constitution, Feature Roadmap).
- **Backend Jest must run `--runInBand`** (`npm test` does). Backend tests read `packages/shared`
  from `dist`: run `npm run build --workspace @queuepass/shared` after changing it.
- **Commit messages** cite the spec and task IDs (Constitution III): for example
  `Impl 019: calendar file generator (T006, T008, #50)`.

## Phase 1: Setup

- [ ] T001 Cut `019-add-to-calendar-impl` from `019-add-to-calendar-spec` while the spec and plan PR
  is open, or from an up-to-date `main` once it has merged; run `npm ci`, `npx prisma generate` in
  `backend/`, then `npm run generate:api` and confirm `git diff` is empty (the spec PR's
  `api-schema.ts` was written by hand; if it differs, fix it in the spec PR). Run `npm test` from the
  repository root and confirm the suite is green before any change (baseline). No new npm package
  is needed; add none.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: **My tickets** receives each venue's full address (FR-012, research R2).

- [ ] T002 Extend `backend/test/integration/me-orders.e2e-spec.ts`:
  - an order at a venue with address parts: `event.location.address` equals the venue's
    `Location.address` (`STREET, CITY, ST ZIP`);
  - an order at a venue from before 013 (parts `null`, one-line `address` written straight through
    Prisma): `event.location.address` is that text;
  - two orders at two venues: each carries its own address;
  - every response matches the contract (`expectToMatchContract`).
  Confirm it fails (no `address` today).
- [ ] T003 In `backend/src/orders/orders.service.ts`, `mine()` returns
  `location: { id, name, address }` from the venue row it already loads; add `address: string` to
  `MyOrderResponse.event.location`. Run T002 until it passes.
- [ ] T004 Contract (ground rules): add `address` to `OrderEvent.location`'s `required` in
  `contracts/openapi.yaml` and delete the sentence named there; `npm run generate:api`; in
  `packages/shared/src/order.ts`, `OrderEvent.location` becomes
  `{ id: string; name: string; /** Spec 019 FR-012 */ address: string }`; build
  `@queuepass/shared`; add a default `address` to `myOrder` in `customer-app/test/helpers.tsx` and to
  every inline `location` of an `OrderEvent` in the Customer app's tests (the type check finds them).
- [ ] T005 Run the Backend's `me-orders`, `orders`, and contract tests and the whole Customer app
  suite (`tsc --noEmit` included); all pass.

---

## Phase 3: User Story 1 - Calendar file for Apple Calendar or Outlook, and User Story 3 - Offered only while it makes sense (Priority: P1) 🎯 MVP

**Goal**: each eligible order card downloads a correct `.ics` file; ineligible cards show nothing.
US3's tests are here because the same component decides both.

**Independent Test**: quickstart S1–S3.

### Tests (write first, confirm they fail)

- [ ] T006 [P] [US1] [US3] Write `customer-app/test/calendar.test.ts` (first line
  `// @vitest-environment node`), against research R3–R7, R10, R12, R14:
  - **Exact file**: `icsFile(entry, now)` for the R3 example (event id
    `6f1c2a4e-3b7d-4e2f-9a10-5c8d7e6f4a21`, `Season Opener`, `2026-10-31T23:30:00.000Z` to
    `2026-11-01T02:45:00.000Z`, `KFC Yum! Center`, `1 ARENA PLAZA, LOUISVILLE, KY 40202`,
    `now = 2026-10-24T15:30:00.000Z`) equals R3's text exactly, with `\r\n` after every line,
    the last included.
  - **Times**: milliseconds dropped (`…:00.999Z` → `…00Z`); an event crossing midnight; one
    crossing the new year (`2026-12-31T23:00:00Z` to `2027-01-01T02:00:00Z`); `endsAt` equal to or
    before `startsAt` throws (R14).
  - **UID and DTSTAMP**: two `MyOrder`s of one event and two different `now`s give the same `UID`
    and different `DTSTAMP`s; nothing else differs.
  - **Escaping** (R6), each alone and combined: `\` → `\\`, `;` → `\;`, `,` → `\,`; `\r\n`, `\n`,
    and `\r` each → `\n`; U+0000, U+0007, U+001F, and U+007F removed; tab kept; `:` and `"`
    unchanged; `LOCATION` is `escape(name) + '\, ' + escape(address)`.
  - **Folding** (R7), measured with `TextEncoder`: a `SUMMARY` line of exactly 75 octets is not
    folded; 76 octets folds into 75 + (space + 1); the 200-character ASCII name gives lines of 75,
    75, and 60 octets; `é` × 100, `漢` × 70, and `🎉` × 50 never split a character (each line
    decodes with `new TextDecoder('utf-8', { fatal: true })`); a `\,` on a fold. For every file in
    the test: every line ≤ 75 octets, every continuation starts with exactly one space, no `\n`
    without `\r` and no `\r` without `\n`.
  - **Round trip**: a reader in the test file (unfold `/\r\n[ \t]/g`, split lines, split at the
    first `:`, unescape) gives back the exact name and `name, address` for every fixture, minus
    removed control characters (SC-003).
  - **Time zones** (R5, SC-002): for `TZ` in `UTC`, `America/New_York`, `America/Los_Angeles`, and
    `Asia/Kolkata`, set `process.env.TZ`, assert that
    `new Date('2026-10-24T12:00:00Z').getTimezoneOffset()` is `0`, `240`, `420`, and `-330`
    respectively (so the switch really happened), and assert `icsFile` of every fixture equals the
    `UTC` result. Restore `TZ` in `afterEach`.
  - **Nothing extra** (FR-004): for an order with ticket codes, a holder's name, and a price, the
    file contains none of them, and no `DESCRIPTION`, `URL`, `ORGANIZER`, `ATTENDEE`, `VALARM`,
    `TZID`, or `VTIMEZONE`.
  - **File name** (R12): `Season Opener` → `season-opener.ics`; `Rock, Paper; Scissors \ Live` →
    `rock-paper-scissors-live.ics`; `Café Noël` → `cafe-noel.ics`; `  --A--  ` → `a.ics`; `🎉🎉` and
    `漢字` → `event.ics`; a 200-character name → 60 characters before `.ics`, not ending in `-`.
  - **Eligibility** (R10, FR-002): scheduled, future, valid → `true`; `CANCELLED` → `false`;
    `nowMs = endsAt − 1` → `true`; `nowMs = endsAt` → `false`; `nowMs` after `startsAt` (under way)
    → `true`; every ticket `VOID` → `false`; one `VOID` and one `VALID` → `true`; `VALID` with
    `checkedInAt` set → `true`.
- [ ] T007 [P] [US1] [US3] Write `customer-app/test/add-to-calendar.test.tsx` (React Testing
  Library, `vi.setSystemTime` fixed), rendering **My tickets** with orders for: an upcoming event; an
  event under way; a cancelled event; an ended event; a refunded order (all `VOID`); an order whose
  only ticket was used, event under way; two valid orders of one event. Assert:
  - each eligible card has exactly one group named "Add to calendar" with the button "Add to Apple
    Calendar or Outlook: <event name>, downloads a calendar file" and the note "A copy for your
    calendar: it won't change if the event does."; ineligible cards have no group, no button, no
    disabled control (SC-005, FR-015); no ticket `<li>` contains a calendar control;
  - the group comes after the event's details and before the ticket list; with `userEvent.tab()`,
    the button is reached after the event's links and before the first ticket's links (FR-013);
  - clicking, pressing Enter, and pressing Space on the button each save one file: stub
    `URL.createObjectURL` and `URL.revokeObjectURL`, spy on `HTMLAnchorElement.prototype.click`;
    the `Blob` has type `text/calendar;charset=utf-8` and text equal to `icsFile` of that event at
    the fixed time; the clicked anchor's `download` is the event's file name; `revokeObjectURL` is
    called once 60 seconds later (fake timers), not before; the stubbed API saw no request but
    `GET /me/orders` (FR-010);
  - both orders of the one event produce files with the same `UID`.
  Confirm both files fail.

### Implementation

- [ ] T008 [US1] [US3] Create `customer-app/src/calendar.ts`: `calendarEntry(event)` (from
  `OrderEvent`: `uid`, `title`, `startsAt`, `endsAt`, `location`), `icsFile(entry, now: Date)`,
  `icsFileName(name)`, `calendarEligible(order, nowMs)`, and the internal escape, fold, and UTC
  formatter, exactly as research R3–R7, R10, R12, R14 say. Comments cite the spec and research.
- [ ] T009 [US1] [US3] Create `customer-app/src/components/AddToCalendar.tsx`: the group
  (`role="group"`, `aria-labelledby` its visible "Add to calendar" label), the button with its
  `aria-label`, and the note (research R11); on click, make the `Blob`, save it through a temporary
  `<a download>`, and revoke the URL after 60 seconds (R12). In `customer-app/src/pages/MyTickets.tsx`,
  read `Date.now()` once per render of the list, pass it to each `OrderCard`, and render the group
  after the `<dl>` when `calendarEligible` is true. Use the shared theme's existing classes; add
  layout rules to `customer-app/src/styles.css` only with theme values, if needed (the theme-classes
  test must still pass).
- [ ] T010 Run T006 and T007 until they pass, then the whole Customer app suite.

---

## Phase 4: User Story 2 - Google Calendar (Priority: P1)

**Goal**: each eligible card opens Google Calendar pre-filled in a new tab.

**Independent Test**: quickstart S4–S5.

### Tests (write first, confirm they fail)

- [ ] T011 [P] [US2] Add to `customer-app/test/calendar.test.ts`, against research R8:
  - `googleCalendarUrl(entry)` for the R3 example equals exactly
    `https://calendar.google.com/calendar/render?action=TEMPLATE&text=Season+Opener&dates=20261031T233000Z%2F20261101T024500Z&location=KFC+Yum%21+Center%2C+1+ARENA+PLAZA%2C+LOUISVILLE%2C+KY+40202`;
  - parsed back with `new URL`, a name and venue with `&`, `#`, `/`, `+`, `%`, `=`, `?`, accents,
    and an emoji come back exactly from `searchParams.get`; the only keys are `action`, `text`,
    `dates`, and `location` (no `ctz`, no `details`);
  - the link is identical under the four `TZ` values of T006;
  - the 200-character name, 200-character venue name, and 500-character address are kept whole.
- [ ] T012 [P] [US2] Add to `customer-app/test/add-to-calendar.test.tsx`: each eligible card has the
  link "Add to Google Calendar: <event name>, opens in a new tab" right after the button, with
  `href` equal to `googleCalendarUrl` of its event, `target="_blank"`, and `rel` containing
  `noopener` and `noreferrer`; ineligible cards have none; Tab reaches it after the button.
  Confirm both fail.

### Implementation

- [ ] T013 [US2] Add `googleCalendarUrl(entry)` to `customer-app/src/calendar.ts` (R8) and the link
  to `AddToCalendar.tsx` (R11).
- [ ] T014 Run T011 and T012 until they pass, then the whole Customer app suite.

---

## Phase 5: Polish and testing many times

- [ ] T015 [P] Update `README.md`: the `019` row in the status table; "Today" says customers add an
  event they hold tickets for to Apple Calendar, Outlook, or Google Calendar from **My tickets**, as
  a one-time copy; the contract version 1.12.0 wherever the README names it.
- [ ] T016 Time zones from the shell (ground rule 3): in `customer-app`, run
  `TZ=UTC npx vitest run test/calendar.test.ts`, then with `TZ=America/New_York`, then
  `TZ=America/Los_Angeles` (Git Bash; Node honors `TZ` on Windows). All pass. Record the three
  results here.
- [ ] T017 Run `npm run lint`, `npx prettier --check .`, and `npm test` from the repository root;
  everything passes, including `check-contract-drift` and `check-boundary`.
- [ ] T018 Flake check (ground rule 2): run `npm test --workspace @queuepass/shared`,
  `npm test --workspace @queuepass/backend`, and `npm test --workspace @queuepass/customer-app` three
  times each, in a row. Record each run's pass count, fail count, and time here. Any failure is
  investigated and fixed, never retried away; then repeat all three runs.
- [ ] T019 Report coverage for the files this feature added or changed (`calendar.ts`,
  `AddToCalendar.tsx`, `MyTickets.tsx`, `orders.service.ts`) in this file and the PR description.
  `calendar.ts` should be 100% lines and branches. The 80% floor is not yet blocking (Constitution
  VI deferral until `010`).
- [ ] T020 Run `npm run ci` from the repository root (ground rule 4): format, lint, build, the full
  suite, and the coverage report, as GitHub Actions runs them. It passes. Record it here.

---

## Phase 6: Independent review (at least two rounds)

- [ ] T021 Review round 1 (Constitution III; ground rule 1): a separate Claude session that did not
  write the code reviews the branch against spec.md, plan.md, research.md, and this file, given the
  code, not the author's conclusions. Fix the findings. Record the round, its findings, and what was
  fixed here and in the PR description.
- [ ] T022 Review round 2 (Mahdi, 2026-10-24): another separate Claude session, not the one from
  round 1, reviews the branch after round 1's fixes. Fix the findings. If this round finds anything
  above LOW, run further rounds (T022a, T022b, …) until one finds only LOW issues. Record every
  round. After the last fixes, rerun T016, T017, T018 (three runs each), and T020.

---

## Phase 7: Running-system gate

- [ ] T023 From a fresh clone: `docker compose up --build`; seeding succeeds on the first run. Walk
  quickstart S0–S9 in the browser: two events (E1 and E2), each added through the `.ics` file to a
  real calendar app (name the app) and through the Google link (ground rule 5); the shell checks of
  each file; adding again (S6, record what the app did); the time zone check (S7); keyboard, screen
  reader, and phone width (S8); and the sign-in, use, and sign-out smoke test of all three front
  ends (S9). Record each step's result here. A step that does not behave as written is a spec
  defect: correct quickstart.md or the spec in a spec PR (Constitution III).

---

## Phase 8: Pull request and merge

- [ ] T024 Once the spec and plan PR has merged, rebase onto `main`, rerun `npm run ci` (T020),
  push `019-add-to-calendar-impl`, and open the implementation PR against `main` with `fixes #50` on
  its own line in the **description** only (see Issue above). Request every team member's review
  (shared surface). The description records: the review rounds (T021, T022), the time zone runs
  (T016), the three-run flake check (T018), coverage (T019), `npm run ci` (T020), the
  running-system results (T023), and any deviation from the plan.
- [ ] T025 CI green on GitHub (ground rule 4): the `CI` workflow's `test` check passes on the PR's
  final commit. If it fails, fix the cause (never skip a test or add a coverage exclusion) and push
  again; any fix after T023 that touches the Customer app or Backend reruns T017 and T018. Merge
  only with CI green and every team member's approval. Record the passing run's link here.

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2** → every story (the entry needs the address).
- **Phase 3 (US1 + US3)** needs Phase 2. It is the MVP: a correct file on every eligible card and
  nothing on the others.
- **Phase 4 (US2)** needs T008 (`calendarEntry`) and T009 (the group).
- **Phase 5** after Phases 3 and 4; **Phase 6** after Phase 5; **Phase 7** after Phase 6's last fixes;
  **Phase 8** last, after the spec and plan PR merges.

Within a phase, test tasks come first and must fail; implementation follows; the "run until they
pass" task closes the phase (T005, T010, T014).

## Parallel Opportunities

- Phase 2: T002 alone, then T003, then T004 (it builds `packages/shared`, which T005 needs).
- Phase 3: T006 and T007 in parallel (different files); then T008 before T009 (T009 imports it).
- Phase 4: T011 and T012 in parallel; they edit the files T006 and T007 created, so never at the same
  time as those.
- Phase 5: T015 alongside T016–T019; T020 last.

```text
# Phase 3 tests, together:
T006 customer-app/test/calendar.test.ts
T007 customer-app/test/add-to-calendar.test.tsx
```

## Implementation Strategy

1. **MVP**: Phases 1–3. The address arrives, and the calendar file works for Apple Calendar and
   Outlook on exactly the right cards.
2. **Google Calendar**: Phase 4.
3. **Proof, many times**: Phases 5–7: three time zones from the shell, three runs of every affected
   suite, `npm run ci`, two review rounds or more, and the browser walk with two events in a real
   calendar app and Google Calendar.
4. **Ship**: Phase 8, after the spec and plan PR merges, with CI green on GitHub.
