# Quickstart: Validating Names on Tickets and Gate Check-In

The running-system gate for `017`. Run after the implementation with every service healthy and the
demo data loaded:

```bash
docker compose up --build -d
npm test                      # full suite, including the 20-admit concurrency test
```

You need four browser sessions that don't share sign-in:

- **Customer**: the Customer app (http://localhost:5174), `customer1` / `test123`.
- **Gate 1**: the Ticket Booth app (http://localhost:5175), `agent1` / `test123`, on the laptop,
  so the webcam works.
- **Gate 2**: the Ticket Booth app, `agent2` / `test123`, in a second browser or profile.
- **Admin**: the Admin app (http://localhost:5173), `admin1` / `test123`.

Contract and rules: [contracts/README.md](./contracts/README.md), [data-model.md](./data-model.md).

## S0: The demo event is open for entry

As **Admin**, open the events list. **Expect**: "Demo Tonight" at Demo Riverside Hall, starting
about 1 hour after the demo data loaded, with orders (research R13). If the demo data was loaded
more than 4 hours ago, its window has passed: create an event that starts within 2 hours and buy
tickets for it in S1 instead.

## S1: A name goes on every ticket (US4)

As **Customer**, open Demo Tonight and choose 3 tickets. **Expect**: a **Name on tickets** field
saying the name must match the photo ID shown at the gate, and **Confirm** disabled while it is
empty. Type only spaces: still disabled, with a message. Type `Jordan Lee` and confirm.
**Expect**: on **My tickets**, the order says "Name on tickets: Jordan Lee", and each ticket has
**Print ticket**. As **Admin**, open the event's attendee list. **Expect**: Jordan Lee in the
**Name on tickets** column; demo orders from before this feature, if any, say "No name on ticket".

## S2: Print a ticket (US5)

As **Customer**, choose **Print ticket** on one of the three. **Expect**: one page with a QR code,
the 12-character code in text, Jordan Lee, the event, venue, start time, and seat if any. The
browser's print preview shows only the ticket, legible in black and white. Keep this page open on
screen (or print it) for S4.

## S3: Type a code and admit once (US1, US3)

As **Gate 1**, choose Demo Tonight. Type the code of the first of Jordan Lee's tickets in lower
case with a dash in the middle, and press **Look up**. **Expect**: the event, ticket type, "Jordan
Lee", "Check a government-issued photo ID that shows: Jordan Lee", **Admit**, **Admit all 3**, and
**Refuse**. A screen reader announces the result.

Press **Refuse**. **Expect**: "Not admitted", and nothing changes anywhere. Look the same code up
again and press **Admit**. **Expect**: "✓ Admitted". Look it up a third time. **Expect**: "Already
used" with the time, and no **Admit**. Time from typing the code to seeing the ticket: under 15
seconds (SC-003).

## S4: Scan with the webcam (US5)

As **Gate 1**, press **Scan** and allow the camera. Hold the print view from S2 (a second ticket of
the order) up to the webcam. **Expect**: the ticket appears with no further tap, with the same
ID-check prompt as typing, and **Admit all 2**. Now show the webcam a QR code that isn't a ticket
(any website's). **Expect**: "Not a QueuePass ticket", and scanning continues.

Deny the camera in the browser's site settings and press **Scan** again. **Expect**: a plain
message that the camera is unavailable; typing still works (US5 scenario 5).

## S5: Admit a group, racing another gate (US2, FR-015a)

Pick a demo order of 4 unused tickets for Demo Tonight from the Admin attendee list. As **Gate 2**,
look one of its codes up and leave it on screen. As **Gate 1**, look up another of its codes and
press **Admit** (just that one). Then as **Gate 2**, press **Admit all 4**. **Expect**: "3
admitted, 1 already used" with the time. As **Admin**, reload the attendee list. **Expect**: all 4
checked in, each with a time, and none twice. From the scan in S4 to an admitted group: under 10
seconds, not counting the ID check (SC-002).

## S6: Refusal reasons (US3)

As **Gate 1**: type `AAAAAAAAAAAA`. **Expect**: "No ticket has this code". Type a code of a ticket
for another demo event. **Expect**: refused, naming that event. Type a code from the cancelled demo
event. **Expect**: "Cancelled and refunded". Choose an event that starts tomorrow and type one of
its codes. **Expect**: refused with the time entry opens. No refusal shows **Admit**.

## S7: Admins and customers see real check-ins (US6)

As **Admin**, open the sales report. **Expect**: Demo Tonight's checked-in count includes every
ticket admitted in S3–S5 (SC-005). As **Customer**, open **My tickets**. **Expect**: the admitted
tickets say "Used" with their times, and no longer offer **Print ticket**.

## S8: Only gate agents can admit (FR-016)

Sign in to the Ticket Booth app as `customer1`. **Expect**: told plainly that the app is for gate
agents, with no data, as today (spec 001). The automated suite covers the API directly: customers,
admins, and missing tokens are refused on both operations.

## S9: Phone width, keyboard, and long names (FR-023, Edge Cases)

As **Gate 1**, open the browser's device toolbar at 360 × 640. **Expect**: no horizontal scroll,
and **Admit**, **Refuse**, and **Scan** are comfortable touch targets. Repeat S3's lookup with the
keyboard alone (Tab and Enter). **Expect**: every control is reachable, and the result is
announced by a screen reader if one is running (FR-024). As **Customer**, buy 1 ticket for Demo
Tonight with the name `Wolfeschlegelsteinhausenbergerdorff 木村拓哉之介`, then look it up at the
gate at that width. **Expect**: the name is shown in full, wrapped, on **My tickets**, the print
view, and the Ticket Booth result.

## S10 (optional): Scan with an Android phone (FR-009a)

Connect an Android phone with USB debugging on. In desktop Chrome, open `chrome://inspect`, choose
**Port forwarding**, and add `5175`, `8080`, and `3000`, each to `localhost:` the same port. On the
phone, open Chrome at `http://localhost:5175`, sign in as `agent2`, choose Demo Tonight, press
**Scan**, and scan an unused ticket's printed QR code. **Expect**: the same lookup as S4. iPhones
can't do this step (research R10).

## Automated equivalents

| Scenario | Tests |
|---|---|
| S1 | holder-name rules (shared and Backend); Customer app name field |
| S2 | Customer app print view and QR matrix |
| S3, S6 | lookup states and their order; admit; refusals; Ticket Booth flows |
| S4 | Ticket Booth scan with a stubbed decoder; camera refused |
| S5 | `wholeOrder` against single admits; 20 simultaneous admits |
| S7 | attendee list and report figures after admits |
| S8 | `401`/`403` on both operations |
| S9 | states, controls, and the live region are tested in the apps; width and wrapping are checked by eye |
