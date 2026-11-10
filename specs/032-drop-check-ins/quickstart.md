# Quickstart: Drop Check-in Details a Week After the Event

**Feature**: `032-drop-check-ins` | **Spec**: [spec.md](./spec.md)

The running-system gate for this feature. Walk it against a stack built from the implementation
branch, **on its own Compose project** (`-p qp032`), or on path B with the team stack's go-ahead from
Mahdi (tasks, ground rules). The job removes check-in details from **every** event past its cutoff in
the database it runs on, the first time it starts: on the team's database that is every event that
ended more than a week ago. Each scenario names the requirements it proves. Test accounts and the seed
password are in the README.

## S0. An event with admitted tickets

1. Path A: `docker compose -p qp032 up --build`. Path B: as in the README ("When the images can't be
   built"), on a stack of its own or the team's with Mahdi's go.
2. In the Admin app, as `admin1`, add a venue **QP032 Hall** (Eastern time; saved not verified is fine)
   and schedule **QP032 Show** there, starting 30 minutes from now, ending 2 hours after that, doors 1
   hour before the start (so check-in is open now), with a tier General, $10.
3. In the Customer app, as `customer1`, buy 3 General tickets (name on tickets "Pat Doe"); as
   `customer2`, buy 2.
4. In the Ticket Booth, as `agent1`, choose QP032 Show and admit 2 of `customer1`'s tickets and 1 of
   `customer2`'s (codes from the Admin app's attendee list).
5. **Expected**: Attendees says 2 orders · 5 valid tickets · 3 checked in, each admitted ticket "✓
   checked in …"; the event page's Sales card and Reports say 3 checked in. Note the Reports row.

## S1. Kept before the cutoff (US1; FR-001, FR-003, SC-001)

1. In the Admin app, edit QP032 Show so it **ended 6 days ago** (start 6 days ago at 7:00 PM, end
   10:00 PM, doors 6:00 PM). **Expected**: saved (times still change before removal, FR-008).
2. Restart the Backend (path A: `docker compose -p qp032 restart backend`; path B: Ctrl+C and
   `run-host.mjs` again), so the job runs at once.
3. **Expected**: Attendees, the Sales card, and Reports as at the end of S0: 3 checked in, each admitted
   ticket marked, no "removed" sentence.

## S2. Removed at the cutoff; the report reads the same (US1, US2; FR-001, FR-002, FR-004, FR-009, FR-011, SC-001, SC-004)

1. Edit QP032 Show so it **ended 8 days ago** (start 8 days ago at 7:00 PM, end 10:00 PM). Restart the
   Backend as in S1.
2. **Expected**: the Backend's log says it removed check-in details of 1 or more events.
3. Reports: QP032 Show still says 3 checked in, beside "Details removed ⟨today's date⟩"; the totals
   are those of S0. The event page's Sales card: 3 checked in and "Check-in details removed on
   ⟨today⟩ (kept for 7 days after the event)."
4. Database check (path A: `docker compose -p qp032 exec database psql -U queuepass -c 'SELECT
   count(*) FROM "Ticket" t JOIN "Event" e ON e.id = t."eventId" WHERE e.name = $$QP032 Show$$ AND
   (t."checkedInAt" IS NOT NULL OR t."checkedInBySub" IS NOT NULL OR t."checkedInByUsername" IS NOT
   NULL)'`). **Expected**: 0.

## S3. Attendees and the export (US3; FR-010, FR-012, FR-013, SC-005)

1. Open QP032 Show's attendees. **Expected**: under the title "Check-in details removed on ⟨today⟩
   (kept for 7 days after the event)."; the summary says 3 checked in; no ticket says "checked in"; each
   order's check-in cell reads "—".
2. Download the attendee list as CSV, Excel, and PDF. **Expected**: in each, the "Checked in" column is
   empty in every row, and the heading lines include the sentence and "3 tickets were checked in."
3. On Reports, download the sales report. **Expected**: QP032 Show's Checked in is 3, as on the page.

## S4. A removed event's times are fixed (US4; FR-008, SC-006)

1. Edit QP032 Show, change only its name to **QP032 Show (past)**, and save. **Expected**: saved.
2. Edit it again and move its end 1 hour later. **Expected**: refused, "The check-in details of QP032
   Show (past) were removed on ⟨today⟩, so its times can no longer change."; the form keeps the values
   typed; reloading shows the old end.

## S5. The customer's view (FR-014)

1. In the Customer app, as `customer1`, open My tickets. **Expected**: the QP032 Show order is under
   Past (spec `030`); its 3 tickets each read "Event over", with no "Show entry code" or "Print
   ticket"; opening `/my-tickets/<ticket>/print` for one says the ticket can't be printed.
2. As `customer2` the same.

## S6. Sign in, use, sign out (Constitution VI)

Sign in to each front end, use it briefly, and sign out. **Expected**: as before `032`. Afterwards
`docker compose -p qp032 down -v` removes this stack and its data.

## Automation

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`. A removal needs an event that ended a week
ago with admitted tickets, which the rules allow only by moving the event's times after admitting
(as S1, S2 do) and restarting the Backend, neither of which the browser tests do; the rules are
covered by the Backend's integration tests against real PostgreSQL with a fixed clock (tasks T002 to
T004) and each page by its Vitest tests (T005, T006).

| Scenario | Browser test |
| --- | --- |
| S0 | Manual: setup by hand, admitting at the Ticket Booth |
| S1 | Manual: needs a Backend restart; the minute before the cutoff is the Backend's test (T002) |
| S2 | Manual: needs a Backend restart; the cutoff, the emptied columns, and the unchanged report are the Backend's tests (T002) |
| S3 | Manual: the Attendees page and the exports for a removed event are the Admin app's tests (T005) |
| S4 | Manual: the refusal is the Backend's test (T004) and the form's banner the Admin app's (T005) |
| S5 | Manual: My tickets and the printable ticket are the Customer app's tests (T006) |
| S6 | Manual: sign in, use, and sign out of each front end, by hand; the main journeys are `022`'s browser tests |
