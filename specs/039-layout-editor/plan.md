# Implementation Plan: Layout Editor: Draw, Arrange and Price a Venue Layout

**Branch**: `039-layout-editor-spec` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md) |
**Issue**: not filed yet (Constitution III; before the PR)

**Input**: Feature specification from `specs/039-layout-editor/spec.md`; the seat-maps proposal's
second spec (D1 option A).

## Summary

- **Where it sits** (research R1): on `038`'s implementation (PR #167, open); rebased onto `main`
  once #167 merges, and the spec PR opens then. **Contract 2.0.0 → 2.1.0** in this PR, additions
  only: `getLayoutDrawing`, `saveLayoutDrawing`, `createLayoutDrawing` (`x-planned: '039'`), four
  schemas, `DRAWN` in `LayoutSummary.source`, error code `LAYOUT_CHANGED`.
- **Data** (data-model.md, R6, R8, R9): no new tables. `Layout.revision` and `LayoutSource.DRAWN`;
  `Section.originX`, `originY`, `angle`, `generator`; six unique constraints made deferrable so one
  save can swap labels, numbers, ranks and positions.
- **API** (R3, R4): the editor reads the whole layout once (every seat with its id and own level)
  and saves it whole. A save keeps everything sent with an id (and the events' prices and off-sale
  seats on it), deletes what is not sent, makes what has none, numbers rows and seats by order,
  puts new seats off sale for the events using the layout, and refuses a stale revision, a locked
  layout, or an event left unable to sell.
- **Backend** (R5, R8, R16): `layouts.service.ts` gains the three operations in `038`'s lock order;
  the Backend draws every outline around its seats and sizes the map; checks shared with
  `layout-file.ts`; `afterLayoutChange` extracted from `replaceLines` for both edits.
- **Shared** (R5, R7): `packages/shared/src/layout-geometry.ts`, pure: the block generator (straight
  or curved rows, row lengths, labels, direction), `outlineAround`, move and turn.
- **Admin app** (R2, R10–R15): a full-page editor at `/locations/:id/layouts/new` and
  `/locations/:id/layouts/:layoutId/edit`: an SVG map from the shared map's shapes with drag, turn
  handle, box select and painting; Levels, Sections and Selection panels; Undo/Redo over a pure
  reducer; warnings before saving; refusals placed at the section; read-only for locked layouts and
  at phone width. The Layouts card gains **New layout**, **Edit** and **View**. The app moves to a
  data router so leaving with unsaved changes asks first.
- **Spec 038** gets dated notes (FR-030); no constitution change (row `039` is reserved).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict), Node.js 22 LTS; NestJS 11, Prisma 6 (Backend);
React 19, Vite 6, React Router 7 (Admin app).

**Primary Dependencies**: none new. SVG and Pointer Events for the editor (R2, no canvas library);
the shared `usePanZoom`, `map-geometry.ts` and `LayoutPreview`; `openapi-fetch` with the generated
`api-schema.ts`; React Router's `createBrowserRouter` and `useBlocker` (already installed, R13).

**Storage**: PostgreSQL 17. One migration: four `Section` columns, `Layout.revision`, an enum value,
six unique indexes replaced by deferrable unique constraints (data-model.md).

**Testing**: Jest with Testcontainers PostgreSQL (Backend), including a migration test and a
save-against-holds concurrency test; Vitest with React Testing Library (shared, Admin); Playwright
against the `qpe2e` stack for User Stories 1 and 2 (`npm run e2e`).

**Target Platform**: the Compose stack; path B on this machine. The editor targets laptop and larger
screens; read-only at ≤ 640px.

**Project Type**: web application: Backend, Admin app, shared package.

**Performance Goals** (SC-003): the Yum! Center's 22,090-seat layout opens in ≤ 3 s (one read of
about 1.4 MB, R3); dragging and turning move one SVG group, applied to the document on release
(R11); a save in ≤ 5 s (bulk `UPDATE … FROM unnest` per table, `createMany` batches of 5,000, R8).
Overlap warnings in < 100 ms (R15).

**Constraints**: Constitution I (contract first: 2.1.0 in this PR, additive), III (two PRs; shared
surface in this PR: the contract, `api-schema.ts`, `errors.ts`; in the implementation:
`packages/shared/src/layout-geometry.ts`), IV (the Backend checks every rule, draws outlines and
sizes the map, keeps the 038 lock order; the database keeps uniqueness at commit), V (all three
operations `queuepass-admin`), VI (tests first, real PostgreSQL, browser tests for US1 and US2),
VII (level colors from the theme; levels named beside their color; keyboard path for every action),
VIII (no free drawing, mirroring, snapping, export, co-editing, touch; Out of scope).

**Scale/Scope**: Backend: `src/layouts/` (service, controller, checks, a new `layout-drawing.ts`),
`configure-app.ts`, one migration, 4 test files; shared: 1 module and its test; Admin: a new
`src/layout-editor/` folder (about 10 components and 4 modules), `LayoutsCard.tsx`, `App.tsx`,
`main.tsx`, `api/layouts.ts`; e2e: 1 new file.

## Constitution Check

*GATE: checked before research and again after design.*

| Principle | Check | Result |
| --- | --- | --- |
| I. Contract first | 2.1.0 in this PR: three operations with request, response, role and every error, `x-planned: '039'`; `LAYOUT_CHANGED` in the envelope and `ERROR_CODES`; `api-schema.ts` regenerated, drift check passes; additions only (R1 on `DRAWN` in a response enum) | Pass |
| II. One command | `docker compose up --build` unchanged; the migration runs in `migrate deploy`; no new service, setting or dependency | Pass |
| III. Spec-driven | Spec + plan PR, independent review, fresh implementer; commits `Spec/Plan/Tasks 039: …`; `fixes #N` only in the implementation PR's description. **The issue is not filed yet**: it must exist before the spec PR opens (to do, with Nate's OK). Shared surface in this PR: `contracts/openapi.yaml`, `api-schema.ts`, `errors.ts`; in the implementation: `layout-geometry.ts` | Pass once the issue is filed |
| IV. Server-authoritative | Every rule decided by the Backend in one transaction: the 038 lock order (venue → layout → events), revision, lock, ids and parents, limits, events left able to sell (R8, R9); outlines and map size computed by the Backend (R5); uniqueness by deferrable constraints checked at commit; a hold racing a save is serialized by the event row lock (concurrency test) | Pass |
| V. Least privilege | `getLayoutDrawing`, `saveLayoutDrawing`, `createLayoutDrawing` `queuepass-admin`; the public map reads are unchanged; authorization tests (missing, expired, wrong-signed, wrong-audience, wrong-role) for all three | Pass |
| VI. Test-first, real database | Backend rules tested first against Testcontainers PostgreSQL, both sides of each limit, swaps of labels, ranks and names, the migration, a save racing 10 holds; generator and outline seat by seat; reducer actions and Undo; browser tests for US1 and US2 (`022`); 80% per workspace | Pass |
| VII. Shared look | The editor uses the shared map's shapes, level color tokens and pan/zoom; levels always named beside their color; warnings by outline and text; every action by keyboard with visible focus and a status line (R11); no decoration | Pass |
| VIII. Simplicity | No canvas library, no state library, no edit-operation API, no versioned layouts, no live co-editing; free drawing, mirroring, snapping, spacing, export, touch editing named in the spec's Out of scope | Pass |

Post-design: unchanged; III passes once the issue is filed.

## Project Structure

### Documentation (this feature)

```text
specs/039-layout-editor/
├── spec.md, plan.md, research.md (R1–R19), data-model.md, quickstart.md (S1–S14)
├── contracts/README.md          # 2.0.0 → 2.1.0 (this PR)
├── checklists/requirements.md
└── tasks.md                     # /speckit-tasks
```

### Source Code

```text
contracts/openapi.yaml                          # 2.1.0 (this PR)
packages/shared/src/api-schema.ts               # regenerated (this PR)
packages/shared/src/errors.ts                   # LAYOUT_CHANGED (this PR)
specs/038-seat-maps/spec.md, research.md        # dated notes (this PR)
README.md                                       # 039 row; the editor (impl)

backend/
├── prisma/schema.prisma                        # revision, DRAWN, origin, angle, generator
├── prisma/migrations/<ts>_layout_editor/       # columns, backfill, deferrable constraints
├── src/layouts/
│   ├── layout-drawing.ts                       # new: check a drawing (ids, parents), plan the save
│   ├── layout-file.ts                          # checks factored out for files and drawings (R16)
│   ├── layouts.service.ts                      # drawing, createDrawing, saveDrawing,
│   │                                           #   afterLayoutChange, revision on update; origin
│   │                                           #   and angle on import, lines, duplicate
│   ├── layouts.controller.ts, dto/             # three routes, DTOs
│   └── layout-lock.ts                          # unchanged
├── src/configure-app.ts                        # 4 MB JSON on the two drawing write routes
└── test/integration/
    ├── layouts.drawing.e2e-spec.ts             # new (R17)
    ├── layouts.drawing.concurrency.e2e-spec.ts # new
    ├── layouts.authz.e2e-spec.ts               # three operations added
    └── migration.layout-editor.e2e-spec.ts     # new

packages/shared/
├── src/layout-geometry.ts                      # new: generateBlock, outlineAround, move, turn
└── test/layout-geometry.test.ts

admin-app/src/
├── main.tsx, App.tsx                           # data router (R13); two editor routes
├── api/layouts.ts                              # drawing read, save, create
├── components/LayoutsCard.tsx                  # New layout, Edit, View
└── layout-editor/                              # new
    ├── LayoutEditor.tsx                        # page: load, toolbar, panels, guard, phone width
    ├── editor-doc.ts                           # LayoutDrawing ↔ document ↔ LayoutDrawingInput
    ├── editor-state.ts                         # reducer, selection, history, totals
    ├── overlap.ts                              # warnings (R15)
    ├── EditorCanvas.tsx                        # overview: sections, floor, drag, turn handle
    ├── SectionSeatsView.tsx                    # zoomed section: seats, row labels, box select
    ├── AddSectionForm.tsx                      # generator form; Regenerate
    ├── LevelsPanel.tsx, SectionsPanel.tsx, SelectionPanel.tsx
    └── SaveBar.tsx                             # save, warnings, refusals, save as new, reload
admin-app/test/layout-editor/*.test.ts(x)       # the editor's tests (vitest runs test/** only)

e2e/tests/039-layout-editor.spec.ts             # new: US1, US2
specs/039-layout-editor/quickstart.md           # Automation rows → Automated (impl)
```

**Structure Decision**: the editor is its own folder in the Admin app because only admins draw
layouts and it has its own state; the geometry is shared code because the Backend must draw the
same outlines the editor shows (R5); the save stays in the `layouts` module with 038's lock and
event recompute, so there is one place that changes a layout.

## Order of work

1. **Tests first** for each step below, seen to fail.
2. **Migration** (revision, `DRAWN`, origin, angle, generator, deferrable constraints) with its test;
   import, lines and duplicate write origin and angle; `update` raises the revision.
3. **Geometry**: `generateBlock`, `outlineAround`, move and turn.
4. **Backend**: `getLayoutDrawing`; checks (R16); `createLayoutDrawing`; `saveLayoutDrawing` with
   `afterLayoutChange`; the 4 MB routes; authorization; the concurrency test.
5. **Admin**: data router; `editor-doc.ts`, `editor-state.ts`; the canvas, zoomed section, panels,
   generator form, save bar, warnings; the Layouts card's buttons; read-only and phone width.
6. Browser tests for US1 and US2; quickstart's Automation rows; README; check no `x-planned: '039'`
   is left; `npm run ci`; e2e; review; walk; PR.

## Complexity Tracking

| Choice | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| Six unique constraints made deferrable (R8) | One save may swap row labels, seat labels, numbers, ranks or positions; immediate checks fail mid-statement | Parking values as `moveRanks` does has no room: labels are ≤ 5 characters and numbers have CHECK ranges; deleting and re-inserting seats drops the events' off-sale entries |
| A data router for the Admin app (R13) | `useBlocker` only works under one; without it the top bar's links leave the editor silently, losing work | A click listener on links misses back, forward and programmatic navigation |
