# Research: Rotating QR Codes

Decisions behind [plan.md](./plan.md). Each one names the spec requirements it serves.

## R1: Each ticket's entry secret lives on the ticket, made by the database

**Decision**: `Ticket.entrySecret`, `BYTEA NOT NULL DEFAULT gen_random_bytes(32)`, with a CHECK that
it is exactly 32 bytes. `gen_random_bytes` comes from `pgcrypto`, which the migration enables with
`CREATE EXTENSION IF NOT EXISTS pgcrypto` (the official PostgreSQL 17 image ships it, as it ships
`btree_gist`, which spec 002 already enables). Adding the column with a volatile default fills a
different random secret into every existing row, so tickets bought before this feature (including
before `017`) get live codes too (spec Key Entities).

Prisma declares it `Bytes @default(dbgenerated("gen_random_bytes(32)")) @db.ByteA`, so every
existing insert path (orders, demo data, test fixtures) gets a secret with no code change. The
`PrismaService` sets Prisma's global `omit: { ticket: { entrySecret: true } }`, so no query loads
the secret unless it names it in a `select`. Only two places do: the entry-key operation (R5) and
the live-code check (R4).

**Rationale**: 32 random bytes is the HMAC-SHA256 key size. Generating it in the database means no
insert path can forget it and the backfill is one statement. The global omit makes leaking it by an
`include: { tickets: true }` impossible rather than merely unlikely (FR-006).

**Alternatives considered**: `crypto.randomBytes` in the Backend (every insert path changes, and the
backfill needs a script); deriving each ticket's secret from one server-wide key and the ticket id
(a new secret to configure and keep out of the repo, Constitution "Secrets", and one leak exposes
every ticket); `sha256` of two `gen_random_uuid()` values (no extension, but 244 random bits by a
detour; `pgcrypto` says what it means).

## R2: What a live code is

**Decision**:

```text
QP1:<TICKET>:<WINDOW>:<MAC>
```

- `TICKET`: the ticket's UUID as 32 upper-case hex digits, no dashes.
- `WINDOW`: the window number in decimal with no leading zero (`0|[1-9][0-9]{0,11}`),
  `floor(unixMilliseconds / 30000)`. Windows are
  `[WINDOW × 30 s, (WINDOW + 1) × 30 s)` in UTC, the same for every ticket (FR-002).
- `MAC`: the first 10 bytes (80 bits) of `HMAC-SHA256(entrySecret, "QP1:<TICKET>:<WINDOW>")`, in
  RFC 4648 base32 without padding: 16 characters of `A–Z2–7`.

Today's window numbers have 8 digits, so a live code is 62 characters, all in QR's alphanumeric
set (`:` included). At error correction level M that is a version 4 symbol (33 × 33 modules), which
reads easily from a phone screen. It survives the Ticket Booth's normalization (upper case, spaces
and dashes removed, spec 017 FR-008) unchanged, because it has no lower case, spaces, or dashes.

**Why these parts**:

- The **ticket's UUID**, not its 12-character code: a screenshot then gives away nothing that can be
  typed at the gate, and nothing on the printed ticket (which carries the code) helps make a live
  code (FR-006, US3 scenario 3).
- The **window in the code**: the Backend checks the MAC for exactly the window the code claims,
  then checks that window against its clock (R3). It can then tell "made by QueuePass, but old"
  (`LIVE_CODE_EXPIRED`) from "not made by QueuePass" (`LIVE_CODE_INVALID`), which FR-011 needs, with
  one HMAC instead of one per candidate window.
- **80 bits of MAC**: guessing a valid live code is a 1 in 2⁸⁰ chance per try, against 1 in 2⁶⁰ for
  a ticket code (12 symbols of 32, spec 005 research R3), so FR-007 holds with room to spare.
  Earlier codes don't help: HMAC outputs for other messages reveal nothing usable about the key or
  about other windows' MACs (FR-006).
- **`QP1:` prefix**: names the format and its version, and lets the Backend and the Ticket Booth tell
  a live code from a ticket code without the agent choosing (FR-011).

**One implementation for both sides**: `packages/shared/src/live-code.ts` holds the constants
(`WINDOW_MS = 30_000`, `GRACE_MS = 5_000`), `windowAt(ms)`, `liveCode(secret, ticketId, window)`,
`parseLiveCode(text)`, and `windowStatus(window, nowMs)` (R3). `liveCode` uses the Web Crypto API
(`globalThis.crypto.subtle`), which Node.js 22 and every current browser provide, so the Customer
app makes codes with exactly the function the Backend checks them with. The Backend compares MACs
with `crypto.timingSafeEqual`.

**Alternatives considered**: standard TOTP digits (6 to 8 digits is 20 to 27 bits, far weaker than a
ticket code, so FR-007 fails); a signed token (JWT) per window from the Backend (needs a connection
for every code, against FR-010, and the Backend's signing key would become a new secret); the ticket
code in place of the UUID (a screenshot would hand over the typed code).

## R3: Which window is current, and the grace

**Decision**: the Backend accepts a live code for window `w` when

```text
w × 30 s − 5 s  ≤  now  <  (w + 1) × 30 s + 5 s
```

on the Backend's clock: 5 seconds of grace on each side (FR-008, decided 2026-10-23), half-open
like every window in the contract. A code outside that range is `LIVE_CODE_EXPIRED`, whether it is
old or (only possible with a badly wrong clock or an extracted secret) from a window that hasn't
started. A copied code therefore stops working at most 35 seconds after it first appeared.

"The Backend's clock" is an injectable `Clock` (`backend/src/common/clock.ts`: `now(): number`,
default `Date.now()`), so tests set it to the exact millisecond (SC-001). The live-code check is a
pure function of the code and that clock; it guards no concurrent write, so it needs no database
guarantee (Constitution IV applies to the admit, which is unchanged, R6). The entry window stays on
the database's clock (spec 017 research R5). Both run on the same laptop's clock under Docker
Compose; the two checks never compare times with each other.

**The Customer app follows the Backend's clock, not its own** (FR-009): the entry-key response
(R5) carries `serverTime`. The app sets `offset = serverTime − (sent + received) / 2` from its own
clock readings around that request, and computes every window from `Date.now() + offset`. A device
clock that is minutes wrong is corrected exactly; the remaining error is at most half the request's
round trip, which the 5 seconds of grace absorb.

**Tests**: `windowStatus` table tests at `w × 30 s − 5 s` (accepted), one millisecond earlier
(refused), `(w + 1) × 30 s + 5 s − 1 ms` (accepted), and `(w + 1) × 30 s + 5 s` (refused); the same
four instants end to end through `lookupEntryTicket` with the `Clock` overridden (SC-001).

**Alternatives considered**: the database's `now()` (a fake clock in tests would need SQL-level
time travel; the check has no row to protect); trusting the device's clock (FR-009 forbids it).

## R4: Looking up a live code

**Decision**: `lookupEntryTicket` keeps its route and body. When the code, trimmed and upper-cased,
starts with `QP1:`, the Backend takes the live-code path, in this order:

1. **Parse** (R2). Anything malformed is `404 LIVE_CODE_INVALID`.
2. **Load the ticket's secret** by its id (`select: { entrySecret: true, … }`, R1). No such ticket is
   `404 LIVE_CODE_INVALID`: the same answer as a forged MAC. The one difference is time: an unknown
   ticket skips one HMAC, a few microseconds, which at most could tell a signed-in gate agent
   whether a random UUID is a ticket. That helps make no code (the MAC still needs the secret), and
   gate agents already see tickets, so it is accepted.
3. **Check the MAC** for the window the code names, in constant time. A mismatch is
   `404 LIVE_CODE_INVALID`.
4. **Check the window** (R3). Outside it is `409 LIVE_CODE_EXPIRED`, with no ticket details (FR-011,
   clarified 2026-10-23).
5. **Everything else is spec 017's lookup**, by the ticket's id instead of its code: the same SELECT,
   the same state CASE and reason order (VOID, OTHER_EVENT, USED, NOT_OPEN, ENDED), and `200
   EntryTicket`, now with `verifiedBy: 'LIVE_CODE'`.

The MAC is checked before the window, so a forged code is always "not valid", never "expired", and
only a code QueuePass really made can be told apart as old. Any other code takes 017's path
unchanged and answers `verifiedBy: 'TICKET_CODE'` (FR-014).

`verifiedBy` comes from the Backend, not from how the Ticket Booth read the code, so the decision to
skip the ID check rests on the server's verification (Constitution IV: the client's view is a
preview). Nothing is recorded by any lookup (FR-012).

`EntryLookupInput.code` grows from at most 64 to at most 80 characters, so a live code has room
when window numbers reach 9 digits (in 2065, about 40 years from now) and the `QP1:` prefix is
never squeezed.

**Alternatives considered**: a new `lookupLiveCode` operation (two lookups with the same answer
shape and refusal reasons; the Ticket Booth would have to choose, against FR-011's "no choice by the
agent"); returning `200` with a state `EXPIRED` (the response would carry ticket details, which the
clarification rules out).

## R5: How the Customer app gets a ticket's secret

**Decision**: one new operation, `getTicketEntryKey`: `GET /me/tickets/{ticketId}/entry-key`,
`customer` only, answering `200 TicketEntryKey`:

```json
{ "ticketId": "3b8e…", "key": "<43 characters of base64url>", "serverTime": "2026-10-24T22:31:07.412Z" }
```

- Only the ticket's own buyer gets it: the order's customer subject must be the token's `sub`.
  Another customer's ticket, or one that doesn't exist, is `404 NOT_FOUND`, so the operation can't be
  used to learn which tickets exist (FR-003).
- A used or void ticket is `409 ENTRY_REFUSED` (`USED` with `usedAt`, or `VOID`), the reasons and
  shape of spec 017: no live code is offered for it (US1 scenario 6).
- Gate agents and admins are `403`; no or bad token `401` (FR-003, SC-007); an id that is not a
  UUID `400`, as on every route with an id in its path.
- The response is sent with `Cache-Control: no-store`, so no browser or proxy cache keeps the key.
- `serverTime` is the `Clock`'s time (R3), with milliseconds.

The Customer app keeps the key in React state only: never in `localStorage`, `sessionStorage`,
IndexedDB, a cookie, or a URL, exactly as tokens are held (Constitution V; FR-010: nothing is kept
once the app is closed or reloaded). After the one request, making codes needs no network, so a
loaded live code keeps changing with no signal while the page stays open (FR-010), provided the
sign-in around it survives the lost signal too (R12).

The secret reaches the buyer's own browser by design (decided 2026-10-23). A buyer who digs it out
of their own tab and hands it on has handed on the ticket, which still enters once (spec Edge
Cases, accepted risk).

**Alternatives considered**: putting the key on `listMyOrders`' tickets (the `Ticket` schema is
shared with Admin's attendee list, so one mapping slip would send every ticket's secret to admins;
and every page load of My tickets would carry secrets nobody asked for); a key per order (a group
member's phone could then make codes for every ticket of the order, which a per-ticket key does not
allow); one Backend request per window (FR-010 needs codes with no signal).

## R6: Admitting is unchanged

**Decision**: `admitTicket` does not change. The agent presses **Admit** (or **Admit all**) after a
lookup, whichever kind of code it was (clarified 2026-10-23); the same conditional `UPDATE` under
PostgreSQL's row lock admits each ticket at most once (spec 017 research R4), whichever code led to
it (FR-014, FR-015). A live code that expires between the lookup and **Admit** doesn't stop the
admit (spec Edge Cases), because the admit is by ticket id, as in `017`, from a signed-in gate
agent.

**Rationale**: the Backend can't know whether an agent checked an ID for a printed code either; the
gate agent is trusted to follow what the lookup said. Requiring the live code again at admit would
refuse an agent who pressed **Admit** six seconds after the window, with nothing gained, since the
agent already saw the verified result.

**Tests**: 20 genuinely simultaneous admits of one ticket, after lookups by its live code and by its
printed code from different agents, record exactly one entry (SC-004).

## R7: The contract lands before the code, and `main` stays green

**Decision**: contract **1.11.0** in this spec and plan PR, with `api-schema.ts` regenerated:

- `getTicketEntryKey` marked `x-planned: '018'` (the route-coverage test requires it unserved until
  the implementation removes the marker, spec 015 research R12);
- `EntryTicket.verifiedBy` declared (`LIVE_CODE` or `TICKET_CODE`) but not in `required` until the
  implementation adds it, since today's Backend doesn't send it (spec 016 R9, spec 017 R7);
- `EntryLookupInput.code` `maxLength` 80, and its description names both kinds of code. Today's DTO
  still enforces 64 until the implementation; no live code exists before then;
- `LIVE_CODE_INVALID` and `LIVE_CODE_EXPIRED` added to `ErrorEnvelope` and to `ERROR_CODES` in
  `packages/shared/src/errors.ts` now (spec 015's lesson from #38); `lookupEntryTicket` gains a
  `409` and examples for both.

## R8: The live-code screen in the Customer app

**Decision**: a new route, `/my-tickets/:ticketId/entry-code`, reached from **Show entry code** next
to **Print ticket** on each valid, unused ticket of **My tickets** (FR-001). It reads `listMyOrders`
for what to show (as the print view does), calls `getTicketEntryKey` once (R5), then:

- every 250 milliseconds works out the current window from the corrected clock (R3); when the
  window changes, makes the new code (R2) and draws it, so a new code appears well within 1 second
  of its window starting (FR-002, SC-006);
- shows "Changes in 12 s" as text under the code, from the same corrected clock (FR-004);
- shows the holder's name or "No name on ticket", the event's name and start time, and the seat if
  any (FR-001).

The QR code reuses spec 017's `TicketQr`, generalized to draw any alphanumeric text: one SVG path,
black on white with its own quiet zone, so it reads the same in dark mode, and the Ticket Booth's
`dontInvert` decoding still works (spec 017 research R9). It is drawn as large as fits the screen
width, up to 320 CSS pixels (FR-004). Its accessible name is "Live entry code, changes every 30
seconds", not the code itself.

**Accessibility** (FR-004, FR-016, FR-017): the countdown is plain text and is not in a live region,
so a screen reader never hears it tick; new codes are not announced. A static sentence says the code
changes every 30 seconds and the gate scans it. The page uses theme values only and fits 360 CSS
pixels.

**States**: while the key loads, "Getting your entry code…"; no connection on load, "Can't show the
live code without a connection. Use your printed ticket with photo ID.", whether it is
`listMyOrders` or the key request that gets no answer (a reload with no signal fails at the first);
a `409` (used or void),
that reason and no code; any other failure, the standard error state with a **Try again** button
(Constitution IV).

**Alternatives considered**: drawing codes on a `<canvas>` (an SVG path scales without blur and
is what `017` already tests); announcing each new code (30 announcements in 15 minutes, all useless
to a screen reader user, who is better served by the static sentence).

## R9: The Ticket Booth app

**Decision**:

- `normalizeScan` (spec 017 R9) also recognizes a live code: after upper-casing, a value matching
  `^QP1:[0-9A-F]{32}:(0|[1-9]\d{0,11}):[A-Z2-7]{16}$` is passed to the lookup as it is. A decoded
  QR that is neither still shows "Not a QueuePass ticket" and scanning goes on. Typing a live code into the
  code field also works, since the Backend decides (R4); nobody is expected to.
- **A verified live code** (`verifiedBy: 'LIVE_CODE'`, `state: ADMITTABLE`): the result says
  "✓ Live code verified. No ID check needed." in place of the ID-check prompt, shows the holder's
  name, event, ticket type or seat as in `017`, and offers **Admit**, **Admit all N** when
  `unusedOnOrder` > 1, and **Refuse** (FR-011, clarified 2026-10-23).
- **`409 LIVE_CODE_EXPIRED`**: "✕ This live code has expired. Ask for the live code in the
  QueuePass app, or a printed ticket with photo ID." No ticket details, no **Admit** (FR-011).
- **`404 LIVE_CODE_INVALID`**: "✕ Not a valid QueuePass code." (FR-011).
- Every other state and refusal keeps 017's wording, word and symbol, not color alone (FR-016).
- A printed or typed code (`verifiedBy: 'TICKET_CODE'`) gets 017's ID-check prompt, unchanged
  (FR-014).

The result stays in the existing live region until the next lookup (spec 017 FR-024).

## R10: Demonstrating it on one laptop

**Decision**: the quickstart shows the Customer app's live code in one browser window and scans it
with the laptop's webcam through the Ticket Booth app in another, by holding a phone up to the
webcam. The phone's **front (selfie) camera** viewfinder, pointed at the laptop screen, relays the
current code in real time (and shows the accepted risk of a live relay). It has to be the front
camera: the webcam faces the same way as the screen, so with the back camera aimed at the screen
the phone's own screen faces away from the webcam. The front camera's preview is mirrored; jsQR,
which the Ticket Booth decodes with, retries a code mirrored when it fails to read it straight, so a
mirrored code still scans. A **photo** taken with the phone is a screenshot, which is accepted
within its window and grace and refused as expired after.

If the relay won't read, either of these replaces it, with nothing added to the code:

- **A camera aimed at the screen as Gate 1's camera**: on a Mac, an iPhone through Continuity
  Camera, or any USB webcam, chosen as Chrome's default camera at `chrome://settings/content/camera`
  (a site's own settings only allow or block the camera; they don't pick one). The Ticket Booth asks
  for `facingMode: 'environment'`, which a laptop doesn't have, so the browser uses that default
  camera. This scans the Customer window directly; it shows no
  relay, but every other scenario is the same.
- **The Customer app on the phone** (Android only): spec 017 research R10's USB forwarding, with
  port 5174 forwarded as well. The phone then shows its own live code to the webcam.

Nothing is added to `docker compose up`.

## R11: Testing

Tests precede code in `tasks.md` (Constitution VI).

- **Shared (Vitest)**: `liveCode` against fixed vectors computed independently with `node:crypto`'s
  `createHmac` (so a mistake in the Web Crypto path can't hide); `parseLiveCode` round trips and
  rejects (wrong prefix, short MAC, lower-case hex after normalization, non-decimal window);
  `windowAt`; `windowStatus` at the four instants of R3.
- **Backend (Jest, Supertest, Testcontainers)**: a `FakeClock` in `TestContext`, real time unless a
  test sets it. Live-code lookup accepted at both inner edges and refused at both outer edges
  (SC-001); forged MAC, MAC made with another ticket's secret, unknown ticket, malformed, and an
  altered window, each `LIVE_CODE_INVALID`; an expired code for a used ticket still says expired;
  a current code for a used, void, other-event, not-open, or ended ticket gives 017's state;
  `verifiedBy` on both paths; the 20-way race (SC-004). `getTicketEntryKey`: the buyer gets 32 bytes
  and `serverTime` from the `Clock`, `no-store` set; another customer and an unknown id `404`; used
  and void `409`; admin and gate agent `403`; missing, expired, wrongly signed, and wrong-audience
  tokens `401`. The migration: existing tickets get distinct 32-byte secrets, the CHECK refuses
  another length. **No leak**: after creating orders and admitting a ticket, the responses of
  `createOrder`, `listMyOrders`, `listAttendees`, `lookupEntryTicket`, and `admitTicket` contain
  neither the key's base64url nor its hex. Every response checked against the contract.
- **Customer app (Vitest, React Testing Library, fake timers)**: **Show entry code** only on valid,
  unused tickets; the code changes within 1 second of each boundary; the countdown text; with the
  device clock 5 minutes off and `serverTime` correct, every code drawn passes the shared
  `windowStatus` against server time (SC-006); after loading, with every request failing, 10 minutes
  of windows still produce new, correct codes (SC-006, FR-010); no `localStorage` or
  `sessionStorage` write; the load, offline, `409`, and error states; the QR's accessible name; the
  QR matrix decodes to the live code.
- **Shared web (Vitest)**: the `AuthProvider` with the fake user manager: a renewal that fails for
  lack of network keeps the user and doesn't redirect, nor does the token expiring with no error
  before it; the renewal is retried quietly every 30 seconds and on going back online; a `401`
  still signs in again; Keycloak's `ErrorResponse` still ends the session (R12).
  In the Customer app, the live-code page stays mounted through the same events.
- **Ticket Booth app**: `normalizeScan` for live codes; the verified result with no ID prompt and
  with **Admit all**; the expired and invalid messages with no **Admit**; printed and typed lookups
  unchanged (SC-005: 017's tests stay and pass).
- **Running system**: [quickstart.md](./quickstart.md).

## R12: Losing the signal doesn't sign the customer out

**Problem**: every front end shares `AuthProvider` (`packages/shared/src/web/auth-provider.tsx`).
On `silentRenewError` or `accessTokenExpired` it removes the user, renders nothing but "Signing
in…", and redirects to Keycloak (spec 001 FR-013). The realm sets no token lifetime, so Keycloak's
default 5-minute access token applies (spec 001 data-model). With no signal, the renewal a minute
before expiry fails, the redirect unmounts the live-code page, and the key, held in that page's
memory only, is gone: FR-010 and SC-006 (10 minutes with no connection) can't be met.

**Decision**: a renewal that fails for lack of network doesn't end the session, and neither does
the token expiring. Only an error response from Keycloak does. oidc-client-ts 3.5.0 (the installed
version, checked under Node) behaves this way:

- Keycloak answers the renewal with an OAuth error (for example `invalid_grant` once its session
  has ended): `silentRenewError` with an `ErrorResponse`.
- Keycloak can't be reached (connection refused): `silentRenewError` with `fetch`'s `TypeError`,
  then `accessTokenExpired` when the token runs out. The library never tries that renewal again.
- The request hangs: after `silentRequestTimeoutInSeconds` (10 seconds) it is an `ErrorTimeout`,
  which the library retries every 5 seconds with no limit and **never** raises as
  `silentRenewError`. `accessTokenExpired` still fires, with no renewal error before it.

So expiry alone can't be read as "renewal impossible". The provider (tasks T024):

- `silentRenewError` with an `ErrorResponse`: as today, remove the user and sign in again.
- `silentRenewError` with anything else, and every `accessTokenExpired`: keep the current user in
  memory and remember that renewal failed.
- While renewal has failed (and not while logging out), retry it quietly with
  `UserManager.signinSilent()`, the refresh-token grant, which navigates nothing: when the browser
  goes back `online` and every 30 seconds. Success raises `userLoaded`, which applies the new user
  and stops the retries; an `ErrorResponse` removes the user and signs in again; anything else
  waits for the next try. A full-page sign-in on `online` was rejected: a flickering signal at the
  gate would navigate away mid-scan, or land on the browser's offline page, and lose the key.
- A page restored from the back-forward cache with an expired user is treated like
  `accessTokenExpired`; with no user (after logout) it still signs in (SC-007).
- An API call that returns `401` still leads to `signIn()`, as every app already does
  (`customer-app/src/use-load.ts`, `booth-app/src/App.tsx`, `admin-app/src/api/client.ts`). While
  Keycloak's single sign-on session lives, that sign-in comes straight back.

An expired token kept in memory is harmless: the Backend refuses it with `401` (Constitution V), so
nothing is done with it, and the quiet retry or the next `401` renews it.

**Any error other than `ErrorResponse` keeps the user, on purpose**: that includes a captive
portal's HTML page in place of Keycloak's answer (oidc-client-ts's "Invalid response Content-Type")
and the library's response-validation errors. Stadium Wi-Fi behind a portal must not cost the
customer the live code; the retries carry on until Keycloak answers, either way.

**Reading of spec 001 FR-013**: "return the user to the login page when renewal is no longer
possible". A failed network request doesn't make renewal impossible; Keycloak refusing it does.
This amends spec 001's data-model §4, whose transition "refresh fails → `signed-out`" and whose
`signed-in` row ("token valid") are annotated in place: only Keycloak's refusal leads to
`signed-out`, and a user whose refresh failed for lack of network stays `signed-in`, in memory,
with an expired token the Backend refuses, while the refresh is retried quietly.

**Constitution V is unchanged**: tokens stay in memory only (nothing new is written to storage);
logout still ends both the front end's session and Keycloak's; the Backend still validates every
token. `removeUser()` doesn't cancel a renewal in flight (checked under Node with oidc-client-ts
3.5.0): when it answers, the library stores the user and raises `userLoaded`. A renewal that lands
during logout, the library's own or the provider's retry, is dropped and the user removed again,
so logout still ends the front end's session, and Back shows no signed-in page (spec 001 SC-007).

**Scope**: the provider is shared, so the change applies to all three apps. In the Admin and Ticket
Booth apps a lost signal now leaves the page in place until the next request, which shows that
app's own no-connection state, instead of bouncing to a Keycloak page that can't load; once the
signal is back the quiet retry renews the token within about 30 seconds. The seat streams
(`packages/shared/src/web/seat-stream.ts`, used by the Customer app's `GetTickets` and the Admin
app's `SeatingCard`) retry a `401` every 5 seconds and never call `signIn()`; they recover through
the same retry, as soon as the token is renewed.

**Tests**: the shared provider's tests with the fake user manager and fake timers (tasks T016): a
`TypeError` renewal error and `accessTokenExpired` alone each keep the user; the retry runs every 30
seconds and on `online`, stops on `userLoaded`, keeps the user on a `TypeError`, and ends the
session on an `ErrorResponse`; nothing runs while logging out, and a renewal that lands during
logout is dropped; the `pageshow` cases. In the Customer app (T017), the live-code page stays
mounted for 10 minutes through `accessTokenExpired` alone and through the `TypeError` sequence, with
`signinSilent` failing throughout and `signinRedirect` never called. The quickstart (S6) stops
Keycloak as well as the Backend for 10 minutes, which outlasts one access token, and throttles the
Customer window's network to stand for one that hangs.

**Alternatives considered**: a longer access-token lifetime in the realm (it would only move the
cliff, and longer-lived tokens weaken Constitution V's expiry check); keeping the key outside
React (a module variable would survive the unmount, but not the full-page redirect to Keycloak);
signing in again with a full-page redirect on `online` (navigates away mid-scan, see above).
