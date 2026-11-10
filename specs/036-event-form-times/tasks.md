# Tasks: Event Form Times

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R11),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) (contract unchanged
at 1.27.0), [quickstart.md](./quickstart.md) (S0–S7)

**Issues**: [#130](https://github.com/Trughouse-Holdings/QueuePass/issues/130),
[#128](https://github.com/Trughouse-Holdings/QueuePass/issues/128). The implementation PR's
**description** says `fixes #130` and `fixes #128`, each on its own line. The spec PR does not
close the issues. No commit message on either branch may contain "fixes #130", "closes #130",
"resolves #130", or the same for #128.

**Tests**: **REQUIRED and written first** (Constitution VI). Write the test tasks of Phase 2 and
confirm they **fail** before the implementation tasks of Phases 3 and 4.

## Ground rules

- **Commits** cite the spec, the task IDs, and the issues: `Impl 036: split date and time controls
  (T008, T009, #130, #128)`.
- **No contract change**: OpenAPI stays 1.27.0. Do not bump it in an Impl commit.
- **Do not touch** branch `034-sell-until-end-impl` or Mahdi's other work.
- **Two pull requests** (Constitution III): this branch is the spec PR; implementation is
  `036-event-form-times-impl`. One independent review of each branch before it is asked to merge.
  If a delivery was written in one session, the review is recorded as still to do.
- **`npm run ci` locally** before pushing when Docker is available. This machine may not have
  Docker; record that, and rely on CI for Backend integration and browser tests (T016). `npm run
  test:tz` as well when the Admin time tests change.
- **No merge, no push to `main`.** Each pull request asks for Nathan's review and approval; it
  claims no standing approval to merge.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US4 from spec.md

---

## Phase 1: Setup

- [ ] T001 Cut `036-event-form-times-spec` from latest `main`; `npm ci` so later failures are this
  feature's. Record any test that cannot be run on the untouched tree (no Docker).

---

## Phase 2: Tests first (all must fail before Phases 3 and 4)

- [ ] T002 [P] [US1] [US2] `admin-app/test/event-form-times.test.ts` (new; FR-001 to FR-009,
  research R1, R4, R5, R6): helpers for 15-minute options (0 to 360, labels including *At the
  start*, *1 hour before*, *1 hour 30 minutes before*, *6 hours before*); a 90-minute stored gap
  is a list value and selects "before" mode; a 10-minute gap selects "at-time" mode; "2 hours
  before" is elapsed time (a start just after a spring-forward yields a local time that is not
  two wall-clock hours earlier); joining and splitting a date and a time, including an incomplete
  pair. Must fail (the helpers do not exist yet).
- [ ] T003 [P] [US1] [US2] [US4] `admin-app/test/event-doors-open.test.tsx` retargeted (FR-001 to
  FR-008): a new event opens in "Before the start", 1 hour, and after a 7:00 PM start shows "Doors
  open at 6:00 PM" (with the abbreviation); changing the start keeps the length; switching to "At
  a set time" shows 6:00 PM and back again keeps 1 hour; in "At a set time" mode a start change
  leaves doors put, and doors more than 6 hours before the start show the range message and send
  nothing; an edit of a 90-minute gap opens in "Before the start". Existing skipped, repeated, and
  send cases are rewritten against the new controls (or against "At a set time" where they need a
  doors date and time). Must fail on the current form.
- [ ] T004 [P] [US3] `admin-app/test/event-form.tz.test.tsx` retargeted (FR-010, FR-011): fills and
  assertions use the date and time controls (or a test helper); venue-zone, skipped, and repeated
  behaviour still holds; doors following a start is the "Before the start" default, 1 hour (or the
  stored length on edit). Must fail on the current combined fields.
- [ ] T005 [P] [US1] [US3] Existing Admin tests that fill Starts, Ends, or Doors open with a
  combined `YYYY-MM-DDTHH:mm` value (`event-form-flow`, `event-create-atomic`,
  `EventForm.conflict`, `check-ins-removed`, `images-field`, `ticket-limit`, `capacity`,
  `event-seating-create`, `event-types-edit`, `delete-flows.event`, `pages.live-fixtures`, and
  any other) get a shared fill/expect helper and are updated to use it. They fail until the
  controls exist, then must pass.
- [ ] T006 [P] [US3] [US1] Existing e2e journeys that fill Starts, Ends, or Doors open
  (`020-time-zones`, `025-doors-open`, `031-atomic-event-create`, `035-event-form-flow`,
  `003-venue-event`) use a shared Playwright helper. `025`'s walk uses "Before the start" (or
  switches mode where it must set an exact time). Must fail on the current fields.
- [ ] T007 [US1] [US3] `e2e/tests/036-event-form-times.spec.ts` (new): title exactly `036 S1: an
  event with doors 2 hours before the start shows that time in the Customer app`. Schedule with
  "Before the start" set to 2 hours, start 7:00 PM, and see doors at 5:00 PM on the Customer event
  page. Must fail until the form has the mode and the length list. On the spec branch the
  quickstart S1 row stays Manual until this file lands on the impl branch.

---

## Phase 3: Helpers and the form (US1–US4)

- [ ] T008 [P] [US1] [US2] [US3] Helpers used by the form and by T002 (offset list and labels,
  mode from a stored gap, elapsed subtraction, split/join of a date and a time, "Doors open at …"
  text). Place them where Admin unit tests can import them (for example
  `admin-app/src/pages/event-form-times.ts`).
- [ ] T009 [US3] [US4] A date-and-time control pair (shared theme classes only) used for Starts,
  Ends, and Doors open in "At a set time" mode: accessible names as in research R2; `aria-invalid`
  and the existing field errors still attach; incomplete date or time is treated as empty.
- [ ] T010 [US1] [US2] [US4] Rework Doors open on `EventForm`: the mode choice; "Before the start"
  select and the resulting-time line; "At a set time" uses T009; switching keeps the instant
  (research plan note: do not snap an off-step gap to a neighbouring step); new event defaults;
  edit mode from the stored gap; start changes follow FR-006 and FR-007; range message unchanged;
  submit still sends `doorsOpenAt`.
- [ ] T011 [US3] Event-list From and To filters: confirm they stay date-only and use the same
  field styling; change only if a real inconsistency is found (research R8). Record the check in
  the PR if no code change is needed.

---

## Phase 4: WebKit in CI and remaining journeys (US3)

- [ ] T012 [US3] Playwright: in CI, add a `webkit` project limited to the event-form tests (020,
  025, 031, 035, 036, and 003 if it fills the form). Local `npm run e2e` stays Chromium-only
  unless WebKit is asked for. `scripts/e2e.mjs` installs WebKit as well as Chromium when CI (or
  the WebKit opt-in) is set. Do not run the whole suite in WebKit (`028` / `001` V3).
- [ ] T013 [US3] Flip quickstart S1 to `Automated: \`036 S1: an event with doors 2 hours before
  the start shows that time in the Customer app\`` on the **impl** branch only, once T007 exists
  there.

---

## Phase 5: Checks and pull requests

- [ ] T014 Run the Admin tests that changed, including `npm run test:tz` for the tz file, and
  `npm run lint` / `npm run format:check`. Fix failures that this feature caused.
- [ ] T015 Tick Phase 2–4 tasks that were done; record local runs in this file.
- [ ] T016 Record that full `npm run ci` and `npm run e2e` could not be run locally if Docker is
  missing; CI is the first full run of Backend integration and the browser tests, including
  WebKit.
- [ ] T017 Independent review of each branch (Constitution III). If this delivery is one session,
  leave the review record empty and say so in the PR: still to do.
- [ ] T018 Open the spec PR against `main` and the impl PR (draft) against the spec branch. Impl
  PR body includes `fixes #130` and `fixes #128`. Neither PR is merged in this work. Update the
  README 036 status columns on the impl branch (tasks and build).

---

## Dependencies

- Phase 2 before Phases 3 and 4 (tests first).
- T008 before or with T010; T009 before or with T010.
- T007 before T013.
- T014 after the form and the tests pass locally.

## Notes

- Open questions for Nathan are the recommended answers in the spec clarifications (steps, no API
  change, elapsed time, default/edit mode, start-move in "At a set time", date+time controls, and
  not snapping off-step gaps).
- T021-style review is T017 here.
