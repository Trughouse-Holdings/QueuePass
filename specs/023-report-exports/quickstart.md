# Quickstart: Report Exports

**Feature**: `023-report-exports` | **Spec**: [spec.md](./spec.md)

## E0. Set up

Stack up from the implementation branch (`docker compose up --build`), demo data loaded. As
`admin1`, make an event "Export Test, Café" with two tiers; as `customer1` buy 2 in one tier with the
name `=SUM(1,1)`, and as `customer3` 1 ticket with the name `Zoë O’Brien`; as `customer2` buy 1 seated ticket (a seated event) or 1 in the other tier; refund
nothing; at the booth (`agent1`), admit one ticket. Cancel one other event.

## E1. Attendee list, three formats (US1; FR-001, FR-004, FR-007–FR-010, SC-001, SC-006)

Attendees page → Download → CSV, then Excel, then PDF. **Expected**: three files named
`attendees-export-test-cafe-<date>-<time>`; each has one row per ticket, matching the page; the
checked-in ticket has its time; `=SUM(1,1)` shows as typed in Excel and as `'=SUM(1,1)` in the CSV opened in Excel or Numbers,
never 2; `Zoë O’Brien` is exact in all three; prices sum to the page's totals; dates sort as dates; the Excel About sheet and the PDF
heading say when it was made and that times are in the venue's zone; "Café" is spelled right in all
three.

## E2. Sales report, three formats (US2; FR-002, FR-005, FR-009, SC-005)

Reports → Download → each format. **Expected**: one row per event in the page's order, the cancelled
one marked Cancelled, the Time zone column filled, a Total row equal to the page's totals; the PDF
printed (or Print Preview) on letter paper: header on every page, "Page n of m", nothing cut off.

## E3. When it was made (US3; FR-003)

Keep the Attendees page open; in another window buy one more ticket; download CSV without reloading.
**Expected**: the file matches the page (without the new ticket) and its `Exported at` is the page's
load time. Reload and download again: the new ticket is there, with a later time.

## E4. Admins only (US4; FR-013)

Sign in to the Customer app as `customer1`: no export anywhere. Open the Admin app as `customer1`:
the wrong-role page.

## E5. Keyboard, phone width, dark mode (FR-015)

Tab to Download, open it with Enter, choose a format with Enter; at 360 px the control fits; in dark
mode it is readable. A screen reader announces "Preparing the PDF…" while it works.

## E6. Size (SC-003, SC-004)

Run the size test (tasks T021). **Expected**: 5,000 tickets in each format within 10 s; 25,000
without error.

## Automation

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`.

| Scenario | Browser test |
| --- | --- |
| E0 | Manual: not built on this branch yet: `023`'s implementation PR adds its browser test and marks (Constitution VI) |
| E1 | Manual: not built on this branch yet: `023`'s implementation PR adds its browser test and marks (Constitution VI) |
| E2 | Manual: not built on this branch yet: `023`'s implementation PR adds its browser test and marks (Constitution VI) |
| E3 | Manual: not built on this branch yet: `023`'s implementation PR adds its browser test and marks (Constitution VI) |
| E4 | Manual: not built on this branch yet: `023`'s implementation PR adds its browser test and marks (Constitution VI) |
| E5 | Manual: not built on this branch yet: `023`'s implementation PR adds its browser test and marks (Constitution VI) |
| E6 | Manual: not built on this branch yet: `023`'s implementation PR adds its browser test and marks (Constitution VI) |
