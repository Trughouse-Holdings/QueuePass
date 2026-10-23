---
description: "Task list for Names on Tickets and Gate Check-In"
---

# Tasks: Names on Tickets and Gate Check-In

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R14),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) →
[`contracts/openapi.yaml`](../../contracts/openapi.yaml) (1.10.0, already applied),
[quickstart.md](./quickstart.md)

**Issues**: [#39](https://github.com/Trughouse-Holdings/QueuePass/issues/39) and
[#40](https://github.com/Trughouse-Holdings/QueuePass/issues/40). The implementation PR says
`fixes #39` and `fixes #40`, each on its own line.

**Tests**: **REQUIRED and written first** (Constitution VI). In each phase, write the test tasks
and confirm they **fail** before the implementation tasks below them.

## Ground rules

- **Fresh session** (Constitution III): implement on branch `017-gate-check-in-impl`, cut from
  `main` after the spec and plan PR merges, in a Claude session that starts from these files only.
  A gap in the spec or plan is fixed there, not worked around in code.
- **Contract**: 1.10.0 is final. The implementation makes only the two changes the plan names:
  remove `x-planned: '017'` from `lookupEntryTicket` and `admitTicket` in the commit that serves
  them (T019), and add `holderName` to `required` in `OrderInput` and `Order` (T034). Regenerate
  `api-schema.ts` after each (`npm run generate:api`). Raise any other gap.
- **One statement per admit** (research R4): the `UPDATE … RETURNING` in R4, run with
  `$queryRaw`. Add no lock, no `lockEvent`, no isolation level, no trigger. The window is in the
  same `WHERE`, on `now()` (R5).
- **Reason order** (R5): `OTHER_EVENT`, `VOID`, `USED`, then `NOT_OPEN` or `ENDED`, else
  `ADMITTABLE`. The lookup and the admit refusal use the same order.
- **Name rule** (R2): only `holderNameProblem` and `normalizeHolderName` from `packages/shared`
  decide what a valid name is. Never write the rule a second time.
- **Never clear an entry**: nothing sets `checkedInAt` back to `NULL` (FR-018). Cancelling sets
  `status`, not `checkedInAt`.
- **Backend tests read `packages/shared` from `dist`**: run `npm run build --workspace
  @queuepass/shared` after changing it.
- **Commit messages** cite the spec and task IDs (Constitution 3.1.0): for example
  `Impl 017: admit statement and refusals (T014–T017, #40)`.

## Phase 1: Setup

- [X] T001 Cut `017-gate-check-in-impl` from an up-to-date `main`, run `npm install`, run
  `npx prisma generate` in `backend/`, and run `npm test` from the repository root. Confirm the
  suite is green before any change (baseline).
- [X] T002 Add the two front-end libraries at exact versions (research R8, R9):
  `npm install --save-exact --workspace @queuepass/customer-app qrcode-generator@2.0.4` and
  `npm install --save-exact --workspace @queuepass/booth-app jsqr@1.4.0`. Confirm
  `node scripts/check-boundary.mjs` still passes and neither package brings dependencies of its own
  (`npm ls qrcode-generator jsqr`).

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the name rule, the shared types, and the three new columns.

- [X] T003 [P] Write `packages/shared/test/holder-name.test.ts`, table tests for research R2:
  `MISSING` for `undefined`, `null`, `''`, `'   '`; `TOO_LONG` at 101 code points and none at
  exactly 100, including 100 × `'😀'` (one code point each, two UTF-16 units); `CONTROL_CHARACTER`
  for a tab, a newline, and `\u0000`; `NO_LETTER` for `'1234'` and `'---'`; no problem for
  `'Jordan Lee'`, `'José Núñez'`, `'李小龙'`, `"O'Brien"`, and `'Ana  María'` (inner double space
  kept). `normalizeHolderName('  Jordan Lee ')` is `'Jordan Lee'`, and `'é'` becomes
  `'é'` (NFC). The check order is `MISSING`, `TOO_LONG`, `CONTROL_CHARACTER`, `NO_LETTER`. Confirm
  it fails.
- [X] T004 Create `packages/shared/src/holder-name.ts` and export it from `packages/shared/src/index.ts`:
  `HOLDER_NAME_MAX = 100`; `type HolderNameProblem = 'MISSING' | 'TOO_LONG' | 'CONTROL_CHARACTER'
  | 'NO_LETTER'`; `normalizeHolderName(raw: string): string` (`trim()`, then
  `normalize('NFC')`); `holderNameProblem(raw: unknown): HolderNameProblem | null`, which
  normalizes first and counts code points with `[...name].length`, letters with `/\p{L}/u`, and
  control characters with `/\p{Cc}/u`; and `holderNameMessage(p: HolderNameProblem): string`:
  `MISSING` "Enter the name on your photo ID.", `TOO_LONG` "The name can be at most 100
  characters.", `CONTROL_CHARACTER` "The name can't contain tabs or line breaks.", `NO_LETTER`
  "The name on the tickets must contain at least one letter." Run T003 until it passes; build
  `packages/shared`.
- [X] T005 [P] Mirror the contract in the shared types. In `packages/shared/src/order.ts`, add
  `holderName: string | null` to `Order` (after `customerUsername`, with a comment citing spec 017
  FR-001) and `holderName: string` to `OrderInput`. Create `packages/shared/src/entry.ts` with
  `EntryState` (`'ADMITTABLE' | 'USED' | 'VOID' | 'OTHER_EVENT' | 'NOT_OPEN' | 'ENDED'`),
  `EntryTicket`, `AdmitInput`, `EntryResult`, and `EntryTicketRef`, field for field as in
  `contracts/openapi.yaml`; export them from `packages/shared/src/index.ts`.
- [X] T006 [P] Write `backend/test/integration/gate-check-in.constraints.e2e-spec.ts`, writing
  directly with `ctx.prisma` (raw SQL where Prisma would trim): `holderName` `''`, `' Jordan'`,
  `'Jordan '`, and 101 characters are refused by `order_holder_name_valid`; 100 characters and
  `NULL` are accepted; `checkedInBySub` without `checkedInAt`, and `checkedInBySub` without
  `checkedInByUsername`, are refused by `ticket_entry_agent`; `checkedInAt` with no agent is
  accepted (demo check-ins from before this feature). Confirm it fails: the columns and CHECKs
  don't exist yet (Constitution VI).
- [X] T007 Add `holderName String?` to `model Order`, and `checkedInBySub String?` and
  `checkedInByUsername String?` to `model Ticket`, in `backend/prisma/schema.prisma`, with the
  comments shown in data-model.md. Create
  `backend/prisma/migrations/<timestamp>_gate_check_in/migration.sql` with exactly the SQL in
  data-model.md: `ALTER TABLE "Order" ADD COLUMN "holderName" TEXT;`, the CHECK
  `"order_holder_name_valid"` (`"holderName" IS NULL OR (char_length("holderName") BETWEEN 1 AND
  100 AND "holderName" = btrim("holderName"))`), the two `"Ticket"` columns, and the CHECK
  `"ticket_entry_agent"` (both agent columns `NULL`, or both set and `"checkedInAt" IS NOT NULL`).
  No backfill, no index. Apply with `prisma migrate deploy` (never `db push`). Run T006 until it
  passes.
- [X] T008 In `backend/test/setup/fixtures.ts`: add `export const HOLDER = 'Test Holder'` — but do
  **not** make `reserveThenOrder` send it yet: until T030 lets the order DTO accept the field, the
  ValidationPipe (`forbidNonWhitelisted`) turns every seated-order test `400`; T031 adds it. Add
  `agent(ctx, n = 1)` returning
  `as(ctx, await tokenFor({ username: 'agent' + n, roles: ['gate-agent'] }))`; add
  `eventAroundNow(ctx, venueId, { startsInSeconds, lastsSeconds, tierId? })`, which reads
  `SELECT now()` from the database and creates the event with `ctx.prisma` at
  `now + startsInSeconds` for `lastsSeconds` (so tests can place events in the past or within the
  entry window, which the API's own rules would refuse), returning its id; and
  `orderWithTickets(ctx, eventId, { quantity, holderName?, customer? })`, which inserts an order and
  its tickets directly (for tickets the API would no longer sell, such as for a started event, or
  an order with no name), returning the order id and the tickets' ids and codes.

**Checkpoint**: shared rule built; columns and constraints in place; nothing served yet.

---

## Phase 3: User Story 1, a gate agent admits a ticket holder once (Priority: P1) 🎯 MVP

**Goal**: type a code, see the ticket and the ID-check prompt, admit it, and find it "already
used" after that. Includes **Admit all** (FR-015a).

**Independent Test**: as `agent1`, choose an event, type a valid code, admit it; type it again and
see "Already used" with the time; the attendee list shows it checked in.

### Tests for User Story 1 ⚠️ write first, confirm they fail

- [X] T009 [P] [US1] Write `backend/test/integration/entry.lookup.e2e-spec.ts` (contract-checked
  `lookupEntryTicket`): an admittable ticket returns every `EntryTicket` field, `state:
  'ADMITTABLE'`, `holderName`, `tierName` (and `null` at base price), `seat` for a seated ticket,
  and `entryOpensAt` = `startsAt` − 2 hours; the code is found in lower case, with spaces, and with
  dashes; `unusedOnOrder` is 4 for a fresh order of 4 and 3 after one of them is admitted; an order
  with no name gives `holderName: null`; a lookup records nothing (`checkedInAt` unchanged); an
  unknown code, `'ABC'`, and `'IIIIIIIIIIII'` (outside the code alphabet) are `404
  TICKET_NOT_FOUND`; an unknown event is `404 NOT_FOUND`; an empty `code` is `400`.
- [X] T010 [P] [US1] Write `backend/test/integration/entry.admit.e2e-spec.ts` (contract-checked
  `admitTicket`): a single admit is `200` with one `admitted` entry and empty `alreadyUsed`; the
  row then has `checkedInAt`, `checkedInBySub` = `subFor('agent1')`, and `checkedInByUsername` =
  `'agent1'`; the next lookup is `USED` with `usedAt`; a second admit is `409 ENTRY_REFUSED` with
  `details.reason: 'USED'` and `details.usedAt`; `wholeOrder: true` on a fresh order of 4 admits 4;
  with one already used it admits 3 and lists the 4th in `alreadyUsed`; it never admits another
  order's tickets, even the same customer's at the same event; a ticket of an order with no name
  (`orderWithTickets`) is admitted once and then refused as used, like any other (SC-007); an
  unknown `ticketId` is `404 TICKET_NOT_FOUND`.
- [X] T011 [P] [US1] Write `backend/test/integration/entry.authz.e2e-spec.ts`: both operations
  answer `401` with no token, an expired token, and a wrongly signed one; `403` for a customer and
  for an admin; and succeed for a gate agent (FR-016, Constitution V).
- [X] T012 [P] [US1] Write `booth-app/test/check-in.test.tsx` with a stubbed `fetch`: the event list
  shows only scheduled events that have not ended, soonest first; the chosen event is kept in
  `sessionStorage` and restored after a remount, and a throwing `sessionStorage` still lets the
  agent choose; a typed lookup shows the event, ticket type, seat, the holder's name or "No name on
  ticket", and the prompt "Check a government-issued photo ID that shows: Jordan Lee" (for no
  name: "Check that the person shows a valid photo ID"); **Admit** posts `wholeOrder: false` and
  shows "✓ Admitted"; **Admit all 4** appears only when `unusedOnOrder` > 1, posts `wholeOrder:
  true`, and shows "✓ 4 admitted", or "✓ 3 admitted · 1 already used at <time>" for a partial
  result; **Refuse** posts nothing and shows "✕ Not admitted"; the buttons are disabled while a
  request is in flight; the result is in a `role="status"` region and stays until the next lookup;
  a `409 ENTRY_REFUSED` from **Admit** is shown as a refusal with its reason; a failed request
  (network error) on a lookup or an admit shows a plain error, records nothing, and re-enables the
  controls (Constitution IV); a `401` on an admit sends the agent to sign in, and the chosen event
  is still there afterwards (Edge Cases).
- [X] T013 [P] [US1] Update `booth-app/test/app.test.tsx`: the hello-world greeting is gone; the
  sign-in gate, the wrong-role refusal, and logout keep their tests.

### Implementation for User Story 1

- [X] T014 [US1] In `backend/src/orders/ticket-code.ts`, export `ALPHABET`. Create
  `backend/src/entry/ticket-state.ts`: `normalizeCode(raw: string): string | null` (upper case,
  remove spaces and dashes, then `null` unless it is exactly 12 symbols of `ALPHABET`); and the
  state rules of research R5 as one SQL `CASE` expression shared by the lookup and the refusal
  query, in the order `OTHER_EVENT`, `VOID`, `USED`, `NOT_OPEN`, `ENDED`, `ADMITTABLE`, comparing
  with `now()`.
- [X] T015 [US1] Create `backend/src/entry/dto/entry-lookup.dto.ts` (`code`: `@IsString()`,
  `@Length(1, 64)`) and `backend/src/entry/dto/admit.dto.ts` (`ticketId`: `@IsUUID('all')`;
  `wholeOrder`: `@IsBoolean()`), mirroring `EntryLookupInput` and `AdmitInput`.
- [X] T016 [US1] Create `backend/src/entry/entry.service.ts`:
  - `lookup(eventId, rawCode)`: `404 NOT_FOUND` for an unknown event; `404 TICKET_NOT_FOUND`
    ("No ticket has the code <normalized>.") when `normalizeCode` is `null` or nothing matches;
    otherwise one `SELECT` joining `Ticket`, `Order`, `Event`, and `TicketTier` that returns the
    `EntryTicket` fields, the state from T014, and `unusedOnOrder` (valid tickets of the same order
    and the ticket's event with `checkedInAt IS NULL`).
  - `admit(eventId, ticketId, wholeOrder, agent: Principal)`: `404` as above for an unknown event
    or ticket; then exactly the `UPDATE … RETURNING` of research R4 (for `wholeOrder`, matching on
    the ticket's `orderId`), setting `checkedInBySub = agent.sub` and `checkedInByUsername =
    agent.username`. If it returns no row, read the ticket's state (T014) and throw
    `conflict('ENTRY_REFUSED', message, details)` with `reason` and, for `USED`, `usedAt`; for
    `OTHER_EVENT`, `event` (`id`, `name`, `startsAt`); for `NOT_OPEN`, `entryOpensAt`. Otherwise
    return `admitted`, and for `wholeOrder` `alreadyUsed`: the order's other valid tickets for the
    event that have a `checkedInAt` and were not admitted now. Messages name no local time (the
    client formats the times in `details`).
- [X] T017 [US1] Create `backend/src/entry/entry.controller.ts` (`@Controller('events/:id/entry')`;
  `@Post('lookup')` and `@Post('admit')`, each `@Roles('gate-agent')` and `@HttpCode(200)`, with
  `ParseUUIDPipe` on `id` and `@CurrentPrincipal()` for the admit) and
  `backend/src/entry/entry.module.ts`; register it in `backend/src/app.module.ts`.
- [X] T018 [US1] Run T009–T011 until they pass.
- [X] T019 [US1] In `contracts/openapi.yaml`, remove `x-planned: '017'` from `lookupEntryTicket`
  and `admitTicket`; run `npm run generate:api`. Run
  `backend/test/contract/route-coverage.e2e-spec.ts` and `node scripts/check-contract-drift.mjs`;
  both pass.
- [X] T020 [US1] Build the Ticket Booth app (research R11):
  - `booth-app/src/main.tsx`: import `@queuepass/shared/theme.css`.
  - `booth-app/src/api.ts`: typed wrappers on `createApiClient` for `listEvents`,
    `lookupEntryTicket`, and `admitTicket`.
  - `booth-app/src/EventPicker.tsx`: scheduled events that have not ended, soonest first; the
    choice in `sessionStorage` under `queuepass.booth.eventId`, every access in `try`/`catch`.
  - `booth-app/src/TicketLookup.tsx`: a labelled **Ticket code** field and **Look up**; it keeps
    focus after each result so the next code can be typed at once.
  - `booth-app/src/EntryResult.tsx`: the ticket, the ID-check prompt, **Admit**, **Admit all N**,
    and **Refuse**, in a `role="status"` region; every state has a word and a symbol (✓, ✕), not
    color alone; times shown with the existing date formatting used by the other apps.
  - `booth-app/src/App.tsx`: compose them under the existing `AuthProvider` and
    `RequireRole role="gate-agent"`, with a header showing the chosen event, **Change event**, and
    `LogoutButton`. Remove `HelloPage` from the app; `getBoothHello` stays served.
  - `booth-app/src/styles.css`: layout only, theme values only (the drift check scans it);
    usable at 360 CSS pixels wide with no horizontal scroll (FR-023).
- [X] T021 [US1] Run T012 and T013 until they pass, then the drift test in `packages/shared`.

**Checkpoint**: typed codes are looked up and admitted once; MVP.

---

## Phase 4: User Story 2, two gates, one ticket, one entry (Priority: P1)

**Goal**: prove FR-015 and FR-015a under genuinely simultaneous requests (SC-001).

**Independent Test**: 20 simultaneous admits of one ticket; exactly one succeeds.

- [ ] T022 [US2] Write `backend/test/integration/entry.concurrency.e2e-spec.ts`, firing requests
  with `Promise.all` as `orders.ticket-limit.concurrency.e2e-spec.ts` does, and failing on any
  `5xx`:
  - 20 admits of one ticket from `agent1`…`agent20`: exactly one `200`, nineteen `409
    ENTRY_REFUSED` with `reason: 'USED'`; the row's `checkedInBySub` is the winner's. Repeat the
    round 5 times on fresh tickets.
  - `wholeOrder` for an order of 4, racing single admits of each of its 4 tickets: every ticket
    has exactly one entry, and the tickets reported as `admitted` across all responses are 4 in
    total, with no ticket twice.
  - An admit racing the admin's `cancelEvent`: the ticket ends `VOID` either way; if the admit won,
    `checkedInAt` is still set; if the cancel won, the admit is `409` with `reason: 'VOID'`.
- [ ] T023 [US2] Run T022 until it passes, without adding any lock (ground rules). If it fails,
  fix the statement of T016, not the test.

**Checkpoint**: one entry per ticket under concurrency, guaranteed by the database.

---

## Phase 5: User Story 3, unusable tickets are refused with a reason (Priority: P1)

**Goal**: every refusal states one reason, in the order of research R5, with no **Admit**.

**Independent Test**: an unknown code, a cancelled event's ticket, a used ticket, and another
event's ticket are each refused with their reason.

- [ ] T024 [P] [US3] Write `backend/test/integration/entry.window.e2e-spec.ts` with
  `eventAroundNow` (research R5, 30-second margins): starting in 2 hours 30 seconds is `NOT_OPEN`
  with `entryOpensAt`, and its admit is `409` with `reason: 'NOT_OPEN'`; starting in 1 hour
  59 minutes 30 seconds is `ADMITTABLE` and admits; ending in 30 seconds admits; ended 30 seconds
  ago is `ENDED` for both operations. Reason order: a used ticket of another event is
  `OTHER_EVENT`; a void ticket that was admitted before its event was cancelled is `VOID` and still
  has its `checkedInAt`; a used ticket of an ended event is `USED`.
- [ ] T025 [P] [US3] Add to `booth-app/test/check-in.test.tsx` one test per refusal, each with no
  **Admit** and a **Look up another** that focuses the code field: `404 TICKET_NOT_FOUND` → "No
  ticket has this code"; `VOID` → "Cancelled and refunded"; `OTHER_EVENT` → "For <event> on
  <date>, not this event"; `USED` → "Already used at <time>"; `NOT_OPEN` → "Entry opens at
  <time>"; `ENDED` → "This event has ended".
- [ ] T026 [US3] Implement the refusal texts in `booth-app/src/EntryResult.tsx`, and make any
  Backend fix T024 needs in `backend/src/entry/`. Run T024 and T025 until they pass.

**Checkpoint**: every refusal explains itself.

---

## Phase 6: User Story 4, every new ticket carries a holder's name (Priority: P1)

**Goal**: one name per order, the buyer's, required on every new order, shown everywhere.

**Independent Test**: buy 3 tickets with a name; all 3 show it on My tickets and the attendee
list; an order without a name is refused with nothing recorded.

- [ ] T027 [P] [US4] Write `backend/test/integration/orders.holder-name.e2e-spec.ts`
  (contract-checked): no `holderName` and `'   '` are `400 HOLDER_NAME_INVALID` with
  `details.reason: 'MISSING'`; 101 code points `TOO_LONG` and 100 accepted; a tab
  `CONTROL_CHARACTER`; `'1234'` `NO_LETTER`; a refusal records no order and no ticket;
  `'  Jordan  Lee '` is stored and returned as `'Jordan  Lee'`; `'José'` is stored as
  `'José'`; a repeated `requestId` with the same name is `200` with the first order, and with a
  different name `409 REQUEST_ID_REUSED`; `holderName` is in the `createOrder` response, in
  `listMyOrders`, and in `listAttendees`; an order inserted without a name (fixture) returns
  `holderName: null`; a seated order (`reserveThenOrder`) carries the name too.
- [ ] T028 [P] [US4] Write `customer-app/test/holder-name-field.test.tsx`: the Get tickets form has
  a field labelled **Name on tickets** with the hint "Your name, as on the photo ID you'll show at
  the gate. It goes on every ticket."; **Confirm** is disabled while `holderNameProblem` returns a
  problem, and the field shows `holderNameMessage` for it once touched; the name is sent as
  `holderName`; a `400 HOLDER_NAME_INVALID` from the Backend is shown as an error with the
  quantity, ticket type, seats, and name kept; the seated flow sends it too.
- [ ] T029 [P] [US4] Update `customer-app/test/my-tickets.test.tsx`: each order shows "Name on
  tickets: Jordan Lee", or "No name on ticket" when `holderName` is `null`.
- [ ] T030 [US4] In `backend/src/orders/dto/create-order.dto.ts`, add `holderName` as
  `@IsOptional() @IsString() @MaxLength(400)` (a missing name must reach the service, research R2).
  In `backend/src/orders/orders.service.ts`:
  - At the top of `create()`, before the transaction: if `holderNameProblem(dto.holderName)` is a
    problem, throw a `400` in the standard envelope with code `HOLDER_NAME_INVALID`, the message
    from `holderNameMessage`, and `details.reason`, built the way `addressRefused` in
    `backend/src/locations/locations.service.ts` builds its `400`s. Otherwise use
    `normalizeHolderName(dto.holderName)` from here on.
  - Store it in `order.create` as `holderName`.
  - In the replay check, add `earlier.holderName === name` to `same`.
  - Add `holderName` to `OrderResponse` and `toOrderResponse`.
- [ ] T031 [US4] Add `holderName: HOLDER` (from `backend/test/setup/fixtures.ts`) to every order
  that existing Backend tests place: the body `reserveThenOrder` sends in
  `backend/test/setup/fixtures.ts` (deferred from T008), and each body posted to `/events/{id}/orders` in
  `backend/test/integration/` (about 35 calls in 23 files; find them with
  `grep -rn 'orders`)' backend/test`). Change nothing else in those tests.
- [ ] T032 [US4] First add to `backend/test/integration/demo-data.e2e-spec.ts` that every demo
  order has a name, and confirm it fails (Constitution VI). Then, in
  `backend/src/scripts/demo-data.ts`, give every demo order a `holderName` from a fixed list of 20
  sample names, indexed by the demo customer's number (research R13), until it passes.
- [ ] T033 [US4] In `customer-app/src/components/GetTickets.tsx`, add the **Name on tickets** field
  above **Confirm** for both general admission and seated orders, validated with
  `holderNameProblem` and `holderNameMessage`, sent as `holderName`, and kept on a refusal
  (Constitution IV). In `customer-app/src/pages/MyTickets.tsx`, show "Name on tickets: <name>" or
  "No name on ticket" on each order.
- [ ] T034 [US4] In `contracts/openapi.yaml`, add `holderName` to `required` in `OrderInput` and in
  `Order`, and remove the two "Required once 017 is implemented" sentences (in `createOrder`'s
  description and in each schema's `holderName` description); run `npm run generate:api`.
- [ ] T035 [US4] Run T027–T029, then the full Backend and Customer app suites, until they pass.

**Checkpoint**: every new order has a valid name, shown to customers and gate agents.

---

## Phase 7: User Story 5, customers print a QR code and agents scan it (Priority: P2)

**Goal**: a printable ticket with a QR code; the Ticket Booth app reads it from the camera.

**Independent Test**: open a ticket's print view, scan it with the webcam, and see the same lookup
as typing its code.

- [ ] T036 [P] [US5] Write `customer-app/test/print-ticket.test.tsx`: **Print ticket** appears on
  My tickets for valid, unused tickets only (not void, not used); `/my-tickets/<ticketId>/print`
  shows an SVG with the accessible name "QR code for ticket <code>", the code in text, the holder's
  name (or "No name on ticket"), the event's name, venue, start time, and the seat if any; **Print**
  calls `window.print` (stubbed); an id that isn't one of the caller's tickets shows "Ticket not
  found"; `qrMatrix(code)` (exported by `TicketQr.tsx`) is 21 × 21 for a 12-character code, and is
  the same matrix `qrcode-generator` makes with type number 0, level `'M'`, and alphanumeric mode.
- [ ] T037 [P] [US5] Write `booth-app/test/scanner.test.tsx`, with `booth-app/src/camera.ts` and
  `booth-app/src/decode.ts` mocked: **Scan** asks for the camera; a decoded ticket code runs the
  lookup with no further tap and stops the camera; a decoded non-ticket value shows "Not a
  QueuePass ticket" once per distinct value and keeps scanning; a `NotAllowedError` shows "Camera
  access was refused. Type the code instead." and the code field still works; no
  `navigator.mediaDevices` shows "This device has no camera. Type the code instead."; unmounting
  and **Stop scanning** stop every track.
- [ ] T038 [US5] Create `customer-app/src/components/TicketQr.tsx`: `qrMatrix(code)` with
  `qrcode-generator` (type number 0, level `'M'`, `addData(code, 'Alphanumeric')`, `make()`), and a
  component that draws it as one SVG `<path>` of the dark modules with a 4-module quiet zone, black
  on white, `role="img"` and `aria-label` "QR code for ticket <code>". Create
  `customer-app/src/pages/PrintTicket.tsx` (reads `listMyOrders`, finds the ticket by id, shows the
  fields of T036 and a **Print** button) and add the route `/my-tickets/:ticketId/print` in
  `customer-app/src/App.tsx`. Add **Print ticket** links in `customer-app/src/pages/MyTickets.tsx`.
  Add `@media print` rules to `customer-app/src/styles.css` that hide the app header and navigation
  and the **Print** button, using theme values only.
- [ ] T039 [US5] Create `booth-app/src/camera.ts` (`openCamera()`: `getUserMedia({ video: {
  facingMode: 'environment' } })`, returning the stream and a `stop()` that stops every track, and
  typed errors for refused and missing cameras), `booth-app/src/decode.ts` (`decodeFrame(video,
  canvas)`: draws the frame at most 640 pixels wide and calls `jsQR` with `inversionAttempts:
  'dontInvert'`), and `booth-app/src/Scanner.tsx` (a `<video>` preview, decoding about every
  160 ms via `requestAnimationFrame`, normalizing a value like typing and handing a ticket code to
  the lookup, **Stop scanning**). Add **Scan** next to **Look up** in `TicketLookup.tsx`.
- [ ] T040 [US5] Run T036 and T037 until they pass, then the drift test.

**Checkpoint**: printed codes scan; typing still works everywhere.

---

## Phase 8: User Story 6, admins see real check-ins (Priority: P2)

**Goal**: the attendee list shows names and entry times; reports count real entries.

**Independent Test**: admit two tickets, then see both on the attendee list and in the report.

- [ ] T041 [P] [US6] Update `admin-app/test/attendees.test.tsx`: a **Name on tickets** column with
  each order's name, or "No name on ticket" for `null`; each checked-in ticket shows its time.
- [ ] T042 [P] [US6] Add to `backend/test/integration/entry.admit.e2e-spec.ts`: after two admits,
  `getSalesReport`'s checked-in count for the event rises by 2, `listAttendees` shows both tickets'
  `checkedInAt`, and the buyer's `listMyOrders` shows them too (FR-020, FR-021, SC-005).
- [ ] T043 [US6] In `admin-app/src/pages/Attendees.tsx`, add the **Name on tickets** column, and
  show each checked-in ticket's time of entry — today the list says only "✓ checked in"; T041
  expects the time (FR-020). Run T041 and T042 until they pass.

**Checkpoint**: every story works on its own and together.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T044 First add to `backend/test/integration/demo-data.e2e-spec.ts` that Demo Tonight's entry
  window is open right after loading and that the demo check-ins record an agent, and confirm it
  fails (Constitution VI). Then, in `backend/src/scripts/demo-data.ts` (research R13): add "Demo
  Tonight" at Demo Riverside Hall, starting 1 hour after the demo data runs and ending 4 hours
  after, at least 60 minutes from every other demo event at that venue; give it named orders with
  unused tickets, including one order of 4; and record `checkedInBySub: 'demo-agent1'` and
  `checkedInByUsername: 'agent1'` on the check-ins the demo data already makes, until it passes.
- [ ] T045 [P] Update `README.md`: the `017` row in the status table; "Today" says gate agents check
  tickets in by code or camera, once each, with an ID check against the name on the order; how to
  sign in to the Ticket Booth app (`agent1` / `test123`); the optional phone step from research R10
  word for word (`chrome://inspect`, **Port forwarding**, ports 5175, 8080, 3000), saying iPhones
  can't use it.
- [ ] T046 Run `npm run lint` and `npm test` from the repository root; everything passes,
  including `check-contract-drift` and `check-boundary`.
- [ ] T047 Report coverage for the files this feature changed (`npx jest --coverage` in `backend`;
  the front ends' coverage if a provider is installed) in the PR description. The 80% floor is not
  yet blocking (Constitution VI deferral until `010` and `011`).
- [ ] T048 Running-system gate: `docker compose up --build` from a fresh clone, then walk
  quickstart.md S0–S9 in the browser (S10 if an Android phone is at hand), and sign in, use, and
  sign out of each front end. Record the results in this file.
- [ ] T049 Independent review (Constitution III): a separate Claude session reviews the branch
  against spec.md and plan.md; fix the findings; repeat until only minor findings remain (2–3
  rounds). Record the rounds and any open finding here and in the PR description.
- [ ] T050 Open the implementation PR against `main` with `fixes #39` and `fixes #40` on their own
  lines. It touches the shared surface (`backend/prisma/`, `packages/shared/`,
  `contracts/openapi.yaml`), so every team member approves it.

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2** before any story.
- **US1 (Phase 3)** is the MVP and comes first. **US2** and **US3** test and refine US1's
  operations, so they follow it, in either order.
- **US4 (Phase 6)** depends only on Phase 2, and can run alongside US1–US3; but its T031 touches
  many Backend tests, so do it on a quiet tree. T034 (name required) comes after T030–T033.
- **US5** needs US1 (scanning hands codes to the lookup) and US4 (the print view shows the name).
- **US6** needs US1 (real entries to show).
- **Phase 9** after every story; T044 after T032.

## Parallel Opportunities

- Phase 2: T003, T005, and T006 in parallel (different workspaces); T004 after T003; T006 before
  T007 (its tests fail first; the migration makes them pass).
- US1: T009–T013 all in parallel; T014–T017 (Backend) alongside T020 (Ticket Booth app).
- US3: T024 and T025 in parallel.
- US4: T027, T028, T029 in parallel; T030 and T033 in parallel after them.
- US5: T036 and T037 in parallel; T038 and T039 in parallel.
- US6: T041 and T042 in parallel.

## Implementation Strategy

1. **MVP**: Phases 1–3. Gate agents admit tickets by typed code, once, with Admit all.
2. **Proven**: Phases 4–5 prove the race (SC-001) and every refusal.
3. **Names**: Phase 6 makes the ID check meaningful for every new order.
4. **Camera**: Phase 7, printed QR codes and scanning.
5. **Admins**: Phase 8.
6. **Ship**: Phase 9, with the running-system gate and the independent review before the PR.
