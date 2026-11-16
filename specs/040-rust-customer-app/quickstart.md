# Quickstart: Rust Customer App

How to check `040-rust-customer-app` end to end. Contracts:
[sign-in-client.md](./contracts/sign-in-client.md),
[parity-checklist.md](./contracts/parity-checklist.md).

**Prerequisites**: Docker. For `npm test` and `npm run build` on the host, also `rustup`, then
`npm run rust:setup` (Linux, macOS, or Windows; it installs the pinned toolchain and the prebuilt
`trunk` and `cargo-llvm-cov` only when missing). `docker compose up --build` needs no Rust on the
host.

## S0: Bring up the whole system

```sh
cp .env.example .env   # first time; an older .env needs http://localhost:5177 in CORS_ORIGINS
docker compose up --build
```

Expected: every service healthy, including `customer-rust-app`. The first build of the Rust image
takes several minutes. React Customer is at `http://localhost:5174`, Rust Customer at
`http://localhost:5177`; both Admin apps and the Ticket Booth as before.

## S1: Red sign-in, the same customer

1. In a fresh browser window (no Keycloak session), open `http://localhost:5174`: the sign-in page
   reads "Sign in to QueuePass Tickets" in teal, as before. Close the window.
2. In a fresh window, open `http://localhost:5177`: the sign-in page reads "Sign in to QueuePass
   Tickets (Rust)", its accent and the lines between the stones are red, and the audience line says
   it is the Rust version. Sign in as `customer1` / `test123`.
3. The app is red; the header and the tab title say "QueuePass Tickets (Rust)".
4. Open My tickets: the same orders as `customer1` has in the React Customer app.
5. Open `http://localhost:5177/my-tickets` while signed out: after sign-in you land on My tickets.

**Demo note (EDIS, Clarifications)**: the two Customer apps share one sign-in session in a browser.
For a demo, show them in separate browser windows, one normal and one private, so signing out of one
never touches the other. If the implementation PR has not merged by EDIS, run the demo from the
implementation branch (`git switch 040-rust-customer-app-impl`, then S0).

## S2: The shared session

1. Signed in to the Rust Customer app as `customer1` (S1), open `http://localhost:5174` in a new
   tab: it signs in as `customer1` without the form (one session for both Customer apps).
2. Sign in to both Admin apps and the Ticket Booth in other tabs.
3. In the React Customer tab, hold a seat on a seated event. In the Rust Customer tab, press
   Log out. Then:
   - the Rust tab is signed out;
   - the held seat is released (open again on the React tab's map within 2 s);
   - the React tab asks for sign-in again at its next renewal, at most its access-token lifetime
     later (it may keep working until then);
   - both Admin apps and the Ticket Booth are still signed in after a reload;
   - note whether Keycloak showed a front-channel logout page or loaded the React Customer app in a
     frame during the logout (research R2; the default is that it does not).

## S3: Find events and venues

1. With the demo data, open Events in both Customer apps. Search for a word, pick a venue, and set
   From and To. Both list the same events, with the same URL keys (`q`, `venue`, `from`, `to`,
   `hideCancelled=1`). Press Back: both return to the previous filter.
2. Open a past event's link from My tickets › Past: "This event has ended." and "Sales closed: this
   event has ended."
3. Open an event that has started: "This event has already started (began at …). You can still buy
   tickets until it ends at …."
4. Open an event with pictures: the gallery rotates, pauses, and opens full screen; Esc closes it.
5. Open Venues and a venue: the same table, address link, and events.

## S4: Buy general-admission tickets

1. In the Rust Customer app, on a general-admission event with ticket types and a per-customer limit
   of 4, pick a type, quantity 2, and a name; Confirm order.
2. The confirmation lists two ticket codes. The React Customer app's My tickets shows the order.
3. Try 3 more: refused with the limit's reason; every value is kept.

## S5: Seats, holds, and the cart across both apps

1. In the Rust Customer app, open a seated demo event, Choose seats, open a section, and click two
   open seats of two price levels: each is held at once, the countdown starts at 5:00 and keeps
   running for the second, and each hold is announced.
2. Click one again: released. Click it again: held.
3. In the React Customer app's Cart (same customer): the same reservation with the same time left.
4. In the Rust app, Add to cart, enter the name, Buy tickets. The confirmation shows; the React
   Customer app's My tickets lists the seats; the Admin apps' seat maps show them sold.
5. Hold a seat and wait out 5:00: the run-out message, and the seat waits 2 minutes.

## S6: My tickets, entry code, print, calendar

1. In both Customer apps, open My tickets: the same upcoming orders, and ended ones under Past.
2. Open the same ticket's entry code in both at the same time: the same QR code and "Changes in n
   s". In the Ticket Booth, scan or type the Rust app's code: admitted once.
3. Print the same ticket from both: the same QR, code, and facts.
4. Add the same event to a calendar from both: the two `.ics` files are the same apart from
   `DTSTAMP`; the Google links are the same.

## S7: Parity checklist

Work through [parity-checklist.md](./contracts/parity-checklist.md) in the Rust Customer app. Each
item passes, and is marked E, U, M, or N/A (with its reason) in the implementation PR.

## S8: Wrong role and Backend down

1. Sign in to the Rust Customer app with an account in the Customer realm that lacks `customer`
   (made by hand in Keycloak's admin console; the next seed run disables it, because the seed
   disables every account without `customer` in that realm): it says you lack access, shows no
   data, and offers Log out. The automated test needs no such account (research R13).
2. Stop the Backend (`docker compose stop backend`) and reload: "Can't reach the QueuePass
   service." Start it again.

## S9: Tests

```sh
npm run rust:setup  # once; on Windows too
npm test            # includes @queuepass/customer-rust-app: cargo llvm-cov, at least 80% lines on core
npm run e2e         # @customer journeys run in both the chromium and customer-rust projects
```

## S10: Hallway test (SC-003)

Show 5 people a screenshot of each Customer app, in random order, and ask which one it is. All 5
name it within 3 seconds. Record the result in the impl PR.

## S11: Same layout

Open each page in both Customer apps side by side, at a desktop width and at phone width, and in
print preview for a ticket: the same headings, cards, fields, buttons, and lists in the same order
and arrangement; only the colors and the name differ (parity SL1–SL12).

## Automation

| Scenario | Browser test |
| --- | --- |
| S0 | Manual: the browser-test stack brings the system up itself |
| S1 | Automated: `040 S1: the Rust Customer app's sign-in is red and names it, and the customer is the same as in the React Customer app` |
| S2 | Automated: `040 S2: the two Customer apps share one session, and logging out of one releases holds and leaves every other app signed in`; rest Manual: the 10 runs with `--repeat-each=10` for SC-006 |
| S3 | Manual: no 040 test of its own; once the implementation PR tags them, the `@customer` journeys of `020` and `030` run in the `customer-rust` project (the started notice is `034 S1/S2`, under S4); the gallery by hand |
| S4 | Manual: no 040 test of its own; once the implementation PR tags them, the `@customer` journeys of `006`, `016`, and `034` run in the `customer-rust` project |
| S5 | Automated: `040 S5: seats held in the Rust Customer app show in the React Customer app's cart and are bought in the Rust one`; rest Manual: step 5, waiting out the 5:00 run-out and its 2-minute wait (too slow for the suite), and step 4's Admin seat maps showing the seats sold, by hand (`033` and `038`'s Customer journeys also run in the `customer-rust` project) |
| S6 | Manual: until the implementation PR, which makes it Automated with the planned test `040 S6: the entry code, the printed ticket, and the calendar file are the same in both Customer apps`; the Ticket Booth scan of a live code by hand (the gate's typed-code path is `017 S3`) |
| S7 | Manual: a walk of the checklist by hand, recorded in the impl PR |
| S8 | Automated: `040 S8: a token without the customer role shows the wrong-role card, and an unreachable Backend is said plainly`; rest Manual: a real role-less account and stopping the real Backend by hand |
| S9 | Manual: test commands, run by CI |
| S10 | Manual: needs people |
| S11 | Manual: until the implementation PR, which makes it Automated with the planned test `040 S11: every page has the same structure and arrangement in both Customer apps, at desktop and phone width` |
