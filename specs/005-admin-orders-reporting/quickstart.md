# Quickstart: Validating Admin Orders, Reporting, Attendees, and Safe Cancellation

The running-system gate for `005`. Run after the implementation with every service healthy.

## O1: Demo data

```bash
docker compose up --build -d
docker compose exec backend node backend/dist/scripts/demo-data.js
```

**Expect**: a summary of venues, events, orders, check-ins, and one cancelled event. Run it again.
**Expect**: "Demo data already present", and nothing changes.

## O2: Reports (US2)

Sign in to http://localhost:5173 as `admin1` / `test123` and open **Reports**. **Expect**: totals
for events, tickets sold of capacity, revenue, and checked in; one row per demo event; the
cancelled event marked cancelled with 0 sold and $0.00.

## O3: Event sales and attendees (US2-3, US3)

Open a demo event with tiers. **Expect**: a Sales card with sold per tier. Open **Attendees**.
**Expect**: each order with customer, tier, quantity, total, status, and ticket codes; some
tickets checked in.

## O4: Cancel (US4)

On a scheduled demo event, click **Cancel event**, then dismiss. **Expect**: nothing changes.
Click again and confirm. **Expect**: "Cancelled. N orders refunded, M tickets voided."; the event
shows Cancelled; Edit, Delete, and the tier form are gone; Attendees shows every order Refunded;
Reports shows it at 0 sold.

## O5: Venue time freed and records kept (US4-3, US4-4)

Schedule a new event at the cancelled event's venue and time. **Expect**: accepted. Try to delete
an event that has orders (from its page). **Expect**: refused, suggesting cancel instead.

## O6: Customer sees cancelled (US4-5)

Log out, sign in to http://localhost:5174 as `customer1`. **Expect**: the cancelled events are
marked "Cancelled" in the event list and on their pages.

## Automation

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`.

| Scenario | Browser test |
| --- | --- |
| O1 | Manual: demo data counts checked by hand; every `npm run e2e` loads the demo data |
| O2 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| O3 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| O4 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| O5 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| O6 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
