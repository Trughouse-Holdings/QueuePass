# Research: Names on Tickets and Gate Check-In

Decisions behind [plan.md](./plan.md). Each one names the spec requirements it serves.

## R1: The holder's name lives on the order

**Decision**: `Order.holderName` (`TEXT`, nullable). Every ticket of an order shows its order's
name. `NULL` means an order placed before this feature ("No name on ticket", FR-005).

**Rationale**: The user decided one name per order, the buyer's, never changed (FR-001, FR-001a).
Storing it once per order makes "every ticket of the order carries the same name" true by
construction, with no way for two tickets of one order to disagree.

**Alternatives considered**: a column on `Ticket` (repeats the value up to 10 times, and a bug
could make them differ); a separate table (a join for no gain).

## R2: What a valid name is, and where it is checked

**Decision**: one function, `holderNameProblem(raw)` in `packages/shared/src/holder-name.ts`, used
by both the Backend and the Customer app, so the form and the server never disagree. It trims
leading and trailing white space (JavaScript `trim`, which covers Unicode spaces), normalizes to
NFC, and then refuses, in this order:

| `reason` | When |
|---|---|
| `MISSING` | absent, or empty after trimming |
| `TOO_LONG` | more than 100 characters, counted as Unicode code points (`[...name].length`, the same unit as PostgreSQL's `char_length`) |
| `CONTROL_CHARACTER` | any `\p{Cc}` (tabs, newlines, NUL, …) |
| `NO_LETTER` | no `\p{L}` (a letter in any script) |

Inner runs of spaces are kept as typed (FR-003). The Backend stores the trimmed, NFC form.

The Backend checks it in `OrdersService.create` **before** taking the event lock, and refuses with
`400 HOLDER_NAME_INVALID` and `details.reason` (FR-002). The DTO declares `holderName` as an
optional string of at most 400 characters (a bound on the request only), so a missing name reaches
the service and gets `HOLDER_NAME_INVALID` with `MISSING`, not a generic `VALIDATION_FAILED`.

A repeated `requestId` (spec 006 FR-005) compares the stored name with the normalized one sent: a
different name is `409 REQUEST_ID_REUSED`, like a different quantity.

The database backs this up with a CHECK (data-model.md): `NULL`, or 1 to 100 characters with no
leading or trailing space. "Required for new orders" stays a Backend rule: the database can't tell
an old order from a new one without a date cut-off, which would be a fragile constraint.

**Alternatives considered**: `class-validator` rules on the DTO (they answer `VALIDATION_FAILED`,
and FR-002 asks for its own code); a Latin-only pattern (refuses real names, Edge Cases); counting
UTF-16 units (disagrees with PostgreSQL's count on emoji and many scripts).

## R3: An entry lives on the ticket

**Decision**: the existing `Ticket.checkedInAt` becomes the time of the ticket's one entry
(spec Key Entities). Two new nullable columns record who admitted it: `checkedInBySub` (the gate
agent's Keycloak subject identifier, Constitution V) and `checkedInByUsername` (a display copy of
`preferred_username`, as `Order.customerUsername` is). A CHECK requires both agent columns
together, and only with a `checkedInAt`. A `checkedInAt` without an agent stays allowed: demo
check-ins made before this feature have none.

**Rationale**: "At most one entry per ticket" (FR-015, FR-018) is then a property of the row: a
ticket has one `checkedInAt` or none. Reports and attendee lists (spec 005) already read
`checkedInAt`, so they show real entries with no change to their queries (FR-020).

**Alternatives considered**: an `Entry` table with a unique `ticketId` (the same guarantee, plus a
join in every report, and two places for one fact).

## R4: Exactly once, under any number of simultaneous admits

**Decision**: an admit is one conditional `UPDATE … RETURNING` statement (run with `$queryRaw`):

```sql
UPDATE "Ticket" t
SET "checkedInAt" = now(), "checkedInBySub" = $sub, "checkedInByUsername" = $username
FROM "Event" e
WHERE e."id" = t."eventId"
  AND t."eventId" = $eventId
  AND <t."id" = $ticketId, or t."orderId" = $orderId for wholeOrder>
  AND t."status" = 'VALID'
  AND t."checkedInAt" IS NULL
  AND now() >= e."startsAt" - interval '2 hours'
  AND now() < e."endsAt"
RETURNING t."id", t."code", t."checkedInAt";
```

Under PostgreSQL's default READ COMMITTED, an `UPDATE` that finds a row being updated by another
transaction waits for it, then re-checks its `WHERE` against the committed version of the row. The
second admit then sees `checkedInAt IS NOT NULL` and updates nothing. So of N simultaneous admits
for one ticket, exactly one updates it, guaranteed by the database's row lock (Constitution IV),
with no read-then-write race in the application. When nothing is returned, a follow-up `SELECT`
of the ticket names the reason (R5) for `409 ENTRY_REFUSED`.

`wholeOrder` admits every ticket of the order that still matches the same predicate, each row
under the same rule; tickets of that order that a racing gate admitted first are reported in
`alreadyUsed`, and the request succeeds if it admitted at least one (FR-015a, Edge Cases).

**Interaction with cancellation**: `cancelEvent` voids tickets under the event lock (spec 005).
An admit racing it waits on the ticket row, re-checks `status = 'VALID'`, and admits nothing if the
cancel committed first. An admit that committed first keeps its `checkedInAt`: cancelling sets
`status`, never clears the entry (Edge Cases).

**Tests**: 20 genuinely simultaneous admits of one ticket from different agents (SC-001); a
`wholeOrder` racing single admits of the same order's tickets, counting exactly one entry per
ticket; an admit racing `cancelEvent`.

**Alternatives considered**: taking the event lock (correct, but makes every gate of a busy event
wait on every other for no gain); `SELECT … FOR UPDATE` then `UPDATE` (two round trips for what one
statement guarantees).

## R5: The entry window and the order of reasons

**Decision**: a ticket can be admitted in `[startsAt - 2 hours, endsAt)`, half-open like every event
window in the contract, on the **database's** clock (`now()`), as spec 015 R3 chose for holds: one
clock for every gate. The lookup computes its `state` in one `SELECT` with the same `now()`, and
the admit puts the window in its `WHERE` (R4), so a ticket can't be admitted a moment after its
lookup said "not open", or the reverse, because of two clocks.

When several reasons apply, the lookup and the refusal give the first in this order, so the agent
hears the most useful one:

1. `VOID`: cancelled and refunded, at any gate. A void ticket gets no one in anywhere. Today
   tickets are void only because their event was cancelled, and the Ticket Booth app never offers
   a cancelled event as the gate (FR-007), so putting `OTHER_EVENT` first would hide this reason
   behind "another event" and US3 scenario 2 could never be seen.
2. `OTHER_EVENT`: wrong gate (the ticket's event is named).
3. `USED`: with `usedAt`.
4. `NOT_OPEN` (with `entryOpensAt`) or `ENDED`.
5. Otherwise `ADMITTABLE`.

An unknown or malformed code is `404 TICKET_NOT_FOUND`; an unknown event is `404 NOT_FOUND`.

**Tests**: boundaries on both sides (Constitution VI) with events placed relative to the
database's `now()`: 30 seconds before and after `startsAt - 2 hours`, and before and after
`endsAt`. The margin keeps the tests from failing on a slow run.

## R6: Two new operations, and none for listing events

**Decision**:

- `lookupEntryTicket`: `POST /events/{id}/entry/lookup`, body `{ code }`. The code goes in the
  body, not the path, so it stays out of access logs; it is normalized (upper case; spaces and
  dashes removed) like the gate agent's typing (FR-008). A ticket that exists is always `200` with
  a `state` (R5); refusal states are information to show, not errors.
- `admitTicket`: `POST /events/{id}/entry/admit`, body `{ ticketId, wholeOrder }`, after a lookup.
  `200 EntryResult` when it admitted at least one ticket; otherwise `409 ENTRY_REFUSED` with the
  reason.

Both are `gate-agent` only (FR-016); the role guard refuses everyone else with `403`, and the
route-coverage test checks the roles against the contract. A refused ID check calls nothing
(FR-017: no record).

The Ticket Booth app lists events to choose from with the existing `listEvents` (any signed-in
user), keeping scheduled events that have not ended (FR-007).

**Alternatives considered**: `GET /tickets/{code}` (the code in the URL and logs); one combined
"scan and admit" call (the agent has to see the name and check the ID first, FR-014); a
gate-agent event list (`listEvents` already serves it).

## R7: The contract lands before the code, and `main` stays green

**Decision**: contract **1.10.0** in this spec and plan PR, with `api-schema.ts` regenerated:

- the two new operations marked `x-planned: '017'`, which the route-coverage test requires to be
  unserved until the implementation removes the markers (spec 015 R12, spec 014 R8);
- `OrderInput.holderName` declared but not in `required`, and `Order.holderName` declared but not
  in `required`, until the implementation adds both (spec 016 R9). Today's Customer app and tests
  send no name, so requiring it now would turn `main` red;
- `HOLDER_NAME_INVALID`, `TICKET_NOT_FOUND`, and `ENTRY_REFUSED` added to `ErrorEnvelope` and to
  `ERROR_CODES` in `packages/shared/src/errors.ts` now, since `us-states.spec.ts` compares the two
  (spec 015's lesson from #38).

## R8: The printed QR code

**Decision**: the Customer app draws the QR code itself with **`qrcode-generator` 2.0.4** (MIT, no
dependencies). It encodes the 12-character ticket code and nothing else (FR-012, FR-013). Every
symbol of the code is in QR's alphanumeric set, so with error correction level M it fits the
smallest QR size (21 × 21 modules), which scans easily from paper or a screen. The component
builds one SVG `<path>` from the generator's module matrix: no HTML strings, and it prints sharply
at any size.

The printable view is a new route, `/my-tickets/:ticketId/print`, reached from a **Print ticket**
link on each valid, unused ticket on **My tickets** (US5). It reads `listMyOrders`, so it shows only
the caller's own tickets. It shows the QR code, the code in text (for typing at the gate), the
holder's name, the event, venue, start time, and seat, and a **Print** button that calls
`window.print()`. Print rules in the Customer app's stylesheet hide the app header and navigation;
they use theme values only, so the drift check passes (Constitution VII).

**Alternatives considered**: `qrcode` 1.5.4 (three dependencies, including a command-line parser);
`uqr` (a 0.x release); a Backend endpoint returning an image (a new operation and a Backend
dependency for what the browser can draw).

## R9: Scanning with the camera

**Decision**: the Ticket Booth app decodes with **`jsqr` 1.4.0** (Apache-2.0, no dependencies),
which works the same in every browser. `getUserMedia({ video: { facingMode: 'environment' } })`
opens the back camera where there is one, else the webcam. About 6 times a second, a frame is drawn
to an off-screen canvas at most 640 pixels wide and passed to `jsQR` (`inversionAttempts:
'dontInvert'`, which is faster, since printed codes are dark on light).

A decoded value is normalized like typing (R6). If it is a ticket code, scanning stops and the
lookup runs with no further tap (US5 scenario 3). Anything else shows "Not a QueuePass ticket" once
per distinct value, and scanning continues (US5 scenario 6). The camera's tracks are stopped as soon
as a code is read, when the agent leaves scanning, and when the screen unmounts.

No camera, or camera access refused, shows a plain message, and the typed code still works (US5
scenario 5). The camera and the decoder sit behind two small modules (`camera.ts`, `decode.ts`),
so tests stub them and never need a real camera.

**Alternatives considered**: the browser's `BarcodeDetector` (missing in Safari, Firefox, and
Chrome on Windows); `@zxing/browser` (larger, with more dependencies, for formats the gate doesn't
use).

## R10: A phone's camera, as an optional step

**Decision**: the required demo scans with the laptop's webcam, which works at
`http://localhost:5175` because browsers treat `localhost` as a secure origin (FR-009a). The
optional phone step in the README uses **Chrome's USB port forwarding** on an Android phone: in
desktop Chrome's `chrome://inspect`, forward the phone's ports 5175, 8080, and 3000 to the laptop's.
The phone then opens `http://localhost:5175`, which is a secure origin on the phone too, so the
camera works. The token issuer (`http://localhost:8080/realms/queuepass`, which the Backend checks),
the Keycloak redirect URIs, and the Backend's CORS origins are all unchanged. Nothing is added to
`docker compose up`.

The spec's FR-009a said "a phone on the same network". USB forwarding is the only way found that
gives a phone a secure origin without changing the issuer, the redirect URIs, or the services, so
this plan rewords FR-009a to "a phone connected to the laptop". iPhones are not covered: Safari has
no port forwarding. The README says so.

**Alternatives considered**:

- An HTTPS reverse proxy on the laptop's network address: tokens would carry another issuer, which
  the Backend refuses; Keycloak would need another hostname, redirect URIs, and web origins
  (exactly what #60 is tightening); the phone would have to trust a self-signed certificate; and it
  adds a service (Constitution II, VIII).
- Chrome's "treat insecure origin as secure" flag on the phone: the same issuer and redirect URI
  problems, since the phone would reach Keycloak and the Backend by the laptop's address.
- A public tunnel: sends sign-in and ticket traffic through an outside service.

## R11: The Ticket Booth app

**Decision**: one screen, no router, three parts:

1. **Event**: a list of scheduled events that have not ended (from `listEvents`), soonest first.
   The choice is kept in `sessionStorage` for the tab, so signing in again after the session
   expires keeps it (Edge Cases); a missing or failed storage read just asks again.
2. **Ticket**: a code field with a **Look up** button, and a **Scan** button that opens the camera
   panel (R9).
3. **Result**, in an `aria-live` region that stays until the next lookup (FR-024): the event, ticket
   type (or "General admission" at the base price), seat, holder's name or "No name on ticket",
   and either the refusal reason with no **Admit** (FR-011), or the ID-check prompt ("Check a
   government-issued photo ID that shows: Jordan Lee") with **Admit**, **Admit all N** when
   `unusedOnOrder` > 1 (FR-015a), and **Refuse**. Buttons are disabled while a request is in
   flight; a double tap is safe anyway (R4).

The app imports the shared theme and adds only layout rules that use theme values (FR-022,
Constitution VII; the drift check already scans `booth-app/src`). Every state has a word and a
symbol (✓ Admitted, ✕ Not admitted), not color alone (FR-023). The theme's buttons are already
44 pixels high. The hello-world greeting is removed from the app; `getBoothHello` stays served and
tested, since the contract still declares it.

## R12: Customer app, Admin app, and reports

- **Get tickets**: a **Name on tickets** field above the confirm button: "Your name, as on the
  photo ID you'll show at the gate. It goes on every ticket." Confirm is disabled until
  `holderNameProblem` returns nothing (R2); a Backend `HOLDER_NAME_INVALID` is shown with the
  customer's choices kept (Constitution IV).
- **My tickets**: each order shows "Name on tickets: Jordan Lee" or "No name on ticket", and each
  valid, unused ticket gets **Print ticket** (R8). "Used" already shows the time (FR-021).
- **Admin attendee list**: a **Name on tickets** column; "No name on ticket" for older orders; and
  the time of entry on each checked-in ticket (today the list says only "✓ checked in", without
  the time). The checked-in counts already come from `checkedInAt` (FR-020).
- **Sales report**: no change. It already counts valid tickets with a `checkedInAt`, so real entries
  appear there (SC-005).

## R13: Demo data

- Every demo order gets a holder's name, from a fixed list of 20 sample names keyed by the demo
  customer's number (FR-006).
- A new demo event, "Demo Tonight", at Demo Riverside Hall, starts 1 hour after the demo data loads
  and ends 4 hours after, so its entry window is open at once (FR-006). It is at least 60 minutes
  from every other event at that venue (spec 002's buffer). It has orders with unused tickets,
  including one order of 4 tickets for **Admit all 4**.
- The demo check-ins that spec 005 makes directly in the database also record `demo-agent1` /
  `agent1` as the agent, so the attendee list looks like real entries.

## R14: Testing

Tests precede code in `tasks.md` (Constitution VI).

- **Backend (Jest, Supertest, Testcontainers)**: lookup states and their order (R5); admit and
  `wholeOrder`; window boundaries on both sides; the 20-way race (SC-001); `wholeOrder` against
  single admits; admit against `cancelEvent`; `401`/`403` for customers, admins, and no token on
  both operations; holder-name rules and boundaries (100 and 101 code points, emoji, combining
  marks, a name of only spaces, a tab), the replay rule, the CHECK constraints; every response
  checked against the contract.
- **Shared (Vitest)**: `holderNameProblem` table tests.
- **Customer app (Vitest, React Testing Library)**: the name field and its errors; My tickets'
  names and **Print ticket**; the print view, including that the QR matrix encodes the code.
- **Ticket Booth app**: event choice and its memory; typed lookup; each refusal message; Admit,
  Admit all, Refuse; a scanned code (stubbed decoder) and a non-ticket QR; camera refused; the live
  region.
- **Admin app**: the attendee list's name column.
- **Running system**: [quickstart.md](./quickstart.md) with the webcam, two gate agents, and a
  customer.
