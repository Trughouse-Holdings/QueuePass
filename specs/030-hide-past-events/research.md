# Research: Hide Past Events

**Feature**: `030-hide-past-events` | **Spec**: [spec.md](./spec.md) | **Date**: 2026-11-09

The issue (#133) settles what is hidden and where. Every decision below that the issue leaves open
takes the recommended option and records the alternatives, for Mahdi and the team to overturn in
review of the spec PR. The code was read on `main` at `b293dc5`.

## R1. Where the rule lives: the Backend's event list

**Decision**: `EventsService.findAll` (`backend/src/events/events.service.ts`) adds one condition to
the query it already builds, unless the caller asks for past events:

```ts
...(query.includePast === 'true' ? {} : { endsAt: { gt: new Date(this.clock.now()) } }),
```

`endsAt > now` is exactly "not past" under the half-open rule (FR-001): at `endsAt` the event is
past. The condition joins the `where` the venue, name, instant-range, and day-range filters already
make (spec `004` FR-006: filters combine), so it is one more `AND`, and the day-range filter's
second pass (spec `020` research R15) runs on what is left. The order (`startsAt` ascending) does not
change (FR-006).

**Why**: one place decides for every client (the issue: "one place to get it right"). The Customer
app's Events page, its search, its filters, and its venue page all read the same list
(`customer-app/src/pages/EventList.tsx`, `pages/VenueDetail.tsx`, `filters.ts`'s `eventQuery`), and so
do the Admin app's Events page and venue page (`admin-app/src/api/events.ts`'s `listEvents`). With the
rule in the Backend none of the Customer app's list code changes. A filter in each app would be three
copies of the rule (the Ticket Booth already has one), each its own chance to differ, and could not
work with pagination (`#43`): a page of 20 that the app then thins out is not a page of 20.

**Alternatives**: filter in each app, leaving the API unchanged: no contract change, but three copies
and no pagination; rejected for the reasons above. A separate operation for past events (`GET
/events/past`): two operations to keep in step for one condition; rejected. A `status` value `ENDED`
stored on the event: a row change at every event's end, a job to make it, and a second source of truth
beside `endsAt`; rejected.

## R2. Which clock: the Backend's injectable clock

**Decision**: `EventsService` reads the time from the Backend's `Clock` (`backend/src/common/clock.ts`,
spec `018` research R3), provided in `EventsModule` as `{ provide: CLOCK, useValue: systemClock }`,
as `EntryModule` does. The integration tests' `createTestApp()` already overrides `CLOCK` with a
`FakeClock` for every module, so a test can set it to an event's `endsAt` exactly, and one
millisecond before, and check both sides of the boundary (Constitution VI; SC-003).
`clock.ts`'s header sentence "this clock decides only which live-code window is current" is replaced:
it decides which live-code window is current and, from spec `030`, which events the event list
counts as past.

**Why**: the boundary must be tested on both sides, which needs a clock a test can stop. The
database's `now()` cannot be set per test, and `new Date()` cannot be either without fake timers in a
process that also runs Nest and Prisma.

**Alternatives**: the database's `now()` in a raw condition, as the entry window does (spec `017`
research R5): the right choice where a lookup and an admit must agree inside one transaction, but a
list has no such pair, and the boundary could only be tested a few hundred milliseconds either side;
rejected. A separate clock token for events: one more provider to override for no gain; rejected.

`backend/test/unit/events.venue-moved.spec.ts` constructs `EventsService` by hand; it passes
`systemClock` as the new third argument.

## R3. The parameter: `includePast`, `true` or `false`, for any caller

**Decision**: `ListEventsQuery` (`backend/src/events/dto/list-events.query.ts`) gains

```ts
@IsOptional()
@IsIn(['true', 'false'], { message: 'includePast must be true or false' })
includePast?: 'true' | 'false';
```

The global `ValidationPipe` has `transform: true` but no implicit conversion, so query values stay
strings; comparing with `'true'` is exact, and `1`, `yes`, `TRUE`, or an empty value is `400
VALIDATION_FAILED` naming `includePast` (FR-003). The contract declares it `type: boolean, default:
false`, so `api-schema.ts` types it `includePast?: boolean`; `openapi-fetch` writes `true` and
`false` into the query string, which the Backend accepts.

**Who may send it**: the operation's `x-required-roles: []` is unchanged: any signed-in caller
(FR-004). Which events a list shows is not access control. A past event's page is readable by every
signed-in user through `getEvent` (spec `003`), a customer's past orders embed their events (`006`),
and Reports (admins) list every event. Restricting the parameter to admins would add a role check that
protects nothing a customer cannot already read, and the Constitution's rule that a UI is never the
enforcement (V) applies to protected data, not to a list's default (recommended answer, open to
review).

**Order**: unchanged, soonest start first. With the toggle on, past events come first, oldest first,
as every event did before this feature; the date filters narrow them. Listing past events after the
coming ones, newest first, would give the one operation two orders depending on a parameter, and the
Customer app relies on the one order (spec `003` research R3) (recommended answer, open to review).

## R4. Who asks for past events

| Caller | Sends `includePast` | Why |
| --- | --- | --- |
| Admin Events page (`admin-app/src/pages/EventList.tsx`) | `true` while Show past events is on | FR-008, FR-009 |
| Admin venue page (`pages/LocationDetail.tsx`) | `true` while its Show past events is on | FR-008, FR-009 |
| Admin venue form (`pages/LocationForm.tsx`) | always `true` | its `hasEvents` decides the time zone note: changing the zone moves past events too (`020`, `024`); FR-010 |
| Customer Events page, search, filters, venue page | never | FR-014 |
| Ticket Booth (`booth-app/src/api.ts`) | never | its own rule (`EventPicker.tsx`'s `forTheGate`: scheduled, `endsAt > now`) already leaves past events out; with the Backend leaving them out first, it offers the same events (FR-017). Its own check stays: it re-judges as time passes on a page left open. |

`admin-app/src/api/events.ts`'s `EventFilters` gains `includePast?: boolean`. Its `listEvents` drops
falsy values, so `false` is never sent, which the Backend treats as the default anyway.

Reports (`pages/Reports.tsx`) reads `GET /reports/sales`, which lists every event; attendees, sales,
and exports read by event id. None of them use the event list, so none change (FR-007, FR-013).

## R5. The Admin toggle lives in the page's address

**Decision**: a checkbox labelled **Show past events** on the Events page and the venue page. On, the
page's address carries `past=1` beside the existing filters (`q`, `venue`, `from`, `to`); off, no
`past` key. It applies at once when changed, without pressing Search, so it is outside the search
form's submit; Clear clears `q`, `venue`, `from`, and `to` and keeps `past`. The Events page's
`apply()` today rebuilds the address from `KEYS` alone, so Search and Clear would drop `past=1`; it
must carry `past` over from the current address (FR-008). The search form's
"filtered" state (which picks "No events match these filters" over "No events scheduled") does not
count it. While it is off the page says past events are hidden: the Events page's subtitle reads,
for example, "3 events scheduled · past events hidden", and the venue page's events section a line
"Past events are hidden." When the list is empty with it off, the empty state adds "Past events are
hidden; turn on Show past events to include them." Exact wording is the implementer's, inside FR-009.

**Why the address** (FR-008): the Admin Events page already keeps its filters in the address so that
reload and a shared link keep them (spec `004` FR-008); the toggle is one more filter and behaves the
same. A fresh visit from the menu (`NavLink to="/events"`) has no `past` key, so it starts off, which is
the default the issue asks for. Going back from a past event's page returns to the list with it still
on.

**Alternatives**: `localStorage` per browser: an admin who turned it on once would see every past event
on every later visit, which the default is meant to prevent, and a shared link would not carry it;
rejected (recommended answer, open to review). `sessionStorage`, as the Ticket Booth keeps its chosen
event: per tab, lost on a new tab, invisible in the address; rejected. Not kept at all: reload and Back
would turn it off while the address still showed the other filters; rejected.

## R6. "Ended" is worked out by each app, at load time

**Decision**: each app has a one-line helper, `hasEnded(endsAt: string, now: number): boolean` →
`Date.parse(endsAt) <= now`, in its own `format.ts` (`admin-app/src/format.ts`,
`customer-app/src/format.ts`), tested there. The time is read once, when a page's events load, and kept
with them, as My tickets already does for Add to calendar (spec `019` research R10), so a later render
never moves an event between states.

The Admin app shows a plain `pill` (`<span className="pill">Ended</span>`, the shared theme's existing
neutral pill, no new style) beside the name on the Events page, on the venue page, and on the event's
own page (`pages/EventDetail.tsx`, beside the existing Cancelled pill). Text, not color, carries it
(Constitution VII). A cancelled past event shows both pills.

**Why**: the list already says which events are past only by having them in it; marking needs a
per-event answer. The event's `endsAt` is in every response, and the apps already compare it with their
clock (the Ticket Booth, Add to calendar). A few minutes' clock difference between browser and Backend
only moves the label, never what is listed (spec Edge Cases).

**Alternatives**: a new response field `ended: boolean` worked out by the Backend: one more field on
every event, a contract change to `Event`, and the label would still be stale on a page left open;
rejected (recommended answer, open to review). One helper in `packages/shared`: shared surface for a
one-line comparison, and the implementation PR would then need every member's approval for it;
rejected. The Ticket Booth keeps its own inline check.

## R7. A past event's Customer page

**Decision**: `customer-app/src/pages/EventDetail.tsx` reads the time when the event loads and, when
`hasEnded`, shows `<p><strong>This event has ended.</strong></p>` under the name, after the cancelled
line when there is one (as the cancelled line is written today). Nothing else changes: the details,
the gallery, and the Get tickets panel, which already says "Sales closed: this event has already
started." for any started event.

**Why**: a link to a past event (from My tickets, a bookmark, a friend) must open (the issue: "rather
than not found"), and say why nothing can be bought. `getEvent` never leaves past events out (FR-007),
so the page already loads.

**Alternatives**: hide the Get tickets panel for a past event: then `#126`'s reworded closed message
("Sales closed: this event has ended.") would have nowhere to appear; `#126` owns that panel's wording;
rejected. Redirect to the list with a message: loses the event's details a ticket holder may want;
rejected.

## R8. My tickets: upcoming, then Past

**Decision**: `customer-app/src/pages/MyTickets.tsx` keeps its one request (`GET /me/orders`, newest
first) and its `loadedAt`, and splits the orders with `hasEnded(o.event.endsAt, loadedAt)`: those not
ended first, then an `<h2>Past</h2>` and the ended ones, each part keeping the newest-first order. With
no upcoming orders it says "You have no upcoming tickets." with the existing "Browse events" link, then
Past; with no past orders there is no Past heading; with no orders at all, today's "You have no tickets
yet." In `OrderCard`, the "Show entry code" link is left out when the event has ended; "Print ticket"
stays. Add to calendar is already off for ended events (`019` FR-002).

**Why**: nothing is deleted or hidden (the issue), the coming tickets a customer needs at the door are
on top, and a live entry code for an event the gate can no longer admit (`025`: the window ends at
`endsAt`) would only mislead. The printable ticket stays as a record.

**Alternatives**: a separate Past page or a collapsed section: one more route or control for a list the
page already has; rejected (recommended answer, open to review). Sorting past orders by event date:
the page's order is newest order first today (`006` FR-008); kept.

## R9. Admin pages for one past event, and Reports

Unchanged, and that is the requirement (FR-007, FR-013). `EventDetail` and `Attendees` load by event
id (`GET /events/{id}`, `/events/{id}/attendees`); the Sales card (`components/SalesCard.tsx`), Reports,
and the exports (`023`) read `GET /reports/sales`, which lists every event; Reports links each name to
its page. They are reachable from Reports, from the Events page with the toggle on, from the venue
page with its toggle on, and by link. Tests pin that each still works for a past event (tasks T004).

Deleting a venue is refused while any event is there, past included (`VENUE_HAS_EVENTS`, spec `002`);
the venue page says past events are hidden, and its toggle shows them (spec Edge Cases).

## R10. Existing tests and work in flight

- **Backend tests with fixed dates.** Many integration tests create events on fixed dates and then
  list them. Some are already behind us (2026-04 to 2026-10 in `events.search.e2e-spec.ts`,
  `events.date-filter.e2e-spec.ts`, `events.crud.e2e-spec.ts`); others are still ahead but will pass
  soon (`events.doors-open.e2e-spec.ts`, ending 2026-11-21; `events.search.e2e-spec.ts`'s 2026-12
  event). Fixing only the tests that fail today would leave the rest to fail later, one by one, on
  their dates. So **every** list request (`get('/events…')`) in a test whose events are on fixed dates
  gains `includePast=true`, whether it fails today or not; they are found by searching the tests, not
  by running them (tasks T010). A list request whose events are made relative to now is left as it is
  unless it relies on a past event being listed (the demo data's past event, `029`). No assertion
  otherwise changes; the commit names each file.
- **Front-end tests** mock the API, so the Backend's default does not reach them. But wherever an Admin
  or Customer test's outcome now depends on the date (the Ended label, the hidden note's list, My
  tickets' Past section, the ended notice), the test fixes the time (`vi.setSystemTime`) or builds its
  fixtures relative to the time it runs (T011). Moving a fixed date further ahead would only put the
  failure off to that date.
- **Spec `029` (demo checkpoint)**, implementation branch `029-demo-checkpoint-impl` (not merged at
  the time of writing): its browser test `029 S2` reads `GET /events` to find Season Opener, the demo's
  past event, by name. After `030` that list leaves it out, so the test asks with
  `?includePast=true`. `029`'s implementation (PR #144) is expected to merge first, so `030`'s
  implementation PR carries the change (T012). It also rewords `029`'s text that has the customer find
  Season Opener in the Customer app's list (spec `029` US1 scenario 3, quickstart S2 step 2): after
  `030` it is not listed, so the customer opens Season Opener's page by its link, where it still shows
  sales closed (T012).
- **`#126` (sell until the event ends)**, not yet specified: the same boundary, `endsAt`. An event in
  progress is listed (here) and will be on sale (there). `030` does not touch the Get tickets panel, the
  `salesClosed` values, or the sales rules, so `#126` changes them without meeting this feature.
- **`#129` (drop check-ins a week after the end)**: about attendee data, not lists; unaffected.
- **Spec `019`**: Add to calendar is offered only before `endsAt`; the Past section agrees with it.
- **Spec `020`**: the past rule compares instants, so time zones play no part; the day filters keep
  their venue-local meaning and combine with it.
- **Spec `008`**: the Customer filters (`filters.ts`) are unchanged; "Hide cancelled" still only changes
  what is shown, after the Backend left past events out.
- **Spec `025`**: the Ticket Booth's `forTheGate` is unchanged (R4).

## R11. Tests

- **Backend** (Jest, Testcontainers PostgreSQL, `createTestApp()`), new
  `backend/test/integration/events.past.e2e-spec.ts`: an event that ended one minute ago is left out by
  default and with `includePast=false`, and included with `includePast=true`; an event in progress and
  one ahead are always listed; the boundary with `ctx.clock.set(endsAt)` (left out) and `set(endsAt -
  1)` (listed), `useRealTime()` in `afterEach`; a cancelled past event is left out; the parameter
  combines with `locationId`, `q`, `from`/`to`, and `fromDate`/`toDate`; `TRUE`, `1`, `yes`, and an
  empty value are `400 VALIDATION_FAILED` naming `includePast`; the parameter is accepted from admin,
  customer, and gate-agent tokens; `getEvent` returns a past event; every response matches the
  contract (`expectToMatchContract`).
- **Admin app** (Vitest, React Testing Library): the Events page's first request has no `includePast`
  and the page says past events are hidden; checking Show past events requests `includePast=true`,
  writes `past=1` in the address, and marks events whose `endsAt` has passed Ended (and only those);
  a page opened at `/events?past=1` starts with it on; Clear keeps it; the empty state's hint; the venue
  page the same; the venue form always sends `includePast=true`; `EventDetail` shows Ended for a past
  event and not for one in progress; Reports links a past event to its page.
- **Customer app**: the Events page, a search, a venue filter, a date filter, and the venue page never
  send `includePast` (the requested URLs are checked); a past event's page says "This event has ended."
  and one in progress does not; My tickets splits by `loadedAt`, keeps every order, leaves "Show entry
  code" out under Past and keeps "Print ticket", and its empty states.
- **Browser** (`e2e/tests/030-hide-past-events.spec.ts`, against the Compose stack; spec `022`): the test
  makes its own venue and, through the API, an event that ended 2 hours ago (5 to 2 hours ago), one in
  progress (30 minutes ago to 2 hours ahead), and one 7 days ahead, so neighbours keep the 60-minute
  rule (the Backend accepts past times on create; tasks T007). `030 S1/S2`: the Customer app's list, a search for
  the past event's name, and its venue's page do not show it, and the other two are shown; its page
  opens with "This event has ended." `030 S4/S6`: the Admin Events page does not list it; with Show past
  events on it is listed with Ended; reloading keeps it; its page shows Ended, and its attendees page
  and Reports row open. My tickets' Past section stays manual and in the Customer tests: an order for a
  past event cannot be placed through the rules (sales close at the start, `006`).

## R12. Constitution 3.9.2 and contract 1.22.0

The roadmap row `030-hide-past-events` is reserved by a PATCH amendment (3.9.1 → 3.9.2, roadmap only),
the Sync Impact Report replaced, and the README's version reference follows. The contract moves from
**1.21.0 to 1.22.0** (MINOR: a new optional parameter, and the default list changes for every client),
with `packages/shared/src/api-schema.ts` regenerated in the same commit and `node
scripts/check-contract-drift.mjs` passing. Both are shared surface: the spec PR needs every member's
approval. Between this PR's merge and the implementation's, `main`'s Backend still lists every event and
refuses `includePast` (`forbidNonWhitelisted`); no client sends it until the implementation, so `main`
stays green.
