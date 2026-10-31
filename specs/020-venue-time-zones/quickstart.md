# Quickstart: Validating Venue Time Zones

**Superseded in part by `024`** ([spec](../024-venue-form-simplify/spec.md#superseded-requirements),
#107): the Admin app's Time zone select has no "work it out" choice and no split-state question; the
admin picks the zone (S3, S4). `024`'s quickstart walks the new behavior. The text below is this
feature's walk as built.

The running-system gate for `020` (Constitution VI, quality gate 5), repeated as Mahdi asked
(2026-10-24): the migration on a copy of real data first (S1), then the browser walk for **two
venues in different zones** and **DST-boundary dates**, each under **two browser time zones**.

```bash
npm run ci                    # format, lint, build, npm test (UTC), coverage report
npm run test:tz               # every front-end and shared suite, and the Backend's unit tests,
                              # in America/New_York, UTC, America/Los_Angeles, Pacific/Honolulu
```

Use a normal window for the Admin app (http://localhost:5173, `admin1` / `test123`), a private
window for the Customer app (http://localhost:5174, `customer1` / `test123`), and a third for the
Ticket Booth app (http://localhost:5175, `agent1` / `test123`). The laptop must be online for new
addresses (S3–S5, the Census Geocoder, as in `013`).

**Two browser zones: done by Mahdi, by hand.** The implementing session walks every step in the
laptop's own zone (America/New_York). The second and third browser zones are set by **Mahdi** in
Chrome, without changing the laptop's zone: DevTools → ⋮ → More tools → Sensors → Location →
"Other…", timezone ID `UTC`, reload, repeat the marked steps; then `America/Los_Angeles`. The
session's browser tools have no time-zone emulation, and the laptop's Windows zone is a system
setting the session must not change (research R21). The automated runs under four zones
(`npm run test:tz`) carry the main proof; this hand check confirms it on the running system. Steps
marked **(two zones)** are repeated this way, and Mahdi's results are recorded in tasks.md T053.

## Two ways to run the system (research R21)

**A. Where images build**: `docker compose up --build` (S2 onward as written).

**B. Host-run path**, where the image build fails (on this laptop, containers cannot reach package
servers: `011` T028 recorded "TLS: server certificate not trusted" at `apk add`). It runs on its
**own compose project and volumes**, `qp020gate`, so the team's database is never migrated in place
(a pre-020 Backend cannot create venues once the migration has run) and no one else's containers
are touched. The ports (5432, 8080, 3000, 5173–5175) and Keycloak's fixed hostname are shared, so
**agree a time with whoever is using the stack** (for example the session implementing another
feature against it), then stop `main`'s stack first. From PowerShell:

```powershell
# 1. In the checkout that runs main's stack: stop it, keeping its data.
docker compose stop

# 2. In this branch's checkout: the gate's own database and Keycloak, from existing images.
docker compose -p qp020gate up -d database keycloak
npm ci
node scripts/run-host.mjs --backend-tz America/Los_Angeles
#   builds packages/shared; prisma generate; prisma migrate deploy; seeds Keycloak; builds and
#   starts the Backend (start:prod) and the three apps (vite on 5173, 5174, 5175), each child with
#   its full environment (DATABASE_URL, OIDC_*, CORS_ORIGINS, ADDRESS_GEOCODER_URL, TZ; and
#   VITE_API_BASE_URL, VITE_OIDC_AUTHORITY, VITE_OIDC_CLIENT_ID per app), output prefixed by name;
#   waits for http://localhost:3000/health; Ctrl+C stops all four.
#   --demo-data also loads demo data once the Backend is built.

# 3. Afterwards: remove the gate project with its volumes, then restart main's stack.
docker compose -p qp020gate down -v
#   (in the main checkout) docker compose start
```

`scripts/run-host.mjs --print` prints each child's command and environment without starting
anything (T058). With path B, record T013's image build as "to do where images build". S2's
container ICU check runs in a plain `node:22-alpine` container if that image is in the local cache
(`docker run --rm node:22-alpine node -e "…"`, the same ICU data as the Backend image); otherwise it
is recorded "to do where images build". S2's host check always runs.

Addresses and coordinates below were checked against the live service on 2026-10-24 (research R1).

## S1: The migration on a copy of real data (US7, SC-001, research R21)

Before switching the stack to the implementation branch, with `main`'s stack running and holding
its usual data (demo data plus anything the team created):

The names are `docker-compose.yml`'s defaults (service `database`, user, password, and database
`queuepass`). Keep the dump outside the repository (here `$SCRATCH`, any temporary folder):

```bash
docker compose exec -T database pg_dump -U queuepass -Fc queuepass > "$SCRATCH/qp-before.dump"
docker run -d --name qp020-copy -e POSTGRES_USER=queuepass -e POSTGRES_PASSWORD=queuepass \
  -e POSTGRES_DB=queuepass -p 55432:5432 postgres:17-alpine
docker exec -i qp020-copy pg_restore -U queuepass -d queuepass < "$SCRATCH/qp-before.dump"
docker exec qp020-copy psql -U queuepass -d queuepass -Atc \
  'SELECT count(*), md5(string_agg(id::text || "startsAt"::text || "endsAt"::text, $$,$$ ORDER BY id)) FROM "Event"'
```

Record the count and checksum. Then, from the implementation branch:

```bash
DATABASE_URL=postgresql://queuepass:queuepass@localhost:55432/queuepass \
  npx prisma migrate deploy --schema backend/prisma/schema.prisma
```

**Expect**: the migration applies once; the count and checksum query give the same values as before;
`SELECT DISTINCT "timeZone", "timeZoneSource" FROM "Location"` is one row,
`America/New_York | DEFAULT`; `SELECT condeferrable FROM pg_constraint WHERE conname =
'event_no_overlap'` is `t`; running `migrate deploy` again changes nothing. Remove the copy
(`docker rm -f qp020-copy`) and the dump.

## S2: The stack starts with the new data and ICU zones (US7)

Path A: `docker compose up --build`. **Expect**: every service healthy; the Backend log shows the
migration applied. Then:

```bash
docker compose exec backend node -e "console.log(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date('2026-10-01T23:00:00Z')))"
```

**Expect**: `7:00 PM EDT` (the Alpine image's ICU knows the zones). Path B: the migration applied
by `run-host.mjs`; the same `node -e …` on the host, and in `docker run --rm node:22-alpine` if
that image is cached, prints `7:00 PM EDT`. The demo venues' pages say
"Time zone: Eastern Time, the default" (or "from the address" on a fresh database with demo
data loaded online).

## S3: A verified address gets its zone from the address (US4, FR-002)

As `admin1`, **Venues → New venue**: "Phoenix Test Hall", "201 E Jefferson St", "Phoenix",
Arizona, "85004", capacity 500, time zone left at "Work it out from the address". Save.
**Expect**: "Venue saved. Address: 201 E JEFFERSON ST, PHOENIX, AZ 85004. Time zone: Arizona Time
(no daylight saving), from the address." The list's Time zone column says
Arizona Time (no daylight saving), from the address.

Repeat with "1701 Bryant St", "Denver", Colorado, "80204" ("Denver Test Hall"). **Expect**:
Mountain Time, from the address.

## S4: An address saved anyway (US4, FR-003)

New venue "KFC Yum! Center", "1 Arena Plaza", "Louisville", Kentucky, "40202". Save → "couldn't
find" → **Save anyway**. **Expect**: the form says "Kentucky has more than one time zone. Choose
this venue's time zone:" with Eastern and Central, and does not save until one is chosen; choose
Eastern and Save anyway. **Expect**: saved, "Address not verified", "Time zone: Eastern Time,
chosen by an admin."

Then a one-zone state: "1 Nowhere Blvd", "Columbus", Ohio, "43215", Save anyway. **Expect**: no
question; "Time zone: Eastern Time, from the state." Delete both test venues afterwards (they have
no events).

## S5: Entering times in the venue's zone, two venues (two zones) (US2, FR-014, FR-015)

Browser zone **America/Los_Angeles**. **Events → New event**: "TZ Check East" at "Demo Riverside
Hall" (Eastern), Oct 30, 2026, 7:00 PM to 10:00 PM. **Expect** under the fields: "Times are in the
venue's time zone: Eastern Time (EDT)." Save. **Expect**: the event page shows "Oct 30, 2026, 7:00
PM EDT" – "10:00 PM EDT".

New event "TZ Check West", 7:00 PM to 10:00 PM, venue Demo Riverside Hall first, then change the
venue to "Phoenix Test Hall" before saving. **Expect**: the fields still say 7:00 PM and 10:00 PM;
the line now says Arizona Time (MST). Save. **Expect**: "7:00 PM MST".

**(two zones, Mahdi)** Switch the browser zone to **UTC**, reload, and open both events, their edit forms, the event list,
and each venue page. **Expect**: identical text: 7:00 PM EDT and 7:00 PM MST; the edit forms show
19:00 and 22:00.

## S6: Customer and Booth show the venue's time (US1, US6, FR-021, SC-002, SC-003)

In the Customer window (laptop zone; then **(two zones, Mahdi)** America/Los_Angeles and UTC): the Events list cards,
both event pages, and (after buying one ticket for "TZ Check East") My tickets, the live entry code
page, and the printable ticket. **Expect**: every time is "7:00 PM EDT" or "7:00 PM MST" (or the
end times), never 4:00 PM, and the order's "ordered at" time has "EDT".

Filter Events from Oct 30 to Oct 30. **Expect**: both test events are listed (each starts on Oct 30
at its venue), whatever the browser zone.

In the Booth window (laptop zone; then **(two zones, Mahdi)** UTC), pick "TZ Check East"; look up the ticket bought above
before its entry window. **Expect**: "Entry opens at Oct 30, 2026, 5:00 PM EDT". Pick "TZ Check
West" and look up the same ticket. **Expect**: "For TZ Check East on Oct 30, 2026, 7:00 PM EDT,
not this event".

## S7: A skipped time is refused (US3, FR-016, FR-018)

At Demo Riverside Hall, new event, start **Mar 14, 2027, 2:30 AM**, end 4:00 AM. **Expect**: the
form says "2:30 AM on Mar 14, 2027 doesn't exist in Eastern Time: clocks jump from 2:00 AM to 3:00
AM. Choose another time." and nothing is sent (DevTools Network shows no `POST /events`); every
value kept. At Phoenix Test Hall, the same times save normally (Arizona has no daylight saving);
delete that event afterwards (S9 needs the night free).

Straight to the API (Admin window console, with the app's token as in `013`'s quickstart, or
`curl` with a token): `POST /events` with `"startsAt":"2027-03-14T02:30:00-05:00"` at Demo Riverside
Hall. **Expect**: `400 LOCAL_TIME_SKIPPED`. With `"2026-10-30T19:00:00-07:00"`: `400
UTC_OFFSET_MISMATCH`. With `"2026-10-30T23:00:00Z"`: `400 UTC_OFFSET_MISMATCH`.

## S8: A repeated time is asked about (US3, FR-017)

At Demo Riverside Hall, new event "Fall Back Show", start **Nov 7, 2027, 1:30 AM**, end 3:30 AM.
**Expect**: "Which 1:30 AM?" with "1:30 AM EDT (the first time)" and "1:30 AM EST (the second
time)"; Save refuses until one is chosen. Choose EST and save. **Expect**: "Nov 7, 2027, 1:30 AM
EST" – "3:30 AM EST". Open its edit form. **Expect**: EST already chosen. **(two zones, Mahdi)**
Repeat both with the browser zone set to UTC.

## S9: Changing a venue's zone (US5, FR-009–FR-012)

Open Phoenix Test Hall (with "TZ Check West", which has no orders), **Edit**, choose **Mountain
Time**, save. **Expect**: a note before saving that local times are kept; after saving, "TZ Check
West" still shows 7:00 PM, now "MDT" (an hour earlier in UTC), and the venue says "chosen by an
admin". Change it back to Arizona Time: 7:00 PM MST again.

Open Demo Riverside Hall (its events have orders), choose **Central Time**, save. **Expect**:
refused, "tickets have been sold for … of its events", the events listed; nothing changed.

At Phoenix Test Hall, add "Late A" Mar 13, 2027, 11:00 PM to Mar 14, 1:30 AM and "Late B" Mar 14,
3:00 AM to 4:00 AM (90 minutes apart in Arizona). Change the venue to Mountain Time. **Expect**:
refused as a scheduling conflict naming both (30 minutes apart in Mountain time); nothing changed.
Delete "Late A" and "Late B", and add "Late C" from Mar 14, 2027, 2:30 AM to 4:00 AM (a time that
exists in Arizona). Change the venue to Mountain Time. **Expect**: refused, "Late C's start, Mar
14, 2027, 2:30 AM, doesn't exist in Mountain Time."; nothing changed. Delete the test events.

## S10: Reports, attendees, and conflicts (FR-022)

**Reports**: each event's date is its venue's local date; "as of" shows the browser's own zone
abbreviation (PDT under America/Los_Angeles, UTC under UTC). **Attendees** of "Demo Tonight" (its
entry window is open) after admitting one of its demo tickets in the Booth: the "checked in" time is
in Eastern time with "EDT" or "EST", and the Booth's "Already used at" for the same ticket matches. Schedule an event overlapping "TZ Check
East": the conflict line names "7:00 PM EDT – 10:00 PM EDT".

## S11: Demo data on a fresh database (R19)

Two runs on empty databases (a second run on the same database does nothing, by design), done
after S1–S10 and S12, because each run starts from an empty database.

- **Path A**: first stop the gate's stack (`docker compose -p qp020gate stop`; both need ports
  5432, 8080, 3000, and 5173–5175, and Keycloak's fixed hostname). Then, on a separate fresh stack
  with its own project name, `docker compose -p qp020demo up
  --build`, run the demo data script online; then `docker compose -p qp020demo down -v`, start it
  again, disconnect its Backend container from the network, and run the script again. Finally
  `docker compose -p qp020demo down -v`.
- **Path B** (in the gate project, after the rest of the walk): stop `run-host.mjs` (Ctrl+C);
  `docker compose -p qp020gate down -v` and `docker compose -p qp020gate up -d database keycloak`;
  `node scripts/run-host.mjs --backend-tz America/Los_Angeles --demo-data` (online); stop it; `down
  -v` and `up -d database keycloak` again; then `node scripts/run-host.mjs --backend-tz
  America/Los_Angeles --demo-data --geocoder-url http://127.0.0.1:9`, which points the address
  service at a port where nothing listens, so the demo data runs as with the service unavailable.
  End with the path B clean-up (`down -v`, restart `main`'s stack).

**Expect**: both runs succeed; the concert, comedy night, and gala start at 7:00 PM, 8:00 PM, and 7:00 PM
Eastern (EDT or EST by date); online the two venues are Eastern "from the address", offline
Eastern "the default" (research R19).

## S12: Sign in, use, sign out (Constitution VI)

Sign in to, use, and sign out of each of the three apps. Record the results of S1–S12, with both
browser zones, in tasks.md (T052, T053).

## Automation

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`.

| Scenario | Browser test |
| --- | --- |
| S1 | Manual: the migration on a copy of real data |
| S2 | Manual: the stack starting, which every `npm run e2e` does |
| S3 | Manual: the zone from a real address service's match, by hand |
| S4 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| S5 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| S6 | Automated: `020 S6: a customer sees event times in the venue zone, whatever the browser zone`; rest Manual: the live entry code page, the printable ticket, the Booth's entry-window messages, and the America/Los_Angeles and UTC zones, by hand |
| S7 | Automated: `020 S7: a start time the venue zone skips is refused and nothing is sent; an Arizona venue takes it`; rest Manual: the API's own refusals (`LOCAL_TIME_SKIPPED`, `UTC_OFFSET_MISMATCH`), covered by Backend tests |
| S8 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| S9 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| S10 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| S11 | Manual: an empty database; every `npm run e2e` loads the demo data |
| S12 | Manual: sign in, use, and sign out of each front end, by hand |
