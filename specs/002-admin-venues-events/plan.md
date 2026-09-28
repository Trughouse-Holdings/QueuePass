# Implementation Plan: Admin Venue and Event Management

**Branch**: `002-admin-venues-events` | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-admin-venues-events/spec.md`

## Summary

Give QueuePass Admins full create, read, update, and **delete** for venues and events in the
Admin app. The Backend already has all ten operations, the 60-minute exclusion constraint,
the `ON DELETE RESTRICT` venue guard, and `001`'s token and role checks (research R1). So this
plan is mostly Admin app work:

- **Venue and event detail pages** (`/locations/:id`, `/events/:id`), each with Edit and
  **Delete**. The venue page lists that venue's events (research R3, R6).
- **Delete with confirmation**: native `window.confirm` naming the record. Then a success
  state on the list, a banner when a venue still has events, and a refreshed list when the
  record was already gone (R4, R5).
- **A specific venue-delete refusal** from the Backend: the service counts events so the
  `409 VENUE_HAS_EVENTS` names the venue and carries `details.eventCount`, while the foreign key
  stays the guarantee (R7).
- **Contract 1.1.0**: operations retagged from `carried-over` to `venues` and `events`, list
  orders documented for `003`, and a `VenueHasEvents` schema (R9). This is already applied, with
  types regenerated.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node.js 22 LTS

**Primary Dependencies**: unchanged from `001`. Backend: NestJS 11, Prisma 6, `jose`. Admin
app: React 19, React Router 7, `oidc-client-ts`, `openapi-fetch`, via `@queuepass/shared/web`.
**No new dependencies.**

**Storage**: PostgreSQL 17. **No schema change and no migration** ([data-model.md](./data-model.md)).

**Testing**: Backend Jest + Supertest + Testcontainers, with every response contract-validated
by `001`'s helper. Admin app Vitest + React Testing Library, with `fetch` stubbed and
`window.confirm` spied. Manual browser round trip in [quickstart.md](./quickstart.md).

**Target Platform**: Developer laptop with Docker Desktop and a desktop browser

**Project Type**: Web system: one REST API and three single-page front ends (only the Admin app
changes)

**Performance Goals**: None beyond responsive local use (SC-001: venue plus event in under 3
minutes)

**Constraints**:
- Delete is irreversible. The Admin app must confirm first (FR-026), and the Backend must never
  cascade (data-model *Deletion*).
- The Admin app changes data only through the API (FR-023). The Backend enforces the admin role
  on every delete (FR-020); hiding a button is not enforcement.
- No new Backend operations. The route-coverage test from `001` must stay green unchanged.

**Scale/Scope**: 2 new Admin pages, 2 new delete actions, 1 Backend service change, 1 contract
schema; a few hundred venues and events

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Evaluated against constitution **v2.0.0**.

| Principle | Gate | Pre | Post | Evidence |
|---|---|---|---|---|
| **I. API-Only, Contract First** | Contract changed before code; one error shape; generated types | PASS | **PASS** | Contract 1.1.0 is edited and lint-clean, and `api-schema.ts` is regenerated, before any implementation (R9). `VenueHasEvents` is still an `ErrorEnvelope`. The Admin app calls delete through the typed shared client. |
| **II. One Repo, One Command** | No new services or config | PASS | **PASS** | Nothing added to Compose or `.env.example`. |
| **III. Spec-Driven, by PR** | Spec, plan, and implementation in order, by PR | **FAIL (accepted)** | **FAIL (accepted)** | Order is followed (the spec was revised, and this plan precedes code). There are no PRs: the project owner chose to work directly on main while building 1.0. |
| **IV. Server-Authoritative, DB-Guaranteed** | Delete rules in the Backend; concurrency guaranteed by the database | PASS | **PASS** | `ON DELETE RESTRICT` remains the venue-delete guarantee, and the event count is message-only (R7). Freed windows follow from the exclusion constraint (R2). The Admin app shows refusals and does not pre-decide them. |
| **V. Sign-In Everywhere, Least Privilege** | Deletes require `queuepass-admin` at the server | PASS | **PASS** | `@Roles('queuepass-admin')` is already on both deletes, and tested for customer, agent, and no token (`carried-over.authz`, D4). |
| **VI. Test-First, Real Database** | Tests before code; real PostgreSQL; smoke test | PASS | **PASS** | The Backend delete tests run on Testcontainers. Admin delete-flow tests are listed in R10 and precede implementation in `tasks.md`. The browser round trip is quickstart D1–D6. |
| **VII. Function Over Finish** | No styling effort | PASS | **PASS** | Native `confirm` instead of a custom modal (R4). The new pages reuse the existing classes. |
| **VIII. Staged Simplicity** | Nothing beyond the spec | PASS | **PASS** | No rename to `/venues` (R8), no soft delete, no audit table, and no list-row delete buttons (R3). |

**Result**: no unjustified violations. Gate III's failure is the owner's recorded choice for
1.0.

## Project Structure

### Documentation (this feature)

```text
specs/002-admin-venues-events/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R10
├── data-model.md        # unchanged schema; deletion semantics
├── quickstart.md        # D1–D7, the running-system gate
├── contracts/README.md  # points to /contracts/openapi.yaml (1.1.0)
└── tasks.md             # /speckit-tasks output (the old list is out of date)
```

### Source Code (repository root)

New paths are marked `+`, and changed ones `~`.

```text
contracts/
└── ~ openapi.yaml                    # 1.1.0 (already applied)

packages/shared/src/
└── ~ api-schema.ts                   # regenerated (already applied)

backend/
├── src/locations/
│   └── ~ locations.service.ts        # remove(): count events → specific VENUE_HAS_EVENTS (R7)
└── test/integration/
    ├── ~ locations.delete.e2e-spec.ts   # eventCount, message, 404, delete twice
    └── ~ events.crud.e2e-spec.ts        # delete twice → 204 then 404

admin-app/
├── src/
│   ├── ~ App.tsx                     # + routes /locations/:id, /events/:id
│   ├── api/
│   │   ├── ~ locations.ts            # + deleteLocation
│   │   └── ~ events.ts               # + deleteEvent
│   ├── + hooks/use-delete.ts         # confirm → delete → navigate or error (R4, R5)
│   ├── pages/
│   │   ├── + LocationDetail.tsx      # details, its events, Edit, Delete
│   │   ├── + EventDetail.tsx         # details, venue link, Edit, Delete
│   │   ├── ~ LocationList.tsx        # name links to detail; shows success/refresh notice
│   │   └── ~ EventList.tsx           # name links to detail; shows success/refresh notice
│   └── components/
│       └── ~ SuccessState.tsx        # reused for "Deleted …" (no change if props suffice)
└── test/
    ├── + LocationDetail.test.tsx
    ├── + EventDetail.test.tsx
    └── + delete-flows.test.tsx

~ README.md                           # status: 002 built
```

**Structure Decision**: The existing monorepo. `002` confines itself to the Admin app, one
Backend service method, and the shared contract, which is shared surface that this plan has
already changed. No other front end is touched.

## Complexity Tracking

| Item | Why it is needed | Simpler alternative rejected because |
|---|---|---|
| Event count before the FK-guarded venue delete | US1-7: the admin must be told the venue still has events, and how many | The FK error alone cannot say how many, or name the venue. Dropping the FK would allow orphans under a race. |
| Two new detail pages | FR-024 and FR-025 require a view screen; delete needs a place where the admin sees what they are deleting (R3) | A delete button in list rows is the easiest place to delete the wrong record, and cannot show a venue's events. |
