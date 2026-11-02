# Quickstart: Doors Open

**Feature**: `025-doors-open` | **Spec**: [spec.md](./spec.md)

The running-system walk for `025`. Times below are for a venue in Eastern Time in November (EST);
read them in your venue's zone if you use another.

## S0: Set up

Stack up from the implementation branch (`docker compose up --build`), demo data loaded. Four browser
sessions that don't share sign-in: **Admin** (http://localhost:5173, `admin1` / `test123`),
**Customer** (http://localhost:5174, `customer1` / `test123`), **Gate** (http://localhost:5175,
`agent1` / `test123`), and a second **Gate** later for S5. Keep the Admin app's network panel open
for S1 and S3. "Now" below means the time you start the scenario.

## S1: New event: doors prefilled, changed, and checked (US1 scenarios 1, 2, 5; FR-002 to FR-005)

Admin → Events → Add event. Choose **Demo Riverside Hall**; type a start 3 days ahead at 7:00 PM and
an end at 10:00 PM. **Expected**: **Doors open**, before Starts, shows the same day at 6:00 PM, with
the same zone line as the other times. Change Doors open to 12:59 PM; press **Create event**.
**Expected**: "Doors must open no more than 6 hours before the start and not after it: between {date},
1:00 PM EST and 7:00 PM EST." next to the field, every value kept, no `POST /events`. Try 7:01 PM:
the same message. Try 1:00 PM: no message. Set 5:30 PM and create (name it "Doors Test", add a
ticket type). **Expected**: one `POST /events` with `"doorsOpenAt": "…T17:30:00-05:00"`; the event
page shows **Doors open** "5:30 PM EST" before Starts. Clear Doors open on a new form and press
Create event. **Expected**: "Enter when doors open." and nothing sent.

## S2: Edit: doors follow the start until changed (US1 scenarios 3, 4; FR-003, FR-008)

Edit "Doors Test" (doors 5:30 PM, start 7:00 PM). Change the start to 8:00 PM. **Expected**: Doors
open becomes 6:30 PM as you type; save; the page says 6:30 PM EST. Edit again; change Doors open to
7:00 PM, then the start to 9:00 PM. **Expected**: Doors open stays 7:00 PM. Save. **Expected**: saved
(doors 2 hours before the start). Set the end back to 10:00 PM if you moved it past it.

## S3: Other callers, and the zone rules for doors (US1 scenarios 6–8; FR-005, FR-007, FR-008)

With the Admin app's token (`001` quickstart V6 shows how to copy one), `POST /events` at Demo
Riverside Hall 4 days ahead, 7:00 PM to 10:00 PM EST, with no `doorsOpenAt`. **Expected**: `201`,
`doorsOpenAt` 1 hour before `startsAt`, `entryOpensAt` 2 hours before it. Again with
`"doorsOpenAt"` 6 hours 1 minute before the start: **Expected**: `400 DOORS_OPEN_OUT_OF_RANGE`, the
message naming 1:00 PM EST to 7:00 PM EST, `details.field` `doorsOpenAt`, nothing saved. With
`doorsOpenAt` 1 minute after the start: the same. With `doorsOpenAt` in `Z`: `400 UTC_OFFSET_MISMATCH`,
`details.field` `doorsOpenAt`. `PATCH` the first event with only a new `startsAt` and `endsAt` 2 hours
later: **Expected**: `doorsOpenAt` moved 2 hours too. In the Admin form, an event on Mar 14, 2027 at
3:30 AM with doors at 2:30 AM: **Expected**: `020`'s "2:30 AM on Mar 14, 2027 doesn't exist in Eastern
Time…" for Doors open.

## S4: Check-in opens 1 hour before doors (US2; FR-011 to FR-013, SC-003)

Admin: create "Gate Window" at **QueuePass Demo Arena** (not Demo Riverside Hall, where Demo Tonight runs
from 1 to 4 hours after the demo data loads and the 60-minute rule would refuse it) starting 2 hours
30 minutes from now, 3 hours long, with **Doors open at the start** (so check-in opens 1 hour 30
minutes from now), base price only. If the Arena has an event then, use a new venue.
Customer: get 1 ticket for it and read its code on My tickets. With the Gate session's token,
`POST /events/{id}/entry/lookup` with the code (the Booth won't offer the event yet, S5).
**Expected**: `200`, `"state": "NOT_OPEN"`, `entryOpensAt` 1 hour before `doorsOpenAt`. Gate: if an
event is chosen, press **Change event**, so the list is shown; **Expected**: Gate Window greyed. Admin:
edit "Gate Window" and set Doors open to 3 hours before the start (doors opened 30 minutes ago, so
check-in opened 1 hour 30 minutes ago); save. Gate: within 30 seconds, without a reload, Gate Window
becomes choosable (S5); choose it, type the code. **Expected**:
admittable; admit it. Admin: set Doors open back to the start. Customer: get a second ticket; Gate:
look it up in the Booth (still chosen). **Expected**: "Not admitted: Entry opens at {time} EST"
(US3 scenario 4), no Admit.

## S5: The Ticket Booth list (US3; FR-014 to FR-018, SC-005)

Gate: sign out and in again. **Expected**: "Demo Tonight" (open since the demo data loaded) is a
button; "Gate Window" (doors at the start, S4) is listed, greyed, "Not open yet · Opens {time} EST",
and is not a button (it can't be reached with Tab or clicked); "Doors Test" (3 days ahead) is listed
greyed with "Opens {date}, 6:00 PM EST" (its date, since that is not today; doors 7:00 PM, S2). Admin: move Gate Window's
doors to 3 hours before the start. Gate: wait on the same screen. **Expected**: within 30 seconds,
without a reload, Gate Window is a button. Second Gate session: choose Gate Window; Admin: move its doors back to the start; second Gate: reload.
**Expected**: the remembered choice is not restored; the list shows Gate Window greyed. With only
events not yet open (a fresh database without demo data, or after Demo Tonight ends): **Expected**: "No
event is open for entry yet." above the greyed list.

## S6: Customers and admins see when doors open (US4; FR-019 to FR-021, SC-006)

Customer: Events. **Expected**: Doors Test's card says **Doors open** "7:00 PM EST" (S2 left doors at
7:00 PM with a 9:00 PM start) before Starts; its page the same. Get a ticket; My tickets and **Print ticket** show Doors open next to the
start. Admin: the event page shows it; the events list does not (unchanged). An event whose doors are
on the day before its start (doors 11:30 PM for a 1:00 AM start): **Expected**: the full date and time.
Cancel an event with doors: its page still shows Doors open.

## S7: Existing events keep their window (FR-024, SC-004)

Before switching to the implementation branch, note one existing event's start (from `main`'s stack,
same volume). After `docker compose up --build` on the branch: **Expected**: its `doorsOpenAt` is its
start minus 1 hour and its `entryOpensAt` its start minus 2 hours (`GET /events/{id}`); cancelled and
past events too. The demo data's "Demo Tonight" is open for entry at once (S5).

## S8: A venue's zone change keeps doors' local time (FR-009)

Admin: a new venue with one event (no orders) 7:00 PM to 10:00 PM, doors 5:30 PM, Eastern Time.
Change the venue's zone to Central Time. **Expected**: the event is now 7:00 PM CST, doors 5:30 PM
CST. A venue in Arizona Time (no daylight saving) with one event on Mar 14, 2027 at 3:30 AM, doors at
2:30 AM: change the venue to Central Time. **Expected**: refused, nothing saved, with `020`'s message
naming the event's doors-open time ("Can't change the time zone: {name}'s doors-open time, Mar 14,
2027, 2:30 AM, doesn't exist in Central Time.").

## S9: Keyboard, screen reader, phone width, dark mode (FR-015, Constitution VII)

Admin event form: tab to Doors open and change it by keyboard; VoiceOver reads its label and the range
message. Booth at 360 px wide with VoiceOver: a greyed event reads its name, start, "Not open yet",
and "Opens …"; Tab moves only between open events and other controls; nothing scrolls sideways.
Customer card at 360 px. Repeat in dark mode.

## S10: Sign in, use, sign out (Constitution VI)

Sign in to each of the three apps, use it, and sign out.

## Automation

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`.

| Scenario | Browser test |
| --- | --- |
| S0 | Manual: set-up for the scenarios below; each browser test sets up its own data through the API |
| S1 | Automated: `025 S1/S2/S6: an admin sets when doors open, and customers see it`; rest Manual: the skipped and repeated local times, covered by the Admin app's tests |
| S2 | Automated: `025 S1/S2/S6: an admin sets when doors open, and customers see it` |
| S3 | Manual: an API behavior, covered by Backend tests; the Admin form's zone messages by the Admin app's tests |
| S4 | Automated: `025 S4/S5: the Ticket Booth works an event only from an hour before its doors open`; rest Manual: the boundary to the second and live codes, covered by Backend tests |
| S5 | Automated: `025 S4/S5: the Ticket Booth works an event only from an hour before its doors open`; rest Manual: an event becoming choosable when its window opens, covered by the Booth's tests with a fake clock |
| S6 | Automated: `025 S1/S2/S6: an admin sets when doors open, and customers see it`; rest Manual: My tickets and the printed ticket, by a person |
| S7 | Manual: needs a database from before the migration; covered by the Backend's migration test |
| S8 | Manual: a venue zone change, covered by Backend tests |
| S9 | Manual: keyboard, a screen reader, phone width, and dark mode, checked by a person |
| S10 | Manual: sign in, use, and sign out of each front end, by hand |
