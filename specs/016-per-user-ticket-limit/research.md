# Research: Per-Customer Ticket Limit

Decisions for [plan.md](./plan.md). Each has a decision, its rationale, and the alternatives
considered.

## R1. Store the limit as a nullable column on the event

**Decision**: `Event.maxTicketsPerCustomer Int?`. `NULL` means no limit. A database CHECK,
`event_max_tickets_per_customer_range`, requires `NULL` or a value from 1 to the event's
`totalTicketCapacity`. The migration adds the column with no default, so every existing event has
no limit (FR-017).

**Rationale**: The limit is one number per event (FR-001), read every time an order is placed. A
column next to `totalTicketCapacity` is read by the same event row lock the order path already
takes (R2). The CHECK makes FR-001's range a database fact, as `event_ticket_capacity_positive`
does for capacity.

**Alternatives considered**: A separate `EventLimit` table (an extra join on every order, for one
number). A `0` meaning "no limit" (a magic value that a later reader can mistake for "sell none").

## R2. Enforce the limit under the event row lock the order path already takes

**Decision**: In `OrdersService.createLocked`, after `lockEvent` and the existing checks, count the
customer's valid tickets for the event (`ticket.count` where `eventId`, `status = 'VALID'`, and
`order.customerSub` is the caller) and refuse when `held + quantity > limit`. `LockedEvent` and its
`SELECT ... FOR UPDATE` gain the new column.

**Rationale**: Every order for an event already takes `SELECT ... FOR UPDATE` on that event's row
before it counts tickets, which is how `SOLD_OUT` holds under 20 simultaneous orders today. Two
orders from the same customer for the same event therefore run one after the other, and the second
counts the first's committed tickets. Constitution IV names a row lock as a database guarantee, so
FR-004 needs no new mechanism. The count uses existing indexes (`Ticket(eventId, status)`, and
`Order.customerSub`).

**Alternatives considered**:

- A per-customer counter row with a CHECK (`held <= limit`): a true constraint, but a second source
  of truth that every refund and cancellation must also update, and changing the limit would have
  to re-check every counter.
- A trigger that counts on insert: hides the rule from the code and the error path, and still needs
  a lock to be race-free.
- SERIALIZABLE isolation: the rest of the order path is built on the row lock; mixing models adds
  retry handling for no gain.

## R3. Where the check runs, and which refusal wins

**Decision**: The check runs after the `requestId` replay check, the cancelled and sales-closed
checks, tier resolution, and seat resolution, and together with the tickets-left check:

```text
stockLeft    = min(event tickets left, tier tickets left)      # existing
customerLeft = max(0, limit - held)   (no limit: unbounded)    # new
if quantity > min(stockLeft, customerLeft):
    if customerLeft < stockLeft: TICKET_LIMIT_REACHED
    else:                        SOLD_OUT                      # existing message and details
```

`customerLeft` is clamped at 0, because `held` can be above the limit after an admin lowers it
(FR-009); `details.remaining` is that clamped value.

**Rationale**: A replayed `requestId` must still return its order and count once (FR-007), so the
check runs after the replay. A cancelled or closed event keeps its existing message. When both
limits bind, the refusal names the smaller number, which is the only one the customer can act on
(spec edge case "Two refusal reasons at once"). On a tie, `SOLD_OUT` is kept, so every existing
`SOLD_OUT` test still passes.

**Alternatives considered**: Checking the limit first (a customer at 5 of 8 asking for 5 on an
event with 1 ticket left would be told "you can get 3 more", then refused again).

## R4. A new error code, `TICKET_LIMIT_REACHED`

**Decision**: `409 TICKET_LIMIT_REACHED` in the standard envelope, with `details`
`{ limit, held, remaining, requested }` and a message such as "Season Opener allows 8 tickets per
customer. You already hold 5, so you can get 3 more; 5 were requested." When `remaining` is 0:
"Season Opener allows 8 tickets per customer, and you already hold 8." The code is added to
`ERROR_CODES` in `packages/shared/src/errors.ts` and to the contract's `ErrorEnvelope` enum.

**Rationale**: FR-005 needs its own stable code and the three numbers. The exception filter passes
an envelope through only if its code is in `ERROR_CODES`; any other `409` is rewritten as
`VENUE_HAS_EVENTS`, so the shared list must change in the same implementation step as the
Backend.

**Alternatives considered**: Reusing `SOLD_OUT` with a reason field (the Customer app and every
reader would have to branch on a detail to know which rule fired).

## R5. Customers learn their standing from the availability read

**Decision**: `GET /events/{id}/availability` gains `customerLimit`: `{ limit, held, remaining }`
for a signed-in customer on an event with a limit, and `null` otherwise. The controller passes the
caller's principal to `AvailabilityService`.

**Rationale**: The Get tickets form already loads availability, and reloads it after every refusal.
The Backend counts held tickets exactly as the order path does, so the form and the rule cannot
disagree about what counts (void tickets, all ticket types). The value describes only the caller,
so no customer learns anything about another (Constitution V).

**Alternatives considered**: Counting on the client from `GET /me/orders` (duplicates the rule in the
front end, and must remember to skip refunded orders). A new `GET /events/{id}/my-limit` (a second
request and a new route for three numbers).

## R6. The range rule on event writes

**Decision**:

- `POST /events` and `PATCH /events/{id}` accept `maxTicketsPerCustomer`: an integer of at least 1,
  or `null`, validated by the DTOs. The service compares the limit with the event's capacity as
  it will be stored: on create, the capacity sent or else the venue's `seatingCapacity`; on
  update, the merged values. It refuses `maxTicketsPerCustomer > totalTicketCapacity` with
  `400 VALIDATION_FAILED`, naming the field and the capacity. This covers both raising the limit
  and lowering the capacity (spec edge case "Capacity lowered below the limit"). The existing
  capacity checks (venue, tiers, sales: `409 CAPACITY_EXCEEDED`) run first, unchanged, so an edit
  that breaks one of them gets the same answer as today.
- `PUT /locations/{id}/layout` (`LayoutService.replace`) sets the capacity of every scheduled
  seated event at the venue to the new layout total. It refuses only when such an event has
  valid tickets (`LAYOUT_IN_USE`), so an unsold seated event's capacity can drop. The service
  therefore also refuses, before any write, when the new total is below the
  `maxTicketsPerCustomer` of a scheduled seated event at the venue: `409 CAPACITY_EXCEEDED`,
  naming the event, with `details` `{ totalSeats, conflictingEvent: { id, name } }`, alongside
  the existing check for general-admission events that sell more than the new total. The venue
  lock it already takes on every scheduled event at the venue serializes it with a limit edit.
- `PUT /events/{id}/seating` needs no check. Turning reserved seating on sets the capacity to the
  layout total, which equals the venue's `seatingCapacity` (a venue with a layout cannot set it
  otherwise), and an event's capacity, and so its limit, never exceeds that. The capacity can
  only rise.
- The database CHECK from R1 backs every path.
- Lowering or clearing the limit touches no order or ticket (FR-009). A cancelled event's update is
  already refused with `EVENT_CANCELLED` before any field is read (FR-010).

**Rationale**: The range depends on another field of the same row, so the service checks it after
merging the update, where it can say which number to change. The DTO alone cannot see the stored
capacity.

**Alternatives considered**: Clamping the limit down to the new capacity silently (an admin's value
would change without them knowing).

## R7. The admin form: one number field, blank for no limit

**Decision**: `EventForm.tsx` gains a "Tickets per customer" number field (`min=1`, step 1) under
"Total tickets", with the hint "Leave blank for no limit." Create sends the number when one is
entered. Edit always sends it, `null` when blank, so clearing works. `EventDetail.tsx` adds a
"Per customer" row to its details card: "8 tickets" or "No limit".

A client-side preview check mirrors R6 against the capacity the event will have, which the form
often does not have typed:

1. reserved seating chosen, or the event already seated: the layout total shown in the form
   (`layout.totalSeats`, or the stored capacity for a seated event being edited);
2. otherwise, the typed "Total tickets" value;
3. otherwise (blank), the selected venue's `seatingCapacity`.

A value of 0 or less, a fraction, or a value above that capacity is refused before sending, with
"Tickets per customer must be a whole number from 1 to N, or blank for no limit." The other values
stay as entered. The Backend remains the check (FR-016).

**Rationale**: The form already sends the full `EventInput` on edit and shows `details.fields` from
a `400`, so a Backend refusal appears with no new error handling. The field reuses the existing
`.field` markup (Constitution VII).

**Alternatives considered**: A checkbox plus a number (two controls for one value).

## R8. The Get tickets form uses the smallest of three caps

**Decision**: In `GetTickets.tsx`, `maxQuantity` becomes the smallest of the per-order cap (10),
the tickets left, and `customerLimit.remaining` when present. The form shows "Limit: 8 tickets per
customer. You can get 3 more." When `remaining` is 0, the form is replaced with "You have reached
the limit of 8 tickets for this event." and no confirm control. The existing closed messages
(cancelled, sales closed, sold out, no seats on sale) come first, because they apply to every
customer; the limit message shows only when the event is otherwise on sale. The seat picker's
`full` uses the same `maxQuantity`, with a line saying why no more seats can be chosen. A `TICKET_LIMIT_REACHED`
refusal is shown through the existing alert, which already shows the Backend's message and
reloads availability.

**Rationale**: FR-012 to FR-015 with the smallest change to a form that already computes
`maxQuantity` from two caps.

**Alternatives considered**: Hiding Get tickets entirely at the limit (the customer would not know
why).

## R9. Contract 1.6.0 merges ahead of the implementation with the suite green

**Decision**: Contract 1.6.0 and regenerated `api-schema.ts` land in the spec and plan PR. The two
new response fields (`Event.maxTicketsPerCustomer`, `Availability.customerLimit`) are documented
as always sent from 016 on, but are not listed in `required`. Clients treat a missing value as
`null`.

**Rationale**: Under constitution 3.0.0, the spec and plan PR merges before implementation begins,
and the green gate requires the full suite to pass on every merge. The Backend tests validate every
response against the contract; required fields the Backend does not send yet would fail them, and
`main` would stay red until the implementation PR. Optional fields keep `main` green, and nothing
is lost, since `null` and missing mean the same thing for both fields.

**Alternatives considered**: Required fields with the plan and implementation PRs merged back to
back (what `007` did under the old three-PR flow; it breaks the green gate in between).

## R10. Demo data

**Decision**: `backend/src/scripts/demo-data.ts` gives one demo event a limit of 4, so the rule can
be shown live without setup.

**Rationale**: `main` must be demo-ready (Constitution III), and the Thursday demo needs an event
where the limit is visible.
