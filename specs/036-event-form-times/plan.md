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
- III (two PRs, citations, independent review): spec PR then impl PR; review recorded as still to
  do if both are opened in one session.
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
- When switching to "Before the start" from a gap that is not a 15-minute step, keep the instant
  (FR-002) and show "At a set time" until the admin picks a list value — actually FR-002 says if
  it's not a step, "At a set time" shows the time. Switching *to* "Before the start" from an odd
  gap: the nearest honest behaviour is to keep the instant visible in the resulting-time line and
  not silently round the select; the implementation should not snap to a neighbouring step.
  Recommended approach, open to review: if the current gap is not a list value, stay on "At a set
  time" and do not switch (the "Before the start" choice is not applied, or it is applied only
  after the admin also picks a length). Simpler and less surprising: **allow the switch only by
  picking a length**, or snap to the nearest step and show the new time. **Chosen: do not snap.**
  If the gap is not a step, the "Before the start" control includes no matching option; the form
  stays in "At a set time" if the admin tries to switch, and says the current gap is not a listed
  length, so they can pick "At a set time" (already there) or choose a listed length, which then
  switches and applies that length. Even simpler for v1: **switching to "Before the start" is
  always allowed; if the gap is not a step, the select shows no selection until they pick one, and
  the shown time stays as it was until they do.** That keeps the instant (FR-002) and avoids
  rounding. Open to review (research R5 supplement). Record this in tasks and the PR.
- Fill helpers in Admin tests and e2e replace every `getByLabel('Starts').fill('…T19:00')` so
  existing journeys keep passing.

## Formal gates

Phase 0 research: [research.md](./research.md) (R1–R11).  
Phase 1 design: [data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md)
(no contract change), [quickstart.md](./quickstart.md).  
Phase 2 tasks: [tasks.md](./tasks.md).
