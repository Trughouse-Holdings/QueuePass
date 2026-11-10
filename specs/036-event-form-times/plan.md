# Plan: Event Form Times

**Feature**: `036-event-form-times`  
**Issues**: [#130](https://github.com/Trughouse-Holdings/QueuePass/issues/130),
[#128](https://github.com/Trughouse-Holdings/QueuePass/issues/128)  
**Constitution**: 3.9.8 (PATCH; this PR). Contract: unchanged at **1.27.0**.

## Summary

The Admin event form, in the venue-and-times section (`035`), gains two ways to set doors open
(only one visible): a 15-minute-step length before the start (default 1 hour on a new event) with
the resulting time shown, or a date and a time. Switching keeps the same instant. Starts, Ends,
and doors in date-and-time mode are each a date control and a time control. The form still sends
`doorsOpenAt`. No Backend or OpenAPI change.

## Technical Context

- **Admin app**: `admin-app/src/pages/EventForm.tsx` and the time helpers it already uses
  (`resolveField`, `toLocalDateTime`, `doorsOpenProblem`, `doorsOpenRangeMessage`). New helpers
  for joining a date and a time, listing offset options, deciding the edit mode, and formatting
  the "Doors open at …" line, kept next to the existing form-check helpers so unit tests can
  cover them without the page.
- **Styling**: shared `field` / `field-row` / `choice` classes only (Constitution VII).
- **Tests**: Admin unit and page tests first (doors modes, offset math, date/time joining, DST
  length, existing `event-doors-open` and `event-form.tz` retargeted). Browser test: schedule with
  doors 2 hours before the start, see the time in the Customer app; the same event-form journeys
  also run in WebKit in CI.
- **e2e runner**: CI installs WebKit as well as Chromium; the `webkit` project is limited to the
  event-form specs. Local `npm run e2e` stays Chromium-only.
- **Out of this plan**: Backend, Prisma, OpenAPI, Customer and Booth behaviour, Mahdi's
  `034-sell-until-end-impl`.

## Constitution Check

- I (contract): no change; `doorsOpenAt` remains the request field.
- III (two PRs, citations, independent review): spec PR then impl PR; one independent review of
  each branch (done 2026-11-10, findings fixed; see each PR).
- IV (server authority): the form previews the range; the Backend still refuses out-of-range
  doors.
- VI (tests first): failing tests before the form change.
- VII (shared theme only): native date and time controls, no custom picker.

## Project Structure

- `specs/036-event-form-times/` — this package.
- `admin-app/src/pages/` — form and helpers (impl).
- `admin-app/test/` — unit and page tests, plus a small fill helper used by existing tests (impl).
- `e2e/tests/`, `e2e/playwright.config.ts`, `scripts/e2e.mjs` — new journey, WebKit in CI (impl).

## Implementation Notes

- Keep a single internal local value (`YYYY-MM-DDTHH:mm`) per field, as today; the two controls
  only split and join it. Existing preview, skipped-time, and repeated-time logic stays on that
  value.
- Derive doors in "Before the start" mode only when the start names one moment; otherwise leave
  the resulting-time line off, and do not send doors until it does.
- Switching to "Before the start" from a gap that is not a 15-minute step (FR-014, accepted
  2026-11-10): the switch is always allowed and never snaps. The length select shows *Choose a
  length…* with no choice, the kept doors instant stays as it is (shown in the resulting-time
  line, and sent and range-checked on save) until the admin picks a length, which then applies
  from the start. Until then a start change leaves doors put, as in "At a set time".
- Switching when one side does not name one moment (FR-015): to "At a set time" with no doors
  instant yet shows empty doors controls; to "Before the start" while the doors do not name one
  moment recomputes doors from the start (kept length, else 1 hour) once the start names one. A
  derived doors time in a repeated hour carries its occurrence, so "At a set time" opens with the
  matching choice.
- Focus and messages (FR-010): a field error on Starts, Ends, or Doors open in "At a set time"
  moves focus to its date control, or to its time control when only the time is missing; both
  controls carry `aria-invalid` and `aria-describedby`. In "Before the start" the length select
  carries them and takes focus.
- The resulting-time line stays mounted as a polite live region (empty while there is nothing to
  show), so its first value is announced (FR-016); it names the day when doors fall on the day
  before the start (FR-004).
- WebKit in CI (FR-012): `e2e/playwright.config.ts` adds the `webkit` project, limited by file to
  the event-form specs, whenever `CI` is set, and `scripts/e2e.mjs` installs WebKit then. No change
  to `.github/workflows/` (not shared surface). This reverses `028` T025a's "CI stays
  Chromium-only" for those files only; a dated note in `028` records it. The whole of each listed
  file runs in WebKit, including `025`'s Ticket Booth journey.
- Fill helpers in Admin tests and e2e replace every `getByLabel('Starts').fill('…T19:00')` so
  existing journeys keep passing.

## Formal gates

Phase 0 research: [research.md](./research.md) (R1–R11).  
Phase 1 design: [data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md)
(no contract change), [quickstart.md](./quickstart.md).  
Phase 2 tasks: [tasks.md](./tasks.md).
