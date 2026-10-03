# Quickstart: Validating Customer Ticket Purchase

The running-system gate for `006`. Run after the implementation with every service healthy:

```bash
docker compose up --build -d
docker compose exec backend node backend/dist/scripts/demo-data.js
```

Use a private window for the Customer app, so an Admin sign-in in the same browser does not carry
over.

## P1: Get tickets in a tier (US1)

Sign in to http://localhost:5174 as `customer1` / `test123`. Open a scheduled demo event with
tiers. **Expect**: a Get tickets section listing each tier with its price and tickets left. Choose
a tier and 2 tickets. **Expect**: the total is twice the tier price. Confirm. **Expect**: a
confirmation with the event, tier, quantity, unit price, total, and 2 distinct ticket codes.

## P2: It reached the Admin app (US1)

In a normal window, sign in to http://localhost:5173 as `admin1` and open that event's
**Attendees**. **Expect**: `customer1`'s order with the same codes. **Reports** counts the 2
tickets.

## P3: Sold out, cancelled, and sales closed (US2)

As `customer1`, open the demo event marked Cancelled. **Expect**: "This event has been cancelled"
and no Get tickets form. As `admin1`, create an event that started yesterday, then open it as
`customer1`. **Expect**: "Sales closed". As `admin1`, create an event with capacity 1; as
`customer1`, get its 1 ticket, then reload. **Expect**: "Sold out".

## P4: My tickets (US3)

As `customer1`, open **My tickets**. **Expect**: the orders from P1 and P3, newest first, with
their codes. As `admin1`, cancel the P1 event. As `customer1`, reload My tickets. **Expect**: that
order Refunded, its event Cancelled, its tickets Void.

## P5: Only your own orders (US3-5)

Log out and sign in as `customer2`. **Expect**: My tickets says there are no tickets yet, and
none of `customer1`'s orders appear.
