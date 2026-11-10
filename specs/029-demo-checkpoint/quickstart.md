# Quickstart: Demo Checkpoint

**Feature**: `029-demo-checkpoint` | **Spec**: [spec.md](./spec.md)

The running-system gate for this feature. Walk it against a stack built from the implementation
branch, **on its own Compose project** (`-p qp029`), never on the team's stack: the reset removes
every venue, event, and order in the database it is pointed at. Each scenario names the requirements
it proves.

## S0. A stack of its own, with some extra data

1. Path A: `docker compose -p qp029 up --build`. Path B (this machine): the team's stack (Compose
   project `queuepass-team`, its Backend and apps run with `run-host.mjs` from the main checkout)
   holds the ports. **Ask Mahdi before touching it.** With his go: stop its `run-host.mjs` (Ctrl+C in
   its terminal) and `docker compose -p queuepass-team stop` (never `down`, never `-v`). Then `docker
   compose -p qp029 up -d database keycloak` and `node scripts/run-host.mjs --backend-tz
   America/Los_Angeles --demo-data`. On path B the reset acts on whatever publishes port 5432, so
   check `docker ps` shows `qp029`'s database on it, not the team's, before every reset.
2. In the Admin app, add a venue with a seating layout and an event there with a tier; in the Customer
   app, as `customer1`, buy tickets for it and for Fall Concert, and pick seats at a seated event but
   leave them held; in the Ticket Booth, admit a Demo Tonight ticket.
3. **Expected**: the extra venue, event, orders, held seats, and admitted ticket are all visible.

## S1. Reset to the demo state (US1; FR-001, FR-002, FR-004 to FR-007, FR-012, FR-014, SC-001, SC-002)

1. In a second terminal, path A: `docker compose -p qp029 exec -e QUEUEPASS_ALLOW_RESET=1 backend node
   backend/dist/scripts/demo-reset.js`. Path B, bash: `QUEUEPASS_ALLOW_RESET=1 node scripts/run-host.mjs --demo-reset`; PowerShell:
   `$env:QUEUEPASS_ALLOW_RESET='1'; node scripts/run-host.mjs --demo-reset; Remove-Item Env:QUEUEPASS_ALLOW_RESET`.
2. **Expected**: within about 10 seconds it prints the database (`database:5432/queuepass` or
   `localhost:5432/queuepass`, no password), the rows removed per kind (the extra venue, sections,
   events, orders, tickets with 25 checked in (the demo's 24 plus the one admitted in S0), seat
   reservations and holds among them), what it
   created (2 venues, 5 events, Holiday Gala cancelled, Season Opener over, 53 orders, 121 tickets, 24
   checked in, 4 images), when Demo Tonight's check-in closes, the time taken, and the reminder to
   reload apps and about attempt limits. Exit status 0. The Backend and apps keep running.
3. Reload the Admin app. **Expected**: exactly Demo Riverside Hall and QueuePass Demo Arena; exactly
   the five demo events; the extra venue and event are gone; Reports show only the demo events. Note
   the Reports figures now, before S2 admits a ticket: S3 compares against them.

## S2. The demo state in the apps (US1; FR-007, SC-006)

1. Ticket Booth, as `agent1`. **Expected**: Demo Tonight is offered and open; Season Opener is not
   offered. Choose Demo Tonight and admit one of its tickets (a code from the Admin app's attendee
   list). **Expected**: admitted.
2. Customer app, as `customer1`. **Expected**: Fall Concert and Comedy Night on sale; Holiday Gala
   cancelled; Season Opener shows "Sales closed"; My tickets is empty (the earlier orders were
   removed; demo orders belong to stand-in identities).

## S3. The same state again (US2; SC-003)

1. Buy and admit a few tickets as in S0 (S2 admitted one already).
2. Run the reset again (S1 step 1). **Expected**: the same "Created" line as in S1; the Reports
   figures equal those noted at the end of S1 (24 checked in, not counting S2's admission); Demo
   Tonight's times moved to the new run.

## S4. Refusals (US3; FR-009, FR-010, FR-011, SC-004, SC-005)

1. Path A without the permission: `docker compose -p qp029 exec backend node
   backend/dist/scripts/demo-reset.js`. **Expected**: "Refused: …" naming `QUEUEPASS_ALLOW_RESET=1`,
   exit 1, nothing changed (the Admin app still shows S3's data).
2. With the permission and a remote host: `docker compose -p qp029 exec -e QUEUEPASS_ALLOW_RESET=1 -e
   DATABASE_URL=postgresql://u:secret@db.example.com:5432/x backend node
   backend/dist/scripts/demo-reset.js`. **Expected**: refused, naming `db.example.com`, never
   `secret`; exit 1; nothing changed.
3. With the permission and `QUEUEPASS_ALLOW_RESET=true`. **Expected**: refused as in step 1.
4. A local database that is not QueuePass's: `docker compose -p qp029 exec database createdb -U
   queuepass empty`, then `docker compose -p qp029 exec -e QUEUEPASS_ALLOW_RESET=1 -e
   DATABASE_URL=postgresql://queuepass:queuepass@database:5432/empty?schema=public backend node
   backend/dist/scripts/demo-reset.js`. **Expected**: refused: not a QueuePass database, or its
   migrations are not all applied; exit 1. (Path B has no Backend container; the same case is in the
   Backend's tests, T005.)
5. Path B without the permission: `node scripts/run-host.mjs --demo-reset` (in a shell where
   `QUEUEPASS_ALLOW_RESET` is not set). **Expected**: refused as in step 1; `run-host.mjs` does not
   give it; exit 1; nothing changed.

## S5. Never run by starting the system (FR-003, SC-007)

1. `docker compose -p qp029 down`, then `docker compose -p qp029 up --build` (path B: start the
   database and Keycloak, then `run-host.mjs` without `--demo-reset`). **Expected**: the data from S3
   is still there (not reset); the seed job runs as before; the system is usable.
2. Search `docker-compose.yml`, `.env.example`, and `.github/workflows` for `QUEUEPASS_ALLOW_RESET`.
   **Expected**: no match.

## S6. Keycloak untouched (FR-008)

1. Sign in to all three apps, then run the reset. Reload each app. **Expected**: still signed in,
   working on the new demo state; no sign-in asked again.
2. Stop Keycloak (`docker compose -p qp029 stop keycloak`), run the reset. **Expected**: it completes
   as in S1. Start Keycloak again.

## S7. Sign in, use, sign out (Constitution VI)

Sign in to each front end, use it briefly on the demo state, and sign out. **Expected**: as before
`029`. Afterwards `docker compose -p qp029 down -v` removes this stack and its data. On path B, restore the team's
stack: `docker compose -p queuepass-team start database keycloak` (only those two) and its
`run-host.mjs` from the main checkout.

## Automation

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`. Every `npm run e2e` also runs the reset
once, on the Compose path, to load the demo state (research R13); the reset's own rules are covered
by the Backend's integration tests against real PostgreSQL (tasks T003 to T006).

| Scenario | Browser test |
| --- | --- |
| S0 | Manual: a stack of its own with hand-made extra data; the e2e stack is fresh |
| S1 | Manual: removing every row would break the browser tests running beside it; the wipe and the output are covered by the Backend's tests, and the harness runs the reset once per job |
| S2 | Automated: `029 S2: after the reset, the Ticket Booth offers Demo Tonight open and the Customer app shows Season Opener with sales closed`; rest Manual: admitting a ticket by hand |
| S3 | Manual: two resets compared by the Backend's tests (T004) |
| S4 | Manual: refusals are command-line behavior, covered by the Backend's guard and migration tests (T003, T005) |
| S5 | Manual: start-up is every `npm run e2e`; the root script test checks no Compose file or workflow gives the permission (T007) |
| S6 | Manual: signed-in apps across a reset and Keycloak stopped, by hand |
| S7 | Manual: sign in, use, and sign out of each front end, by hand; the main journeys are `022`'s browser tests |
