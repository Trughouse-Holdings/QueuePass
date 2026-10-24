# Implementation Plan: Add to Calendar

**Branch**: `019-add-to-calendar-spec` | **Date**: 2026-10-24 | **Spec**: [spec.md](./spec.md)
| **Issue**: [#50](https://github.com/Trughouse-Holdings/QueuePass/issues/50)

**Input**: Feature specification from `specs/019-add-to-calendar/spec.md`

## Summary

- **Where it is made**: in the Customer app, not the Backend. A calendar file is a presentation
  format of data the customer already sees; it enforces no rule and stores nothing, and a Backend
  download would still need the token in a header and a `Blob` (research R1).
- **One module**, `customer-app/src/calendar.ts`, with no React and no new dependency (R13):
  `icsFile(entry, now)` (RFC 5545: `METHOD:PUBLISH`, one `VEVENT`, `UID:queuepass-event-<event id>`,
  `DTSTAMP`, UTC `DTSTART`/`DTEND` with `Z`, escaped `SUMMARY` and `LOCATION`, folded at 75 octets on
  UTF-8 boundaries, CRLF; R3–R7), `googleCalendarUrl(entry)` (`render?action=TEMPLATE`, `dates` in
  UTC, no `ctz`; R8), `icsFileName(name)` (R12), and `calendarEligible(order, nowMs)` (not cancelled,
  not ended, a valid ticket; R10).
- **My tickets**: each eligible order card gets an "Add to calendar" group after the event's details:
  a button **Add to Apple Calendar or Outlook** that saves `<event-name>.ics` as
  `text/calendar;charset=utf-8`, a link **Add to Google Calendar** that opens a new tab, and the
  snapshot note. Outlook is served by the file; no Outlook web link (R9, R11).
- **API**: contract **1.12.0** adds `address` to `OrderEvent.location` in `listMyOrders`, so the
  entry has the venue's full address (FR-012). Declared but not required in this PR; the
  implementation sends it and makes it required (R2). The Backend change is one field in
  `OrdersService.mine()`. No new operation, no new error, no schema migration.
- **Time zones**: UTC instants throughout, so the file is identical in every zone and correct
  whatever `020` decides (R5).
- **Tested many times** (Mahdi, 2026-10-24): generator tests under four `TZ` values in the suite and
  three from the shell, through `CALENDAR_TEST_TZ`, because the Customer app's Vitest config pins
  `TZ` to New York for every run, CI included, so a plain `TZ=` would change nothing (R5); every
  affected workspace's suite three times in a row; `npm run ci` locally;
  CI green on GitHub before merge; the running-system walk with two events; at least two independent
  review rounds on each branch (tasks.md, ground rules).

The contract change lands in this spec and plan PR, before any code (Constitution I). This worktree
has no `node_modules`, so `api-schema.ts` was updated by hand to exactly what
`openapi-typescript` 7.13.0 writes for the new property (the same form as `Location.address`); the
drift check in CI (`check-contract-drift`) confirms it on this PR, and T001 reruns it locally.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node.js 22 LTS

**Primary Dependencies**: unchanged. No new npm package (R13): `Date`, `TextEncoder`,
`String.prototype.normalize`, `URLSearchParams`, `Blob`, and `URL.createObjectURL` are built into
every current browser and Node.js 22.

**Storage**: none. No schema change (data-model.md).

**Testing**: Customer app on Vitest + React Testing Library: generator unit tests in the Node
environment with exact expected files, a small reader that unfolds and unescapes, and a loop over
`TZ` values; component tests for eligibility, names, keyboard, the download, and the Google link.
Backend Jest + Supertest + Testcontainers for `address` in `listMyOrders` with contract validation.
A real calendar app and Google Calendar in [quickstart.md](./quickstart.md).

**Target Platform**: the existing Docker Compose stack on one laptop; the Customer app in a desktop
browser and at phone width; Apple Calendar, Outlook, or Google Calendar as the receiving app.

**Project Type**: web application (one Backend, three front ends).

**Performance Goals**: none beyond today's. The file is made on click from data in memory (a few
hundred bytes); **My tickets** makes no extra request.

**Constraints**: the entry holds only name, start, end, venue name and address (FR-004); times are
UTC instants (FR-005); no feed or refresh (FR-006); one `UID` per event (FR-007); the file needs no
request (FR-010); only the entry goes to Google, only on the customer's choice (FR-011); the
controls meet `008`'s usability rules and the shared theme (FR-013, FR-014).

**Scale/Scope**: 1 changed operation (one added response field); one new module and one new
component in the Customer app; one changed page; laptop scale.

## Constitution Check

Evaluated against constitution **v3.4.1**.

| Principle | Pre | Post | Evidence |
|---|---|---|---|
| **I. API-Only, Contract First** | PASS | **PASS** | Contract 1.12.0 and the matching `api-schema.ts` in this PR, before any code. The one change is an additive response field on `listMyOrders`; role, errors, and request are unchanged. `address` is declared but not required until the implementation sends it, so the response-schema tests stay green on `main` (R2). The Customer app reads it through `MyOrder`/`OrderEvent` in `packages/shared/src/order.ts`, which mirror the contract and gain `address` in the implementation (T004); the Backend's response tests check it against the contract. The file is a presentation format made in the Customer app from API data, not business logic (R1); no front end gains data access. |
| **II. One Repo, One Command** | PASS | **PASS** | No new service, variable, secret, migration, or npm dependency. |
| **III. Spec-Driven, Reviewed** | PASS | **PASS** | Issue #50; number reserved in Constitution 3.4.1; spec, clarifications (Mahdi, 2026-10-24), and plan on `019-add-to-calendar-spec`, reviewed before the PR by independent Claude sessions: at least two rounds, more until only minor findings remain (Mahdi, 2026-10-24; the constitution requires one). Implementation on `019-add-to-calendar-impl` in a fresh session from the spec and plan only, cut from the spec branch while this PR is open and opened as a PR only after it merges, with `fixes #50` in its description only. Commits cite `Spec`/`Plan`/`Tasks 019` and `#50`. |
| **IV. Server-Authoritative, DB-Guaranteed** | PASS | **PASS** | No write and no rule a write must obey. When the controls are offered is a display choice that grants and protects nothing (R10), like hiding **Show entry code** on a used ticket. Nothing to guarantee in the database. |
| **V. Sign-In Everywhere** | PASS | **PASS** | **My tickets** stays `customer` only and owner only (`listMyOrders`, unchanged). The file is made on the device: no download URL, no token in a URL, no new authentication path (R1). No account identifier goes into the file or to Google (R4, R8). |
| **VI. Test-First, Real Database** | PASS | **PASS** | Tests precede code in tasks.md: the Backend's `address` test (real PostgreSQL) before `mine()` changes; the generator's exact-file, escaping, folding, time zone, and eligibility tests before `calendar.ts`; component tests before the page changes. Boundaries tested on both sides (`endsAt` to the millisecond, 75 and 76 octets). CI runs the suite on every PR and is merge-blocking (`011`); the coverage floor is still a recorded deferral until `010`, so the PR reports coverage. |
| **VII. Function Over Finish, One Shared Look** | PASS | **PASS** | Plain button and link with the shared theme's classes; no icons, no new theme value; 44-pixel targets, phone width, keyboard, contrast as in `008` (R11). |
| **VIII. Staged Simplicity** | PASS | **PASS** | No Backend endpoint, no feed, no reminders, no Outlook web links, no library, no grouping of **My tickets** (spec Out of Scope; R1, R9, R13). No security or correctness control is deferred. |

## Project Structure

```text
specs/019-add-to-calendar/
├── spec.md, plan.md, research.md (R1–R15), data-model.md, quickstart.md (S0–S9), tasks.md
├── checklists/requirements.md
└── contracts/README.md

contracts/~ openapi.yaml                       # 1.12.0: OrderEvent.location.address (this PR)
packages/shared/src/~ api-schema.ts            # matching type (this PR)

# Implementation PR:
contracts/~ openapi.yaml                       # address joins required (T004)
packages/shared/src/~ api-schema.ts, ~ order.ts   # regenerated; OrderEvent.location.address
backend/
├── src/orders/~ orders.service.ts             # mine(): location.address; MyOrderResponse
└── test/integration/~ me-orders.e2e-spec.ts   # address, checked and pre-013 venues
customer-app/
├── src/+ calendar.ts                          # icsFile, googleCalendarUrl, icsFileName,
│                                              # calendarEligible, calendarEntry (R3–R12)
├── src/components/+ AddToCalendar.tsx         # the group: button, link, note (R11, R12)
├── src/pages/~ MyTickets.tsx                  # the group on eligible cards
├── src/~ styles.css                           # layout only, theme values (if needed)
└── test/+ calendar.test.ts, + add-to-calendar.test.tsx, ~ helpers.tsx (myOrder address)
~ README.md                                    # 019 row, Today, contract 1.12.0
```

**Structure Decision**: the existing monorepo layout. The generator lives in the Customer app, the
only user (R1); it is free of React and browser-only APIs except in the component, so it can move to
`packages/shared` if a later feature needs iCalendar elsewhere.

## Merging with other PRs

- `main` is at 6eb1f9b (Constitution 3.4.1, reserving 019 and 020).
- **`020-venue-time-zones` (#42)**, specified in parallel, will likely change the contract too (a
  venue's time zone). Contract 1.12.0 holds unless 020 merges its contract change first. Then this
  branch is rebased onto `main`, takes the next minor version (1.13.0), keeps both changes where they
  meet in `OrderEvent.location`, and regenerates `api-schema.ts` with `npm run generate:api` rather
  than merging it by hand; the drift check must pass (T001, T024). If 019 merges first, 020 does the
  same. No conflict in meaning: 019 writes UTC instants and reads only `address` (R5). If 020 changes
  how **My tickets** shows times, the calendar group sits in its own component and is unaffected.
- **`010-test-coverage`**: if it merges first, this feature's code must meet the 80% floor in
  `customer-app` and `backend`; the tests in tasks.md cover every branch of `calendar.ts`.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| A contract change for one field | FR-012: the entry needs the venue's address, and **My tickets** does not have it | Fetching each venue from the client adds requests, loading and error states, and pop-up-blocker risk for Google (R2) |
| Folding by UTF-8 octets, not characters | RFC 5545's limit is octets; splitting a character breaks Outlook (R7) | Folding by string length overflows the limit for any non-ASCII name |
| `address` declared but not required in this PR | Constitution I needs the contract before code; Principle III needs `main` green (R2) | The same pattern as 014–018 |
