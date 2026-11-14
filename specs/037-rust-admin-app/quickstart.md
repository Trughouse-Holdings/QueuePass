# Quickstart: Rust Admin App

How to check `037-rust-admin-app` end to end. Contracts: [sign-in-realm.md](./contracts/sign-in-realm.md),
[parity-checklist.md](./contracts/parity-checklist.md).

**Prerequisites**: Docker. For `npm test` and `npm run build` on the host, also `rustup`, then
`npm run rust:setup` (the pinned toolchain from `admin-rust-app/rust-toolchain.toml`, plus prebuilt
`trunk` and `cargo-llvm-cov`). `docker compose up --build` needs no Rust on the host.

## S0: Bring up the whole system

```sh
cp .env.example .env   # first time; keep COMPOSE_PROJECT_NAME=queuepass-team
docker compose up --build
```

Expected: every service healthy, including `admin-rust-app`. The first build of the Rust image takes
several minutes. React Admin is at `http://localhost:5173`, and Rust Admin at
`http://localhost:5176`.

## S1: Both Admin apps signed in at once

1. Open `http://localhost:5173` and sign in as `admin1` / `test123`.
2. In a new tab, open `http://localhost:5176`. The sign-in page reads "Sign in to QueuePass Admin
   (Rust)" and is red. Sign in as `admin2` / `test123`.
3. Both tabs show their home page. The Rust tab is red, and its header and tab title say "(Rust)".
4. Press Log out in the Rust tab, then reload the React tab: it is still signed in. Repeat the
   other way around.
5. In the Rust tab, open `http://localhost:5176/events` while signed out. After signing in you land
   on Events, not the home page.

## S2: A change in one app shows in the other

1. In Rust Admin, create a venue with two sections (for example 10 × 20 and 5 × 10) and a real
   address.
2. In React Admin, open Venues: the venue is there with the same address, verified status, time
   zone, and layout.
3. Edit its capacity in React Admin, then reload it in Rust Admin: the new capacity shows.
4. In Rust Admin, change the venue's layout on its page (layout card). React Admin shows the new
   layout.

## S3: Schedule an event in the Rust Admin app

1. In Rust Admin, Schedule event at the venue from S2. The times default to today at the next
   whole hour, and 4 hours later. Doors open 1 hour before.
2. Add two ticket types, map each section to one, set 4 tickets per customer, and add two pictures.
3. Submit. Open the event in React Admin: every value matches, including both pictures in order.
4. In Rust Admin, schedule a second event at the same venue overlapping the first. The clash
   refusal shows beside the times, and every value is kept.

## S4: Live seat map

1. Open the S3 event in Rust Admin.
2. In the Customer app (`http://localhost:5174`, `customer1` / `test123`), hold a seat, then buy
   it.
3. Rust Admin's seat map shows the seat held, then sold, without a reload.
4. On the same page, the Sales card shows the sale, the tiers card edits a tier's price, and the
   Seating card marks a section Not for sale. Each change shows in React Admin.

## S5: Attendees, reports, downloads

1. In Rust Admin, open the S3 event's Attendees and the Reports page. The figures match React
   Admin's.
2. Download the attendee list and the sales report as CSV, XLSX, and PDF from both apps. Each pair
   holds the same rows, columns, and values, with "Made by", the time-zone note, and (attendees)
   the privacy note. Only the made-at time differs.

## S6: Parity checklist

Work through [parity-checklist.md](./contracts/parity-checklist.md) in the Rust Admin app. Each item
passes, and is marked E, U, or M in the implementation PR.

## S7: Wrong role and Backend down

1. Sign in to Rust Admin with an account in its realm that lacks `queuepass-admin` (made by hand in
   Keycloak's admin console). The app says you lack access, shows no data, and offers sign-out.
2. Stop the Backend (`docker compose stop backend`) and reload Rust Admin. It says the service is
   unreachable. Start the Backend again.

## S8: Tests

```sh
npm run rust:setup  # once
npm test            # includes @queuepass/admin-rust-app: cargo llvm-cov, at least 80% lines on core
npm run e2e         # @admin journeys run in both the chromium and admin-rust projects
```

## S9: Hallway test (SC-003)

Show 5 people a screenshot of each Admin app, in random order, and ask which one it is. All 5 name
it within 3 seconds. Record the result in the impl PR.

## Automation

| Scenario | Browser test |
| --- | --- |
| S0 | Manual: the browser-test stack brings the system up itself |
| S1 | Manual: becomes Automated in the impl PR as `037 S1: both Admin apps stay signed in, and logging out of one leaves the other` (also checks the red header, the tab title, `returnTo`, and that no sign-in value is left in `sessionStorage`); run 10 times with `--repeat-each=10` for SC-007 |
| S2 | Manual: becomes Automated in the impl PR as `037 S2: a venue and its layout made in the Rust Admin app show in the React Admin app` |
| S3 | Manual: becomes Automated in the impl PR as `037 S3: an event scheduled in the Rust Admin app with ticket types, seating, a limit, and pictures reads the same in the React Admin app`; the `031`, `035`, `036` event-form journeys also run in the `admin-rust` project |
| S4 | Manual: becomes Automated in the impl PR as `037 S4: the Rust Admin app's event page shows live seats and edits tiers and seating`; `015`'s Admin steps also run in the `admin-rust` project |
| S5 | Manual: becomes Automated in the impl PR as `037 S5: attendees, reports, and every download in the Rust Admin app`; file contents are compared with the React app's by `core` tests (research R7) |
| S6 | Manual: a walk of the checklist by hand, recorded in the impl PR |
| S7 | Manual: needs an account made by hand and a stopped Backend; covered by `core` tests of `AuthState` |
| S8 | Manual: test commands, run by CI |
| S9 | Manual: needs people |
