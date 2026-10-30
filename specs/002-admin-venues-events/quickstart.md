# Quickstart: Validating Admin Venue and Event Management

The running-system gate for `002` (Constitution VI). Run it after the `002` implementation, with
the system up. It assumes `001`'s quickstart already passes. Its focus is **delete**, the new
capability, plus the view pages around it.

## Prerequisites

- `docker compose up --build -d`, with every service healthy (see `001` quickstart V1).
- A private browser window. Sign in to http://localhost:5173 as `admin1` / `test123`.

## D1: Delete an event (US2-8; FR-010, FR-025–FR-027)

1. **Venues → Add venue**: name `Quickstart Hall`, address `1 Test Way`, capacity `1000`.
   **Expect**: a success state; the venue is listed.
2. **Events → Add event**: `Show A` at `Quickstart Hall`, tomorrow 18:00–21:00, 100 tickets,
   price `10.00`. **Expect**: a success state.
3. Open **Show A** from the event list. **Expect**: its detail page shows name, venue link,
   start and end with dates, tickets, price, and **Edit** and **Delete** buttons.
4. Click **Delete**, then **Cancel** in the confirmation. **Expect**: nothing happens; the event
   is still there. In developer tools, Network tab, no `DELETE` request was sent.
5. Click **Delete**, then **OK**. **Expect**: back on the event list with `Deleted "Show A".`,
   and Show A is gone.
6. **Add event** again at `Quickstart Hall`, tomorrow 18:00–21:00. **Expect**: accepted, because
   the window was freed.

## D2: A venue with events cannot be deleted (US1-7; FR-004, FR-029)

1. Open **Quickstart Hall** from the venue list. **Expect**: its details, and the event from
   D1.6 listed below them.
2. Click **Delete**, then **OK**. **Expect**: you stay on the page, and a banner says
   `Cannot delete "Quickstart Hall": 1 event is still scheduled there. Delete or move them
   first.` The venue and its event are unchanged.
3. Open the event from the venue page, delete it (confirm), then return to **Quickstart Hall**.
   **Expect**: "Nothing is scheduled here."
4. Click **Delete**, then **OK**. **Expect**: back on the venue list with
   `Deleted "Quickstart Hall".`, and it is gone.

## D3: Deleted by someone else (spec edge case)

1. Create a venue `Race Hall` and open its detail page in **two tabs**.
2. Delete it in tab 1 (confirm). Then click **Delete** in tab 2 and confirm.
   **Expect**: tab 2 goes to the venue list with `"Race Hall" no longer exists. The list has
   been refreshed.`, and the list does not show it.

## D4: Only admins can delete, at the API (US4; FR-020)

Take a customer's token from the Customer app, as in `001` quickstart V6, and a venue ID from the
Admin app's venue page URL:

```bash
curl -si -X DELETE -H "Authorization: Bearer $CUSTOMER_TOKEN" localhost:3000/locations/$VENUE_ID | head -1   # 403
curl -si -X DELETE localhost:3000/locations/$VENUE_ID | head -1                                             # 401
```

**Expect**: both refused, and the venue still listed in the Admin app.

## D5: The refusal carries the count (research R7; contract 1.1.0)

With an admin token and a venue that has 3 events:

```bash
curl -s -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" localhost:3000/locations/$VENUE_ID
```

**Expect** `409` with body
`{"error":{"code":"VENUE_HAS_EVENTS","message":"Cannot delete \"…\": 3 events are still scheduled there. Delete or move them first.","details":{"eventCount":3}}}`.

## D6: Everything else still works (FR-032–FR-037)

- Create, edit, the conflict banner (an overlapping event at the same venue), and kept form values
  behave as before.
- Log out from any page. **Expect**: the `001` logout behavior.

## D7: The full suite passes

```bash
npm test
```

**Expect**: every workspace passes, including the new Backend delete tests and the Admin app's
detail and delete tests.

---

## Validation record

**2026-09-28: all of D1–D7 passed.**

| Step | Result |
|---|---|
| D1 | In real Chrome as `admin1`: venue and event created; event page shows venue link, dated times, Edit, and Delete; **Cancel** sent no `DELETE`; **OK** deleted it and the list said `Deleted "Show A".`; the same 18:00–21:00 window was then accepted again |
| D2 | Venue page listed its event; Delete was refused on the page with `Cannot delete "Quickstart Hall …": 1 event is still scheduled there. Delete or move them first.`; after deleting the event, the page said "Nothing is scheduled here." and the venue deleted |
| D3 | Two tabs on one venue: tab 1 deleted it; tab 2's Delete landed on a refreshed list with `"Race Hall …" no longer exists. The list has been refreshed.` |
| D4 | A customer's browser-issued token got `403` on `DELETE /locations/{id}`; no token got `401`; the venue remained |
| D5 | An admin deleting a venue with 3 events got `409` with `details.eventCount: 3` and the plural message |
| D6 | Logout from a detail page reached the Keycloak login page; the notice did not repeat after a reload |
| D7 | `npm test`: boundary and drift checks, then 195 tests (shared 22, backend 120, admin 44, customer 3, booth 3, seed 3) |

**Bug found and fixed during D7**: two byte-identical simultaneous creates could make
PostgreSQL abort one with a deadlock (`40P01`) inside the exclusion index, which reached the
client as `500`. The existing concurrency test failed in about 2 of 5 runs. Event writes now
retry up to 3 times on a deadlock, so the retry's pre-check returns a normal
`409 SCHEDULING_CONFLICT` naming the winner; the error filter maps any remaining deadlock to
the same race-path `409`. The concurrency test then passed 15 of 15 runs. No double booking was
ever accepted: the constraint held throughout. Only the error code was wrong.

## Automation

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`.

| Scenario | Browser test |
| --- | --- |
| D1 | Automated: `002 D1: an admin deletes an event, and its time at the venue is free again`; rest Manual: the detail page's fields and its Edit button (step 3), by eye; the test sets up the venue and event through the API |
| D2 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| D3 | Manual: two admins at once; outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| D4 | Manual: role checks on the API, covered by Backend tests |
| D5 | Manual: the API's refusal body, covered by Backend tests |
| D6 | Manual: a regression walk, by hand |
| D7 | Manual: the full suite, run by the `test` check on every pull request |
