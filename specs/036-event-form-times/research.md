# Research: Event Form Times

**Feature**: `036-event-form-times` (issues #130, #128)

**Date**: 2026-11-10

Every decision below that the issues left open was a recommended answer; Nathan accepted them all on
2026-11-10.

## R1: 15-minute steps (FR-003)

**Decision**: The "Before the start" list is every 15 minutes from 0 to 6 hours inclusive (25
choices). Labels: *At the start*, *15 minutes before*, *30 minutes before*, *45 minutes before*,
*1 hour before*, *1 hour 15 minutes before*, … *6 hours before*.

**Rationale**: #130 asks the spec to choose whole hours, half hours, or 15-minute steps, and gives
a 90-minute stored gap as the example that should be shown as it is. With 15-minute steps, 90
minutes is a normal choice. Whole hours would force many real venues (30, 45, 90 minutes) into
"At a set time" or a one-off option. Half hours would still miss 45 minutes. Twenty-five options
in a select is still short.

**Alternatives considered**: Whole hours only (smaller list, poorer fit). 30-minute steps (misses
45). A free-typed number of minutes (easier to go out of range; more error states).

## R2: Date control and time control, not a custom picker (FR-010)

**Decision**: Starts, Ends, and Doors open in "At a set time" mode are a date input and a time
input side by side, joined into the same venue-local value the form already uses
(`YYYY-MM-DDTHH:mm`). Accessible names are *Starts date*, *Starts time*, *Ends date*, *Ends time*,
*Doors open date*, and *Doors open time*. Minute precision (`step` of 60 seconds). No new picker
component and no new visual design.

**Rationale**: Issue #128 option 1. Every current browser shows a clear date picker and a clear
time picker for those types, including Safari on macOS and iOS. Option 2 (a custom picker) would
be custom visual design (Constitution VII). Option 3 (a hint on the native combined field) leaves
Safari's missing time picker in place. The form's existing skipped-time and repeated-time checks
already work on the joined local value, so they stay as they are in `020`.

**Alternatives considered**: A shared-theme custom picker. Keep `datetime-local` and add a hint.

## R3: No contract change (FR-011)

**Decision**: The form still sends `doorsOpenAt` (and `startsAt`, `endsAt`) as today, under `020`
FR-018. OpenAPI stays at **1.27.0**. The Backend is unchanged. Constitution 3.9.8 is a PATCH that
reserves the roadmap row only.

**Rationale**: #130 prefers this as the smaller change. Every other client already speaks
`doorsOpenAt`. A `doorsBeforeStartMinutes` field would force a MINOR contract bump, Backend work,
and dual support, for no new stored fact.

**Alternatives considered**: A new request field (larger, and the stored instant would still be
needed for customers and the Ticket Booth).

**Coordination**: Mahdi's `034-sell-until-end-impl` is still at contract 1.26.0 and constitution
3.9.6. This work does not bump the contract, so there is no version collision. That branch is not
touched.

## R4: Elapsed time, not wall-clock hours (FR-009)

**Decision**: A chosen length is subtracted from the start instant as elapsed milliseconds (for
example 2 × 60 × 60 × 1000). The form then shows that instant in the venue's zone. The Backend's
range check already uses elapsed time (`025` FR-004).

**Rationale**: If the clocks move for daylight saving between doors and the start, "2 hours
earlier on the clock" and "2 elapsed hours" disagree. Matching the Backend means the form and the
server never disagree about whether a listed length is in range. The shown local time is how the
admin sees the difference.

**Alternatives considered**: Wall-clock arithmetic (prettier labels around a DST change, but the
Backend could refuse a length the form thought was in range, or accept one it thought was not).

## R5: Which mode a form opens in (FR-005)

**Decision**: New event: "Before the start", 1 hour. Edit: "Before the start" when
`startsAt - doorsOpenAt` is a multiple of 15 minutes and lies in 0 to 6 hours inclusive;
otherwise "At a set time" with the exact stored local time. The stored instant is not rewritten
until the admin changes a control.

**Rationale**: Jeff asked the spec to settle the default and the edit mode. Most events will have
been saved from a list value (or the 1-hour default), so they open in "Before the start". A gap
that is not on a step (the leftover of #130's "show it as it is") opens in "At a set time" so
nothing is rounded away.

**Alternatives considered**: Always open edits in "At a set time" (loses the usual "1 hour before"
view). Always open in "Before the start" and add a one-off option for odd gaps (messier list).

**Switching to "Before the start" from an off-step gap** (FR-014): allowed and never rounded. The
length shows *Choose a length…*; the kept instant is shown, sent, and range-checked until a length
is picked. **Alternatives considered**: refuse the switch until a length is picked (an extra rule
to learn); snap to the nearest step (silently moves the doors).

## R6: Moving the start in "At a set time" mode (FR-007)

**Decision**: In "At a set time" mode, doors stay at the date and time shown when the start
changes. `025` FR-003 (follow the start until Doors open is edited) is superseded for this mode.
In "Before the start" mode, the chosen length is kept and doors move with the start.

**Rationale**: Jeff asked for an explicit decision. The point of "At a set time" is a clock time.
Keeping `025` FR-003 in that mode would still move doors until the admin edited them, which is
surprising after choosing "set time". The form always sends `doorsOpenAt`, so the Backend's
"update the start and omit doors, and doors follow" path (`025` FR-008) is not used by this form.

**Alternatives considered**: Keep FR-003 in both modes (less change, but the two ways would behave
the same when the start moves). Always move doors, even after an explicit doors time was typed.

## R7: A new spec, amending `025` by dated notes (clarifications)

**Decision**: This is spec `036`. Dated notes in `025` point here for the form parts of FR-002,
FR-003, and FR-005. Dated notes in `035` Out of scope record that #128 and #130 are no longer
deferred.

**Rationale**: `025` also specifies the Backend, the check-in window, and the Ticket Booth, which
do not change. Rewriting those FRs in place would mix a form redesign with a settled server
feature.

## R8: Event-list date filters (FR-013)

**Decision**: No behaviour change. The Admin list (`EventList`) and the Customer list
(`EventFilters`) already use a date-only control for From and To, with no time part. They already
look like an ordinary date field in every browser. The event form's new date controls should use
the same field styling (the shared `field` class) so they look consistent. If a later review finds
a visible inconsistency, fix the styling only.

**Rationale**: #128 asked that they be checked. They have no time to overlook.

## R9: WebKit in CI, for the event-form tests only (FR-012)

**Decision**: In CI, Playwright's `webkit` project runs the event-form browser tests (this
feature's test, and the existing `020`, `025`, `031`, and `035` form journeys that fill start,
end, or doors). Chromium still runs the full suite. A local `npm run e2e` stays Chromium-only
unless WebKit is asked for, because other tests have known WebKit failures (`028`, `001` V3). CI
installs WebKit as well as Chromium. A hand walk on real Safari is still listed as untested from
this machine.

**How**: `e2e/playwright.config.ts` adds the `webkit` project whenever `CI` is set, with
`testMatch` limited to the event-form spec files (003, 020, 025, 031, 035, 036), and
`scripts/e2e.mjs` installs WebKit when `CI` (or the WebKit opt-in) is set. No change to
`.github/workflows/`, so no shared-surface approval is needed for it. Limiting by file runs all of
each listed file in WebKit, including `025`'s Ticket Booth journey; that is accepted as long as it
passes there. This reverses `028` T025a's "CI stays Chromium-only" for those files; `028` carries a
dated note.

**Rationale**: #128's "done when" asks for WebKit on the event form. Enabling WebKit for every
test would fail existing journeys and lengthen every CI run.

## R10: Tests first, two pull requests

**Decision**: Same two-PR convention as `035` and Mahdi's specs: `036-event-form-times-spec`
against `main`, `036-event-form-times-impl` against the spec branch until the spec PR is merged.
The impl PR body says `fixes #130` and `fixes #128`. Neither PR is merged without Nathan's
approval of the changes. The spec-branch quickstart marks the new browser test Manual until the
impl branch adds it (the `check-quickstart-marks` rule).

## R11: Constitution and shared surface

**Decision**: Constitution 3.9.7 → 3.9.8 (PATCH, one roadmap row). No OpenAPI change. The e2e
runner and Playwright config change only on the impl branch, so CI on the spec PR stays as `main`
plus docs.

**Note**: A change to `.specify/memory/constitution.md` needs approval from every team member in
its pull request (Constitution, shared surface). This PR asks for that review; it claims no
standing approval to merge.
