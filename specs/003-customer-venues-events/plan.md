# Implementation Plan: Customer Venue and Event Browsing

**Branch**: `003-customer-venues-events` | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-customer-venues-events/spec.md`

## Summary

Give signed-in customers a read-only view of every venue and event in the Customer app. The
Backend already serves everything this needs: `GET /locations`, `GET /locations/{id}`,
`GET /events` (with an optional `locationId` filter), and `GET /events/{id}` are open to any
signed-in user and return their lists in the order the spec asks for (research R1). So this plan
is **Customer app work only**:

- **Four read-only pages** behind `001`'s sign-in and `customer` role check: the event list at
  `/` and `/events`, an event page, the venue list, and a venue page with its events (R2, R3).
- **One small load hook** that turns an API result into loading, data, missing, and unreachable
  states, and sends a `401` back through sign-in (R4).
- **Local-time and USD formatting** that never converts money to floating point (R5).
- **No Backend, schema, contract, or dependency change** (FR-012). React Router is already a
  dependency of the Customer app.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node.js 22 LTS

**Primary Dependencies**: unchanged. React 19, React Router 7, `oidc-client-ts` and
`openapi-fetch` through `@queuepass/shared/web`. **No new dependencies.**

**Storage**: none in this app. PostgreSQL is reached only through the Backend API.
**No schema change and no migration** ([data-model.md](./data-model.md)).

**Testing**: Vitest + React Testing Library in `customer-app/test/`, with `fetch` stubbed per
route and the fake user manager from `packages/shared/test/web/`. Tests run with `TZ` pinned so
local-time output is deterministic. Manual browser round trip in [quickstart.md](./quickstart.md).

**Target Platform**: Developer laptop with Docker Desktop and a desktop browser

**Project Type**: Web system: one REST API and three single-page front ends (only the Customer
app changes)

**Performance Goals**: None beyond responsive local use (SC-001: find an event in under 30 s)

**Constraints**:
- Read-only: no create, edit, or delete control anywhere in the app (FR-009). The Backend
  already refuses customer writes with `403`; the UI simply never offers them.
- Data only through the typed shared API client with the customer's own token (FR-010). The
  existing boundary check (`scripts/check-boundary.mjs`) must stay green.
- Money stays a decimal string end to end (Constitution, *Money*).

**Scale/Scope**: 4 new pages, 1 hook, 1 format module, 1 new test file plus an updated one; a few
hundred venues and events, one page each, no pagination

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Evaluated against constitution **v2.0.0**.

| Principle | Gate | Pre | Post | Evidence |
|---|---|---|---|---|
| **I. API-Only, Contract First** | No DB access; typed client; contract unchanged | PASS | **PASS** | Every call goes through `useAuth().api`, typed by `api-schema.ts`. No contract change, so the drift check stays green. |
| **II. One Repo, One Command** | No new services or config | PASS | **PASS** | Nothing added to Compose or `.env.example`. The Customer app image builds as before. |
| **III. Spec-Driven, by PR** | Spec, plan, implementation in order, by PR | PASS | **PASS** | Spec PR, then this plan PR, then the implementation PR. |
| **IV. Server-Authoritative** | No client-side rules | PASS | **PASS** | The app renders what the Backend returns, in the Backend's order (R3). |
| **V. Sign-In Everywhere** | Every page behind sign-in and the `customer` role; logout on every page | PASS | **PASS** | All routes render inside `RequireRole role="customer"`; the header carries `LogoutButton` (R2). |
| **VI. Test-First** | Tests before code | PASS | **PASS** | `tasks.md` puts each story's tests before its pages. No persistence path is added, so no new Backend tests are required. |
| **VII. Function Over Finish** | No styling effort | PASS | **PASS** | Plain semantic HTML: headings, tables, links. No stylesheet is added. |
| **VIII. Staged Simplicity** | Nothing beyond the spec | PASS | **PASS** | No search, filters, pagination, caching, or live refresh (spec *Out of Scope*). |

**Result**: no violations.

## Project Structure

### Documentation (this feature)

```text
specs/003-customer-venues-events/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R6
├── data-model.md        # no change; fields the app reads
├── quickstart.md        # C1–C5, the running-system gate
├── contracts/README.md  # the four read operations used, unchanged
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

New paths are marked `+`, and changed ones `~`.

```text
customer-app/
├── src/
│   ├── ~ main.tsx                # AuthProvider → RequireRole → BrowserRouter → App (as admin-app)
│   ├── ~ App.tsx                 # header (nav + logout) and routes
│   ├── + format.ts               # when(), usd()
│   ├── + use-load.ts             # API result → loading | ok | missing | unreachable
│   └── pages/
│       ├── + EventList.tsx       # FR-001, FR-002
│       ├── + EventDetail.tsx     # FR-005
│       ├── + VenueList.tsx       # FR-003
│       └── + VenueDetail.tsx     # FR-004
└── test/
    ├── ~ app.test.tsx            # sign-in, wrong role, logout, no change controls
    └── + browse.test.tsx         # lists, order, details, empty, missing, local time, USD

~ README.md                       # status: 003 built; Customer app row
```

**Structure Decision**: The existing monorepo. `003` touches only `customer-app/` and the README.
It follows the Admin app's layout (`main.tsx` owns the providers, `App.tsx` owns the routes) so
tests can mount `App` inside a `MemoryRouter`.

## Complexity Tracking

No entries. The feature adds no abstraction beyond one hook shared by four pages.
