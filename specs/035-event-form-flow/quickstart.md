# Quickstart: Event Form Flow

**Feature**: `035-event-form-flow` | **Spec**: [spec.md](./spec.md)

Walk these on a stack of your own, not the team stack (README, "When the images can't be built",
path B on a machine that cannot build the app images). Each scenario names the requirements it
proves. Open the browser's network panel for S1, S4, and S5.

## S0. A stack of its own, with a seated venue and a plain venue

1. Start QueuePass as the README describes, on a project name of your own.
2. Sign in to the Admin app. Create a seated venue "035 Hall" with three sections of 10 seats
   (Front, Middle, Back) and a time zone, and a plain venue "035 Room" with capacity 100 and no
   layout.

## S1. A seated event that fills the layout (US2, US3; FR-008, SC-001)

1. Schedule event. **Expected**: Venue and times is shown; Tickets and seating is not, until a
   venue is chosen.
2. Name "035 Full House", venue 035 Hall, doors / start / end in range. **Expected**: Tickets and
   seating appears, reserved seating chosen, a live total, each section offered a ticket type.
3. Two ticket types, Floor and Balcony. Assign Front and Middle to Floor, Back to Balcony.
   **Expected**: the total updates as each section is set, and once all three are assigned it
   says that all 30 seats are assigned (or "30 of 30"), with no leftover sentence, and each type's
   seat count matches its sections (20 and 10).
4. Schedule event. **Expected**: the event is created, one `POST /events` (plus pictures if any),
   no error after pressing the button, and the event page shows both types.

## S2. Immediate errors, no send (US1; FR-003 to FR-005, SC-002, SC-003)

1. Schedule event, choose 035 Room, leave the name empty, leave the name field. **Expected**:
   "Enter the event's name." next to Event name; no request is sent when you press the button;
   focus is on Event name.
2. Type a name: the message clears as you type.
3. Add two ticket types both named "Floor" / "floor", with prices and quantities, and press the
   button. **Expected**: the repeated-name message next to ticket type 2, nothing sent.

## S3. General admission total (US2; FR-009)

1. Schedule event at 035 Room, total tickets 100, types whose quantities add up to 80. **Expected**:
   the total says 80 of 100 and names 20 seats not assigned to a ticket type.
2. Raise the quantities over 100. **Expected**: the over-capacity problem is next to the ticket
   types, and the button does not send.

## S4. A refused edit saves nothing (US4, US6; FR-016 to FR-019, SC-004, SC-005)

1. Open the event from S1 (or schedule a general-admission event at 035 Room with one type,
   "Floor"). Edit event, change the name, add a second type also named "floor", press Save.
   **Expected**: the repeated-name message next to the new type, that field focused, no banner at
   the top, the form still holds the new name and the new type; reload or check via the API, the
   stored name and types are unchanged.
2. Rename the second type to "Balcony" and save. **Expected**: the event has the new name and both
   types.

## S5. Scheduling conflict lands with the times (US6; FR-011, SC-006)

1. Schedule a second event at 035 Hall in the same slot as S1. **Expected**: the conflict
   treatment appears with the times, focus is on Starts, the typed values remain, and there is no
   error banner at the top of the page.

## S6. Locked fields on an event with sold tickets (US5; FR-013)

1. As a customer, buy a ticket (or a reserved seat in Front) for the event.
2. In the Admin app, Edit event. **Expected**: reserved seating is locked, with the reason; the
   section that has sold seats is locked, with the reason; Remove is not offered on the type that
   has sold tickets, with the reason. An event with no sales (S3's event, if unsold) has none of
   these locks.

## S7. Through the API (US4; FR-017, FR-018)

1. `PATCH /events/{id}` with only a new name: the name changes, types unchanged.
2. `PATCH` with `tiers` that repeat a name, and a changed name: `409`, name and types unchanged.
3. `POST /events` with `tiers[0].id` set: `400`, no event.

## S8. Sign in, use, sign out (Constitution VI)

Sign in, use, and sign out of each front end. In the Customer app, S1's event is offered with its
ticket types.

## Automation

| Scenario | Browser test |
| --- | --- |
| S0 | Manual: setup by hand; the browser tests make their own venues through the API |
| S1 | Automated: `035 S1: a seated event that fills the venue's layout is scheduled without a submit-time error` |
| S2 | Manual: covered by the Admin app's tests (preview, focus, no send) |
| S3 | Manual: covered by the Admin app's tests (the live total and over-capacity) |
| S4 | Manual: covered by the Backend's tests (unchanged rows) and the Admin app's (placement, one request); a second browser test is not required |
| S5 | Manual: the conflict treatment is `002`'s; placement next to the times is in the Admin app's tests |
| S6 | Manual: sold-ticket locks need a purchase; the Admin app's tests stub the counts |
| S7 | Manual: API calls by hand; covered by the Backend's integration tests |
| S8 | Manual: sign in, use, and sign out of each front end, by hand; the main journeys are `022`'s browser tests |
