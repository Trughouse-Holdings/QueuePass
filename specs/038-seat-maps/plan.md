# Implementation Plan: Seat Maps: Venue Layouts, Prices by Level, Seats Off Sale, and the Customer Venue Map

**Branch**: `038-seat-maps-spec` | **Date**: 2026-11-13 | **Spec**: [spec.md](./spec.md) |
**Issue**: [#165](https://github.com/Trughouse-Holdings/QueuePass/issues/165)

**Input**: Feature specification from `specs/038-seat-maps/spec.md`; the seat-maps proposal John
approved on 2026-11-13.

## Summary

- **Data** (data-model.md, research R1, R16): a venue has **layouts**; a layout has **price levels**
  and **sections**; a section has **rows**; a row has **seats**, each a database row with its place
  and an optional level (seat → row → section). An event points at one layout, has a **price per
  level** and **off-sale seats**. Tickets and holds point at the seat, and the "one valid ticket /
  one live hold per seat" indexes move to the seat id (FR-025). One hand-written migration carries
  every venue, seated event and ticket over to a "Standard" layout (FR-031, FR-032).
- **API** (contracts/README.md, R2–R4, R8–R12): seats keep their `{sectionId, row, seat}` shape, now
  numbers with labels added beside them, so holds, orders, the cart and the stream keep working.
  Eleven new operations (layouts, a section's seats, event seating, the venue map and one section of
  it); `createEvent`/`updateEvent` take `layoutId`, `levelPrices` and `offSale`; the stream starts
  with a `venueMap`, and every change carries the event's seat-change `seq`, the seat's `levelId`
  and the state it left (`from`), so counts never double (R12). **Contract 1.28.0 in this PR**
  (additions, `x-planned` and `x-retired` markers), **2.0.0 in the implementation** by applying the
  committed patch `contracts/step2.diff` unchanged (R3).
- **Backend**: a new `layouts` module (import with a problem list, section lines, edit keeping ids,
  rename, duplicate, delete, the lock); event seating inside the event save (`event-setup.ts`);
  the venue map reads; holds and orders without tiers on seated events, priced per seat at purchase;
  the stream's new messages; reports, attendee lists and the gate with levels and labels.
- **Shared** (R13): a `venue-map/` component set in `packages/shared/src/web/`: an SVG map (sections
  overview, a zoomed section's seats), `use-pan-zoom.ts`, the legend, the price filter, the
  Sections list, and a stream reducer; 12 level colors and the seat-state marks in the theme.
- **Customer app** (R14): Choose seats → the venue map with the filter, zoom, Sections list, and
  `033`'s Your seats with per-seat prices; the cart and confirmations show levels and labels.
- **Admin app** (R15): a Layouts card on the venue page (import, section lines, rename, duplicate,
  delete, preview); the event form's Seating section (layout, price table, off-sale tool on the
  map); the event page's live map by state; attendee list and exports with level and price.
- **Booth app**: the seat's labels and level on the entry result.
- **Demo data** (R18): the KFC Yum! Center, its four layouts (traced section plan + generator +
  committed files) and four demo events, loaded by the reset (`029`).
- **Spec 038** amended in this PR (R20): issue #165, the 100-section limit, the carried-over levels,
  the unmapped-section cases. **Dated notes** in `007`, `015`, `033`, `035` (FR-036).
- **Constitution 3.10.0** (R3, R20): Principle I and gate 2 allow a breaking removal approved in the
  spec PR as an exact patch; roadmap rows `038` and `039`; next free `040`.
- **Spec 037** (PR #164, the Rust Admin app) ports seating screens this feature retires: 038's
  implementation merges first and 037's seating parity follows 038 (R22).
- **Independent review round 1** (2026-11-13): five blocking and twenty-two other findings, all
  addressed in this PR (research notes "review B1"… where each lands).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict), Node.js 22 LTS; NestJS 11, Prisma 6 (Backend);
React 19, Vite 6 (Admin and Customer apps); plain Node ES modules for `scripts/`.

**Primary Dependencies**: none new. SVG and Pointer Events for the map (R13, no pan/zoom
library); `openapi-fetch` and the generated `api-schema.ts`; `useSeatStream`.

**Storage**: PostgreSQL 17. Six new tables, `Section` moved to layouts, new columns on `Event`,
`Ticket`, `SeatHold`, `Order.unitPrice` nullable; one migration with the carry-over (data-model.md).

**Testing**: Jest with Testcontainers PostgreSQL (Backend), including a migration test from the
state before 038; Vitest with React Testing Library (shared, Admin, Customer, Booth); Playwright
against the `qpe2e` stack (`npm run e2e`); `node --test scripts/test/*.test.mjs` for the generator.

**Target Platform**: the Compose stack; path B on this machine.

**Project Type**: web application: Backend, three React apps, shared package, demo data.

**Performance Goals**: overview ≤ 2 s and a section ≤ 1 s on a laptop for the 22,090-seat layout
(SC-003): `getVenueMap` is one grouped count query (seats × rows × sections, left-joined to tickets,
live holds and off-sale rows, `GROUP BY section, level`), a few kB; `getVenueMapSection` ≤ 900 seats
for the Yum! Center, about 50 kB; the overview draws ≤ 100 polygons, never seats (FR-029). Live
changes within 2 s (SC-004), as `015`. An import of 30,000 seats in one transaction with
`createMany` batches of 5,000.

**Constraints**: Constitution I (contract first, two steps, R3), III (two PRs; shared surface in this
PR: the constitution, the contract, `api-schema.ts`, `errors.ts`), IV (every seat rule in the
Backend under the event lock; uniqueness by partial unique indexes on the seat; deleting a sold or
held seat fails in the database), V (layout writes and event seating `queuepass-admin`; maps any
signed-in user; no buyer revealed, FR-028), VI (tests first, real PostgreSQL, 10 concurrent requests,
browser tests for US2 and US3), VII (level colors and marks are theme tokens; states by shape, not
color alone), VIII (no editor, pit, best-available, versioning; each named in Out of scope).

**Scale/Scope**: the largest change since `007`. Backend: new `src/layouts/`, rewritten
`src/seating/`, changes in `events/`, `reservations/`, `orders/`, `reports/`, `entry/`, `locations/`,
`scripts/`; shared: `seating.ts`, `web/venue-map/*`, `web/use-seat-stream.ts`, `theme.css`; Admin:
about 8 components and pages; Customer: about 6; Booth: 1; e2e: 1 new file and 5 updated; about 25
new or rewritten test files.

## Constitution Check

*GATE: checked before research and again after design.*

| Principle | Check | Result |
| --- | --- | --- |
| I. Contract first | 1.28.0 in this PR: every new operation declared with request, response, role and every error, `x-planned: '038'`; new response fields optional; three new codes in the envelope and `ERROR_CODES`; `api-schema.ts` regenerated, drift check passes, all apps compile unchanged. The breaking part is the exact patch `contracts/step2.diff` (checked to apply and compile), marked `x-retired: '038'` in 1.28.0, applied unchanged by the implementation, under the rule this PR adds to Principle I (3.10.0, R3) | Pass |
| II. One command | `docker compose up --build` unchanged; the migration runs in `migrate deploy`; the Yum! Center files ship in the Backend image (JSON modules); no new service or setting | Pass |
| III. Spec-driven | Issue #165; spec + plan PR with the constitution amendment (3.10.0), independent review, fresh implementer; commits `Spec/Plan/Tasks 038: … (#165)`; `fixes #165` only in the implementation PR's description. Shared surface in this PR: the constitution, `contracts/openapi.yaml`, `api-schema.ts`, `errors.ts` (every member approves). The implementation touches shared surface again: the contract's step 2, `theme.css` (level colors and marks), `packages/shared/src/web/venue-map/` (both apps use it) | Pass |
| IV. Server-authoritative | Layout lock, prices, off-sale, holds and purchase prices decided by the Backend, the venue always locked first (layout writes: venue, layout, events; event saves: venue shared, event, layout key share; holds and orders: the event only) (R7); one valid ticket and one live hold per seat by partial unique indexes on `seatId`; a sold or held seat can't be deleted (`SET NULL` + CHECK); off-sale vs hold serialized by the event row lock; refusals keep the admin's entries (`031`, `035`) | Pass |
| V. Least privilege | Layout writes, `getEventSeating` and event seating fields `queuepass-admin`; layout and venue-map reads any signed-in user (a public map, FR-008); no response names who holds or bought a seat (FR-028); authorization tests for every new operation (missing, expired, wrong-signed, wrong-audience, wrong-role) | Pass |
| VI. Test-first, real database | Every Backend rule tested first against Testcontainers PostgreSQL, both sides of each limit (30,000 seats, 100 rows, 200 seats, 12 levels, 4 MB), the carry-over from a real pre-038 database (R16), 10 genuinely concurrent holds and orders (SC-001); app and shared tests first; browser tests for US2 and US3 (`022`); 80% per workspace | Pass |
| VII. Shared look | 12 level colors, the unavailable gray and the seat marks are tokens in `packages/shared/src/web/theme.css`, checked by its contrast tests; the map component is shared, so both apps match; states by shape and text as well as color (FR-019, SC-007); no decoration (a floor object is a labelled outline) | Pass |
| VIII. Simplicity | No editor (`039`), pit, best available, versioned layouts, canvas renderer or pan/zoom library; off-sale stored as seats, not rules; deferred items named in the spec's Out of scope; no control deferred | Pass |

Post-design: unchanged, all pass. Constitution amended to 3.10.0 (MINOR: the breaking-removal rule
in Principle I and gate 2; roadmap rows). Re-checked after review round 1: all pass.

## Project Structure

### Documentation (this feature)

```text
specs/038-seat-maps/
├── spec.md, plan.md, research.md (R1–R21), data-model.md, quickstart.md (S0–S21)
├── contracts/README.md          # 1.27.0 → 1.28.0 now; step 2 → 2.0.0 in the implementation
├── contracts/step2.diff         # the exact 1.28.0 → 2.0.0 patch the implementation applies
├── checklists/requirements.md
└── tasks.md                     # /speckit-tasks
```

### Source Code

```text
.specify/memory/constitution.md                 # 3.10.0: Principle I rule, rows 038, 039 (this PR)
contracts/openapi.yaml                          # 1.28.0 (this PR); 2.0.0 (impl: git apply step2.diff)
packages/shared/src/api-schema.ts               # regenerated (this PR, and impl)
packages/shared/src/errors.ts                   # three codes (this PR)
specs/007-, 015-, 023-, 024-, 031-, 033-, 035-…/spec.md  # dated notes (this PR)
README.md                                       # 038 row, v3.10.0 (this PR); seat maps, demo (impl)

backend/
├── prisma/schema.prisma                        # data-model.md
├── prisma/migrations/<ts>_seat_maps/           # tables, carry-over, indexes (R16)
├── src/layouts/                                # new: module, controller, service (import, lines,
│   ├── layout-file.ts                          #   edit, rename, duplicate, delete, lock), file
│   ├── layout-lines.ts                         #   checks and run expansion, grid placement,
│   └── layout-lock.ts                          #   venue → layout → events lock (R5–R7)
├── src/seating/
│   ├── seat-levels.ts                          # COALESCE level, counts by section and level (R1, R11)
│   ├── venue-map.service.ts / .controller.ts   # getVenueMap, getVenueMapSection (R11)
│   ├── event-seating.ts                        # layoutId, prices, off-sale selectors, compaction (R8, R9)
│   ├── seat-rules.ts                           # resolveSeats → seat ids, no tier rule, off sale (R10)
│   ├── seat-stream.controller.ts, seat-events.service.ts # venueMap, from, levelId (R12)
│   └── layout.service.ts, seat-map.service.ts, tier-seats.ts, dto/ # removed (step 2)
├── src/events/event-setup.ts, events.service.ts # seating in the event save; priceMax (R8, R9)
├── src/tiers/                                  # refuse a tier on a seated event
├── src/reservations/                           # seat ids, no tier, SEAT_OFF_SALE, from/level (R10)
├── src/orders/                                 # price per ticket, labels, levelName, unitPrice (R10)
├── src/reports/, src/entry/, attendees          # levels and labels (R17)
├── src/locations/                              # capacity from layouts (FR-009)
├── src/configure-app.ts                        # 4 MB JSON only on the import route (R5)
├── src/scripts/demo-data.ts, layouts/*.json    # Yum! Center venue, layouts, events (R18)
└── test/                                       # R19; fixtures/layouts/{small,bad}.json

packages/shared/src/
├── seating.ts                                  # new types, LAYOUT_LIMITS, level colors
└── web/
    ├── venue-map/{venue-map.tsx, section-view.tsx, legend.tsx, price-filter.tsx,
    │   sections-list.tsx, use-pan-zoom.ts, map-state.ts}   # R13
    ├── use-seat-stream.ts, seat-stream.ts      # venueMap snapshot, delta reducer (R12)
    └── theme.css                               # --level-*, --seat-* tokens (R13)

customer-app/src/
├── components/GetTickets.tsx                   # seated: Choose seats → venue map (R14)
├── components/SeatPicker.tsx                   # removed (the shared Sections list replaces it)
├── pages/Cart.tsx, components/OrderConfirmation.tsx, pages/MyTickets.tsx, pages/PrintTicket.tsx
└── pages/EventList.tsx, EventDetail.tsx        # price range (FR-024)

admin-app/src/
├── components/LayoutsCard.tsx                  # new, replaces LayoutCard.tsx (R15)
├── components/SectionLines.tsx                 # level column
├── components/SeatingSection.tsx               # new: event form's Seating (R15)
├── components/EventSeatMap.tsx                 # new, replaces SeatingCard.tsx and SeatGrid.tsx
├── pages/LocationForm.tsx, EventForm.tsx, Attendees.tsx, export/attendee-rows.ts
└── api/seating.ts → api/layouts.ts

booth-app/src/EntryResult.tsx                   # labels and level

scripts/layouts/yum-center/plan.json            # traced section plan (R18)
scripts/layouts/generate-yum-center.mjs         # makes the four files (R18)
scripts/test/layouts.test.mjs                   # totals, schema, deterministic

e2e/tests/038-seat-maps.spec.ts                 # new: US2, US3 (S0, S5, S6, S10–S14, S16, S17)
e2e/tests/006-007-tickets, 015-seat-holds, 031-atomic-event-create, 033-seat-hold-cart,
          035-event-form-flow .spec.ts           # layouts in place of section mappings
specs/038-seat-maps/quickstart.md               # Automation rows → Automated (impl)
```

**Structure Decision**: layouts get their own Backend module, since they are a venue resource with
their own lock and five writes; everything per event stays in `seating/` and the event save. The map
is one shared React component set because both apps draw the same layout and Constitution VII
wants them to match; each app passes how to color (price or state) and what a click does (hold or
take off sale).

## Order of work

For the EDIS demo on 2026-11-20 (R21); tasks.md numbers it.

1. **Tests first** for each step below, seen to fail.
2. **Schema and migration** with the carry-over test (R16); **contract step 2** applied and the
   retired Backend code and its tests removed in the same phase, so the branch has one seating model
   from then on (the old apps' seating screens stay red until their phase moves them).
3. **Layouts API**: import with problems, lines, edit, rename, duplicate, delete, lock, capacity
   (R5–R7).
4. **Yum! Center** section plan, generator, files; demo venue, layouts, events in `demo-data.ts`
   (R18). *Demo data usable from here.*
5. **Event seating** in the event save; `getEventSeating`; capacity, base price, `priceMax` (R8, R9).
6. **Venue map reads**, the stream's `venueMap` and changes (R11, R12).
7. **Holds and orders** across levels, labels and prices on tickets; concurrency test (R10).
8. **Shared map component**, pan/zoom, theme tokens, Sections list, stream reducer (R13).
9. **Customer flow**: Choose seats, filter, zoom, Your seats, cart (R14). *Demo path complete.*
10. **Admin**: Layouts card, Seating section with the off-sale tool, event page map (R15).
11. **Reports, attendees, exports, Booth** (R17).
12. Check that no `x-planned: '038'` or `x-retired` marker is left; browser tests; quickstart's
    Automation rows; README; `npm run ci`; e2e; review; walk; PR.

## Complexity Tracking

| Choice | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| Contract in two steps, the second an exact patch applied by the implementation PR (R3) | Constitution I wants the change reviewed before code; Principle III wants `main` green and accurate at every merge; the contract tests validate every response strictly, so a breaking change merged early turns `main` red | All in the spec PR breaks `main`; all in the implementation PR skips review; keeping the retired operations forever leaves two seating models; deferring removals to `039` makes the route-coverage test fail between the merges. This PR amends the constitution (3.10.0) so the rule is written, not inferred |
| More than 12 levels on a carried-over layout (R16) | One level per old section is the only way every existing event keeps every seat's price, since events at one venue mapped sections to different ticket types | Merging sections into ≤ 12 levels would change what some existing seats cost; the limit stays for every new layout |
