# Quickstart: Rust Admin App

How to check `037-rust-admin-app` end to end. Contracts: [sign-in-realm.md](./contracts/sign-in-realm.md),
[parity-checklist.md](./contracts/parity-checklist.md).

**Amended 2026-11-14**: S2–S4 follow seat maps (`038`); S10 (the layout editor, `039`) and S11
(same layout, FR-020) are new.

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

1. In Rust Admin, create a venue with a real address, Seating "Seated", two levels, and two
   section lines (for example 10 × 20 and 5 × 10).
2. In React Admin, open Venues: the venue is there with the same address, verified status, time
   zone, and its "Standard" layout on the Layouts card.
3. In React Admin, rename the layout; reload the venue in Rust Admin: the new name shows.
4. In Rust Admin, on the venue's Layouts card, duplicate the layout, edit its section lines, and
   import a layout file with a mistake in it: the problems are listed as in React Admin, and
   nothing is saved. React Admin shows the copy with its new lines.

## S3: Schedule an event in the Rust Admin app

1. In Rust Admin, Schedule event at the venue from S2. The times default to today at the next
   whole hour, and 4 hours later. Doors open 1 hour before.
2. Keep General admission, add two ticket types, set 4 tickets per customer, and add two pictures.
3. Submit. Open the event in React Admin: every value matches, including both pictures in order.
4. In Rust Admin, schedule a second event at the same venue overlapping the first. The clash
   refusal shows beside the times, and every value is kept.
5. In Rust Admin, schedule a third event at the venue, a day later, on its layout: give each level
   a price and take one row and two single seats off sale. Open it in React Admin's Edit event:
   the same layout, prices, and seats off sale.

## S4: Live venue map

1. Open S3's seated event in Rust Admin.
2. In the Customer app (`http://localhost:5174`, `customer1` / `test123`), hold a seat, then buy
   it.
3. Rust Admin's Seating card shows the section's counts change, and, zoomed into the section, the
   seat held, then sold, without a reload.
4. On the same page, the Sales card shows the sale by price level. On S3's general-admission event,
   the tiers card edits a tier's price; React Admin shows it.

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

## S10: The layout editor

1. In Rust Admin, open S2's venue and choose New layout. Pick a Court floor, add two sections with
   the block generator (one curved), drag one and turn it, add a level, paint a section and two
   seats with it, then Undo and Redo once. Name it and Save.
2. Open the same layout in React Admin's editor: every section, place, angle, label, and level is
   the same. Move a section there and save.
3. Back in Rust Admin, without reloading, move a section and save: the change-since-opened refusal
   offers Save as a new layout and Reload, as in React Admin.
4. Press Back with unsaved changes: the app asks first. Open a locked layout (S0's demo data): it
   opens to view, and Duplicate to edit makes an editable copy.

## S11: Same layout

Open each page in both apps side by side, at a desktop width and at phone width: the same headings,
cards, fields, buttons, and table columns in the same order and arrangement; only the colors and the
name differ (parity SL1–SL14).

## Automation

| Scenario | Browser test |
| --- | --- |
| S0 | Manual: the browser-test stack brings the system up itself |
| S1 | Automated: `037 S1: both Admin apps stay signed in, and logging out of one leaves the other`; rest Manual: the 10 runs with `--repeat-each=10` for SC-007 (the test also checks the red header, the tab title, `returnTo`, and that no sign-in value is left in `sessionStorage`) |
| S2 | Automated: `037 S2: a venue and its layout made in the Rust Admin app show in the React Admin app`; rest Manual: two price levels by hand (the test uses one); `038 S0` and `038 S5` also run in the `admin-rust` project |
| S3 | Manual: becomes Automated in the impl PR as `037 S3: events scheduled in the Rust Admin app, general admission and on a layout, read the same in the React Admin app`; the `031`, `035`, `036` event-form journeys and `038 S6` also run in the `admin-rust` project |
| S4 | Manual: becomes Automated in the impl PR as `037 S4: the Rust Admin app's event page shows live seats, sales by level, and edits tiers`; `015`'s Admin steps and `038 S17` also run in the `admin-rust` project |
| S5 | Manual: becomes Automated in the impl PR as `037 S5: attendees, reports, and every download in the Rust Admin app`; file contents are compared with the React app's by `core` tests (research R7) |
| S6 | Manual: a walk of the checklist by hand, recorded in the impl PR |
| S7 | Manual: needs an account made by hand and a stopped Backend; covered by `core` tests of `AuthState` |
| S8 | Manual: test commands, run by CI |
| S9 | Manual: needs people |
| S10 | Manual: becomes Automated in the impl PR as `037 S10: a layout drawn in the Rust Admin app's editor is the same in the React Admin app's, and a stale save is refused`; `039 S1/S2/S3` and `039 S5` also run in the `admin-rust` project |
| S11 | Automated: `037 S11: every page has the same structure and arrangement in both Admin apps, at desktop and phone width`; rest Manual: the side-by-side look by hand (research R15) |
