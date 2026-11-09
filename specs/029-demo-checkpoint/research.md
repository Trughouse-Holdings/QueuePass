# Research: Demo Checkpoint

**Feature**: `029-demo-checkpoint` | **Spec**: [spec.md](./spec.md) | **Date**: 2026-11-09

The issue (#139) settles what the command does. Every decision below that the issue leaves open takes
the recommended option and records the alternatives, for Mahdi and the team to overturn in review of
the spec PR.

## R1. Where the reset lives: a Backend script beside the demo data

**Decision**: `backend/src/scripts/demo-reset.ts`, compiled to `backend/dist/scripts/demo-reset.js`
like `demo-data.ts`, with a Backend workspace script `demo-reset` (`node
dist/scripts/demo-reset.js`) in `backend/package.json`. It exports:

- `checkResetAllowed(env): { host, port, database }` — the pure guard of R7, reading
  `QUEUEPASS_ALLOW_RESET` and `DATABASE_URL`; throws `ResetRefused` with the message to print.
- `wipeAppData(prisma): Promise<RemovedCounts>` — R2.
- `assertMigrated(prisma, migrationsDir)` — R7's second check.
- `runDemoReset(app, options): Promise<ResetSummary>` — wipe, then `runDemoData(app)` (R5), then the
  summary.
- `main()` — guard first, then the Nest application context (as `demo-data.ts`), the steps, the
  output of R11, `app.close()`.

**Why**: the reset must load the demo data through the Backend's services (FR-006), which only the
Backend's own code can do (Constitution I: no other code reaches the database). The demo data's
script already runs this way in both stacks: inside the Backend's container with Compose, and from
the host with the Backend's environment on path B (`run-host.mjs --demo-data`). The compiled script
ships in the Backend's image (`backend/dist` is copied), so the Compose command needs nothing new in
the image.

**Alternatives**: a root `scripts/demo-reset.mjs` that wipes with `psql` and calls `npm run
demo-data`: two processes and a second database client, and `psql` is not on the host here. An HTTP
endpoint: an API operation that deletes everything would be reachable by any admin token, needs a
contract change, and is exactly the kind of control the issue keeps out of the apps (spec, Out of
scope). A root `package.json` script: shared surface, and it could not give the Backend's environment
on every shell (R6).

## R2. Removing the data: one `TRUNCATE` of every table but the migration record

**Decision**: in one interactive transaction, `prisma.$transaction(fn, { timeout: 15_000, maxWait:
5_000 })` (Prisma's defaults, 5 s and 2 s, would expire the transaction before or with the lock wait;
R10):

1. `SET LOCAL lock_timeout = '3s'` (R10).
2. List the tables: `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND
   tablename <> '_prisma_migrations' ORDER BY tablename`.
3. `LOCK TABLE <every listed table, quoted> IN ACCESS EXCLUSIVE MODE`: every lock the `TRUNCATE`
   needs, taken at once before anything is read, so no lock is upgraded table by table (which could
   deadlock with the running Backend) and no row can be added between the counts and the removal.
4. Count each one's rows (`SELECT count(*)`), for the output (FR-012). At demo size this is
   milliseconds, and the counts are exactly what step 5 removes.
5. `TRUNCATE TABLE <every listed table, quoted> RESTART IDENTITY CASCADE`.

The schema is the one in the `DATABASE_URL`'s `schema` parameter (`public` in every stack), which is
what Prisma's connection sets as `current_schema()`. The removed counts are reported under the
table's name (`Location` printed as "venues" through a small label map, unknown tables under their own
name).

**Why**: `TRUNCATE` removes everything at once and keeps every constraint, index, the exclusion
constraint `event_no_overlap`, and the CHECKs in migration SQL (FR-005). Listing the tables from the
catalog means a table a later feature adds is removed too, without changing the reset (FR-004). The
existing test helper `backend/test/setup/reset-db.ts` truncates a fixed list, which already misses
`EventImage` (removed only by `CASCADE`); the catalog avoids that drift. One transaction makes the
removal all or nothing (Edge Cases).

**Alternatives**: `DELETE` child tables first: slower, order-dependent, and must be kept in step with
the schema. `DROP SCHEMA` and `prisma migrate deploy`: removes the migration record and takes far
longer; the constitution's own test helper comment warns against dropping. A fixed list shared with
`reset-db.ts`: would miss new tables silently; the reset's test instead asserts every listed table is
empty after the wipe (T005).

## R3. Purchase attempt limits are in memory, not in the database

**Decision**: the reset does not try to clear them. It prints (FR-014): "Purchase attempt limits
counted before the reset are kept by the running Backend for up to a minute; restart the Backend to
clear them at once."

**Why**: `026` keeps attempts in `AttemptLimitsService`'s in-memory map
(`backend/src/attempt-limits/attempt-limits.service.ts`; spec 026 data-model.md, "No new tables"),
inside the running Backend process. A separate process cannot reach it. Each attempt counts for at
most 60 seconds, so by the time a presenter has opened the apps after a reset, they are gone, and
ordinary buying never meets the limits (`026` SC).

**Alternatives**: an admin API operation to clear them: a contract change and a new control for a
problem that ends by itself within a minute (Principle VIII). Restarting the Backend from the reset:
the reset does not own the Backend's process on either path.

## R4. Keycloak stays out; stand-in identities make that safe

**Decision**: the reset does not read, write, or need Keycloak (FR-008). It boots the Backend's
module, whose token check builds its key set lazily (`createRemoteJWKSet` fetches only when a token is
checked, which the reset never does), so Keycloak may be down. It needs the `OIDC_*` variables set,
which both commands give (R6).

**Why**: the demo data's orders belong to `demo-customer<N>` and its check-ins to `demo-agent1`
(`demo-data.ts` `buyer`, the check-in update), stand-ins that are no Keycloak subject. So the demo
state does not depend on which accounts or realms exist, and spec `028`'s change from one realm to
three does not touch the reset. Orders made by real signed-in customers (real subjects) are app data
and removed with the rest; their accounts stay. A signed-in user's token stays valid, so after a
reload the apps work as before.

**Alternatives**: re-provisioning the demo users through `scripts/seed` (the issue's "or"): the seed
is idempotent and already run by `docker compose up`, users are not app data, and `028` is redesigning
the seed's realms now; coupling the reset to it would make the reset change with every realm change.

## R5. The demo state: today's demo data plus a past event

**Decision**: `runDemoData` gains one event, created through `EventsService.create` like the others,
after Holiday Gala:

```ts
// Spec 029 FR-007 (research R5): an event that is over, so the apps show one; 7 days before the
// run at 7:00 PM to 10:00 PM at the Hall. Sales closed at its start (006), so it has no tickets.
const past = await events.create({
  name: 'Season Opener',
  locationId: hall.id,
  ...timesAt(atLocal(-7, '19:00', hallZone), 3, hallZone),
  totalTicketCapacity: 150,
  basePrice: '30.00',
});
```

`DemoSummary` gains `past: string | null` ("Season Opener") and `events` becomes 5. `atLocal` already
takes any whole number of days, negative included. The Hall's other events are 21 days ahead and
1 hour ahead, far past the 60-minute rule. `EventsService.create` does not refuse a past start (only
the order of start, doors, and end, `025`), so it goes through the real rules; doors default to the
start minus 1 hour.

The existing tests that count the demo data change with it (T004): `demo-data.e2e-spec.ts` expects
5 events and the sales report's `totals.events` 4 (scheduled events; the gala is cancelled), and the
doors check covers Season Opener too.

**Why**: the issue asks for "one in the past". Holiday Gala is cancelled but upcoming. Adding the
past event to the demo data, not to the reset only, keeps one demo state: `npm run demo-data` on a
fresh stack and the reset give the same thing (Assumptions, "The demo data is the checkpoint").

**No tickets**: `OrdersService.create` refuses an order once the event has started (`006` FR-014,
`orders.service.ts`: `new Date() >= event.startsAt`), so a past event cannot get orders through the
Backend's rules. The alternatives: write orders, tickets, and check-ins straight into the tables, as
the demo data already does for check-ins (`005` research R9). Rejected: every order row the demo
makes goes through `OrdersService` today; a past event with sales would be the first demo order to
skip the capacity, tier, and limit checks. Mahdi may prefer a past event with sales for the reports;
then T009 changes to direct inserts and the past event gains a tier, orders, and check-ins (spec,
Clarifications, open to review).

**Names and places**: "Season Opener" at Demo Riverside Hall, capacity 150, $30.00, no tiers, no
images: plain, so its only role is "over". The Arena has a 2,000-seat capacity and the concert; the
Hall is the smaller, busier venue in the demo.

## R6. The two commands

**Decision**:

- **Compose stack** (path A): `docker compose exec -e QUEUEPASS_ALLOW_RESET=1 backend node
  backend/dist/scripts/demo-reset.js`. The Backend's container has every variable the Backend needs,
  its `DATABASE_URL` points at host `database`, and `-e` gives the permission for this one command.
- **Host-run stack** (path B), with the permission typed in front of it:
  - bash: `QUEUEPASS_ALLOW_RESET=1 node scripts/run-host.mjs --demo-reset`
  - PowerShell: `$env:QUEUEPASS_ALLOW_RESET='1'; node scripts/run-host.mjs --demo-reset; Remove-Item
    Env:QUEUEPASS_ALLOW_RESET` (one line; the last part takes the permission back out of the shell).

  A new mode of `run-host.mjs`: it runs one step, `npm run demo-reset --workspace
  @queuepass/backend`, with the Backend's environment from `plan()` (`backendEnv`, the same object the
  Backend child gets) on top of its own environment, which carries the person's
  `QUEUEPASS_ALLOW_RESET` through. It never sets or defaults that variable itself (spec review round
  1), so without it the reset's guard refuses as on path A. Then it exits with that step's status. No setup steps (no build, no
  migration, no seed: FR-002, SC-002) and no children. Before running, it checks
  `backend/dist/scripts/demo-reset.js` exists, and otherwise prints "Build the Backend first: npm run
  build --workspace @queuepass/backend" and exits 1. `--demo-reset` with `--demo-data` is refused
  (unknown combination); `--geocoder-url` and `--backend-tz` apply as for the Backend; `--print` shows
  the one step and its environment. It runs in a second terminal while the first runs the stack;
  nothing it does touches the running Backend's process or ports.

**Why**: both stacks need the Backend's full environment, which a bare `npm run` on the host does not
have (`oidcConfig()` refuses to boot without `OIDC_*`). `run-host.mjs` already owns that environment
for path B (`plan()` is the one place it is written), so the reset reuses it rather than copying it
into a third place. The host-run stack's database is always `localhost:5432`, which is whichever stack
publishes that port on the laptop, the team's stack included (spec Edge Cases). That is why the
permission is still typed by the person on this path too: `--demo-reset` alone could be typed by habit
in the team stack's terminal.

**Alternatives**: a root `npm run demo:reset` as the issue's example: root `package.json` is shared
surface, and an npm script cannot set `QUEUEPASS_ALLOW_RESET` the same way on PowerShell and POSIX
shells without a new dependency; on the Compose path the host need not have `node_modules` at all.
Letting `--demo-reset` set the permission itself (the first draft's recommendation): one less thing to
type, but then nothing but the flag stands between a habit and the team's data. Reversed in spec
review round 1 (decided for safety by the orchestrating session on Mahdi's behalf).

**Conflict note**: spec `028` (its spec merged; its implementation in progress) changes
`run-host.mjs` (its realm and OIDC values). The implementation of `029` adds a mode and does not touch
those values, so a rebase merges cleanly or with a small conflict in `plan()`; whichever merges second
keeps both.

## R7. The safety checks

**Decision**, in `checkResetAllowed` (no connection) and then `assertMigrated` (connected, before the
wipe):

1. `QUEUEPASS_ALLOW_RESET` MUST be exactly `1`. Otherwise: "Refused: this removes every venue, event,
   order and ticket. To reset a local QueuePass database, set QUEUEPASS_ALLOW_RESET=1 for this command
   (see README, Demo checkpoint)."
2. `DATABASE_URL` MUST parse as a `postgresql:` or `postgres:` URL whose hostname, lower-cased and
   without IPv6 brackets, is one of `localhost`, `127.0.0.1`, `::1`, or `database` only when the
   reset runs inside a container (the file `/.dockerenv` exists; `checkResetAllowed(env, {
   inContainer })` takes it as an option, defaulting to that file check, so tests can set it). Its
   query MUST have no `host` or `hostaddr` key (libpq's overrides, which would send the connection
   elsewhere), compared after percent-decoding and lower-casing each key (`HOST=`, `h%6Fst=` refused).
   Otherwise: "Refused: the database host `<host>` is not local (allowed: localhost, 127.0.0.1, ::1,
   and database inside a container)." A missing or unreadable `DATABASE_URL` is refused the same way.
3. Connected: the table `_prisma_migrations` MUST exist in the current schema; every migration folder
   name in `backend/prisma/migrations` (found from the script's own location,
   `../../prisma/migrations` from `dist/scripts`, present in the image and on the host) MUST appear in
   it with `finished_at` set and `rolled_back_at` NULL. Otherwise: "Refused: this database is not a
   QueuePass database, or its migrations are not all applied. Start the Backend once (it applies
   them), then reset."

`database` is allowed because inside the Compose network it is the stack's own Postgres service (and
the e2e stack's, R13). Outside a container it is refused: a hosts-file entry or a DNS search domain
could resolve it to another machine. Only the Backend's container uses that host, and Docker creates
`/.dockerenv` in every container it runs. Both checks 1 and 2 run before
the Nest application context is created, so a refusal opens no connection (SC-004). The password is
never printed; the output names `host:port/database` only (FR-011).

**Why**: the issue's own example ("an explicit `QUEUEPASS_ALLOW_RESET=1` flag plus a localhost
database host"). The migration check stops a reset that would wipe a database and then fail to load
the demo data into an older schema, leaving it empty.

**Alternatives**: refusing when `NODE_ENV=production`: the Backend's image sets `NODE_ENV=production`
for every run, including local Compose, so it would refuse the main case. A confirmation prompt
("type RESET"): not scriptable for the e2e harness (R12), and the permission is already explicit.
Checking the database name (`queuepass`): the e2e stack and other Compose projects use the same name,
so it adds nothing.

## R8. Save and restore checkpoints: deferred

**Decision**: not built (spec, Out of scope). Principle VIII: the feature builds what its spec needs.

**Why**: (1) a dump holds instants, so a state saved today and restored tomorrow has Demo Tonight's
window closed and "upcoming" events a day nearer, which is what the reset exists to avoid; (2) on path
B the host has no `pg_dump` or `pg_restore`, and running them in the database container needs its name,
which differs per Compose project (`queuepass-team`, `qp020gate`, `qpe2e`); (3) a dump includes
`_prisma_migrations`, so restoring an old one after a new migration breaks the schema check; (4) the
reset already reaches a known state in seconds. No security or correctness control is deferred, so
no closing feature has to be named; a later issue can add a checkpoint if a hand-prepared state is
ever needed, and should restore data only, into the current schema.

## R9. Speed

**Decision**: SC-002's 10 seconds on the team laptop with the address service answering or refusing at
once. Expected parts: starting the Backend's module about 1–2 s; the wipe under 0.1 s; two address
checks about 1 s each online; about 40 orders and 4 images through the services about 1–2 s.

When the address service hangs, each venue waits for `CensusGeocoder`'s 5-second limit and is saved not
verified (`demo-data.ts`'s `saveUnverified` option, `013` research R14), so a reset can take about 10 s
more; the output says the addresses were not verified. A reset offline does not change the time zone:
both venues are in Kentucky, Eastern by address or by default. The test measures the wipe alone
(under 1 s) and the whole reset against the fake geocoder (under 10 s), not the network.

## R10. A running Backend, and two resets at once

**Decision**: the wipe sets `lock_timeout` to 3 seconds inside a Prisma transaction allowed 15 seconds
(`timeout: 15_000`) and 5 seconds to get a connection (`maxWait: 5_000`), so the lock wait always ends
first. The `LOCK TABLE … IN ACCESS EXCLUSIVE MODE` of R2 waits for transactions in flight (each a few
milliseconds); if the database stays busy past 3 seconds, the transaction fails and is rolled back,
nothing is removed, and the reset says "the database is busy; try again" (exit 1). That message is
given for PostgreSQL's `55P03` (lock not available), `40P01` (deadlock detected), and Prisma's `P2028`
(the transaction could not start or expired), whichever surfaces; any other error is reported as
itself. A test holds `LOCK TABLE "Event" IN ACCESS SHARE MODE` from a second client in an open
transaction and checks the reset refuses as busy with a marker row still there (tasks T006).

The running Backend keeps working: requests for removed rows get its usual not-found answers; the
hold sweeper finds nothing to sweep; a seat-map stream for a removed event stops getting changes.
Open pages show their last state until reloaded, hence FR-014's reminder.

Two resets at once: the second's wipe waits for the first's (or removes what the first loaded so
far); one of them then fails, finding the demo venue missing mid-load or already present. `runDemoData`
returns `created: false` when the demo venue exists, and the reset treats that as FR-013's "another
reset ran at the same time; run it again" (exit 1). Any other failure reports the same way. No lock
is added: it is one person's laptop, and one more run fixes it.

## R11. Output

**Decision**: plain lines, for example:

```text
Resetting localhost:5432/queuepass to the demo state.
Removed: 3 venues, 2 seating sections, 9 events, 11 tiers, 0 section tiers, 6 images, 47 orders,
  131 tickets (52 checked in), 1 seat reservation, 4 seat holds.
Created: 2 venues, 5 events (Holiday Gala cancelled, Season Opener over), 53 orders, 121 tickets
  (24 checked in), 4 images. Demo Tonight is open for check-in until 9:14 PM EST.
Done in 3.2 s. Reload any open app. Purchase attempt limits counted before the reset clear within a
minute, or when the Backend restarts.
```

When the address service could not be reached: one more line, as `demo-data.ts` prints today. The
labels come from a map of table names to words; a table not in the map is printed by its name, so a
new table still shows. The checked-in count among removed tickets comes from one `count` with
`checkedInAt IS NOT NULL` before the wipe. Demo Tonight's closing time is shown in the Hall's zone
with `@queuepass/shared`'s formatting.

## R12. Tests (Constitution VI)

**Decision**:

- **Backend, Jest with Testcontainers** (`backend/test/integration/demo-reset.e2e-spec.ts`, new):
  - a database filled with extra data through the services and direct writes (a venue with sections,
    an event with tiers and section tiers, an image, orders, an admitted ticket, a live seat hold and
    an ended one), then `runDemoReset`: every table but `_prisma_migrations` holds only demo rows,
    and the fingerprint (below) equals that of a reset of an empty database (SC-001);
  - two resets in a row give equal fingerprints (SC-003);
  - the past event is over, has no tickets, and doors at its start minus 1 hour; Demo Tonight's window
    is open (FR-007);
  - the removed counts printed match what was there; the created counts match the summary (FR-012);
  - the wipe takes under 1 s and the whole reset under 10 s with the fake geocoder (SC-002);
  - `assertMigrated` refuses a schema without `_prisma_migrations` (a second database in the same
    container), one missing a migration row, and one with a failed migration; nothing removed (FR-010,
    SC-005);
  - `_prisma_migrations` still holds every row after a reset (FR-005);
  - a failure while loading the demo data (the demo venue inserted between wipe and load through a
    test hook, so `runDemoData` returns `created: false`) is reported as FR-013 says.
- **Backend, Jest unit** (`backend/test/unit/demo-reset-guard.spec.ts`, new): `checkResetAllowed` with
  the permission absent, `0`, `true`, ` 1`, `1`; hosts `localhost`, `LOCALHOST`, `127.0.0.1`, `[::1]`,
  `database` inside a container (accepted) and outside one (refused), `db.example.com`, `10.0.0.5`,
  `127.0.0.2`, `localhost.example.com`; query keys `host=`, `HOST=`, `h%6Fst=`, and `hostaddr=`; a
  missing and an unreadable `DATABASE_URL`; the returned `host:port/database` has no
  password (FR-009, FR-011, SC-004). And `main()` with a refused guard never constructs the Nest
  application context (a spy on the factory).
- **Root scripts** (`scripts/test/run-host.test.mjs`): `--print --demo-reset` lists exactly one step,
  `demo-reset`, with the Backend child's environment and no `QUEUEPASS_ALLOW_RESET` of its own, and no
  children; `--demo-reset --demo-data` is refused; `run()` through `deps` with a missing compiled
  script prints "Build the Backend first" and fails without running the step (FR-002). (`scripts/test/demo-reset-safety.test.mjs`, new):
  `docker-compose.yml`, `e2e/stack/docker-compose.e2e.yml`, `.env.example`, and every workflow under
  `.github/workflows` never contain `QUEUEPASS_ALLOW_RESET` or `demo-reset` (FR-003, SC-007).
- **Fingerprint**: a helper in the test that reads every demo table and maps each row to its
  meaningful fields, dropping identifiers, ticket codes, entry secrets, and `createdAt`/`updatedAt`/
  `checkedInAt`/`cancelledAt`; event times as (local date minus Fall Concert's local date in days,
  local time, duration, doors offset) for the dated events (Fall Concert, Comedy Night, Holiday Gala,
  Season Opener), taking the reference date from the created Fall Concert (`d` + 14) rather than the
  test's clock, so a run across midnight cannot shift it; and for Demo Tonight its duration and doors
  offset only. Separately, each run asserts Demo Tonight's `startsAt − runAt` is more than 59 and at
  most 61 minutes, `runAt` taken just before the reset, so a minute boundary cannot flake it. Image
  bytes as a SHA-256; sorted. Equal fingerprints are SC-001 and SC-003.
- **Browser test** (`e2e/tests/029-demo-checkpoint.spec.ts`, new): R13.

The guard is a pure function, so its cases need no database. The Testcontainers database's host is
`localhost` on Docker Desktop and GitHub's runners, and the integration tests call `runDemoReset`
(after the guard), so they do not depend on it.

## R13. The browser harness loads the demo state through the reset

**Decision**: `scripts/e2e.mjs` runs `docker compose … exec -T -e QUEUEPASS_ALLOW_RESET=1 backend node
backend/dist/scripts/demo-reset.js` in place of the demo data's command, and stops with "the demo
state did not load" when it fails. On the fresh `qpe2e` stack this removes nothing and loads the demo
data, the same state as before plus Season Opener. So every pull request's `e2e` check runs the reset
on the Compose path (host `database` inside the Backend's container, the permission given with
`-e`, never in a Compose file). The harness is the one place that gives the permission without a
person typing it, and only for its own throwaway `qpe2e` stack (spec FR-003).

One browser test, `029 S2: after the reset, the Ticket Booth offers Demo Tonight open and the Customer
app shows Season Opener with sales closed`, checks the demo state a presenter relies on, in the apps.
It reads only demo rows and changes nothing (it does not admit a ticket), so it runs in parallel with
the others. The reset itself is not run by a browser test: removing every row while other tests run in
parallel would break them; it is covered by R12's Backend tests and run once per `e2e` job by the
harness.

No existing browser test reads the demo data (no test names a demo venue or event; each makes its own
with unique names), so the extra past event changes no other test.

**Alternatives**: keep the harness on `demo-data.js` and never run the reset on Compose in CI: the
Compose path (`database` host, `-e`) would be checked only by hand.

## R14. Constitution and README

**Decision**: the spec PR amends the constitution to 3.9.1 (PATCH): roadmap row `029-demo-checkpoint`
and "The next free number is `030`", on top of 3.9.0 (spec `028`, row `028`). No
principle changes: the reset is never run by `docker compose up` (II, VIII), touches no API (I), and
no Keycloak (V). The README gets the `029` status row and v3.9.1 here; the implementation adds a "Demo
checkpoint" section after "Demo data" (both commands, the permission, what is removed and kept, the
demo state, never automatic) and points the Demo Tonight paragraph to it (FR-015).
