# Quickstart: Validating Rotating QR Codes

The running-system gate for `018`. Run after the implementation with every service healthy and the
demo data loaded:

```bash
docker compose up --build -d
npm test                      # full suite, including the live-code boundary and race tests
```

You need three browser sessions that don't share sign-in, and a phone with a camera:

- **Customer**: the Customer app (http://localhost:5174), `customer1` / `test123`, in a window
  narrowed to phone width (about 360 pixels).
- **Gate 1**: the Ticket Booth app (http://localhost:5175), `agent1` / `test123`, on the laptop,
  so the webcam works.
- **Gate 2**: the Ticket Booth app, `agent2` / `test123`, in a second browser or profile.
- **Phone**: its ordinary camera app, used only to carry the Customer window's QR code to the
  webcam (research R10). Use its **front (selfie) camera**: aimed at the Customer window, the
  phone's screen then faces the webcam (with the back camera it faces away). Its live viewfinder
  relays the current code, mirrored, which the Ticket Booth still reads; a photo is a screenshot.
  If the relay won't read, use one of research R10's two alternatives: an iPhone (Continuity
  Camera) or a USB webcam aimed at the screen as Gate 1's camera, made Chrome's default camera at
  `chrome://settings/content/camera` (a site's settings only allow or block it), or, on Android,
  the Customer app on the phone itself.

Contract and rules: [contracts/README.md](./contracts/README.md), [data-model.md](./data-model.md).

## S0: An event open for entry, and a ticket for it

Use spec 017's "Demo Tonight" (open for entry from when the demo data loads until 4 hours later;
if that has passed, create an event that starts within 2 hours). As **Customer**, get 3 tickets for
it with the name `Jordan Lee`. **Expect**: on **My tickets**, each of the three has **Print ticket**
and **Show entry code**.

## S1: The live code changes on its own (US1, FR-001–FR-004, FR-017)

As **Customer**, choose **Show entry code** on the first ticket. **Expect**: a large black-on-white
QR code, "Changes in N s" counting down, Jordan Lee, Demo Tonight with its start time, and the seat
if any, with no horizontal scroll at 360 pixels wide (FR-017). Watch it reach 0. **Expect**: a new
QR code within a second, and the countdown back at 29 or 30, with no tap or reload. Switch the
laptop to dark mode. **Expect**: the QR code stays black on
white. With a screen reader on, **expect** the countdown not to be read out as it changes.

## S2: Scan the live code, no ID check (US1)

As **Gate 1**, choose Demo Tonight and press **Scan**. Aim the phone's front camera at the Customer
window, so the phone's screen, showing the viewfinder, faces the webcam. **Expect**: the ticket
appears with no further
tap, saying "✓ Live code verified. No ID check needed.", with Jordan Lee, **Admit**, **Admit all
3**, and **Refuse**, and no ID-check prompt. Press **Admit**. **Expect**: "✓ Admitted". From
pressing **Scan** to "Admitted": under 5 seconds (SC-003).

As **Customer**, reload **My tickets**. **Expect**: that ticket shows "Used" with the time, and no
**Show entry code**.

## S3: A screenshot expires (US2)

As **Customer**, open **Show entry code** on the second ticket. With the phone, take a **photo** of
the QR code and note the countdown. Within that countdown plus 5 seconds, scan the photo at **Gate
1**. **Expect**: verified, as in S2. Press **Refuse** (nothing recorded).

Wait until at least 40 seconds after taking the photo. Scan the same photo again. **Expect**: "✕
This live code has expired. Ask for the live code in the QueuePass app, or a printed ticket with
photo ID.", with no event, name, or seat, and no **Admit**. Now scan the Customer window's current
code through the phone's viewfinder. **Expect**: verified again: the expired photo changed nothing.

## S4: Printed and typed codes still need ID (US3, FR-014)

As **Customer**, open **Print ticket** for the third ticket. At **Gate 1**, scan it. **Expect**:
spec 017's "Check a government-issued photo ID that shows: Jordan Lee", not "Live code verified".
Type the same ticket's code instead. **Expect**: the same ID-check prompt. Press **Refuse**.

## S5: One entry, whichever code (US4)

As **Customer**, open **Show entry code** for the third ticket. At **Gate 2**, type its printed
code, and at **Gate 1**, scan its live code, so both screens show it admittable. Press **Admit** on
both, as close together as you can. **Expect**: exactly one "✓ Admitted"; the other says "Already
used" with the time. Scan the live code again: "Already used". (The automated test sends 20 at
once, SC-004.)

## S6: No signal (FR-010, SC-006)

As **Customer**, buy one more ticket for Demo Tonight and open its **Show entry code**. Stop both
the Backend and Keycloak with `docker compose stop backend keycloak` (everything runs on
`localhost`, so turning Wi-Fi off cuts nothing). **Expect**: the code keeps changing, with no
"Signing in…" and no move to a sign-in page, for 10 minutes (SC-006). That outlasts one 5-minute
access token, so the app has tried to renew it and failed for lack of network (research R12).
Start both again (`docker compose start backend keycloak`) and, once they are healthy, scan the
current code at **Gate 1** within its window (Gate 1's token expired too; it renews quietly within
about 30 seconds of Keycloak answering, so it may not pass through sign-in at all). **Expect**:
verified.

Next, a network that hangs instead of refusing, on the **Customer** window only (to be confirmed in
T039; nobody has run this step yet). In Chrome DevTools → **Network** → throttling, add a custom
profile with about 60,000 ms of latency and select it for 6 minutes. Keep DevTools open on the
Customer window the whole time: throttling applies only while it is open. **Expect**: the code keeps
changing, with no "Signing in…" (the token expires with no renewal error, research R12). Turn
throttling off. **Expect**: within about 30 seconds the token renews (the Network panel shows a
`token` request answered `200`) with no change of page, and the code keeps changing.

Now stop only the Backend (`docker compose stop backend`) and reload the Customer page. Keycloak
stays up because a reload signs in again first: with Keycloak down too, that sign-in fails before
the app can show anything. **Expect**: "Can't show the live code without a connection. Use your
printed ticket with photo ID." Start the Backend again.

## S7: Only the buyer gets the key (FR-003)

Sign in to the Customer app as `customer2` in another browser, and open
`http://localhost:5174/my-tickets/<ticket id from S6>/entry-code` (copy the id from `customer1`'s
address bar). **Expect**: no QR code, and a not-found message. The automated tests cover admins,
gate agents, and bad tokens (SC-007).

## S8: Smoke test (Constitution VI)

Sign in to, use, and sign out of each front end. The Ticket Booth app's sign-out returns to its
sign-in page; the Customer app's sign-out drops the live code screen with it.
