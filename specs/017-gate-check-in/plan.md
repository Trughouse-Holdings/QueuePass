# Implementation Plan: Names on Tickets and Gate Check-In

**Branch**: `017-gate-check-in-spec` | **Date**: 2026-10-22 | **Spec**: [spec.md](./spec.md)
| **Issues**: [#39](https://github.com/Trughouse-Holdings/QueuePass/issues/39),
[#40](https://github.com/Trughouse-Holdings/QueuePass/issues/40)

**Input**: Feature specification from `specs/017-gate-check-in/spec.md`

## Summary

- **Names**: `Order.holderName`, the buyer's name for every ticket of the order, set once (research
  R1). One shared function, `holderNameProblem`, defines a valid name for the Backend and the
  Customer app; the Backend refuses with `400 HOLDER_NAME_INVALID` before taking the event lock
  (R2).
- **Entries**: `Ticket.checkedInAt` becomes the entry's time, plus who admitted it (R3). An admit is
  one conditional `UPDATE … WHERE "checkedInAt" IS NULL AND "status" = 'VALID'` with the entry
  window in the same `WHERE`, so PostgreSQL's row lock guarantees one entry per ticket, under any
  number of simultaneous admits (R4). The window is `[startsAt - 2 hours, endsAt)` on the
  database's clock (R5).
- **API**: `lookupEntryTicket` (`POST`, the code in the body) returns the ticket and its `state`;
  `admitTicket` admits one ticket or `wholeOrder`, or answers `409 ENTRY_REFUSED` with the reason.
  Both `gate-agent` only (R6).
- **Customer app**: a **Name on tickets** field; names and **Print ticket** on My tickets; a
  printable view with a QR code drawn by `qrcode-generator` (R8, R12).
- **Ticket Booth app**: choose an event, type or scan a code (`jsqr` on camera frames), see the
  ticket, check the ID, then **Admit**, **Admit all N**, or **Refuse** (R9, R11).
- **Phone camera**: the required demo uses the laptop's webcam; an optional README step uses
  Android Chrome's USB port forwarding, with no configuration change (R10).
- **Admin app**: a **Name on tickets** column on the attendee list. Reports need no change (R12).
- **Demo data**: names on every order, and "Demo Tonight", whose entry window is open when loaded
  (R13).

Contract **1.10.0** lands in this spec and plan PR with types regenerated and the three new codes
in `ERROR_CODES`. The two new operations are marked `x-planned: '017'`; `holderName` is declared
but not yet required. The implementation removes the markers and adds `holderName` to `required`.
`main` stays green (R7). This PR also carries Constitution **3.1.2**, a PATCH clarification of
Principle V for holder names (spec Clarifications).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node.js 22 LTS

**Primary Dependencies**: unchanged, plus two new front-end libraries, each with no dependencies of
its own: **`qrcode-generator` 2.0.4** (MIT) in `customer-app`, and **`jsqr` 1.4.0** (Apache-2.0) in
`booth-app` (R8, R9). The Backend gains none.

**Storage**: PostgreSQL 17. Three nullable columns and two CHECKs in one migration
([data-model.md](./data-model.md)).

**Testing**: Backend Jest + Supertest + Testcontainers with contract validation, including 20
simultaneous admits of one ticket and window boundaries on both sides. Shared, Admin, Customer, and
Ticket Booth apps on Vitest + React Testing Library, with the camera and the QR decoder stubbed.
Browser round trip with a webcam in [quickstart.md](./quickstart.md).

**Target Platform**: the existing Docker Compose stack on one laptop; the Ticket Booth app in a
desktop browser with a webcam, and at phone width.

**Project Type**: web application (one Backend, three front ends).

**Performance Goals**: a lookup is one indexed query by the unique ticket code; an admit is one
statement. Lookup to admitted holder in under 10 seconds, ID check aside (SC-002); typed lookup in
under 15 seconds (SC-003). The camera decodes about 6 frames a second at most 640 pixels wide.

**Constraints**: one entry per ticket under concurrency (FR-015, Constitution IV); no undo, no
re-entry, no record of refusals (FR-017, FR-018); the name never changes after purchase (FR-001a);
`gate-agent` only, enforced by the Backend (FR-016, Constitution V); the Ticket Booth app takes the
shared theme and defines no look (FR-022, Constitution VII); every rule from `005`, `006`, `007`,
`015`, and `016` still holds.

**Scale/Scope**: 2 new operations; 1 changed request (`createOrder`) and 3 changed responses
(`createOrder`, `listAttendees`, `listMyOrders`); 3 new error codes; the Ticket Booth app's first
real screen; laptop scale (30 gate agents, 200 customers).

## Constitution Check

Evaluated against constitution **v3.1.2** (this PR's PATCH included).

| Principle | Pre | Post | Evidence |
|---|---|---|---|
| **I. API-Only, Contract First** | PASS | **PASS** | Contract 1.10.0 and regenerated types in this PR, before any code. Each new operation declares its request, response, role, and every error; new codes use the standard envelope and are in `ERROR_CODES`. `x-planned` keeps the route-coverage test meaningful; `holderName` becomes required with its implementation (R7). The Ticket Booth app reaches the Backend only through the generated client. |
| **II. One Repo, One Command** | PASS | **PASS** | No new service or variable. One migration applied by the existing startup. Two npm dependencies installed by the existing build. The phone step is optional and changes nothing in `docker compose up` (R10). |
| **III. Spec-Driven, Reviewed** | PASS | **PASS** | Issues #39 and #40; number reserved by PR #65; spec, clarifications, and plan on `017-gate-check-in-spec`, reviewed by a second Claude session before the PR; implementation on `017-gate-check-in-impl` in a fresh session, closing #39 and #40. |
| **IV. Server-Authoritative, DB-Guaranteed** | PASS | **PASS** | One entry per ticket is guaranteed by PostgreSQL's row lock in one conditional `UPDATE` (R4), tested with 20 genuinely simultaneous admits; the entry window is in the same statement, on the database's clock (R5). The name rules are enforced by the Backend and backed by a CHECK (R2). The Customer app's name check and the Ticket Booth app's states are previews; every Backend refusal is shown, with the entered values kept. |
| **V. Sign-In Everywhere** | PASS | **PASS** | Both new operations are `gate-agent` only, checked by the server; tested for missing, expired, and wrong-role tokens. The agent is recorded by subject identifier, with the username as a display copy. Holder names are ticket data under the 3.1.2 clarification. No token in URLs or storage; the ticket code travels in a request body, not a path. |
| **VI. Test-First, Real Database** | PASS | **PASS** | Tests precede code in `tasks.md`; the guarantee is tested with simultaneous requests on real PostgreSQL; window boundaries tested on both sides; name length tested at 100 and 101 code points. The 80% floor is a recorded deferral until `010` and `011`; this feature reports its coverage. |
| **VII. Function Over Finish, One Shared Look** | PASS | **PASS** | The Ticket Booth app adopts the shared theme now that it has a function, as Principle VII says; its stylesheet uses theme values only and the drift check already scans `booth-app/src`. States use words and symbols, not color alone; theme buttons are already 44 pixels high. The print view's rules use theme values only. No new theme value. |
| **VIII. Staged Simplicity** | PASS | **PASS** | No undo, no re-entry, no refusal records, no gates or devices, no offline entry, no per-ticket names (spec Out of Scope). The phone step reuses Chrome's port forwarding instead of adding a proxy (R10). No security or correctness control is deferred: rotating codes (`018`) add protection; they don't replace a missing one, since printed and typed codes always require the ID check. |

## Project Structure

```text
specs/017-gate-check-in/
├── spec.md, plan.md, research.md (R1–R14), data-model.md, quickstart.md (S0–S10), tasks.md
├── checklists/requirements.md
└── contracts/README.md

.specify/memory/~ constitution.md                            # 3.1.2, Principle V (this PR)
contracts/~ openapi.yaml                                     # 1.10.0, x-planned (this PR)
packages/shared/src/~ api-schema.ts                          # regenerated (this PR)
packages/shared/src/~ errors.ts                              # 3 new codes (this PR)
~ README.md                                                  # constitution version (this PR)

# Implementation PR:
packages/shared/src/+ holder-name.ts, ~ index.ts             # holderNameProblem (R2)
packages/shared/test/+ holder-name.test.ts
backend/
├── prisma/~ schema.prisma, migrations/+ <timestamp>_gate_check_in/migration.sql
├── src/
│   ├── entry/+ entry.module.ts, + entry.controller.ts, + entry.service.ts,
│   │         + dto/entry-lookup.dto.ts, + dto/admit.dto.ts, + ticket-state.ts   # R4–R6
│   ├── orders/~ orders.service.ts, ~ dto/create-order.dto.ts                     # holderName (R2)
│   ├── scripts/~ demo-data.ts                                                    # R13
│   └── ~ app.module.ts
└── test/
    ├── integration/+ entry.lookup.e2e-spec.ts, + entry.admit.e2e-spec.ts,
    │               + entry.window.e2e-spec.ts, + entry.concurrency.e2e-spec.ts,
    │               + entry.authz.e2e-spec.ts, + orders.holder-name.e2e-spec.ts,
    │               + gate-check-in.constraints.e2e-spec.ts;
    │               ~ order tests from 005–016 (send holderName); ~ demo-data.e2e-spec.ts
    ├── contract/~ route-coverage.e2e-spec.ts                # no x-planned left
    └── setup/~ fixtures.ts                                  # holderName default; eventAt(dbNow ± …)
customer-app/
├── package.json                                             # + qrcode-generator 2.0.4
├── src/components/~ GetTickets.tsx, + TicketQr.tsx
├── src/pages/~ MyTickets.tsx, + PrintTicket.tsx; ~ App.tsx (route); ~ styles.css (print)
└── test/+ holder-name-field.test.tsx, + print-ticket.test.tsx; ~ my-tickets tests
booth-app/
├── package.json                                             # + jsqr 1.4.0
├── src/~ App.tsx, ~ main.tsx (theme), + api.ts, + camera.ts, + decode.ts,
│        + EventPicker.tsx, + TicketLookup.tsx, + Scanner.tsx, + EntryResult.tsx, + styles.css
└── test/~ app.test.tsx, + check-in.test.tsx, + scanner.test.tsx
admin-app/src/pages/~ Attendees.tsx; admin-app/test/~ attendees tests
~ README.md                                                  # Today, the optional phone step
```

**Structure Decision**: the existing monorepo layout. Check-in gets its own Backend module,
`entry/`, since it has its own routes and role; it reads tickets and events but writes only the
entry columns. The name rule lives in `packages/shared` because two workspaces enforce it.

## Merging with other PRs

- **Open now**: none. `main` is at a7c548d (#65, the reservation of 017 and 018).
- **Contract version**: if another spec PR merges first and takes 1.10.0, this one moves to the next
  minor version on rebase, as 015 did after 014.
- **#60 (wildcard redirect URIs)**: touches the Keycloak seed's redirect URIs. This feature adds
  none (R10), so the two don't collide.
- **`018-rotating-qr-codes`** builds on `lookupEntryTicket` and `admitTicket`; it will add a second
  kind of code to the same operations rather than new ones, so their names here are kept general.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| Two new front-end dependencies, `qrcode-generator` and `jsqr` | FR-012 needs a QR code drawn; FR-009 needs one read from camera frames. Both are small, maintained, and have no dependencies (R8, R9) | Writing a QR encoder and decoder by hand is far more code to test; the browser's `BarcodeDetector` is missing in Safari, Firefox, and Chrome on Windows; server-drawn images add an API operation and a Backend dependency |
| `x-planned` on two operations, and `holderName` declared but not required | Constitution I needs the contract before code; Principle III needs `main` green (R7) | The same pattern as 014, 015, and 016; a contract merged after the code breaks Constitution I |
| The phone step uses USB port forwarding, so phones on Wi-Fi and iPhones are not covered | Any other way to give a phone a secure origin changes the token issuer, the redirect URIs, or the services (R10) | An HTTPS proxy or a public tunnel; both rejected in R10. FR-009a is reworded to match |
