---
description: "Task list for Event Form Flow"
---

# Tasks: Event Form Flow

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R12),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) (contract 1.26.0),
[quickstart.md](./quickstart.md) (S0–S8)

**Issue**: [#134](https://github.com/Trughouse-Holdings/QueuePass/issues/134). The implementation
PR's **description** says `fixes #134` on its own line. The spec PR does not close the issue. No
commit message on either branch may contain "fixes #134", "closes #134", or "resolves #134".

**Tests**: **REQUIRED and written first** (Constitution VI). Write the test tasks of Phase 2 and
confirm they **fail** before the implementation tasks of Phases 3 and 4.

## Ground rules

- **Commits** cite the spec, the task IDs, and the issue: `Impl 035: preview checks and seat
  totals (T012–T014, #134)`.
- **Contract first**: the contract (1.26.0) and `api-schema.ts` are part of this work's first
  commits (the spec PR). If a later task must change them, it amends those files in a Plan or
  Clarify commit, not silently in an Impl commit.
- **Spec `034` (PR #153)**: if it merges first, rebase, take constitution 3.9.7 and contract
  1.27.0 on top, and keep both rows and both contract changes (research R10, R12). Do not touch
  PRs #151 or #153 or their branches.
- **Two pull requests** (Constitution III): this branch is the spec PR; implementation is
  `035-event-form-flow-impl`. One independent review of each branch before it is asked to merge
  (T021). If a delivery was written in one session, the review is recorded as still to do.
- **`npm run ci` locally** before pushing (T019). `npm run test:tz` as well. Browser tests run in
  CI's `e2e` job when Docker is not available on the machine (T020).
- **No merge, no push to `main`.** Each pull request asks for Nathan's review and approval; it
  claims no standing approval to merge.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US6 from spec.md

---

## Phase 1: Setup

- [ ] T001 Cut `035-event-form-flow-spec` from latest `main`; `npm ci`; `npm run ci` green before
  any code change (the constitution, contract, and spec files may already be on the branch), so a
  later failure is this feature's. Record any test that fails on the untouched tree.

---

## Phase 2: Tests first (all must fail before Phases 3 and 4)

- [ ] T002 [P] [US4] `backend/test/integration/events.update-setup.e2e-spec.ts` (new; FR-017,
  FR-018, research R8, R11), the successes: a general-admission update that changes the name,
  updates a type, adds a type, and removes a type with no orders, in one request, leaves those as
  the event's types and no extras; a seated update remaps sections and adds a type, quantities
  follow the sections, mappings match; a body without `tiers` and `reservedSeating` is answered as
  before (only the details change). Every response passes `expectToMatchContract`. Must fail (the
  fields are unknown: `400`).
- [ ] T003 [P] [US4] Same file, the refusals (FR-018, SC-004): for each, the status, code, and
  path, and **the event's name, types, and mappings unchanged**: a repeated name
  (`409 TIER_NAME_TAKEN`, `tiers.1.name`) together with a changed event name; an unknown, foreign,
  or repeated `id` (`400`, `tiers.0.id` / `tiers.1.id`); `id` on `createEvent` (`400`,
  `tiers.0.id`, no event); removing a type that has orders (`409 TIER_HAS_ORDERS`, `tiers`);
  quantity below tickets sold (`409 CAPACITY_EXCEEDED`, `tiers.0.quantity`); switching reserved
  seating with sold tickets (`409 EVENT_HAS_ORDERS`, `reservedSeating`); remapping a section with
  sold seats (`409 EVENT_HAS_ORDERS`, `tiers.<i>.sectionIds`); a mid-write failure after the
  first change (spy on a later insert, as `031` T003) leaves the event as it was. Must fail.
- [ ] T004 [P] [US4] `backend/test/unit/event-setup.spec.ts` (existing or extended): planner
  cases for an update with ids (a kept type, a new type, a removal, a repeated id). Must fail
  where the helpers do not exist yet.
- [ ] T005 [P] [US1] [US2] [US3] `admin-app/test/event-form-checks.test.ts` (new; FR-003 to
  FR-009, research R3, R6): preview errors for an empty name, a bad price, a repeated type name
  (the `031` wording), end before start, doors out of range, quantities over capacity, a limit
  outside 1 to the capacity; each clears when the value is fixed. Seat totals: reserved 20 of 30
  with "10 seats not assigned to a ticket type," then all 30 assigned; general admission 80 of
  100 with 20 left, and over capacity is a problem. Must fail.
- [ ] T006 [P] [US1] [US2] [US3] [US5] [US6] `admin-app/test/event-form-flow.test.tsx` (new;
  FR-001 to FR-016, SC-002, SC-003, SC-006, research R11): on Schedule event, tickets and seating
  are hidden until a venue is chosen; after choosing a seated venue the live total is on the
  page; leaving Event name empty shows the error next to it and Schedule event sends no request
  and focuses the name; a repeated type name is next to type 2 and sends nothing; a server
  refusal that names `tiers.1.name` is next to that field, that field is focused, and
  `error-banner` is absent; a scheduling conflict is shown with the times, not at the top. On
  Edit event, sold counts lock reserved seating, a sold section, and Remove on a type with sales,
  each with the reason; Save sends one `PATCH /events/{id}` with `tiers` and `reservedSeating`
  (and each type's `id` when it has one). Must fail.
- [ ] T007 [P] [US2] [US3] `e2e/tests/035-event-form-flow.spec.ts` (new; S1, FR-008, SC-001):
  create a venue with three sections of 10, open Schedule event, fill a seated event that assigns
  every section, assert the live total reaches all 30 seats assigned, press Schedule event, and
  land on the event with both types; no submit-time error. Must fail (the total and headings are
  not there yet).

---

## Phase 3: Backend and contract (US4)

- [ ] T008 [US4] Contract 1.26.0 as `contracts/README.md` states: `EventUpdate.reservedSeating`
  and `.tiers`, `EventTierInput.id`, `createEvent` and `updateEvent` descriptions, examples;
  regenerate `api-schema.ts`; `node scripts/check-contract-drift.mjs` passes (FR-020, R12). (May
  already be done in the spec commits of this branch; then mark done and move on.)
- [ ] T009 [US4] `EventTierDto` optional `id`; `UpdateEventDto` optional `reservedSeating` and
  `tiers`, never `null`, the same nested validation as create (R8, R9). `createEvent` refuses
  `id` (`400`, path `tiers.<i>.id`).
- [ ] T010 [US4] `event-setup.ts`: plan and write an update (kept ids, new types, removals,
  sold-ticket and hold rules, close holds as `SeatMapService.update` does) (FR-018, R8, data
  model).
- [ ] T011 [US4] `EventsService.updateLocked`: when `tiers` or `reservedSeating` is sent, run
  today's detail checks, then the setup, all in the existing transaction; publish seat-map
  changes after commit; a request without them is unchanged (FR-017, FR-018). T002–T004 pass.

---

## Phase 4: Admin form (US1–US6)

- [ ] T012 [US1] [US2] `admin-app/src/pages/event-form-checks.ts`: the preview checks, seat
  totals, and field-error placement (extended `fieldErrors`) (FR-003 to FR-010, R3–R6). T005
  passes.
- [ ] T013 [US3] `EventForm.tsx`: the three section headings; tickets and seating only once a
  venue is chosen; section mapping and quantities as FR-002 (FR-001, FR-002, R1).
- [ ] T014 [US1] [US2] Touched-field preview errors, the live total and leftover wording, submit
  does not send a known problem and focuses the first field at fault, the polite live region
  (FR-003 to FR-009, FR-012, R5).
- [ ] T015 [US6] Server refusals placed beside the field (or with the times for a conflict, or
  next to the button for no-answer and unmapped errors), focus moved, no top banner for a
  field-mapped problem; every value kept (FR-010, FR-011, R4). Apply on edit as well as
  schedule (FR-019).
- [ ] T016 [US4] [US5] Edit sends one `updateEvent` with `tiers` and `reservedSeating` when types
  have loaded, each existing type's `id` included; pictures still after; availability is loaded
  on edit; locks and reasons as FR-013, FR-014 (R7, R8). T006 passes. Existing EventForm tests
  are updated for disclosure, placement, and the one update request, and still check the same
  outcomes (SC-007).
- [ ] T017 [US2] [US3] `e2e/tests/031-atomic-event-create.spec.ts` no longer requires
  `error-banner`; it still checks the message beside ticket type 2, the kept values, and a
  successful retry. `e2e/tests/035-event-form-flow.spec.ts` (T007) passes against a running
  stack, or is left for CI's `e2e` job if Docker is not available, recorded in T020.

---

## Phase 5: Docs, checks, review, PR

- [ ] T018 Quickstart Automation: mark S1 Automated once T007 is written; README 035 status row
  updated to the implementation's progress; dated notes in `031` (FR-013, Out of scope, banner
  rules) and in `008` research R10 if it still states the old edit sequence (FR-020, R10).
- [ ] T019 `npm run ci` green, and `npm run test:tz` green, recorded here (counts per workspace,
  coverage). Run three times if time allows, at least once before push.
- [ ] T020 Record what could not be run locally (Docker / `npm run e2e` / Compose smoke). Those
  wait for CI's `e2e` job and, if needed, a hand walk of S0–S8 on a stack of its own (S8).
- [ ] T021 Independent review (Constitution III) by a session that did not write the work, or a
  record in the pull request that this has not yet been run and is asked of Nathan or another
  session. Findings fixed, or left open with the reason.
- [ ] T022 Push each branch (not `main`) and open two pull requests, following the repo's
  spec-then-impl pattern: the spec PR (`035-event-form-flow-spec`) against `main`; the
  implementation PR (`035-event-form-flow-impl`) against the spec branch until that PR is merged,
  then retargeted to `main`. The implementation PR's body is in the same form as recent Impl PRs,
  including `fixes #134` on its own line, a Tests table, Review, and an Approval section that
  asks for Nathan's review and approval before merging, with no claim of standing approval. The
  spec PR does not close the issue. Draft a PR if anything in T019–T021 is incomplete or
  unverified. Do not merge.

---

## Review record

Left for the reviewer (T021).
