# Quickstart: Validating the Per-Customer Ticket Limit

The running-system gate for `016`. Run after the implementation with every service healthy:

```bash
docker compose up --build -d
npm test                      # full suite, including the concurrency tests below
```

Use a normal window for the Admin app (http://localhost:5173, `admin1` / `test123`) and a private
window for the Customer app (http://localhost:5174, `customer1` / `test123`).

## S1: Set a limit (US3)

As `admin1`, create an event starting next week with 100 tickets and **Tickets per customer** 8.
Time the later edit to 6 from opening the edit form to saving: under 30 seconds (SC-003).
**Expect**: the event page shows "Per customer: 8 tickets". Edit it and enter 0, then 101.
**Expect**: each is refused, the form names the allowed range (1 to 100), and the other values
stay. Enter 6 and save. **Expect**: "Per customer: 6 tickets".

## S2: Buy up to the limit (US1, US4)

As `customer1`, open the event. **Expect**: "Limit: 6 tickets per customer. You can get 6 more.",
and the largest quantity offered is 6. Get 4. Return to the event. **Expect**: "You can get 2
more." and the largest quantity offered is 2. Get 2. Return. **Expect**: "You have reached the
limit of 6 tickets for this event." and no confirm control.

## S3: Another customer is unaffected (US1)

In another private window, sign in as `customer2` and open the same event. **Expect**: "You can
get 6 more."

## S4: Lower and clear the limit (US3)

As `admin1`, lower the limit to 4 and save. **Expect**: saved; `customer1`'s **My tickets** still
lists all 6 tickets, and the event still says they have reached the limit. Clear the field and
save. **Expect**: "Per customer: No limit"; `customer1` can get tickets again, up to 10 per order.

## S5: The Backend refuses on its own (US1, FR-016)

Set the limit back to 6. As `customer1` (holding 6), send an order straight to the API with the
Customer app's token (see [quickstart V6 of `001`](../001-bare-bones-system/quickstart.md) for
copying a token):

```bash
curl -s -X POST http://localhost:3000/events/<eventId>/orders \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"quantity": 1}'
```

**Expect**: `409` with `code: TICKET_LIMIT_REACHED` and `details` `limit: 6, held: 6,
remaining: 0, requested: 1`.

## S6: Simultaneous orders (US2)

Covered by the Backend suite rather than by hand: 50 simultaneous one-ticket orders from one
customer against a limit of 8 leave exactly 8 valid tickets, and two simultaneous orders of 6
leave 6. **Expect**: `npm test` passes, with these tests listed.

## S7: Seated events (US4)

On a reserved-seating event with a limit of 3, as a customer holding 0, choose seats. **Expect**:
a fourth seat cannot be chosen, with a line saying the limit allows 3. As `admin1`, schedule a
reserved-seating event with no tickets sold at a venue with a layout, give it a limit of 20, then
open the venue's seating layout and save one with fewer than 20 seats. **Expect**: refused, naming
the event and telling the admin to lower its limit first; the layout is unchanged.

## S8: Existing events and the demo

Every event created before `016` shows "Per customer: No limit" and sells as before (FR-017). After
`docker compose exec backend node backend/dist/scripts/demo-data.js`, one demo event has a
limit of 4.
