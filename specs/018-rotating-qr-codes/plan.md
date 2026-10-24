# Implementation Plan: Rotating QR Codes

**Branch**: `018-rotating-qr-codes-spec` | **Date**: 2026-10-23 | **Spec**: [spec.md](./spec.md)
| **Issue**: [#41](https://github.com/Trughouse-Holdings/QueuePass/issues/41)

**Input**: Feature specification from `specs/018-rotating-qr-codes/spec.md`

## Summary

- **Secret**: every ticket gets `entrySecret`, 32 random bytes made by the database
  (`gen_random_bytes`), backfilled into every existing ticket, and left out of every query unless
  named (Prisma's global `omit`) (research R1).
- **Live code**: `QP1:<ticket UUID>:<window>:<MAC>`, the MAC being 80 bits of HMAC-SHA256 under the
  ticket's secret. One shared module, `packages/shared/src/live-code.ts`, makes codes in the
  Customer app and checks them in the Backend, with the Web Crypto API (R2).
- **Windows**: 30 seconds, the same for every ticket; a code is accepted from 5 seconds before its
  window until 5 seconds after, on the Backend's clock, an injectable `Clock` so tests hit each
  boundary to the millisecond (R3).
- **API**: `getTicketEntryKey` (`GET /me/tickets/{ticketId}/entry-key`, the buyer only) returns the
  key and `serverTime`; `lookupEntryTicket` also takes live codes, refusing with
  `404 LIVE_CODE_INVALID` or `409 LIVE_CODE_EXPIRED`, and otherwise answers as in `017` plus
  `verifiedBy` (R4, R5). `admitTicket` does not change, so one entry per ticket stays guaranteed by
  the same row-locked `UPDATE` (R6).
- **Customer app**: **Show entry code** on each valid, unused ticket opens a live QR code with a
  countdown, following the Backend's clock, held in memory only, and working with no signal while
  the page stays open (R5, R8).
- **Sign-in with no signal**: the shared `AuthProvider` no longer ends the session when a token
  renewal fails for lack of network, only when Keycloak refuses it; otherwise the 5-minute access
  token's failed renewal would redirect away from the live code within minutes. It signs in again
  when the browser is back online or an API call returns `401`. All three apps share the provider
  (R12).
- **Ticket Booth app**: recognizes a live code when scanned; a verified one shows "No ID check
  needed" with **Admit** and **Admit all**; expired and invalid codes are refused with their reason
  (R9).

Contract **1.11.0** lands in this spec and plan PR with types regenerated and the two new codes in
`ERROR_CODES`. `getTicketEntryKey` is marked `x-planned: '018'`; `verifiedBy` is declared but not
yet required. The implementation removes the marker and adds `verifiedBy` to `required`. `main`
stays green (R7). No constitution change.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node.js 22 LTS

**Primary Dependencies**: unchanged. No new npm package: HMAC-SHA256 comes from the Web Crypto API
built into Node.js 22 and every current browser (`globalThis.crypto.subtle`); the QR code is drawn
with `qrcode-generator` and read with `jsqr`, both added by `017`. The database gains the `pgcrypto`
extension, which ships with the PostgreSQL 17 image (R1).

**Storage**: PostgreSQL 17. One `BYTEA NOT NULL` column with a database default, one CHECK, and
`CREATE EXTENSION pgcrypto`, in one migration ([data-model.md](./data-model.md)).

**Testing**: Backend Jest + Supertest + Testcontainers with contract validation and a `FakeClock`
for exact window boundaries; the 20-admit race mixing live and printed lookups; authorization on
the new operation; a no-leak check across responses. Shared, Customer, and Ticket Booth apps on
Vitest + React Testing Library, with fake timers for windows, a wrong device clock, and no signal.
Browser round trip with a webcam and a phone camera in [quickstart.md](./quickstart.md).

**Target Platform**: the existing Docker Compose stack on one laptop; the Customer app at phone
width, the Ticket Booth app in a desktop browser with a webcam.

**Project Type**: web application (one Backend, three front ends).

**Performance Goals**: a live-code check is one primary-key read and one HMAC before 017's lookup.
The Customer app recomputes one HMAC per 30 seconds, and checks the clock 4 times a second. Scan to
admitted in under 5 seconds (SC-003).

**Constraints**: one entry per ticket under concurrency, whichever code (FR-015, Constitution IV);
the secret never printed, shown, logged, or returned except to its buyer (FR-006); the key in memory
only (FR-010, Constitution V); the Backend's clock decides (FR-009); printed and typed codes keep the
ID check (FR-014); every rule from `017` still holds.

**Scale/Scope**: 1 new operation; 1 changed operation (`lookupEntryTicket`); 2 new error codes; one
new Customer screen; laptop scale.

## Constitution Check

Evaluated against constitution **v3.2.1**.

| Principle | Pre | Post | Evidence |
|---|---|---|---|
| **I. API-Only, Contract First** | PASS | **PASS** | Contract 1.11.0 and regenerated types in this PR, before any code. The new operation declares its request, response, role, headers, and every error; the new codes use the standard envelope and are in `ERROR_CODES`. `x-planned` keeps the route-coverage test meaningful; `verifiedBy` becomes required with its implementation (R7). Both front ends call through the generated client. |
| **II. One Repo, One Command** | PASS | **PASS** | No new service, variable, or secret to configure. One migration applied by the existing startup; `pgcrypto` is in the stock image. No new npm dependency. |
| **III. Spec-Driven, Reviewed** | PASS | **PASS** | Issue #41; number reserved by PR #65; spec, clarifications, and plan on `018-rotating-qr-codes-spec`, reviewed by a second Claude session before the PR; implementation on `018-rotating-qr-codes-impl` in a fresh session, cut from the spec branch while this PR is open and opened as a PR only after it merges, closing #41 (and only that PR says "fixes"). |
| **IV. Server-Authoritative, DB-Guaranteed** | PASS | **PASS** | The Backend verifies every live code and says so in `verifiedBy`; the Ticket Booth only shows it (R4). One entry per ticket stays the row-locked `UPDATE` of spec 017 R4, unchanged (R6). The live-code window guards no write, so it needs no database guarantee (R3). Every Backend refusal is shown as an explicit state. |
| **V. Sign-In Everywhere** | PASS | **PASS** | `getTicketEntryKey` is `customer` only and owner only; `lookupEntryTicket` stays `gate-agent` only; both tested for missing, expired, wrongly signed, wrong-audience, and wrong-role tokens. The entry key is held in memory only, like tokens, and sent `no-store`. No identity data is added. A renewal that fails for lack of network keeps the user in memory instead of ending the session (R12): tokens stay in memory only, an expired one is refused by the Backend with `401`, and logout still ends both sessions. |
| **VI. Test-First, Real Database** | PASS | **PASS** | Tests precede code in `tasks.md`, including the Backend's refusal tests (expired, forged) and the shared sign-in provider's no-network tests, which come before the code they cover in Phase 3; window boundaries tested on both sides to the millisecond with a controlled clock; the race tested with 20 simultaneous requests on real PostgreSQL; the secret's CHECK and backfill tested on the real migration. The 80% floor is a recorded deferral until `010` and `011`; this feature reports its coverage. |
| **VII. Function Over Finish, One Shared Look** | PASS | **PASS** | The live-code screen uses theme values only; the QR is black on white because a scanner needs it, as spec 017's print view already is. States use words and symbols, not color alone. No new theme value. |
| **VIII. Staged Simplicity** | PASS | **PASS** | No wallet passes, no secret rotation, no offline admits, no auto-admit, no relay protection (spec Out of Scope). No security or correctness control is deferred: real-time relay and a buyer handing on their own secret are accepted risks named in the spec, each equivalent to handing over the ticket, which still enters once. |

## Project Structure

```text
specs/018-rotating-qr-codes/
├── spec.md, plan.md, research.md (R1–R12), data-model.md, quickstart.md (S0–S8), tasks.md
├── checklists/requirements.md
└── contracts/README.md

contracts/~ openapi.yaml                                     # 1.11.0, x-planned (this PR)
packages/shared/src/~ api-schema.ts                          # regenerated (this PR)
packages/shared/src/~ errors.ts                              # 2 new codes (this PR)

# Implementation PR:
packages/shared/src/+ live-code.ts, ~ entry.ts (verifiedBy, TicketEntryKey), ~ index.ts   # R2, R3
packages/shared/test/+ live-code.test.ts
packages/shared/src/web/~ auth-provider.tsx                  # renewal without network (R12)
packages/shared/test/web/~ auth-provider.test.tsx
backend/
├── prisma/~ schema.prisma, migrations/+ <timestamp>_live_codes/migration.sql   # R1
├── src/
│   ├── common/+ clock.ts                                    # CLOCK provider (R3)
│   ├── prisma/~ prisma.service.ts                           # global omit of entrySecret (R1)
│   ├── entry/~ entry.service.ts, + live-code-check.ts, ~ dto/entry-lookup.dto.ts (80),
│   │         + entry-key.controller.ts, ~ entry.module.ts   # R4, R5
│   └── ~ app.module.ts                                      # CLOCK, if not in a shared module
└── test/
    ├── integration/+ entry.live-code.e2e-spec.ts, + entry.live-boundaries.e2e-spec.ts,
    │               + entry.live-refusals.e2e-spec.ts,
    │               + entry.live-race.e2e-spec.ts, + entry-key.e2e-spec.ts,
    │               + entry-key.authz.e2e-spec.ts, + live-codes.constraints.e2e-spec.ts,
    │               + entry-secret.no-leak.e2e-spec.ts; ~ entry.lookup tests (verifiedBy)
    ├── contract/~ route-coverage.e2e-spec.ts               # no x-planned left
    └── setup/+ fake-clock.ts, ~ test-app.ts                # TestContext.clock
customer-app/
├── src/components/~ TicketQr.tsx                            # any alphanumeric text, label prop
├── src/+ live-code-clock.ts                                 # offset from serverTime (R3)
├── src/pages/+ EntryCode.tsx, ~ MyTickets.tsx; ~ App.tsx (route); ~ styles.css
└── test/+ entry-code.test.tsx; ~ my-tickets tests, ~ ticket-qr tests
booth-app/
├── src/~ decode.ts (live codes), ~ App.tsx (new errors), ~ EntryResult.tsx (verified result)
└── test/~ scanner.test.tsx, ~ check-in.test.tsx (+ live-code cases)
~ README.md                                                  # Today: 018 row, quickstart pointer
```

**Structure Decision**: the existing monorepo layout. Live codes extend spec 017's `entry/` module:
the key operation sits there too, since it exists only for entry, even though its route is under
`/me`. The code format lives in `packages/shared` because two workspaces must agree on it to the
bit.

## Merging with other PRs

- **No other PR is open** (2026-10-23). `main` is at 9bce234 (017 merged as PR #68).
- **Contract version**: if another spec PR merges first and takes 1.11.0, this one moves to the next
  minor version on rebase.
- **#60 (wildcard redirect URIs)**: touches the Keycloak seed only; no overlap.
- **`010`/`011` (#22, #23)**: if CI lands first, this feature's tests run in it; nothing here
  depends on it.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| The entry secret reaches the buyer's browser | FR-010 (decided 2026-10-23): codes must keep changing with no signal while the app is open | Fetching each code from the Backend fails with no signal; the residual risk (a buyer handing on their own secret) equals handing on the ticket, which still enters once (R5) |
| A custom code format instead of TOTP | FR-007 needs at least a ticket code's 60 bits; TOTP digits give 20–27 (R2) | TOTP with longer output is no longer TOTP, and still needs the ticket named in the code |
| An injectable `Clock` in the Backend | SC-001 asks for exact boundaries every run; the real clock can't be placed at a millisecond (R3) | Waiting for real windows makes tests slow and flaky; the database's `now()` can't be faked per test |
| `x-planned` on one operation, and `verifiedBy` declared but not required | Constitution I needs the contract before code; Principle III needs `main` green (R7) | The same pattern as 014–017 |
