# Quickstart: Validating Seat Selection

The running-system gate for `007`. Run after the implementation with every service healthy:

```bash
docker compose up --build -d
```

Use a normal window for the Admin app (http://localhost:5173, `admin1` / `test123`) and a private
window for the Customer app (http://localhost:5174, `customer1` / `test123`).

## S1: Lay out a venue (US1)

As `admin1`, create a venue "Seat Hall" with seating capacity 500. On its page, **Edit layout**:
section `A`, 3 rows of 10; section `B`, 2 rows of 20. Save. **Expect**: the layout card lists
both sections and 70 seats. Try a section of 30 rows of 20. **Expect**: refused, over capacity.

## S2: Turn on reserved seating and map tiers (US4)

Create an event at Seat Hall starting next week, with tiers `VIP` ($120, 30) and `General` ($40,
40). On the event page, check **Reserved seating**, map `A` → VIP and `B` → General, and save.
**Expect**: the seat map shows both sections with 0 sold.

## S3: Choose seats (US2)

As `customer1`, open the event. Choose **VIP**, section **A**, then Row 1 Seats 5 and 6.
**Expect**: total $240.00. Confirm. **Expect**: a confirmation listing two codes with "Section A,
Row 1, Seat 5" and "Section A, Row 1, Seat 6". **My tickets** shows the same seats.

## S4: Taken seats and the admin view (US3, US4)

Reload the event as `customer1`. **Expect**: A-1-5 and A-1-6 are taken and cannot be chosen. As
`admin1`, open the event's seat map. **Expect**: those two seats sold, section A 2 sold and 28
open. **Attendees** shows `customer1`'s tickets with their seats. Try to remap A to General.
**Expect**: refused, it has sales.

## S5: Locked layout, and cancellation frees seats (US1-4, US3-3)

As `admin1`, try to edit Seat Hall's layout. **Expect**: refused, naming the event. Cancel the
event. **Expect**: the layout can now be edited, and the event's seat map shows 0 sold.

## S6: General admission unchanged (SC-005)

As `customer1`, open a demo event. **Expect**: the `006` Get tickets form, with no seat map.
