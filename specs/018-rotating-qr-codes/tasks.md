---
description: "Task list for Rotating QR Codes"
---

# Tasks: Rotating QR Codes

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R12),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) →
[`contracts/openapi.yaml`](../../contracts/openapi.yaml) (1.11.0, already applied),
[quickstart.md](./quickstart.md)

**Issue**: [#41](https://github.com/Trughouse-Holdings/QueuePass/issues/41). The implementation PR's
**description** says `fixes #41` on its own line. No commit message on either branch may contain
"fixes #41", "closes #41", or "resolves #41": a commit body with that line closed #39 and #40 early
when 017's spec PR merged.

**Tests**: **REQUIRED and written first** (Constitution VI). In each phase, write the test tasks
and confirm they **fail** before the implementation tasks below them.

## Ground rules

- **Fresh session** (Constitution III, 3.2.0): implement on branch `018-rotating-qr-codes-impl` in a
  Claude session that starts from these files only. While the spec and plan PR is open, cut it from
  `018-rotating-qr-codes-spec` and carry in every change that PR's review makes; once it merges,
  bring it up to `main`. A gap in the spec or plan is fixed there, not worked around in code.
- **Contract**: 1.11.0 is final. The implementation makes only the two changes the plan names:
  remove `x-planned: '018'` from `getTicketEntryKey` in the commit that serves it (T023), and add
  `verifiedBy` to `EntryTicket`'s `required`, deleting the sentence "Required once feature 018 is
  implemented." (T027). Regenerate `api-schema.ts` after each (`npm run generate:api`). Raise any
  other gap.
- **One live-code implementation** (research R2): only `packages/shared/src/live-code.ts` makes,
  parses, or times live codes. The Backend and the Customer app both import it. Never write the
  format, the window arithmetic, or the grace a second time.
- **Constants**: `WINDOW_MS = 30_000`, `GRACE_MS = 5_000`, prefix `QP1:`, MAC = first 10 bytes of
  HMAC-SHA256, base32 RFC 4648 upper case without padding (research R2, R3). A code for window `w`
  is accepted when `w × WINDOW_MS − GRACE_MS ≤ now < (w + 1) × WINDOW_MS + GRACE_MS`.
- **The secret stays put** (FR-006, research R1, R5): `entrySecret` is read only by
  `getTicketEntryKey` and the live-code check, each with an explicit `select`. It is never logged,
  never in an error message or `details`, never in any other response, and never written to
  browser storage, a cookie, or a URL. In the Customer app it lives in React state only.
- **Admitting does not change** (research R6): no edit to `EntryService.admit`, its `UPDATE`, or
  `AdmitDto`. Add no lock.
- **The Backend's clock** for live codes is the injected `CLOCK` (T008), never `Date.now()` directly
  in `entry/`. The entry window stays on the database's `now()` (spec 017 R5).
- **Sign-in survives no signal** (research R12, FR-010): a token renewal that fails for lack of
  network, or a token that simply expires, keeps the signed-in user in memory and retries the
  renewal quietly; only Keycloak's own refusal (`ErrorResponse`) ends the session. The change is in
  `packages/shared`'s `AuthProvider`, so it reaches all three apps (T016, T024).
- **Backend tests read `packages/shared` from `dist`**: run `npm run build --workspace
  @queuepass/shared` after changing it. **Backend Jest must run `--runInBand`** (`npm test` does);
  a bare `npx jest` breaks the shared test container.
- **Commit messages** cite the spec and task IDs (Constitution III): for example
  `Impl 018: live-code check in lookupEntryTicket (T014, T020, T021, #41)`.

## Phase 1: Setup

- [ ] T001 Cut `018-rotating-qr-codes-impl` from `018-rotating-qr-codes-spec` while the spec and
  plan PR is open, or from an up-to-date `main` once it has merged (ground rules); run
  `npm install`, run `npx prisma generate` in `backend/`, and run `npm test` from the repository
  root. Confirm the suite is green before any change (baseline). No new npm package is needed
  (plan, Primary Dependencies); add none.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the shared live-code module, the secret column, and the Backend's clock.

- [ ] T002 [P] Write `packages/shared/test/live-code.test.ts` (first line
  `// @vitest-environment node`), for research R2 and R3:
  - `windowAt(ms)` is `Math.floor(ms / 30000)`: `windowAt(0) = 0`, `windowAt(29_999) = 0`,
    `windowAt(30_000) = 1`.
  - `liveCode(secret, ticketId, window)` for three fixed vectors (secrets of 32 bytes, e.g. all
    `0x00`, all `0xff`, and bytes `0..31`; fixed UUIDs; windows `0`, `58773103`, `999999999`)
    equals the value the test computes itself with `node:crypto`: `createHmac('sha256', secret)
    .update('QP1:' + hex + ':' + window).digest().subarray(0, 10)`, base32-encoded by a reference
    encoder in the test, so the Web Crypto path is checked against an independent one. The result
    matches `^QP1:[0-9A-F]{32}:(0|[1-9]\d{0,11}):[A-Z2-7]{16}$`; for window `58773103` it is 62
    characters.
  - `parseLiveCode` round-trips every vector to `{ ticketId (lower case, with dashes), window, mac }`
    and returns `null` for: a ticket code (`'7KQ2M9XWAB4C'`); `'QP2:…'`; 31 or 33 hex digits; a
    15-character MAC; a MAC with `1`, `0`, or `8`; a window with a sign, a decimal point, or 13
    digits; a window with a leading zero (`…:058773103:…` carrying window `58773103`'s genuine
    MAC, a code QueuePass never makes, FR-011); anything after the MAC. Window `0` alone parses.
    It accepts lower-case input (it upper-cases first).
  - `windowStatus(w, nowMs)` with `w = 58773103` and `start = w × 30000`: `'EARLY'` at
    `start − 5001`; `'CURRENT'` at `start − 5000`, at `start`, and at `start + 34_999`; `'EXPIRED'`
    at `start + 35_000`.
  - `keyToBase64url` / `keyFromBase64url` round-trip 32 bytes as 43 characters of `[A-Za-z0-9_-]`
    with no padding; `keyFromBase64url` returns `null` for 42 or 44 characters, `+`, `/`, or `=`.
  Confirm it fails (the module doesn't exist).
- [ ] T003 Create `packages/shared/src/live-code.ts` and export it from
  `packages/shared/src/index.ts`: `LIVE_CODE_PREFIX = 'QP1:'`, `WINDOW_MS = 30_000`,
  `GRACE_MS = 5_000`; `windowAt(ms: number): number`; `windowStartMs(w: number): number`;
  `async liveCode(secret: Uint8Array, ticketId: string, window: number): Promise<string>` using
  `globalThis.crypto.subtle` (`importKey('raw', new Uint8Array(secret), { name: 'HMAC', hash:
  'SHA-256' }, false, ['sign'])`, then `sign`), taking the first 10 bytes, base32 (RFC 4648, upper
  case, no padding). The copy is needed: under TypeScript 5.9 `BufferSource` refuses a plain
  `Uint8Array` (`Uint8Array<ArrayBufferLike>`, which is also what Prisma's `Bytes` is), and
  `new Uint8Array(secret)` is a `Uint8Array<ArrayBuffer>`. The message is
  `QP1:<ticket UUID, dashes removed, upper case>:<window>`;
  `parseLiveCode(text: string): { ticketId: string; window: number; mac: string } | null` (trim,
  upper-case, match `^QP1:([0-9A-F]{32}):(0|[1-9]\d{0,11}):([A-Z2-7]{16})$`, rebuild the UUID
  with dashes in lower case; no leading zero in the window, since QueuePass never writes one);
  `windowStatus(window: number, nowMs: number): 'EARLY' | 'CURRENT' | 'EXPIRED'` with the ground
  rules' half-open range; `isLiveCodeText(text: string): boolean` (starts with
  `QP1:` after trim and upper-case); `keyToBase64url(bytes)` and `keyFromBase64url(text):
  Uint8Array | null` (exactly 32 bytes). No Node-only import: the module runs in browsers too.
  Run T002 until it passes; build `packages/shared`.
- [ ] T004 [P] Mirror the contract in `packages/shared/src/entry.ts`: add
  `verifiedBy?: 'LIVE_CODE' | 'TICKET_CODE'` to `EntryTicket`, **optional** as in contract 1.11.0
  (comment citing spec 018 FR-011 and "required from T027"). Not required yet: the Backend's
  `toEntryTicket` returns this type and sends no `verifiedBy` until T021, so a required field
  would stop every Backend suite compiling from here to T021. Also add a
  new `TicketEntryKey { ticketId: string; key: string; serverTime: string }` (comment: base64url of
  32 bytes; the Backend's clock with milliseconds); update `EntryLookupInput.code`'s comment to
  "1–80 characters: a ticket code or a live code"; export from `packages/shared/src/index.ts`.
- [ ] T005 [P] Write `backend/test/integration/live-codes.constraints.e2e-spec.ts`, using
  `ctx.prisma` and raw SQL:
  - a ticket inserted with no `entrySecret` gets one of exactly 32 bytes, and two tickets get
    different secrets;
  - an `UPDATE` setting `"entrySecret"` to 31 or 33 bytes is refused by
    `ticket_entry_secret_32_bytes`;
  - the default query leaves it out: `ctx.prisma.ticket.findFirst()` returns an object with no
    `entrySecret` key, nor do `ctx.prisma.order.findFirst({ include: { tickets: true } })`'s
    tickets, nor the ticket from `ctx.prisma.$transaction((tx) => tx.ticket.findFirst())` (inside
    a transaction the omit holds at runtime, though not in `tx`'s types, T007);
    `ctx.prisma.ticket.findFirst({ select: { entrySecret: true } })` returns 32 bytes;
  - the omit is in the types too: reading `.entrySecret` on the result of a default
    `ctx.prisma.ticket.findFirst()` carries a `// @ts-expect-error`, so the file stops compiling
    if T007's typing is ever lost.
  Confirm it fails.
- [ ] T006 Add to `model Ticket` in `backend/prisma/schema.prisma`, after `checkedInByUsername`:
  `entrySecret Bytes @default(dbgenerated("gen_random_bytes(32)")) @db.ByteA`, with the comment from
  data-model.md. Create `backend/prisma/migrations/<timestamp>_live_codes/migration.sql` with
  exactly data-model.md's three statements, in order: `CREATE EXTENSION IF NOT EXISTS pgcrypto;`,
  `ALTER TABLE "Ticket" ADD COLUMN "entrySecret" BYTEA NOT NULL DEFAULT gen_random_bytes(32);`, and
  `ALTER TABLE "Ticket" ADD CONSTRAINT ticket_entry_secret_32_bytes CHECK
  (octet_length("entrySecret") = 32);`. No index. Apply with `prisma migrate deploy` (never
  `db push`).
- [ ] T007 In `backend/src/prisma/prisma.service.ts`, leave `entrySecret` out of every query by
  default, in the types as well as at runtime (research R1):
  ```ts
  const OMIT = { ticket: { entrySecret: true } } as const;
  export class PrismaService extends PrismaClient<{ omit: typeof OMIT }> implements … {
    constructor() { super({ omit: OMIT }); }
  ```
  A bare `extends PrismaClient` with `super({ omit })` drops the field at runtime, but its types
  still say `entrySecret` is there. The typed form fixes that for queries on `this.prisma`, but not
  inside a transaction: `$transaction`'s `tx` still fits `Prisma.TransactionClient` because its
  types keep the field, so in `$transaction(async (tx) => …)` the result of
  `tx.ticket.findFirst()` is typed with `entrySecret` while at runtime it has none (a
  `@ts-expect-error` there is reported unused). Never read `entrySecret` from a default query,
  through `tx` or not: a `select` naming it is the only way to read it. Also, a `PrismaService` no
  longer fits a `PrismaClient` or `Prisma.TransactionClient` parameter, and a query result no
  longer fits Prisma's model type `Ticket`, which still lists every column. A trial on 2026-10-23
  (the typed omit on another column, then `tsc`) found these, so retype them:
  - `resetDb` (`backend/test/setup/reset-db.ts`) and `holdSeats` and `endHold`
    (`backend/test/setup/fixtures.ts`): `PrismaClient` → `PrismaService` (every suite passes
    `ctx.prisma` to them);
  - `customerHeld`'s `db` (`backend/src/common/event-lock.ts`): `Pick<Prisma.TransactionClient,
    'ticket'>` → `Pick<PrismaService | Prisma.TransactionClient, 'ticket'>`, since
    `availability.service.ts` passes it `this.prisma` (the trial compiled with this);
  - `backend/src/orders/orders.service.ts`: `OrderRow`'s `tickets: Ticket[]` and the
    `tickets: Ticket[]` parameter further down → `Omit<Ticket, 'entrySecret'>[]`.
  Run
  `npx tsc --noEmit -p tsconfig.json` in `backend/`; fix any other compile error the omit causes
  by naming the field in a `select` or retyping a parameter, never by removing the omit. Run T005
  until it passes, then the full Backend suite: every existing test still passes.
- [ ] T008 Create `backend/src/common/clock.ts`: `export interface Clock { now(): number }`,
  `export const CLOCK = Symbol('CLOCK')`, and `export const systemClock: Clock = { now: () =>
  Date.now() }`, with a comment citing spec 018 research R3. Provide `{ provide: CLOCK, useValue:
  systemClock }` in `backend/src/entry/entry.module.ts` (the only module that reads it). It comes
  before T009 because T009's `FakeClock` and the `CLOCK` override in `test-app.ts` import it:
  without it, `test-app.ts` doesn't compile and every Backend suite fails.
- [ ] T009 Create `backend/test/setup/fake-clock.ts` (after T008): `class FakeClock implements
  Clock` with `now()` returning `Date.now()` until `set(ms: number)` fixes it, and
  `useRealTime()` to undo; add `clock: FakeClock` to `TestContext` in
  `backend/test/setup/test-app.ts`, override the `CLOCK` provider with it (next to
  `ADDRESS_GEOCODER`); each `createTestApp()` gets a new `FakeClock` on real time. Every test file
  that calls `ctx.clock.set` also calls `ctx.clock.useRealTime()` in its `afterEach`, so no test
  inherits another's time. Add a `liveCodeFor(ctx, ticketId, window)` helper to
  `backend/test/setup/fixtures.ts` that reads the ticket's secret with
  `select: { entrySecret: true }` and returns `liveCode(...)` from `@queuepass/shared` (so it
  needs T006 too). Run the full Backend suite: still green.

**Checkpoint**: shared module built and tested; every ticket has a secret nobody loads by
accident; the clock is injectable. Nothing served yet.

---

## Phase 3: User Story 1, a customer shows a live code and walks in (Priority: P1) 🎯 MVP

**Goal**: **Show entry code** draws a live code that changes every 30 seconds; the Ticket Booth
scans it, says no ID check is needed, and admits it.

**Independent Test**: a customer opens a ticket's live code; `agent1` scans it, sees "Live code
verified. No ID check needed.", admits it, and **My tickets** then shows the ticket as "Used".

### Tests for User Story 1 ⚠️ write first, confirm they fail

Every Backend behavior this phase builds is tested here first (Constitution VI), including the
ones that serve US2 and US3: the live-code check (T020) refuses expired and forged codes (T013,
T014), the lookup (T021) answers `verifiedBy: 'TICKET_CODE'` on 017's path (T015), and no
response but the key operation's (T019) carries the secret (T032). Those four keep their story's
label.

- [ ] T010 [P] [US1] Write `backend/test/integration/entry-key.e2e-spec.ts` (contract-checked
  `getTicketEntryKey`, research R5): the buyer gets `200` with `ticketId`, a `key` of 43 base64url
  characters that `keyFromBase64url` turns into exactly the ticket's stored 32 bytes, and
  `serverTime` equal to `new Date(ctx.clock.now()).toISOString()` with the clock set; the response
  has `Cache-Control: no-store`; another customer's ticket and a random UUID are both `404
  NOT_FOUND` with the same message shape; an id that is not a UUID is `400 VALIDATION_FAILED`;
  a used ticket is `409 ENTRY_REFUSED` with
  `details.reason: 'USED'` and `details.usedAt`; a void ticket (cancelled event) is `409
  ENTRY_REFUSED` with `reason: 'VOID'`; a ticket bought before 017 (`orderWithTickets` with no
  name) still gets its key; and so do a ticket for an event 30 days away and one for an event that
  has ended, both valid and unused (`eventAroundNow`, `orderWithTickets`): the key doesn't depend
  on the entry window (FR-005).
- [ ] T011 [P] [US1] Write `backend/test/integration/entry-key.authz.e2e-spec.ts`:
  `getTicketEntryKey` answers `401` with no token, an expired token, a wrongly signed one, and one
  for another audience; `403` for an admin and for a gate agent; `200` for the buyer (FR-003,
  SC-007, Constitution V and VI). Also, a customer's token posting a current live code
  (`liveCodeFor`) to `lookupEntryTicket` is `403` (FR-013).
- [ ] T012 [P] [US1] Write `backend/test/integration/entry.live-code.e2e-spec.ts`
  (contract-checked `lookupEntryTicket`), with `ctx.clock.set` to the middle of a window: a current
  live code (`liveCodeFor`) for an admittable ticket is `200` with every `EntryTicket` field of spec
  017 and `verifiedBy: 'LIVE_CODE'`; the same code in lower case is accepted; a lookup records
  nothing; then `admitTicket` with that `ticketId` admits it, and with `wholeOrder: true` on a
  fresh order of 3 admits 3 (clarified 2026-10-23); a current live code of a used, void,
  other-event, not-yet-open, and ended ticket gives `state` `USED` (with `usedAt`), `VOID`,
  `OTHER_EVENT`, `NOT_OPEN`, and `ENDED`, each with `verifiedBy: 'LIVE_CODE'`; a ticket bought
  before 017 has a working live code with `holderName: null`.
- [ ] T013 [P] [US2] Write `backend/test/integration/entry.live-boundaries.e2e-spec.ts` with
  `ctx.clock.set` and one ticket's code for window `w = liveWindowAt(Date.now())` (SC-001), where
  `liveWindowAt` is the shared module's `windowAt` imported under that name
  (`import { windowAt as liveWindowAt } from '@queuepass/shared'`). `backend/test/setup/fixtures.ts`
  already exports a different `windowAt(daysFromNow, hour)` for event times; never mix them up. At
  `w × 30000 − 5000` and at `(w + 1) × 30000 + 4999`, `200` with `verifiedBy: 'LIVE_CODE'`; at
  `w × 30000 − 5001` and at `(w + 1) × 30000 + 5000`, `409 LIVE_CODE_EXPIRED` with the message
  "This live code has expired." and no `details`. Repeat for 3 consecutive windows. Then, with the
  clock at the last accepted instant, a lookup is `200`, and admitting that ticket after moving
  the clock past the grace still succeeds (spec Edge Cases, research R6).
- [ ] T014 [P] [US2] Write `backend/test/integration/entry.live-refusals.e2e-spec.ts`: each of these
  is `404 LIVE_CODE_INVALID` with "This is not a valid QueuePass code." and no `details`: a MAC with
  one character changed; the right MAC under another ticket's secret; a well-formed code naming a
  random UUID; `'QP1:'` alone; `'QP1:XYZ'`; a code whose window was changed by 1 with its MAC kept;
  a code with a 15-character MAC. An expired genuine code of a **used** ticket is `409
  LIVE_CODE_EXPIRED`, not `USED` (R4: the window is checked before the ticket). None of them
  changes the ticket (`checkedInAt` still `NULL`), and the ticket's current live code is admitted
  afterwards (FR-012, US2 scenario 5). A request with an 81-character code is `400`.
- [ ] T015 [P] [US3] Add to `backend/test/integration/entry.lookup.e2e-spec.ts`: a typed code
  (any case, spaces, dashes) answers `verifiedBy: 'TICKET_CODE'`; a ticket admitted through its
  live code is `USED` when looked up by its typed code, and the other way around (FR-014).
- [ ] T032 [P] [US3] Write `backend/test/integration/entry-secret.no-leak.e2e-spec.ts` (FR-006),
  here, out of number order, because T019 and T021 build what it tests. For one order of 2
  tickets, read each ticket's secret (`select`) and form its base64url and hex; call
  `createOrder` (for a new order), `listMyOrders`, `listAttendees`, `getSalesReport`,
  `lookupEntryTicket` by typed code and by live code, `admitTicket`, and the `409` of a second
  admit; the raw text of no response contains either secret's base64url or hex, or the word
  `entrySecret`. Only `getTicketEntryKey` for its own ticket contains that ticket's base64url, and
  never the other ticket's.
- [ ] T016 [P] [US1] Add to `packages/shared/test/web/fake-user-manager.ts` a `signinSilent`
  `vi.fn` that records `'signinSilent'` in `calls` and by default resolves to the current user
  without emitting anything (each test sets its outcome). Then add to
  `packages/shared/test/web/auth-provider.test.tsx`, under fake timers (research R12; FR-010,
  SC-006; spec 001 FR-013):
  - a `silentRenewError` with `new TypeError('Failed to fetch')` (what `fetch` throws with no
    network) keeps the user: the status stays `signed-in`, the children stay mounted, and neither
    `removeUser` nor `signinRedirect` is called;
  - `accessTokenExpired` with **no** `silentRenewError` before it keeps the user the same way: on
    a network that hangs, the library retries the timed-out renewal itself and raises no error,
    so the token expires with nothing before it;
  - after either, the provider calls `signinSilent` every 30 seconds and on a `window` `online`
    event; the fake rejecting with a `TypeError` keeps the user and the next try still comes; the
    fake emitting `userLoaded` with a fresh user applies it and stops the tries (advancing another
    60 seconds calls `signinSilent` no more); the fake rejecting with
    `new ErrorResponse({ error: 'invalid_grant' })` (from `oidc-client-ts`) ends in `removeUser`
    then `signinRedirect`; none of these calls `signinRedirect` otherwise;
  - an `online` event with no failed renewal calls nothing; no `signinSilent` while logging out;
  - the probe calling `useAuth().signIn()`, which is what every app does on a `401`
    (`customer-app/src/use-load.ts`, `booth-app/src/App.tsx`, `admin-app/src/api/client.ts`),
    still calls `signinRedirect`, with or without a failed renewal;
  - the existing "signs in again when silent renew fails" now emits an `ErrorResponse` and still
    ends in `removeUser` then `signinRedirect`;
  - a `pageshow` with `persisted: true` and an expired user in memory keeps it and starts the
    tries, as `accessTokenExpired` does; with no user, it signs in, as today (SC-007).
  Confirm the new cases fail.
- [ ] T017 [P] [US1] Write `customer-app/test/entry-code.test.tsx` with a stubbed `fetch` and fake
  timers set up as `customer-app/test/seat-holds.test.tsx` does: `vi.useFakeTimers({
  shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'performance', 'Date'] })`. A bare `vi.useFakeTimers()` stalls Testing Library's `findBy…` and
  `waitFor`, which under Vitest poll with the faked timers. Move the device clock with
  `vi.setSystemTime`. `crypto.subtle` works under this jsdom setup as it is (checked 2026-10-23),
  so `test/setup.ts` needs no change.
  - **My tickets** shows **Show entry code**, linking to `/my-tickets/<ticketId>/entry-code`, on
    each valid, unused ticket only, next to **Print ticket**; none on void or used tickets.
  - The page calls `getTicketEntryKey` once and shows "Getting your entry code…" until it answers;
    then an SVG with the accessible name "Live entry code, changes every 30 seconds", "Changes in
    N s", the holder's name (or "No name on ticket"), the event's name and start time, and the
    seat if any.
  - The QR drawn is the current live code: the test computes the expected code itself with
    `liveCode(key, ticketId, windowAt(serverNow))` from `@queuepass/shared`, checks that
    `parseLiveCode` accepts it for this ticket, and compares the SVG `path`'s `d` with
    `qrPath(expected)`, which T025 exports from `TicketQr.tsx`. The Customer app has no QR decoder,
    and none is added.
  - Advancing the timers across a window boundary draws a new code within 1 second, and the
    countdown restarts at 30 (or 29) (FR-002, SC-006).
  - With the device clock 5 minutes **ahead** of `serverTime`, and again 5 minutes **behind**, every
    code drawn over 3 windows has a `window` for which `windowStatus(window, serverNow)` is
    `'CURRENT'`, where `serverNow` is the stubbed server time advanced with the timers (FR-009,
    SC-006).
  - After the key loads, every further `fetch` rejects; advancing 10 minutes keeps drawing new
    codes, each `'CURRENT'` for server time (FR-010, SC-006), and `fetch` was called no more times.
    Along the way, through the `um` that `renderCustomer` returns (the real `AuthProvider` with the
    fake user manager), whose `signinSilent` (T016) rejects with `new TypeError('Failed to
    fetch')` throughout, emit `accessTokenExpired` alone (no `silentRenewError`, the hanging
    network), and in a second run `silentRenewError` with that `TypeError` and then
    `accessTokenExpired`: in both, over the 10 minutes the page stays mounted and keeps drawing codes, and `signinRedirect` is
    never called (research R12). The fake doesn't fetch, so `fetch`'s count holds.
  - `localStorage.setItem`, `sessionStorage.setItem`, and `document.cookie` writes are spied on and
    never called with anything containing the key (FR-010); the key never appears in
    `window.location`.
  - The countdown is not inside any `aria-live` or `role="status"` region (FR-004).
  - States: the key request failing with a network error shows "Can't show the live code without a
    connection. Use your printed ticket with photo ID."; so does `listMyOrders` getting no answer
    (the page reloaded with no connection, quickstart S6); a `409` with `USED` shows "This ticket was
    already used." and no QR; `404` shows "Ticket not found"; any other failure shows the standard
    error with **Try again**, which retries.
- [ ] T018 [P] [US1] Add to `booth-app/test/scanner.test.tsx` and `booth-app/test/check-in.test.tsx`:
  `normalizeScan` returns a live code (upper-cased, otherwise unchanged) for a value matching
  `^QP1:[0-9A-F]{32}:(0|[1-9]\d{0,11}):[A-Z2-7]{16}$`, and a decoded live code runs the lookup with
  no further tap and stops the camera; a lookup answering `verifiedBy: 'LIVE_CODE'` and `ADMITTABLE`
  shows "✓ Live code verified. No ID check needed." and the holder's name, event, and ticket type,
  with **Admit**, **Admit all 3** (for `unusedOnOrder: 3`), and **Refuse**, and does **not** show
  "Check a government-issued photo ID"; **Admit** and **Admit all** post as in 017.

### Implementation for User Story 1

- [ ] T019 [US1] Create `backend/src/entry/entry-key.controller.ts`:
  `@Controller('me/tickets/:ticketId/entry-key')`, `@Get()` with `@Roles('customer')`,
  `ParseUUIDPipe` on `ticketId`, `@CurrentPrincipal()`, and `@Header('Cache-Control', 'no-store')`.
  Add `entryKey(ticketId, principal)` to `backend/src/entry/entry.service.ts` (or a small
  `entry-key.service.ts` in the same module): one `findFirst` with `where: { id: ticketId, order: {
  customerSub: principal.sub } }` and `select: { id, status, checkedInAt, entrySecret }`; none is
  `NotFoundException('No ticket exists with id <id>.')`, the same for someone else's ticket;
  `VOID` is `conflict('ENTRY_REFUSED', 'This ticket was cancelled and refunded.', { reason: 'VOID'
  })`; used is `conflict('ENTRY_REFUSED', 'This ticket was already used.', { reason: 'USED', usedAt
  })`; otherwise `{ ticketId, key: keyToBase64url(entrySecret), serverTime: new
  Date(clock.now()).toISOString() }`. Register the controller in `entry.module.ts`.
- [ ] T020 [US1] Create `backend/src/entry/live-code-check.ts`: `checkLiveCode(prisma, clock, text)`
  returning the verified `ticketId`, or throwing, in research R4's order: `parseLiveCode` is `null`
  → `404 LIVE_CODE_INVALID`; load `{ entrySecret }` by id (`select`), none → `404
  LIVE_CODE_INVALID`; recompute `liveCode(secret, ticketId, window)` and compare its MAC with the
  presented one using `crypto.timingSafeEqual` on equal-length buffers, mismatch → `404
  LIVE_CODE_INVALID`; `windowStatus(window, clock.now())` not `'CURRENT'` → `409
  LIVE_CODE_EXPIRED`. Messages: "This is not a valid QueuePass code." and "This live code has
  expired."; no `details` on either (no ticket information, FR-011). Build both in the standard
  envelope as `ticketNotFound` in `entry.service.ts` builds its `404`, and with `conflict()` for the
  `409`.
- [ ] T021 [US1] In `backend/src/entry/entry.service.ts`, inject `CLOCK`; at the top of `lookup`,
  after `eventOrThrow`, if `isLiveCodeText(rawCode)`, call `checkLiveCode` and then run the existing
  `select` with `t."id" = ${ticketId}::uuid`, returning `toEntryTicket(row)` with `verifiedBy:
  'LIVE_CODE'`; otherwise keep 017's path unchanged and return `verifiedBy: 'TICKET_CODE'`. In
  `backend/src/entry/dto/entry-lookup.dto.ts`, change `@Length(1, 64, …)` to `@Length(1, 80, {
  message: 'code must be between 1 and 80 characters' })` (research R4).
- [ ] T022 [US1] Build `packages/shared`; run T010–T015 and T032 until they pass. A fix any of
  them needs goes in `backend/src/entry/` or `packages/shared/src/live-code.ts`.
- [ ] T023 [US1] In `contracts/openapi.yaml`, remove `x-planned: '018'` from `getTicketEntryKey`;
  run `npm run generate:api`. Run `backend/test/contract/route-coverage.e2e-spec.ts` and
  `node scripts/check-contract-drift.mjs`; both pass.
- [ ] T024 [US1] In `packages/shared/src/web/auth-provider.tsx` (research R12), split today's
  `onLost`:
  - A `silentRenewError` whose error is an `ErrorResponse` (`err instanceof ErrorResponse` from
    `oidc-client-ts`, or `err.name === 'ErrorResponse'`) does what `onLost` does now:
    `removeUser`, `apply(null)`, `signIn()`.
  - A `silentRenewError` with any other error, and every `accessTokenExpired`, keep the user in
    memory and set a `renewFailed` ref. Expiry alone must not end the session: the library retries
    a timed-out renewal itself (every 5 seconds, with no limit) and never raises it, so on a
    network that hangs the token expires with no renewal error before it.
  - While `renewFailed` is set, a user is in memory, and `loggingOut` is not set, call
    `um.signinSilent()` (the refresh-token grant, no page navigation) on the `window`'s `online`
    event and every 30 seconds. On success, `userLoaded` applies the user and clears the ref, which
    stops the tries. An `ErrorResponse` does `removeUser`, `apply(null)`, `signIn()`. Anything
    else keeps the user until the next try. Nothing on this path navigates the page.
  - `pageshow` from the back-forward cache: no user in memory still signs in (logout, SC-007); an
    expired user is handled like `accessTokenExpired`, not redirected.
  - A `401` still reaches `signIn()` through each app, unchanged.
  - Clear the interval on unmount and when the ref clears.
  Add `signinSilent(): Promise<User | null>` to `UserManagerLike` (T016 added it to the fake).
  Update the comment above the effect to cite spec 001 FR-013 and its data-model §4, as amended by
  research R12. Nothing is written to storage (Constitution V) and `logout` doesn't change. Run
  T016 and the rest of `packages/shared`'s tests until they pass, build `packages/shared`, then run
  the Admin, Customer, and Ticket Booth apps' tests: the provider is theirs too.
- [ ] T025 [US1] In `customer-app/src/components/TicketQr.tsx`, generalize without changing 017's
  output: `qrMatrix(text)` (any QR-alphanumeric text; type number 0, level `'M'`); export
  `qrPath(text): string`, the SVG path of the dark modules with the 4-module quiet zone, built as
  `TicketQr` builds it today, and have `TicketQr` draw with it (T017 compares with it); and
  `TicketQr({ code, label? })` whose `aria-label` defaults to 017's "QR code for ticket <code>";
  017's print view and `print-ticket.test.tsx` stay unchanged and passing. Add the class
  `ticket-qr--live` support for a size of `min(100%, 320px)` in `customer-app/src/styles.css`,
  theme values only.
- [ ] T026 [US1] Build the live-code screen (research R8):
  - `customer-app/src/live-code-clock.ts`: `measureOffset(serverTime: string, sentMs: number,
    receivedMs: number): number` (`Date.parse(serverTime) − (sentMs + receivedMs) / 2`) and
    `serverNow(offset: number): number` (`Date.now() + offset`), with a comment citing FR-009.
  - `customer-app/src/pages/EntryCode.tsx`: reads `listMyOrders` to find the ticket (as
    `PrintTicket.tsx` does); calls `getTicketEntryKey` once, timing it for `measureOffset`; keeps
    the decoded key and the offset in `useState`/`useRef` only; a `setInterval` of 250 ms works out
    `windowAt(serverNow(offset))`, and when it changes, awaits `liveCode` and sets the code (ignore a
    result for a window that has already passed); shows the QR (`TicketQr` with
    `className`/`label` "Live entry code, changes every 30 seconds"), "Changes in N s" as plain text
    outside any live region, the static sentence "Show this at the gate. It changes every 30
    seconds.", the holder's name or "No name on ticket", the event's name and start time, and the
    seat; the states of T017. Where `PrintTicket.tsx` shows `<ServiceUnreachable />` for
    `useLoad`'s `unreachable`, this page shows the no-connection message instead (FR-010). Clears
    the interval on unmount.
  - `customer-app/src/App.tsx`: the route `/my-tickets/:ticketId/entry-code`.
  - `customer-app/src/pages/MyTickets.tsx`: a **Show entry code** link, `aria-label` "Show entry
    code for ticket <code>", on each valid, unused ticket, beside **Print ticket**.
  - Typed calls through the generated client (`createApiClient`), as the other pages do.
- [ ] T027 [US1] In `contracts/openapi.yaml`, add `verifiedBy` to `EntryTicket`'s `required` and
  delete "Required once feature 018 is implemented." from its description; run
  `npm run generate:api`. In `packages/shared/src/entry.ts`, make `verifiedBy` required too (drop
  T004's `?` and its "required from T027"), and build `packages/shared`. T012, T015, and the
  existing entry tests still pass against the contract.
- [ ] T028 [US1] In the Ticket Booth app (research R9): `booth-app/src/decode.ts`, make
  `normalizeScan` return a live code (upper-cased) when it matches T018's pattern,
  `^QP1:[0-9A-F]{32}:(0|[1-9]\d{0,11}):[A-Z2-7]{16}$`, else 017's behavior;
  `booth-app/src/EntryResult.tsx`, for `verifiedBy === 'LIVE_CODE'` and `ADMITTABLE`, show
  "✓ Live code verified. No ID check needed." in place of the ID-check prompt, keeping **Admit**,
  **Admit all N**, and **Refuse**. Theme values only; word and symbol, not color alone (FR-016).
- [ ] T029 [US1] Run T017 and T018 until they pass, then the theme drift test
  (`packages/shared/test/theme/drift.test.ts`, part of `npm test -w packages/shared`) and
  `node scripts/check-contract-drift.mjs`.

**Checkpoint**: a live code is shown, scanned, verified by the Backend, and admitted, and keeps
changing with no signal; copies and forgeries are refused by the Backend. MVP.

---

## Phase 4: User Story 2, a copied code is refused (Priority: P1)

**Goal**: an old screenshot is refused as expired, a made-up code as not valid, each with nothing
recorded and nothing about the ticket shown.

**Independent Test**: with the clock controlled, a live code is accepted just inside each edge of
its window and grace and refused just outside; forged codes are refused as not valid (T013, T014,
written and passing in Phase 3); the Ticket Booth shows each refusal with its reason (T030).

- [ ] T030 [US2] Add to `booth-app/test/check-in.test.tsx`: a `409 LIVE_CODE_EXPIRED` from a
  lookup shows "✕ This live code has expired. Ask for the live code in the QueuePass app, or a
  printed ticket with photo ID.", with no event, name, seat, or **Admit**; a `404
  LIVE_CODE_INVALID` shows "✕ Not a valid QueuePass code." with no **Admit**; both are in the
  `role="status"` region, keep **Look up another**, and leave a typed code in the field (as 017's
  not-found does); scanning again after an expired code works. Confirm it fails.
- [ ] T031 [US2] In `booth-app/src/App.tsx`, handle `LIVE_CODE_EXPIRED` and `LIVE_CODE_INVALID`
  from `lookupEntryTicket` as refusals beside 017's `TICKET_NOT_FOUND`, with the texts of T030, in
  `booth-app/src/EntryResult.tsx`. Run T030 until it passes.

**Checkpoint**: copies die within 35 seconds; forgeries never work.

---

## Phase 5: User Story 3, the printed ticket and typed code still work (Priority: P1)

**Goal**: 017's ID-checked path is untouched, and nothing printed can make a live code.

**Independent Test**: 017's printed-QR and typed-code tests still pass, now with
`verifiedBy: 'TICKET_CODE'` (T015), and no response leaks the secret (T032), both written and
passing in Phase 3; the Ticket Booth keeps the ID check for them (T033).

- [ ] T033 [P] [US3] Add to `booth-app/test/check-in.test.tsx`: a lookup answering `verifiedBy:
  'TICKET_CODE'` shows 017's "Check a government-issued photo ID that shows: Jordan Lee" and no
  "Live code verified" (FR-014, SC-005).
- [ ] T034 [US3] Run T033, T015, and every 017 test until they pass; fix only 018 code (017's
  tests are the specification of SC-005).

**Checkpoint**: three ways in, one rule for each.

---

## Phase 6: User Story 4, one entry per ticket, however it is presented (Priority: P1)

**Goal**: FR-015 under genuinely simultaneous requests that came through both kinds of lookup
(SC-004).

**Independent Test**: 20 simultaneous admits of one ticket after mixed lookups; exactly one wins.

- [ ] T035 [US4] Write `backend/test/integration/entry.live-race.e2e-spec.ts`, firing with
  `Promise.all` as `entry.concurrency.e2e-spec.ts` does, failing on any `5xx`: for one fresh
  ticket, `agent1`…`agent10` look it up by its current live code and `agent11`…`agent20` by its
  typed code (all `200`, ADMITTABLE), then all 20 admit at once: exactly one `200`, nineteen `409
  ENTRY_REFUSED` with `reason: 'USED'`. Repeat 5 times on fresh tickets. Run it until it passes
  without changing `EntryService.admit` (ground rules).

**Checkpoint**: one entry per ticket, whichever code.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T036 [P] Update `README.md`: the `018` row in the status table; "Today" says customers show a
  live entry code from **My tickets** that changes every 30 seconds and needs no ID check at the
  gate, while printed and typed codes still need one; a pointer to
  `specs/018-rotating-qr-codes/quickstart.md` for the phone-to-webcam demo (research R10); the
  contract version 1.11.0 wherever the README names it.
- [ ] T037 Run `npm run lint`, `npx prettier --check .`, and `npm test` from the repository root;
  everything passes, including `check-contract-drift` and `check-boundary`.
- [ ] T038 Report coverage for the files this feature changed (`npm test -- --coverage` in
  `backend`, which keeps `--runInBand`; the front ends' coverage if a provider is installed) in the
  PR description. The 80% floor is not yet blocking (Constitution VI deferral until `010` and
  `011`).
- [ ] T039 Running-system gate: `docker compose up --build` from a fresh clone, then walk
  quickstart.md S0–S8 in the browser, with a phone camera for S2–S5, and sign in, use, and sign
  out of each front end. Record the results in this file.
- [ ] T040 Independent review (Constitution III): a separate Claude session reviews the branch
  against spec.md and plan.md; fix the findings; repeat until only minor findings remain (2–3
  rounds). Record the rounds and any open finding here and in the PR description.
- [ ] T041 Once the spec and plan PR has merged (Constitution 3.2.0), bring the branch up to `main`
  and open the implementation PR against `main`, assigned to `nathan-707`, with `fixes #41` on its
  own line in the **description** only (see Issue above). The description records: the review
  rounds (T040), coverage (T038), the running-system results (T039), and any deviation from the
  plan.

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2** → every story.
- **US1 (Phase 3)** needs Phase 2. It is the MVP: secret, key operation, live lookup with its
  refusals, sign-in that survives no signal, Customer screen, Ticket Booth result. Its tests
  include the Backend tests of US2 (T013, T014) and US3 (T015, T032), since T019, T020, and T021
  build what they test.
- **US2 (Phase 4)** needs US1's live-code check (T020–T022) and Booth wiring (T028).
- **US3 (Phase 5)** needs T021 (`verifiedBy` on both paths).
- **US4 (Phase 6)** needs T021 and `liveCodeFor` (T009).
- **Polish** last; T041 waits for the spec and plan PR to merge.

Within a phase, test tasks come first and must fail; implementation follows; the "run until they
pass" task closes the phase (T022 for the Backend track and T029 for the front ends in Phase 3,
T031, T034).

## Parallel Opportunities

- Phase 2: T002, T004, T005 touch different files. T008 then T009, in that order (T009
  imports T008's `clock.ts`).
- US1 tests: T010 to T018 and T032 in parallel, each in its own files. Then the Backend (T019–T023,
  T027), Customer (T024–T026), and Ticket Booth (T028) tracks are independent of each other; T024 and
  T027 each change one file of `packages/shared` and rebuild it, so run those two one after the
  other.
- US2: T030, then T031.
- US3: T033 only.
- T018, T030, and T033 all edit `booth-app/test/check-in.test.tsx`; they sit in different phases,
  so never run them at the same time.

```text
# US1 tests, together:
T010 backend/test/integration/entry-key.e2e-spec.ts
T011 backend/test/integration/entry-key.authz.e2e-spec.ts
T012 backend/test/integration/entry.live-code.e2e-spec.ts
T013 backend/test/integration/entry.live-boundaries.e2e-spec.ts
T014 backend/test/integration/entry.live-refusals.e2e-spec.ts
T015 backend/test/integration/entry.lookup.e2e-spec.ts
T032 backend/test/integration/entry-secret.no-leak.e2e-spec.ts
T016 packages/shared/test/web/auth-provider.test.tsx
T017 customer-app/test/entry-code.test.tsx
T018 booth-app/test/scanner.test.tsx, booth-app/test/check-in.test.tsx
```

## Implementation Strategy

1. **MVP**: Phases 1–3. A live code works end to end, keeps changing with no signal, admits once
   (017's guarantee carries it), and the Backend refuses copies and forgeries.
2. **Safety**: Phase 3 already proves the secret never leaks (T032); Phase 4 shows copies and
   forgeries refused at the gate; Phase 5 proves nothing of 017 changed.
3. **Proof under load**: Phase 6.
4. **Ship**: Phase 7, after the spec and plan PR merges.
