# Implementation Plan: Event Form Flow

**Branch**: `035-event-form-flow-spec` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md) |
**Issue**: [#134](https://github.com/Trughouse-Holdings/QueuePass/issues/134)

**Input**: Feature specification from `specs/035-event-form-flow/spec.md`

## Summary

- **The Admin event form is reworked** (research R1, R3–R7): three sections (venue and times,
  tickets and seating, details); preview errors next to the field as soon as it is wrong; a live
  seat total that names what is left; submit never sends a known problem and focuses the first
  field at fault; a server refusal is shown only beside its field, with focus, not in a banner at
  the top; locked fields on edit show why. Scheduling stays `031`'s one request.
- **`updateEvent` takes the setup** (R8): optional `reservedSeating` and `tiers` (`EventTierInput`
  plus optional `id`) on `PATCH /events/{id}`; without them, unchanged. With them, one transaction
  saves the details, the complete ticket types, and the seating, or saves none of that request.
  `id` is refused on `createEvent`. Contract 1.25.0 → 1.26.0, on `main` as it stands. If spec
  `034` (PR #153) merges first, this branch rebases and takes 1.27.0 on top (research R10, R12).
- **Tests** (R11): Backend integration on real PostgreSQL, every refused setup-update leaving the
  event unchanged, a failure after the first write, planner unit tests; Admin tests for the
  preview, totals, focus, locks, and one update request; one browser test that fills a layout.
- **Constitution 3.9.6** (R12): roadmap row `035`, on top of `033`'s 3.9.5. Number 034 is reserved
  by open PR #153 and is not claimed here.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict), Node.js 22 LTS; NestJS 11 and Prisma 6 (Backend);
React 19 with Vite 6 (Admin app).

**Primary Dependencies**: none new. The Backend reuses `planEventSetup`, the event row lock, and
the hold-closing helpers `SeatMapService.update` already calls; the Admin app reuses the shared
theme's `field__hint`, headings, and status styles, and `fieldErrors` from `031`.

**Storage**: PostgreSQL 17. No schema change (data-model.md): `Event`, `TicketTier`, `SectionTier`
as they are, written in one transaction on an update that includes the setup.

**Testing**: Jest with Testcontainers PostgreSQL (Backend integration) and Jest unit tests; Vitest
with React Testing Library (Admin app); Playwright against the `qpe2e` Compose stack
(`npm run e2e`). Research R11. Docker is not assumed on every machine; CI's `e2e` job walks the
browser tests when the stack cannot be started locally (path B / this constraint recorded in
tasks).

**Target Platform**: the Compose stack (path A) or the database and Keycloak in Docker with the
Backend and apps on the host (path B).

**Project Type**: web application: the Backend's event update, the contract, and the Admin app's
event form. No Customer app, Ticket Booth, seed, or Compose change.

**Performance Goals**: an edit stays one round trip for the event and its setup (plus pictures);
the live total is computed in the page, no extra request as the admin types.

**Constraints**: Constitution I (the contract in this work, `info.version` raised, `api-schema.ts`
regenerated; the Admin app types the update body from it), III (spec and plan in this PR,
implementation in a second PR, independent review, commit citations), IV (the Backend enforces
every rule; the database guarantees what must hold under concurrency; the form keeps every value
and shows the refusal beside the field), VI (tests first, real PostgreSQL), VII (the shared theme;
no custom visual design), VIII (no new operation, error code, column, or request key; related
issues stay their own work).

**Scale/Scope**: one DTO changed and `EventTierDto` extended; `event-setup.ts` and `updateLocked`
extended; the event form and a helper module; one Admin API typing change and an availability
fetch; new Backend and Admin tests; one browser test; existing EventForm and `031` S3 tests
updated; constitution, contract, README, and dated notes in `031` (and `008` research if needed).

## Constitution Check

*GATE: checked before research and again after design.*

| Principle | Check | Result |
| --- | --- | --- |
| I. Contract first | `updateEvent`'s request gains two optional fields; `EventTierInput` gains optional `id`, refused on `createEvent`; descriptions give the order of checks and the field paths; examples on `400` and `409`; `info.version` 1.25.0 → 1.26.0; `api-schema.ts` regenerated, drift check green. Responses and error codes unchanged. The Admin app types the update from the generated schema | Pass |
| II. One command | No Compose, seed, or environment change; `docker compose up --build` unchanged | Pass |
| III. Spec-driven | Spec, plan, constitution row (3.9.6), and contract are in this spec PR (`035-event-form-flow-spec`); the implementation follows in a second PR (`035-event-form-flow-impl`), as Constitution III requires. Commits cite `035` and #134; `fixes #134` only in the implementation pull request description, never in a commit subject or body. Shared surface: the constitution, the contract, `api-schema.ts`, README (every member approves). A second-session independent review is recorded as still to do and is asked of Nathan in the pull request | Pass |
| IV. Server-authoritative | Every rule of `004`, `005`, `007`, `015`, `016`, `031` applied by the Backend inside the update transaction; under concurrency guaranteed by the same locks and constraints as today's update, tier, and seating writes; the form's checks are a preview; the form keeps every value and shows the refusal beside its field | Pass |
| V. Least privilege | `updateEvent` stays `queuepass-admin` only; `getEventAvailability` is already open to any signed-in caller; no role, token, or realm change | Pass |
| VI. Test-first, real database | Integration tests on Testcontainers PostgreSQL written first: each refused setup-update leaves the event unchanged, a failure after the first write leaves it unchanged; Admin tests; a browser test (research R11) | Pass |
| VII. Shared look | Sections, totals, and messages use the theme's headings, `field__hint`, and existing banners/status; no new visual design (Principle VII, the issue's usability work) | Pass |
| VIII. Simplicity | Optional fields on the existing update; no new operation, error code, column, or dependency; no request key; #128, #130, #49, #44 stay their own issues; no control removed | Pass |

Post-design: unchanged, all pass. Constitution amended to 3.9.6 (PATCH, roadmap row only).

## Project Structure

### Documentation (this feature)

```text
specs/035-event-form-flow/
├── spec.md, plan.md, research.md (R1–R12), data-model.md, quickstart.md (S0–S8)
├── contracts/README.md          # updateEvent's new fields, EventTierInput.id, 1.26.0
├── checklists/requirements.md
└── tasks.md
```

### Source Code

```text
.specify/memory/constitution.md                # 3.9.6, the 035 row
contracts/openapi.yaml                         # 1.26.0: EventUpdate.reservedSeating, .tiers,
                                               # EventTierInput.id, updateEvent text, examples
packages/shared/src/api-schema.ts              # regenerated
README.md                                      # 035 status row, v3.9.6
specs/031-atomic-event-create/spec.md          # dated notes: FR-013, Out of scope, banner rules
specs/008-customer-event-search/research.md    # dated note on R10's edit sequence, if still current

backend/
├── src/events/dto/event-tier.dto.ts           # optional id (R8, R9)
├── src/events/dto/update-event.dto.ts         # reservedSeating?, tiers? (R8, R9)
├── src/events/event-setup.ts                  # plan/write an update: ids, removals, sold tickets,
                                               # close holds (R8, R9)
├── src/events/events.service.ts               # updateLocked: setup when sent; publish seat changes
└── test/
    ├── unit/event-setup.spec.ts               # new branches (R11)
    └── integration/
        └── events.update-setup.e2e-spec.ts    # new: success, refusals leave the event,
                                               # failure after the first write (R11)
admin-app/
├── src/api/events.ts                          # updateEvent typed by generated EventUpdate (R9)
├── src/api/seating.ts or orders               # getAvailability already exists; form calls it
├── src/pages/event-form-checks.ts             # new: preview, totals, fieldErrors (R9)
├── src/pages/EventForm.tsx                    # sections, totals, touched errors, focus, locks,
                                               # one update request (R1, R3–R8)
└── test/
    ├── event-form-flow.test.tsx               # new (R11)
    ├── event-form-checks.test.ts              # new, the helper (R11)
    └── (existing EventForm tests)             # placement, disclosure, one update request (T0xx)
e2e/tests/035-event-form-flow.spec.ts          # new: 035 S1, fill a layout (SC-001)
e2e/tests/031-atomic-event-create.spec.ts      # no top banner required; message stays beside the field
specs/035-event-form-flow/quickstart.md        # Automation row S1 → Automated (impl)
```

## Complexity Tracking

No constitution-check violations. The optional `id` on `EventTierInput` (refused on create) is
simpler than a second schema. Extracting the form's checks is a helper, not a new workspace.
