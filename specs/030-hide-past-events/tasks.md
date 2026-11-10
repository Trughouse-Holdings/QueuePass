---
description: "Task list for Hide Past Events"
---

# Tasks: Hide Past Events

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R12),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) (`listEvents` gains
`includePast`, 1.22.0), [quickstart.md](./quickstart.md) (S0–S9)

**Issue**: [#133](https://github.com/Trughouse-Holdings/QueuePass/issues/133). The implementation
PR's **description** says `fixes #133` on its own line. No commit message on either branch may
contain "fixes #133", "closes #133", or "resolves #133".

**Tests**: **REQUIRED and written first** (Constitution VI). Write the test tasks of Phase 2 and
confirm they **fail** before the implementation tasks that follow.

## Ground rules

- **Fresh session** (Constitution III): implement on branch `030-hide-past-events-impl` in a Claude
  session that starts from these files only. While the spec and plan PR is open, cut it from
  `030-hide-past-events-spec` and carry in every change that PR's review makes; once it merges, bring
  it up to `main`. A gap in the spec or plan is fixed there, not worked around in code.
- **Commits** cite the spec, the task IDs, and the issue: `Impl 030: the event list leaves past events
  out (T008, T009, #133)`.
- **The contract is done** in the spec PR (1.22.0, `api-schema.ts` regenerated). The implementation PR
  does not touch `contracts/openapi.yaml`, `packages/shared/`, or any other shared surface; a needed
  contract change goes back to the spec branch (or, after it merges, a `Clarify 030` PR).
- **One independent review** (Constitution III) of the implementation branch before its PR (T023).
- **`npm run ci` locally** before pushing (T021), then **CI green on GitHub**, the `test` and `e2e`
  checks, before merge (T025).
- **The team stack**: compose project `queuepass-team`, its Backend and apps run from
  `C:\Users\mahdi\hello_world\QueuePass-team` with `run-host.mjs`, holds every fixed port (5432, 8080,
  3000, 5173–5175). Do not stop it or write to it without Mahdi saying so in the session; walk on a
  stack of your own (`-p qp030`) when the ports are free, otherwise ask (T024).
- **Path B on this machine** (README "When the images can't be built"): the app images cannot be
  built here, so the Compose path (A) is walked by CI's `e2e` job (T007) and the hand walk uses path B.
- **Spec `029`** has merged (PR #144, `5598b67`): `e2e/tests/029-demo-checkpoint.spec.ts` reads the
  past demo event from `GET /events`, and 029's spec, quickstart, and the README say the Customer app
  shows Season Opener. This feature's implementation makes T012's and T020's changes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US4 from spec.md

---

## Phase 1: Setup

- [x] T001 Cut `030-hide-past-events-impl` from `030-hide-past-events-spec` (or from `main` once the
  spec PR has merged); `npm ci`; `npm run ci` green before any change, so a later failure is this
  feature's. Confirm `packages/shared/src/api-schema.ts` has `includePast?: boolean` in `listEvents`.

---

## Phase 2: Tests first (all must fail before the implementation)

  **Done** (2026-11-09): main at `10bd53f` (spec 030 merged, 028 and 029 implemented); `npm ci`;
  `npm run ci` green before any change (Backend 1233, admin 364, customer 335); `api-schema.ts` has
  `includePast?: boolean` in `listEvents`.
- [x] T002 [P] [US1] [US4] `backend/test/integration/events.past.e2e-spec.ts` (new; FR-001 to FR-007,
  SC-001 to SC-003, research R1 to R3, R11), with `createTestApp()`, `resetDb`, and the fake geocoder;
  `afterEach` calls `ctx.clock.useRealTime()`. Events made relative to the real time through the API
  (two venues, so the 60-minute rule never meets them): **ended** (ended 1 minute ago), **cancelled
  ended** (ended 2 hours ago, then cancelled), **in progress** (started 30 minutes ago, ends in 2
  hours), **ahead** (in 7 days). Cases:
  - `GET /events` and `?includePast=false`: in progress and ahead, in that order; neither ended one.
  - `?includePast=true`: all four, soonest start first.
  - The boundary: an event created ending at a whole minute `E` in the future; `ctx.clock.set(E)` →
    left out; `ctx.clock.set(E - 1)` → listed (SC-003).
  - Combined: `q` (the ended event's name) and `from`/`to` (a one-hour range around the ended event's
    start): each **empty** without `includePast`, exactly the ended event with it. `locationId` (the
    ended event's venue) and `fromDate`/`toDate` (the ended event's local date): without the parameter
    the ended event is **absent**, with it **present**; assert only that, never the whole list, because
    the venue and the day can also hold the in-progress or ahead event (near midnight, and under
    `npm run test:tz`).
  - `includePast=TRUE`, `1`, `yes`, and `includePast=` (empty): `400`, `res.body.error.code` is
    `VALIDATION_FAILED` and `JSON.stringify(res.body.error)` contains `includePast` (as
    `events.date-filter.e2e-spec.ts` asserts its refusals).
  - Admin, customer, and gate-agent tokens each get `200` with `includePast=true` and the past events.
    Use the token helpers on `main` (`backend/test/setup/tokens.ts`) for each role; spec `028`'s
    implementation (PR #145) rewrites them, so whichever of the two merges second adapts these calls.
  - `GET /events/{id}` of the ended event: `200`, the event.
  - Every `200` matches the contract (`expectToMatchContract(res, 'listEvents')`).
  Must fail (no parameter yet: `400` for `includePast`, and past events listed by default).
  **Done**: 16 tests; seen failing before T008 (11 of 16: no default rule, and the `400`s passed only
  because `forbidNonWhitelisted` refused the unknown parameter). The cancelled ended event is named
  "Cancelled Gala" so `q` on the ended event's name matches it alone. Token helpers from `main` after
  028 (`tokenFor(ADMIN | CUSTOMER | AGENT)`).
- [x] T003 [P] [US3] `admin-app/test/past-events.test.tsx` (new; FR-008 to FR-012, research R4 to R6),
  with the app's existing API mocking and a fixed time (`vi.useFakeTimers({ toFake: ['Date'] })` and
  `vi.setSystemTime`, or the pattern the app's tests already use): fixtures with one event ended, one in
  progress, one ahead.
  - Events page at `/events`: the request has no `includePast`; the page says past events are hidden;
    the checkbox "Show past events" is unchecked.
  - Checking it: a new request with `includePast=true`, without pressing Search; the address has
    `past=1`; the ended event's row has the text "Ended", the others do not; the hidden note is gone.
  - Opened at `/events?past=1`: checked, and the first request has `includePast=true`.
  - With the toggle on, typing `q` and pressing Search keeps `past=1` in the address (with `q`), and
    the request has both `q` and `includePast=true`.
  - With `q` typed and searched and the toggle on, Clear empties `q` and keeps `past=1`.
  - Off, a search that returns nothing: the empty state names Show past events.
  - Venue page (`/locations/:id`): the same four behaviors for its own list (request has `locationId`,
    and `includePast=true` only when checked).
  - Venue form (`/locations/:id/edit`): its events request always has `includePast=true`.
  - A cancelled ended event, with the toggle on: both "Cancelled" and "Ended".
  Must fail (no control yet).
  **Done**: `admin-app/test/past-events.test.tsx`, 18 tests (15 failed first; the 3 that passed pin
  unchanged behavior: an event in progress, Attendees, Reports).
- [x] T004 [P] [US3] Admin app, same or neighbouring test files (FR-011, FR-013, research R6, R9):
  `admin-app/test/format.test.ts` (or the app's existing format test) for `hasEnded(endsAt, now)`:
  `false` one millisecond before `endsAt`, `true` at it and after; `EventDetail` of an ended event shows
  "Ended" beside the name, of an event in progress does not; `Attendees` of an ended event loads; Reports
  with a past event in `/reports/sales` lists it and its name links to `/events/<id>`. Must fail where
  new (no helper, no pill).
  **Done**: in `past-events.test.tsx` (EventDetail, Attendees, Reports) and `format.test.ts` (new,
  2 tests, failing first: no helper). The cancelled past event's page shows Cancelled then Ended.
- [x] T005 [P] [US1] [US2] `customer-app/test/past-events.test.tsx` (new; FR-014, research R6, R7,
  R11): the Events page, a search (`q`), a venue filter, a date filter, and a venue page each request
  `/events` without `includePast` (check every requested URL); no control on those pages names past
  events. `EventDetail` of an event ended one minute ago shows "This event has ended." under the name;
  of one in progress, not; of a cancelled ended event, both lines. `customer-app/test/format.test.ts`
  (or the existing one): `hasEnded` as in T004. Must fail where new.
  **Done**: `customer-app/test/past-events.test.tsx`, 8 tests (the five list cases already pass and
  pin FR-014; the two ended-notice cases failed first); `format.test.ts` +2 (failing first).
- [x] T006 [P] [US2] `customer-app/test/my-tickets.test.tsx` (or the existing My tickets test; FR-015,
  FR-016, research R8), with a fixed time: orders for an ahead event and an ended one (newest first
  from the API, the ended one newer) → the ahead order first, then a heading "Past", then the ended
  order; every order present; under Past a valid unused ticket has "Print ticket" and no "Show entry
  code"; above it, both. Only past orders → "You have no upcoming tickets." with "Browse events", then
  Past. Only upcoming → no "Past" heading. No orders → "You have no tickets yet." Must fail.
  **Done**: a describe "upcoming, then Past (spec 030)" in `my-tickets.test.tsx`, 5 tests (3 failed
  first; only-upcoming and no-orders already held).
- [x] T007 [US1] [US2] [US3] `e2e/tests/030-hide-past-events.spec.ts` (new; research R11), with the
  fixtures in `e2e/fixtures/` (`apiFor`/`apiAs`, `createVenue`, `createEvent`, `addTier`, the
  per-worker accounts of `apps.ts`), its own venue with a unique name, and through the API three events
  at it whose times keep the 60-minute rule between neighbours (`events.service.ts`, the scheduling
  conflict check): **ended** from 5 hours ago to 2 hours ago, **in progress** from 30 minutes ago to 2
  hours from now (90 minutes after the ended one's end), and **ahead** 7 days from now, 7:00 PM to 10:00
  PM venue-local, each time sent in the venue's zone with its offset (spec `020`), as the existing
  fixtures do:
  - `030 S1/S2: the Customer app leaves an ended event out of the list, a search, and its venue page, and its own page says it has ended`:
    the Events page, a search for the ended event's name, and the venue's page show the in-progress and
    ahead events and not the ended one; the ended event's page (by its id) shows its name and "This
    event has ended."
  - `030 S4/S6: the Admin app hides an ended event until Show past events is on, marks it Ended, and its page, attendees, and Reports row open`:
    the Events page (search the venue) does not list the ended event; after checking Show past events
    it is listed with "Ended"; after a reload still; its page shows "Ended"; its Attendees page opens;
    Reports lists it and its name opens its page.
  Read only beyond its own rows. Must fail (no behavior yet). Write it now; it runs on CI's `e2e` job
  (T022).

---

## Phase 3: The Backend

  **Written**: two tests, `030 S1/S2` and `030 S4/S6`, type-checked by `npm run lint`; not run locally
  (no browser stretch was needed: the brief and T022 leave them to CI's `e2e` job on the PR).
- [x] T008 [US4] `backend/src/events/dto/list-events.query.ts` (research R3): `includePast?: 'true' |
  'false'` with `@IsOptional()` and `@IsIn(['true', 'false'], { message: 'includePast must be true or
  false' })`; the header comment names spec 030. T002's validation cases pass.
- [x] T009 [US1] [US4] `backend/src/events/events.module.ts`: provide `{ provide: CLOCK, useValue:
  systemClock }`. `backend/src/events/events.service.ts`: inject `@Inject(CLOCK) private readonly clock:
  Clock` as the constructor's third argument; in `findAll`, add `...(query.includePast === 'true' ? {} :
  { endsAt: { gt: new Date(this.clock.now()) } })` to `where`, with a comment citing FR-001, FR-002 and
  research R1, R2. `backend/src/common/clock.ts`: replace its header's sentence "this clock decides only
  which live-code window is current" with one saying it decides which live-code window is current and,
  from spec 030, which events the event list counts as past (research R2). `backend/test/unit/events.venue-moved.spec.ts`: pass `systemClock` as the third argument. T002
  passes.
- [x] T010 [US4] Every Backend list request in a test whose events are on **fixed dates**, past or still
  ahead, gains `includePast=true` (`?includePast=true`, or `&includePast=true` after its other
  filters) and nothing else (research R10). Find them by searching, not by running: every
  `get('/events` and ``get(`/events?`` under `backend/test`. On `main` at `5598b67` that is
  `events.crud.e2e-spec.ts` (lines 69, 84, 131, 156), `events.date-filter.e2e-spec.ts` (82; its `400`
  cases at 116 too), `events.doors-open.e2e-spec.ts` (85; events ending 2026-11-21),
  `events.price-precision.e2e-spec.ts` (58), `events.search.e2e-spec.ts` (49 to 102, including its 2026-12
  and 2027 events); check each one's dates, and any added since. They stay as they are:
  `events.ticket-limit.e2e-spec.ts` (83; its events come from `test/setup/fixtures.ts`'s `event()`,
  365 days and more ahead of the run); `demo-data.e2e-spec.ts` (97, times relative to now) unless it
  counts the demo's past event, Season Opener, in which case it asks with `includePast=true`;
  `venues-events.authz.e2e-spec.ts` (103, 113: status and contract only). Then run the
  suite: a failure is investigated, not patched. The commit names every file changed. Suite green.
  **Done**: T008, T009 (`cd5a3de`); T010 files: `events.crud`, `events.date-filter` (and its `400`s),
  `events.doors-open`, `events.price-precision`, `events.search` (and its `400`s); left as they are:
  `events.ticket-limit`, `demo-data`, `venues-events.authz`. Backend 1249/1249.
- [x] T011 Admin and Customer apps (research R10). Find the tests by searching, not by running: every
  test that renders a page gaining a date rule (Admin `EventList`, `LocationDetail`, `EventDetail`;
  Customer `EventDetail`, `VenueDetail`, `MyTickets`: by importing the page, or rendering the app at
  its route, `/events`, `/locations/<id>`, `/events/<id>`, `/venues/<id>`, `/my-tickets`) **and** uses
  fixed-date fixtures (`grep -rlE "endsAt['\"]?: ?['\"]20[0-9]{2}-" admin-app/test customer-app/test`,
  plus whatever imports them). On `main` at `5598b67` the shared fixtures are
  `admin-app/test/fixtures/events.json`, `admin-app/test/fixtures-005.ts`, and
  `customer-app/test/helpers.tsx`, with events ending on 2026-11-20/21, 2026-12-02/09, 2027-01-01/02,
  and 2027-11-07; and, among others, `admin-app/test/EventDetail.test.tsx`, `LocationDetail.test.tsx`,
  `customer-app/test/browse.test.tsx`, `doors-open.test.tsx`, and `my-tickets.test.tsx`. Each such test
  fixes the time before rendering, as `customer-app/test/add-to-calendar.test.tsx` (line 94) does:
  `vi.useFakeTimers({ toFake: [..., 'Date'] })` then `vi.setSystemTime(NOW)`, with `NOW` before every
  fixture's end unless the test is about an ended event; or builds its fixtures relative to the time it
  runs. Moving a fixed date further ahead is not enough: it only puts the failure off. Name each in the
  commit.
  **Done**: Admin: `admin-app/test/helpers/fixed-time.ts` (`fixTimeBeforeFixtures`, 2026-09-25, before
  `events.json`'s earliest end, 2026-10-02) in EventDetail, LocationDetail, cancel, delete-flows.event,
  delete-flows.venue, event-images.detail, layout, pages.live-fixtures, reports-export, reports,
  search, seat-holds, seating, theme-classes, ticket-limit, tiers, times.tz. Customer: the same helper
  in `helpers.tsx` (2026-10-01, before every rendered fixture's end; the earliest, 2026-11-20, in
  doors-open) in address-link, app, browse, cards, doors-open, event-images, filters,
  holder-name-field, keyboard, my-tickets, print-ticket, purchase-unavailable, purchase, rate-limit,
  seat-holds, seat-stream, seats, theme-classes, ticket-limit, times.tz; `fakeClock()` now keeps a
  fixed time (a second `useFakeTimers` is otherwise ignored by Vitest and leaves timers real).
  add-to-calendar and entry-code already fix their own time.
- [x] T012 Spec `029` after `030` (research R10). `029`'s implementation has merged (PR #144), so this
  PR carries these changes:
  - `e2e/tests/029-demo-checkpoint.spec.ts`: its `api.call<Event[]>('GET', '/events')` becomes
    `'/events?includePast=true'`, with a comment citing spec 030 research R10.
  - `specs/029-demo-checkpoint/spec.md` US1 acceptance scenario 3 and `quickstart.md` S2 step 2: where
    the customer sees Season Opener with sales closed, reword to open Season Opener's page by its link
    (it is not listed after spec `030`), which shows "Sales closed". The same for 029's US1 narrative
    (spec.md, "in the Customer app, Fall Concert is on sale and Season Opener is over") and SC-006
    ("the Customer app shows Season Opener with sales closed"): on its page. Text only; `029`'s
    Automation table and test title are unchanged.

---

## Phase 4: The Admin app (US3)

  **Done** (`187596a`).
- [x] T013 [US3] `admin-app/src/api/events.ts`: `EventFilters.includePast?: boolean` (sent only when
  `true`; the existing falsy filter drops `false`). `admin-app/src/format.ts`: `hasEnded(endsAt: string,
  now: number): boolean`, `Date.parse(endsAt) <= now`, citing FR-001. T004's helper cases pass.
- [x] T014 [US3] `admin-app/src/pages/EventList.tsx` (research R5, R6): `past` read from the address
  beside `q`, `venue`, `from`, `to`, but outside `KEYS`' "filtered" test and outside the search form's
  submit; a checkbox labelled "Show past events" that sets or removes `past=1` at once (keeping the other
  keys); `apply()`, which today rebuilds the address from `KEYS` alone, carries `past` over from the
  current address, so Search and Clear keep it (FR-008); `clear` keeps `past`; `toApi` sends `includePast: true` when on; the time read when the events
  arrive (kept with them, as My tickets' `loadedAt`); `<span className="pill">Ended</span>` after the
  name (after Cancelled when both) when `hasEnded`; while off, the subtitle adds "past events hidden" and
  the empty states add the hint naming Show past events. T003's Events page cases pass.
- [x] T015 [US3] `admin-app/src/pages/LocationDetail.tsx`: the same control on its own address
  (`useSearchParams`, `past=1`), `listEvents({ locationId: id, includePast })`, refetching when it
  changes; "Past events are hidden." under "Events here" while off (also when the list is empty); Ended
  pills. T003's venue page cases pass.
- [x] T016 [US3] `admin-app/src/pages/LocationForm.tsx`: `listEvents({ locationId: id, includePast:
  true })` with a comment citing FR-010. `admin-app/src/pages/EventDetail.tsx`: the Ended pill beside
  the name (after Cancelled), from the time the event loaded. T003's form case and T004 pass.

---

## Phase 5: The Customer app (US1, US2)

  **Done** (T013–T016, `e922470`). Beyond the letter of T015: the venue page's list had no Cancelled
  pill, so it gains one beside Ended (FR-011: a cancelled past event shows both marks on every list).
- [x] T017 [US2] `customer-app/src/format.ts`: `hasEnded`, as T013. `customer-app/src/pages/EventDetail.tsx`
  (research R7): read the time when the event loads; when ended, `<p><strong>This event has
  ended.</strong></p>` under the name, after the cancelled line. No change to the list pages, filters,
  or `GetTickets`. T005 passes.
- [x] T018 [US2] `customer-app/src/pages/MyTickets.tsx` (research R8): split `orders` by
  `hasEnded(o.event.endsAt, loadedAt)`; upcoming first, then `<h2>Past</h2>` and the past ones, each in
  the API's order; the empty texts of T006; `OrderCard` takes whether its event has ended and leaves out
  "Show entry code" then, keeping "Print ticket". T006 passes.

---

## Phase 6: Documentation, review, pull request

  **Done** (`b55e40d`).
- [x] T019 `specs/030-hide-past-events/quickstart.md`: the Automation rows S1, S2, S4, S6 become
  `Automated: \`<T007's exact title>\``, with `; rest Manual: …` where the test walks part of the
  scenario (S6: exports and the Sales card by hand); `npm test`'s quickstart-marks check passes.
- [x] T020 README: the `030` status row (tasks count and code status); the Customer and Admin app
  descriptions, where they list what each page shows, say past events are hidden and, for admins, the
  toggle (FR-018). In "Demo data" ("Season Opener, a week ago and over, so the apps show an event whose
  sales are closed") and "Demo checkpoint" ("Season Opener over, its sales closed"), say Season Opener
  is left out of the event lists after `030`: its page (by link, from Reports, or the Admin list with
  Show past events on) shows sales closed, as T012 rewords 029's spec.
  **Done** (`c8edef5`): quickstart-marks check passes (29 quickstarts). README: Customer browsing, My
  tickets, a new "Past events hidden" line, Demo data, Demo checkpoint, and the `030` row.
- [x] T021 `npm run ci` locally, green; record the counts per workspace and each workspace's line
  coverage (each at or above 80%).
  **Done** (2026-11-09, head `c8edef5`): `npm run ci` green, exit 0, with `KEYCLOAK_URL` and
  `KEYCLOAK_HEALTH_URL` at `http://127.0.0.1:9` (seed's 28 live tests skip). Counts: root scripts 85;
  shared 793; Backend 1249 (107 suites); admin-app 384; customer-app 350; booth-app 94; seed 262 passed,
  28 skipped; quick test:tz pass. Line coverage: shared 96.77%, Backend 97.09%, admin-app 97.30%,
  customer-app 97.68%, booth-app 93.44%, seed 99.41%.
- [ ] T022 Run the Backend suite three times in a row, and the Admin and Customer suites three times,
  and `npm run test:tz` (several zones: the boundary and the apps' fixed times); record the counts.
  The `e2e` job on GitHub runs T007's two tests; record their time.
  **Local part done**: Backend three times in a row, 1249/1249 each (97.09% lines); admin-app three
  times, 384/384 each (97.30%); customer-app three times, 350/350 each (97.68%); `npm run test:tz` all
  pass in America/New_York, UTC, America/Los_Angeles, Pacific/Honolulu (shared, Backend, admin,
  customer, booth). **Pending**: the `e2e` job on GitHub (`030 S1/S2`, `030 S4/S6`, and the changed
  `029 S2`) and its time: CI runs on the PR (T025).
- [ ] T023 Independent review by a separate Claude session (Constitution III) of the implementation
  against spec.md, plan.md, research.md, and the contract; fix the findings; record the round here.
- [ ] T024 Running-system walk, quickstart S0–S9, on a stack of its own (`-p qp030`) or path B with
  Mahdi's go for the team stack's ports (ground rules); record each scenario's result here
  (Constitution VI smoke test). Check the pages at phone width too (spec `008`).
- [ ] T025 Push and open the implementation PR (after the spec PR has merged and the branch is up to
  date with `main`): description says `fixes #133`, lists the review, the walk, the test counts, and
  that no shared surface is touched. Wait for CI green on GitHub (`test` and `e2e`) on the final
  commit; merge only when green and approved.

---

## Dependencies & Execution Order

- **Setup (T001)** → **Tests (T002–T007)** → **Backend (T008–T012)** → **Admin (T013–T016)** and
  **Customer (T017, T018)** → **Polish (T019–T025)**.
- T008 → T009 (T002 needs both). T010 after T009 (the default changes there). T011 after T014–T018
  (the labels appear there); T012 any time after T009.
- T013 before T014–T016. T017 before T018 (the helper).
- T007 passes only after T009, T014, T016, and T017. T019 after T007 passes.

### Parallel opportunities

- T002, T003–T004, T005–T006 (three workspaces' test files); T007 beside them.
- The Admin phase (T013–T016) and the Customer phase (T017, T018) once T009 is done.

## Implementation Strategy

- **MVP**: T001–T010: the Backend leaves past events out for every client. On its own it already
  meets US1 (the Customer app's lists need no change) and US4.
- Then the Admin toggle and labels (US3), the Customer page notice and My tickets (US2), the browser
  tests, the README, and the PR.

## Review record (spec branch)

- **Round 1** (independent Claude session, 2026-11-09): 1 must-fix, 5 should-fix, 4 nits; all fixed in
  the `Review 030: spec review round 1` commit, and N1 (the roadmap row) in its own `Constitution:`
  commit.
  - M1: T010 fixed only the Backend tests failing today, so tests on dates still ahead
    (`events.doors-open.e2e-spec.ts`, ending 2026-11-21; `events.search.e2e-spec.ts`'s 2026-12 and 2027
    events) would fail later, one by one; and T011's "move the fixture ahead" only put failures off →
    T010 adds `includePast=true` to **every** list request on fixed dates, found by search (the list as
    of `b293dc5`); T011 fixes the time (`vi.setSystemTime`) or builds fixtures relative to now
    (research R10, T010, T011).
  - S1: T002's combined cases expected empty results for `locationId` and `fromDate`/`toDate`, but the
    venue and the day can also hold the in-progress or ahead event (flaky near midnight and under
    `test:tz`) → those assert the ended event absent without the parameter and present with it; "empty"
    only for `q` and a narrow `from`/`to` (T002).
  - S2: T007's events had no exact times and could break the 60-minute venue rule → ended −5 h to −2 h,
    in progress −30 min to +2 h, ahead +7 days 7–10 PM local (T007).
  - S3: the Admin Events page's `apply()` rebuilds the address from `KEYS` only, so Search and Clear
    would drop `past=1` (FR-008) → R5 and T014 say `apply` carries `past` over; T003 gains "toggle on,
    search, `past=1` still in the address" (research R5, T003, T014).
  - S4: the `400` example showed `details.fields` as a map; the Backend sends a list of messages →
    contracts/README.md corrected, and the contract's four `VALIDATION_FAILED` examples too (example
    text only, still 1.22.0); T002 asserts as `events.date-filter.e2e-spec.ts` does,
    `JSON.stringify(res.body.error)` contains `includePast` (contracts/README.md, T002).
  - S5: spec `029`'s US1 scenario 3 and quickstart S2 step 2 have the customer see Season Opener in the
    Customer list, which `030` removes → T012 (this feature's implementation, since PR #144 merges first)
    rewords them to open its page by its link, beside the `includePast=true` lookup (research R10, T012).
  - N1: constitution row `030` "Depends on" adds `002`, `019`, `020`.
  - N2: T002 uses `main`'s token helpers for the gate agent; PR #145 (spec `028`) rewrites
    `backend/test/setup/tokens.ts`, and whichever merges second adapts (T002).
  - N3: T009 replaces `clock.ts`'s header sentence "decides only which live-code window is current"
    rather than adding a line after it (research R2, T009).
  - N4: `/my-tickets/<ticket>/entry-code` still opens by its address for a past ticket (only its link is
    left out); the gate refuses the ticket as ended anyway → listed in spec Out of scope.
- **Round 2** (independent Claude session, 2026-11-09): no must-fix, 2 should-fix, 3 nits; the
  reviewer's verdict: only minor findings remain. All fixed in the `Review 030: spec review round 2`
  commit, after rebasing onto `main` at `5598b67`.
  - S1: PR #144 (spec `029`'s implementation) merged → rebased onto `main`; README keeps main's `029`
    row ("Done (19/22 tasks)", "Built, reviewed, and walked") with the `030` row added and v3.9.2; the
    constitution's diff against `main` is only the Sync Impact Report, row `030`, the next free number
    `031`, and the version line. The Sync Impact Report's Impact line now names 029's text and README
    rewording (its own `Constitution:` commit).
  - S2: T011 said to fix front-end tests without saying how to find them → a search like T010's: tests
    rendering the six pages that gain a date rule with fixed-date fixtures (the fixture files and
    dates as of `5598b67`), fixing the time as `customer-app/test/add-to-calendar.test.tsx` does
    (research R10, T011).
  - N1: text written against `b293dc5` updated: `029` has merged; `demo-data.e2e-spec.ts`'s list request
    is line 97 (research R10, plan.md, T010, ground rules).
  - N2: `events.ticket-limit.e2e-spec.ts` dropped from T010's list: its `event()` fixture places events
    365 days and more ahead; noted in T010 and R10.
  - N3: T020 also rewords the README's "Demo data" and "Demo checkpoint" lines, and T012 029's US1
    narrative and SC-006, about Season Opener being shown in the Customer app.
- **Open findings**: none.

## Review record (implementation branch)

- **Round 1** (independent code review of PR #149, 2026-11-09): 1 must-fix, 1 should-fix, 3 nits;
  the reviewer's verdict after the must-fix: only minor findings remain. All fixed.
  - M1: the branch conflicted with `main` (specs `031`, #147, and `032`, #148, merged) → `main` merged
    in: the README keeps `main`'s `031` and `032` rows and v3.9.4 with this branch's `030` row; 030's
    spec keeps `032`'s four dated amendments (a Clarification, US2 scenario 2, the "event moved later"
    edge case, FR-016), which apply once `032` removes check-in details, so no `030` code changes; the
    constitution is `main`'s.
  - S1: My tickets' `<h2>Past</h2>` was the same level as each order card's `<h2>`, so heading
    navigation could not tell which orders are past (Constitution VII) → the past orders sit in a
    `<section aria-labelledby>` under the Past heading, their card headings `h3`; a test asserts a past
    card's heading is level 3 inside the Past region and an upcoming one is level 2 outside it.
  - N1: the `400` refusal cases in `events.search.e2e-spec.ts` (and its "from at or after to" case)
    and `events.date-filter.e2e-spec.ts` no longer send `includePast=true` (T010 covers list requests
    that return events, not refusals).
  - N2: `events.past.e2e-spec.ts` calls `expectToMatchContract(res, 'listEvents')` on every `200` it
    reads (the default and `includePast=true` included), as well as the client's own check (R11).
  - N3: `029 S2` also asserts "This event has ended." on Season Opener's page (FR-014).
  - After the fixes: `npm run ci` green; Backend 1249/1249, admin 384/384, customer 351/351, each three
    times in a row. Then `main` merged again (spec `031`'s implementation, `796e9a9`): `npm run ci`
    green with root scripts 85, shared 793, Backend 1295, admin 402, customer 351, booth 94, seed 262
    (28 skipped); lines: Backend 97.17%, admin 97.46%, customer 97.68%.
