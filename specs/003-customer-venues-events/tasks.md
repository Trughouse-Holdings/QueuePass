---
description: "Task list for Customer Venue and Event Browsing"
---

# Tasks: Customer Venue and Event Browsing

**Input**: Design documents from `specs/003-customer-venues-events/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) →
[`contracts/openapi.yaml`](../../contracts/openapi.yaml) (1.1.0, unchanged),
[quickstart.md](./quickstart.md)

**Tests**: **REQUIRED and written first** (spec FR-013, Constitution VI). In each story phase,
write the test tasks and run them to confirm they **fail** before the implementation tasks below
them.

**Organization**: by user story from [spec.md](./spec.md). US1 (events) is the MVP. US2 (venues)
builds on it. US3 (read-only, signed-in only) mostly verifies structure the earlier phases set up.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: The user story the task belongs to (US1–US3)
- Every task names its exact file paths, relative to the repository root.

## Ground rules for whoever implements these tasks

- **Change only `customer-app/` and `README.md`.** No Backend, schema, contract, or shared-package
  change (FR-012). If a task seems to need one, stop and raise it.
- Call the API only through `useAuth().api` from `@queuepass/shared/web` (FR-010).
- Render lists in the order the Backend returns them. Do not sort in the browser (research R3).
- Never convert `basePrice` to a `number` (research R5).
- No stylesheet and no visual design (Constitution VII). Plain headings, tables, and links.

---

## Phase 1: Setup

**Purpose**: Confirm the starting point is green before changing anything.

- [X] T001 Run `node scripts/check-boundary.mjs`, `node scripts/check-contract-drift.mjs`, and `npm test --workspace @queuepass/customer-app` at the repository root. Record the baseline (expected: both checks pass, 3 Customer app tests) in the T001 line when you check it off. If anything fails, stop and fix it first. **Baseline 2026-09-28: boundary and drift checks passed, Customer app 3/3.**

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The provider layout, test harness, formatting, and load hook that every page uses.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 In `customer-app/vitest.config.ts`, add `env: { TZ: 'America/New_York' }` to `test` so local-time output is deterministic (research R6).
- [X] T003 [P] Create `customer-app/test/helpers.tsx` exporting `json(body, status)`, `stubApi(routes)` (same contract as `admin-app/test/helpers/api-stub.ts`: routes keyed `"METHOD /path"`, query ignored, unstubbed → `404`, `'network-error'` throws, every call recorded with method, path, search, and `authorization` header), and `renderCustomer({ at = '/', roles = ['customer'], username = 'customer1' })`, which mounts `AuthProvider` (fake user manager) → `RequireRole role="customer"` → `MemoryRouter initialEntries={[at]}` → `App`.
- [X] T004 [P] Create `customer-app/test/format.test.ts`: `usd('45.5')` → `$45.50`, `usd('1200.00')` → `$1,200.00`, `usd('0')` → `$0.00`, `usd('7.05')` → `$7.05`; `when('2026-12-01T23:00:00.000Z')` contains `Dec 1, 2026` and `6:00`; `when('2026-12-02T07:00:00.000Z')` contains `Dec 2, 2026`. Run it and confirm it fails.
- [X] T005 Create `customer-app/src/format.ts` with `when(iso)` and `usd(price)` per research R5, and make T004 pass.
- [X] T006 Create `customer-app/src/use-load.ts` exporting `useLoad<T>(fetch: (api) => Promise<{ data?: T; response: Response }>, deps)` returning `{ kind: 'loading' } | { kind: 'ok', data } | { kind: 'missing' } | { kind: 'unreachable' }` per research R4. A `401` calls `signIn()`. Ignore results that arrive after unmount or a dependency change.
- [X] T007 Move the providers: `customer-app/src/main.tsx` renders `AuthProvider` → `RequireRole role="customer"` → `BrowserRouter` → `App`; `customer-app/src/App.tsx` renders a `<header>` with the app name, `<nav>` links **Events** (`/events`) and **Venues** (`/venues`), and `LogoutButton`, then `<main>` with `<Routes>` (empty for now). Rewrite `customer-app/test/app.test.tsx` onto `renderCustomer` keeping its three `001` assertions (customer sees the header and logout; queuepass-admin sees "Your account can't use this app." and no request is sent; signed-out visitor sees only "Signing in…"). The greeting assertion is replaced by "header shows Events, Venues, and Log out" (spec Clarifications). Also added a logout-order test (memory cleared before the Keycloak redirect).

**Checkpoint**: `npm test --workspace @queuepass/customer-app` passes; the app builds.

---

## Phase 3: User Story 1 - Browse All Events (Priority: P1) 🎯 MVP

**Goal**: A signed-in customer lands on every event, soonest first, with venue, local times, and
price.

**Independent Test**: quickstart C1.

### Tests for User Story 1 ⚠️ write first, confirm they fail

- [X] T008 [P] [US1] In `customer-app/test/browse.test.tsx`, `describe('event list')`: stub `GET /events` with two events in Backend order and assert, at `/`, both rows render in that order with name, venue name, start and end via `when()`, and price via `usd()`; the request carried `Authorization: Bearer`. Same at `/events`. An event crossing midnight shows two different dates. An empty array shows "Nothing is scheduled yet." A network error shows "Can't reach the QueuePass service."
- [X] T009 [P] [US1] In the same file, `describe('event page')`: `GET /events/{id}` renders name, venue link to `/venues/{locationId}`, start, end, tickets, and price; a `404` shows "This event is no longer available." with a link to `/events`.

### Implementation for User Story 1

- [X] T010 [US1] Create `customer-app/src/pages/EventList.tsx`: `useLoad` on `GET /events`; a table with Event (link to `/events/:id`), Venue (link to `/venues/:locationId`), Starts, Ends, Base price. Empty and unreachable states per T008.
- [X] T011 [US1] Create `customer-app/src/pages/EventDetail.tsx`: `useLoad` on `GET /events/{id}`; a heading and a definition list of venue (link), starts, ends, tickets, base price; missing state per T009.
- [X] T012 [US1] Add routes `/`, `/events`, and `/events/:id` in `customer-app/src/App.tsx`. Make T008 and T009 pass.

**Checkpoint**: MVP. Validate with quickstart C1.

---

## Phase 4: User Story 2 - Browse All Venues and What Is On at Each (Priority: P2)

**Goal**: Venues listed by name; each venue page shows its events.

**Independent Test**: quickstart C2.

### Tests for User Story 2 ⚠️ write first, confirm they fail

- [X] T013 [P] [US2] In `customer-app/test/browse.test.tsx`, `describe('venue list')`: stub `GET /locations` with two venues in Backend order and assert rows render in that order with name (link), address, and seating capacity with separators; empty shows "No venues yet."
- [X] T014 [P] [US2] `describe('venue page')`: stub `GET /locations/{id}` and `GET /events` and assert the request carried `?locationId={id}`, the venue's details render, and its events are listed in Backend order with links; a venue with no events shows "Nothing is scheduled here."; a `404` shows "This venue is no longer available." with a link to `/venues`.

### Implementation for User Story 2

- [X] T015 [US2] Create `customer-app/src/pages/VenueList.tsx` per T013.
- [X] T016 [US2] Create `customer-app/src/pages/VenueDetail.tsx`: loads the venue and `GET /events?locationId=` together; renders per T014.
- [X] T017 [US2] Add routes `/venues` and `/venues/:id` in `customer-app/src/App.tsx`, plus a catch-all "Page not found." with links to both lists. Make T013 and T014 pass. Also covered by `app.test.tsx` "shows a plain message for an unknown address".

**Checkpoint**: Validate with quickstart C2.

---

## Phase 5: User Story 3 - Read-Only and Signed-In Only (Priority: P3)

**Goal**: Prove no page offers a change and no page shows data without the customer role.

**Independent Test**: quickstart C3 and C5.

- [X] T018 [P] [US3] In `customer-app/test/app.test.tsx`, for each of `/`, `/events/e1`, `/venues`, `/venues/v1` with every route stubbed: no button or link whose name matches `/add|new|edit|save|delete|schedule/i` exists, and every recorded request is a `GET` (FR-009, SC-003).
- [X] T019 [P] [US3] In the same file, for `/venues/v1` as `queuepass-admin` and as `gate-agent`: the wrong-role message shows and **no** request is sent (US3-3, SC-004); as a signed-out visitor: only "Signing in…" and no request (US3-2).

**Checkpoint**: all Customer app tests pass.

---

## Phase 6: Polish and Cross-Cutting Concerns

- [X] T020 [P] Update `README.md`: the Status table (003 built, tasks count), the "Today" paragraph, the Customer app row in *Start the system* ("browse venues and events"), and remove "The Customer app's venue and event listings arrive in `003`."
- [X] T021 Run `npm run lint`, `npm run build`, `node scripts/check-boundary.mjs`, and `node scripts/check-contract-drift.mjs`. All pass. **2026-09-28: lint, build, boundary, and drift all pass.**
- [X] T022 Run `npm test` (Docker running). All suites pass. Record the counts in this line. **2026-09-28 (Windows 11, Docker Desktop, with `fix/windows-test-scripts` merged): shared 22, Backend 120, Admin app 44, Customer app 30, Booth app 3, seed 3 — all pass.**
- [X] T023 `docker compose up --build -d`, then run quickstart C1–C5 in a browser. Record the result in this line. **2026-09-28: C1–C5 pass in a browser against `docker compose up --build`.**

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2 → US1 → US2 → US3 → Polish.** US2 reuses US1's links and format helpers.
- Within Phase 2: T002 and T003 first; T004 before T005; T006 and T007 after T003.
- Within each story: tests, confirm failing, then pages, then routes.

## Parallel Opportunities

- **Phase 2**: T003 and T004 together.
- **US1 tests**: T008 and T009 together. **US2 tests**: T013 and T014 together.
- **US3**: T018 and T019 together.

## Implementation Strategy

### MVP: User Story 1 only

Phases 1–3. Customers land on every event. **Stop and validate** with quickstart C1.

### Incremental delivery

1. Setup + Foundational + US1 gives the event list and event pages (MVP).
2. + US2 gives venues and each venue's events. Verify with quickstart C2.
3. + US3 gives regression proof that the app stays read-only and role-gated. Verify with C3, C5.
4. Polish, then the full suite (T022) and quickstart (T023).
