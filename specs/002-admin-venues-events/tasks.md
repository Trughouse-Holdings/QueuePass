---
description: "Task list for Admin Venue and Event Management"
---

# Tasks: Admin Venue and Event Management

**Input**: Design documents from `specs/002-admin-venues-events/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) →
[`contracts/openapi.yaml`](../../contracts/openapi.yaml) (1.1.0, already applied),
[quickstart.md](./quickstart.md)

**Tests**: **REQUIRED and written first** (spec FR-033–FR-037, Constitution VI). In each story
phase, write the test tasks and run them to confirm they **fail** before the implementation tasks
below them.

**Organization**: by user story from [spec.md](./spec.md). US1 (venues) and US2 (events) carry
the new work. US3 (double-booking) and US4 (admin-only) are already built and tested in `001`,
so their phases are regression checks on the new delete paths.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: The user story the task belongs to (US1–US4)
- Every task names its exact file paths, relative to the repository root.

## Ground rules for whoever implements these tasks

- The contract is already at 1.1.0 and `packages/shared/src/api-schema.ts` is regenerated. **Do
  not change the contract.** If a task seems to need a change, stop and raise it.
- **No schema change and no migration** ([data-model.md](./data-model.md)).
- **Never cascade** a venue delete. `ON DELETE RESTRICT` stays the guarantee (research R7).
- Confirmation is **`window.confirm`**, not a custom modal (research R4).
- Delete lives on the **detail pages only**, not in list rows (research R3).
- Paths stay `/locations` and `/events` (research R8). UI text says "venue".
- Reuse the Admin app's existing CSS classes (`page-head`, `page-title`, `card`, `btn`,
  `btn--primary`, `banner`, `rowlink`, `pill`). Add no new styling (Constitution VII).
- Keep `001`'s sign-in behavior: every new page renders inside `RequireRole`, through `App.tsx`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the starting point is green before changing anything.

- [X] T001 Run `node scripts/check-contract-drift.mjs`, `npm test --workspace @queuepass/backend`, and `npm test --workspace @queuepass/admin-app` at the repository root. Record the baseline (expected: drift check passes, 113 Backend tests, 19 Admin app tests) in the T001 line of `specs/002-admin-venues-events/tasks.md` when you check it off. If anything fails, stop and fix it before continuing. **Baseline 2026-09-28: drift check passed, Backend 113/113, Admin app 19/19.**

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The API calls, delete helper, and banner options that both US1 and US2 use.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 [P] Add `export const deleteLocation = (id: string): Promise<void> => unwrap(api.DELETE('/locations/{id}', { params: { path: { id } } }));` to `admin-app/src/api/locations.ts`.
- [X] T003 [P] Add `export const deleteEvent = (id: string): Promise<void> => unwrap(api.DELETE('/events/{id}', { params: { path: { id } } }));` to `admin-app/src/api/events.ts`.
- [X] T004 [P] Give `ErrorBanner` in `admin-app/src/components/ErrorBanner.tsx` an optional `title?: string` prop. When it is set, use it instead of `'Could not save'`. Leave the `SCHEDULING_CONFLICT` title and every other existing behavior unchanged, so the existing tests still pass.
- [X] T005 Create `admin-app/src/hooks/use-delete.ts` exporting `useDelete({ kind, name, run, listPath })`. `kind` is `'venue' | 'event'`, `name` is the record's name, `run` calls T002 or T003, and `listPath` is `/locations` or `/events`. It returns `{ remove, deleting, error }`, and `remove()` does the following (research R4, R5):
  1. If `window.confirm(\`Delete the ${kind} "${name}"? This cannot be undone.\`)` is false, return and send nothing.
  2. Set `deleting = true`. While it is true, a second `remove()` returns immediately.
  3. On success, `navigate(listPath, { state: { notice: { kind: 'success', text: \`Deleted "${name}".\` } } })`.
  4. On `ApiError` with status `404`, `navigate(listPath, { state: { notice: { kind: 'info', text: \`"${name}" no longer exists. The list has been refreshed.\` } } })`.
  5. On any other `ApiError`, set `error` to it and `deleting = false`.
  6. On a network error (`TypeError`), set `error` to an `ApiError(0, { error: { code: 'VALIDATION_FAILED', message: "Can't reach the QueuePass service." } })` and `deleting = false`.

  Use `useNavigate` from `react-router-dom`. Depends on T002–T003.
- [X] T006 Create `admin-app/src/components/Notice.tsx`, a component that reads `useLocation().state?.notice` and renders it once: `SuccessState` for `kind: 'success'`, or a `<div role="status" className="banner">` with the text for `kind: 'info'`. Right after the first render, clear the state with `navigate(location.pathname, { replace: true, state: null })`, so a reload does not repeat the message (research R5).

**Checkpoint**: The delete calls, the confirm/delete/navigate helper, and the notice exist. Stories can start.

---

## Phase 3: User Story 1 — Maintain the Venue Catalog (Priority: P1) 🎯 MVP

**Goal**: An admin can list, **view**, create, edit, and **delete** venues. A venue that still has events cannot be deleted, and the admin is told how many events block it.

**Independent Test**: [quickstart.md](./quickstart.md) D2 and D3, plus the US1 tests below. No event-scheduling features are needed beyond creating one event to block a delete.

### Tests for User Story 1 (write first, confirm they fail)

- [X] T007 [P] [US1] Extend `backend/test/integration/locations.delete.e2e-spec.ts` (FR-004, research R7). Use `asAdmin(ctx)`, so every response is contract-validated automatically.
  - A venue named `Yum Center` with 1 event: `DELETE` returns `409`, `error.code === 'VENUE_HAS_EVENTS'`, `error.message === 'Cannot delete "Yum Center": 1 event is still scheduled there. Delete or move them first.'`, and `error.details.eventCount === 1`.
  - With 3 events: the message says `3 events are still scheduled there` and `eventCount === 3`.
  - Deleting an unknown UUID returns `404 NOT_FOUND`.
  - Deleting the same empty venue twice returns `204`, then `404`.

  Keep the existing three tests unchanged.
- [X] T008 [P] [US1] Create `admin-app/test/LocationDetail.test.tsx`. Stub `fetch` (accepting a `Request`, as in `test/pages.live-fixtures.test.tsx`) and render `<LocationDetail/>` in a `MemoryRouter` at `/locations/<id>` with route `/locations/:id`.
  - It shows the venue's name, address, and seating capacity, and its events from `GET /events?locationId=<id>`, each linking to `/events/<eventId>`.
  - For a venue with no events, it shows "Nothing is scheduled here."
  - A `404` from `getLocation` shows "This venue no longer exists." with a link to `/locations`.
  - A network error shows "Can't reach the QueuePass service."
  - It has an Edit link to `/locations/<id>/edit` and a Delete button.
- [X] T009 [P] [US1] Create `admin-app/test/delete-flows.venue.test.tsx` (FR-026, FR-027, FR-029, research R5). Use `vi.spyOn(window, 'confirm')` and a stubbed `fetch`, with routes for `/locations/:id` and `/locations` (rendering `LocationList`).
  - When confirm returns `false`, no `DELETE` request is sent.
  - Confirm then `204`: it lands on the list showing `Deleted "Yum Center".`
  - Confirm then `409` with the T007 body: it stays on the page, and a banner titled "Could not delete" shows the message. The events are still listed.
  - Confirm then `404`: it lands on the list showing `"Yum Center" no longer exists. The list has been refreshed.`, and the list was fetched again.
  - While the `DELETE` is pending, the button is disabled, and a second click sends no second request.
  - A network error shows "Can't reach the QueuePass service."
- [X] T010 [P] [US1] Add a test to `admin-app/test/pages.live-fixtures.test.tsx`: `LocationList` renders each venue name as a link to `/locations/<id>`. Leave every existing assertion unchanged.

### Implementation for User Story 1

- [X] T011 [US1] Change `remove()` in `backend/src/locations/locations.service.ts` (research R7):
  1. After `findOne(id)`, count events with `this.prisma.event.count({ where: { locationId: id } })`.
  2. If the count is greater than 0, throw `new HttpException({ error: { code: 'VENUE_HAS_EVENTS', message: \`Cannot delete "${location.name}": ${n} ${n === 1 ? 'event is' : 'events are'} still scheduled there. Delete or move them first.\`, details: { eventCount: n } } }, HttpStatus.CONFLICT)`. This envelope passes through the filter unchanged.
  3. Otherwise delete as before.

  Keep the existing comment explaining that the FK `ON DELETE RESTRICT` is the real guarantee, and add one line saying the count exists only for the message.
- [X] T012 [US1] Create `admin-app/src/pages/LocationDetail.tsx` (FR-024; data-model *Admin app view state*):
  - It loads `getLocation(id)` and `listEvents(id)` in parallel.
  - It renders a `page-head` with the venue name as the title and the address as the subtitle, plus an Edit link (`btn`) and a Delete button (`btn`, `disabled={deleting}`, text "Deleting…" while pending).
  - It renders a `card` with the seating capacity, then an "Events here" list of the venue's events: name linking to `/events/<id>`, start date and time, end date and time, soonest first (as returned). When there are none, it says "Nothing is scheduled here."
  - Delete uses `useDelete({ kind: 'venue', name, run: () => deleteLocation(id), listPath: '/locations' })`, and `error` renders as `<ErrorBanner error={error} title="Could not delete" />` above the card.
  - A `404` on load renders "This venue no longer exists." with a link to the list, and a network error renders "Can't reach the QueuePass service."
- [X] T013 [US1] In `admin-app/src/pages/LocationList.tsx`:
  - wrap each venue name cell's text in `<Link to={\`/locations/${l.id}\`} className="rowlink">`;
  - render `<Notice />` above the error banner;
  - change the header comment from "No removal control this stage; that is API-only." to "Delete lives on the venue page (spec 002 research R3)."
- [X] T014 [US1] Add `<Route path="/locations/:id" element={<LocationDetail />} />` to `admin-app/src/App.tsx`, **after** `/locations/new` so `new` is not read as an ID.
- [X] T015 [US1] Run `npm test --workspace @queuepass/backend` and `npm test --workspace @queuepass/admin-app`, and confirm T007–T010 now pass along with every earlier test.

**Checkpoint**: The venue catalog has full create, read, update, and delete, with a clear refusal. US1 is independently verified.

---

## Phase 4: User Story 2 — Schedule Events at a Venue (Priority: P2)

**Goal**: An admin can **view** and **delete** an event, in addition to the existing list, create, and edit. A deleted event frees its window.

**Independent Test**: [quickstart.md](./quickstart.md) D1, plus the US2 tests below.

### Tests for User Story 2 (write first, confirm they fail)

- [X] T016 [P] [US2] Extend `backend/test/integration/events.crud.e2e-spec.ts`: deleting the same event twice returns `204`, then `404 NOT_FOUND`, and deleting an unknown UUID returns `404`. Keep the existing "deletes an event and frees the window" test.
- [X] T017 [P] [US2] Create `admin-app/test/EventDetail.test.tsx`, rendered at `/events/<id>` with route `/events/:id`:
  - it shows the name, the venue name as a link to `/locations/<locationId>`, the start and end each **with a date** (an event from 22:00 to 02:00 the next day shows two different dates), ticket capacity, and price as `$<basePrice>`;
  - a `404` shows "This event no longer exists." with a link to `/events`;
  - a network error shows "Can't reach the QueuePass service.";
  - it has an Edit link to `/events/<id>/edit` and a Delete button.
- [X] T018 [P] [US2] Create `admin-app/test/delete-flows.event.test.tsx`. Using the same approach as T009, with routes `/events/:id` and `/events` (rendering `EventList`):
  - cancel sends no request;
  - confirm then `204` lands on the list with `Deleted "<name>".`;
  - confirm then `404` lands on a refreshed list with the "no longer exists" message;
  - the button is disabled while pending;
  - a network error shows the unreachable message.
- [X] T019 [P] [US2] Add a test to `admin-app/test/pages.live-fixtures.test.tsx`: `EventList` renders each event name as a link to `/events/<id>`. Leave every existing assertion unchanged.

### Implementation for User Story 2

- [X] T020 [US2] Create `admin-app/src/pages/EventDetail.tsx` (FR-025, FR-031):
  - it loads `getEvent(id)` and renders a `page-head` with the event name, an Edit link, and a Delete button (as in T012);
  - it renders a `card` listing: venue (a link to `/locations/<locationId>`), starts and ends (each formatted with `toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })`, so both show dates), tickets (`toLocaleString()`), and base price (`$<basePrice>`);
  - delete uses `useDelete({ kind: 'event', name, run: () => deleteEvent(id), listPath: '/events' })`, with `<ErrorBanner error={error} title="Could not delete" />`;
  - `404` and network errors are handled as in T012, with "This event no longer exists."
- [X] T021 [US2] In `admin-app/src/pages/EventList.tsx`:
  - wrap each event name in `<Link to={\`/events/${e.id}\`} className="rowlink">`;
  - render `<Notice />` above the error banner;
  - change the header comment from "No removal control this stage; that is API-only." to "Delete lives on the event page (spec 002 research R3)."
- [X] T022 [US2] Add `<Route path="/events/:id" element={<EventDetail />} />` to `admin-app/src/App.tsx`, **after** `/events/new`.
- [X] T023 [US2] Run `npm test --workspace @queuepass/backend` and `npm test --workspace @queuepass/admin-app`, and confirm T016–T019 pass along with every earlier test.

**Checkpoint**: Events have full create, read, update, and delete. US1 and US2 both work independently.

---

## Phase 5: User Story 3 — Block Double-Bookings with Clear Feedback (Priority: P3)

**Goal**: Confirm the 60-minute rule is untouched by the delete work, and that a delete really frees the window through the Admin app's own API calls.

**Independent Test**: The existing conflict suites, plus T024.

- [X] T024 [P] [US3] Add a test to `admin-app/test/delete-flows.event.test.tsx`. With a stubbed API, the Admin app's `createEvent` for 18:00–21:00 at a venue is first refused with the `SCHEDULING_CONFLICT` fixture from `test/fixtures/conflict-409.json` (the conflict banner shows). After `deleteEvent` of the blocking event returns `204`, the same `createEvent` succeeds. This proves the Admin app surfaces both states. The real freed-window guarantee is already covered by the Backend's `events.crud` "frees the window" test.
- [X] T025 [US3] Run `npm test --workspace @queuepass/backend -- events.conflict events.buffer-boundary events.concurrency events.conflict-update events.conflict-contract` and confirm every scheduling-rule test still passes unchanged (FR-013–FR-018, FR-034, FR-035).

**Checkpoint**: The double-booking rule still holds.

---

## Phase 6: User Story 4 — Only Admins Can Change Venues and Events (Priority: P4)

**Goal**: Confirm deletes remain admin-only at the API, and the new pages stay behind sign-in.

**Independent Test**: [quickstart.md](./quickstart.md) D4, plus T026–T027.

- [X] T026 [P] [US4] Add a test to `backend/test/integration/carried-over.authz.e2e-spec.ts`. With `CUSTOMER` and `AGENT` tokens, `DELETE /locations/<id>` for a venue **with no events** returns `403 FORBIDDEN` and the venue still exists, so the `403` cannot be confused with the `409` path. Then rename the file to `backend/test/integration/venues-events.authz.e2e-spec.ts` and update its describe title to `Venue and event endpoints: authorization`, since `002` owns these endpoints now.
  *Done; the rename is noted on `001` task T033.*
- [X] T027 [P] [US4] Add a test to `admin-app/test/app.auth.test.tsx`: a `customer` user opening `/locations/<id>` and `/events/<id>` sees only "Your account can't use this app.", and no `fetch` call is made.

**Checkpoint**: All four user stories hold.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T028 [P] Update `README.md`:
  - change the `002` status row to `Done` and `Built and verified`;
  - in *What the system does*, make sure the venue and event bullets say "create, view, edit, and delete";
  - in *Deliberate scope boundaries*, remove any sentence saying delete is API-only.
- [X] T029 [P] Remove the out-of-date banner from `specs/002-admin-venues-events/checklists/requirements.md`, and update that checklist's items to the current spec's requirement numbers where it cites them.
- [X] T030 Run `npm run lint`, `npx prettier --check .`, and `npx @redocly/cli@1 lint contracts/openapi.yaml` (expect only the three accepted warnings) at the repository root, and fix any findings in the files this feature touched.
- [X] T031 Rebuild with `docker compose up --build -d`, then run [quickstart.md](./quickstart.md) D1–D7 in a private browser window. Record the date and result at the bottom of `specs/002-admin-venues-events/quickstart.md` (Constitution VI, workflow gate 5).
- [X] T032 Run the root `npm test` and confirm every workspace passes. Record the per-workspace counts under the T031 record.
  *Done: 195 tests. Found and fixed a deadlock-to-500 race in `backend/src/events/events.service.ts` (retry on `40P01`) and the error filter; details in the quickstart record.*

---

## Dependencies & Execution Order

### Phase dependencies

| Phase | Depends on | Blocks |
|---|---|---|
| 1 Setup | nothing | everything |
| 2 Foundational | Setup | US1, US2 |
| 3 US1 (P1) | Foundational | nothing (US2 can run in parallel) |
| 4 US2 (P2) | Foundational | US3's T024 |
| 5 US3 (P3) | US2 (T024 uses `deleteEvent` and the event list) | nothing |
| 6 US4 (P4) | US1 and US2 (the pages must exist for T027) | nothing |
| 7 Polish | all stories | nothing |

### Within each story

1. Tests first, confirmed **failing**.
2. Then implementation, in the listed order.
3. The story's test-run task last (T015, T023, T025).

### Couplings to watch

- **T011 changes a `409` body that T009 and the `pages.live-fixtures` fixtures may assert on.**
  Update the fixture `admin-app/test/fixtures/` only if a test asserts the old generic message.
  The contract already allows both messages.
- **T014 and T022 route order**: `/locations/new` and `/events/new` must stay above `/:id`.
- **T026 renames a file** that `001`'s tasks referenced by its old name. Mention the rename in
  the T026 check-off note.

## Parallel Opportunities

**Phase 2**: T002, T003, and T004 run together. T005 follows T002–T003, and T006 is independent.

**US1 tests**, all together:

```text
T007 backend locations.delete   T008 LocationDetail.test   T009 delete-flows.venue.test   T010 list link
```

**US2 tests**, all together:

```text
T016 backend events.crud   T017 EventDetail.test   T018 delete-flows.event.test   T019 list link
```

**Across stories**: after Phase 2, US1 (T007–T015) and US2 (T016–T023) touch different pages and
different Backend specs. Their only shared file is `admin-app/src/App.tsx` (T014, T022), which
gets one route each, so merge those two edits carefully.

**US4**: T026 and T027 together.

**Polish**: T028 and T029 together.

## Implementation Strategy

### MVP: User Story 1 only

Phases 1–3. Admins can view and delete venues, with a clear refusal while events exist. **Stop
and validate** with quickstart D2 and D3.

### Incremental delivery

1. Setup + Foundational + US1 gives venue view and delete (MVP).
2. + US2 gives event view and delete, with windows freed. Verify with quickstart D1.
3. + US3 and US4 give regression proof that the rules and roles still hold. Verify with D4.
4. Polish, then the full quickstart (T031) and suite (T032).
