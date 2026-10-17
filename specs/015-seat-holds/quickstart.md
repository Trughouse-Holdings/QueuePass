# Quickstart: Validating Seat Holds with Live Updates

The running-system gate for `015`. Run after the implementation with every service healthy:

```bash
docker compose up --build -d
npm test                      # full suite, including the 10-reservation concurrency test
```

You need three browser sessions that don't share sign-in:

- **Admin**: the Admin app (http://localhost:5173), `admin1` / `test123`.
- **Customer 1**: the Customer app (http://localhost:5174), `customer1` / `test123`, in one browser.
- **Customer 2**: the Customer app, `customer2` / `test123`, in a second browser or profile.

## S0: Set up a seated event

As `admin1`, give a venue a layout with sections **A** (3 rows of 10 seats) and **B** (2 rows of
10). Create an event there starting next week, with ticket types "General" at $20 and "VIP" at
$50. On its page, turn reserved seating on and map both sections to General. Open the event's seat
map and leave it open.

## S1: Reserve, then confirm (US1)

As **Customer 1**, open the event, pick A-1-5 and A-1-6, and press **Reserve seats**.
**Expect**: a countdown from 5:00, **Confirm purchase** and **Release seats**, and both seats shown
as yours. Time from opening the event to confirming: under 90 seconds (SC-005). Press **Confirm
purchase**. **Expect**: the confirmation lists both seats, and My tickets shows them.

## S2: Live gray-out (US3, US4)

Open the event as both **Customer 1** and **Customer 2**, side by side, with the Admin seat map
also open. As Customer 1, reserve A-2-3 and A-2-4. **Expect**, within 2 seconds and without a
refresh (SC-002):

- **Customer 2** sees both seats as **Reserved**: a dashed outline with an R mark, distinct from
  sold (striped), announced as "reserved" by a screen reader, and not choosable.
- **Admin** sees them marked `◩`, and section A's counts show 2 reserved.

As Customer 2, try to pick A-2-3. **Expect**: it can't be chosen. As Customer 1, press **Release
seats**. **Expect**: both seats turn open for Customer 2 and the Admin within 2 seconds.

## S3: A pick taken by someone else (FR-011)

As **Customer 2**, pick A-3-1 without reserving it. As **Customer 1**, reserve A-3-1. **Expect**:
Customer 2's pick disappears with a message naming Row 3, Seat 1, and their other picks stay.

## S4: Same seat at the same moment (US2)

Covered by the automated test of 10 simultaneous reservations for one seat (exactly 1 succeeds,
SC-001). By hand: as both customers, pick A-3-5 and press **Reserve seats** together. **Expect**:
exactly one gets it, and the other sees "Row 3, Seat 5 is reserved by another customer", with
nothing reserved.

## S5: Run out (FR-004, FR-005, SC-003)

As **Customer 1**, reserve A-3-7 and wait 5 minutes, with Customer 2 watching. **Expect**: at 0:00,
Customer 1 sees that the reservation ran out, Confirm purchase is gone, and the pick is kept;
Customer 2 sees A-3-7 open within 2 seconds after the 5 minutes end. As Customer 1, press
**Reserve seats** again at once. **Expect**: refused, naming the seat and when it can be reserved
again (2 minutes later). As **Customer 2**, reserve A-3-7. **Expect**: it succeeds.

## S6: Deselect and add (FR-003, FR-007)

As **Customer 1**, reserve A-1-1 and A-1-2. At about 4:00 left, pick A-1-3 and press **Reserve
seats**. **Expect**: three seats are yours, and the countdown didn't restart. Deselect A-1-1.
**Expect**: it turns open for Customer 2 at once, and the countdown is unchanged.

## S7: Logout releases (FR-008, SC-004)

As **Customer 1**, reserve A-1-8, then log out. **Expect**: Customer 2 sees A-1-8 open within 2
seconds.

## S8: Two tabs (edge case)

As **Customer 1**, open the event in two tabs and reserve in the first. **Expect**: the second tab
shows the same seats as yours within 2 seconds. Release in the second. **Expect**: the first tab
shows no reservation.

## S9: Admin changes end reservations (FR-016)

As **Customer 1**, reserve B-1-1. As `admin1`, map section B to VIP (allowed: B has no sold
seats). **Expect**: Customer 1 sees the seat leave their reservation without a refresh, and the
reservation ends. Customer 1 can reserve B-1-1 again at once, now as VIP: an admin change starts
no 2-minute wait.

## S10: Reconnect (FR-010)

As **Customer 2**, open the event, then stop the Backend (`docker compose stop backend`) for 10
seconds and start it again. Meanwhile nothing is reserved. **Expect**: the seat map catches up on
its own when the Backend is back, without a page reload.

## S11: Smoke test (Constitution VI)

Sign in to, use, and sign out of the Admin, Customer, and Ticket Booth apps. **Expect**: general-
admission events still sell exactly as before (SC-006), and the Booth app is unchanged.
