# Feature Specification: Event Form Times

**Feature Branch**: `036-event-form-times-spec`

**Created**: 2026-11-10

**Status**: Draft

**Issues**: [#130](https://github.com/Trughouse-Holdings/QueuePass/issues/130) (pick doors open as
hours before the start) and [#128](https://github.com/Trughouse-Holdings/QueuePass/issues/128)
(Safari has no time picker in the calendar popup for Doors open, Starts, and Ends). Nathan asked
that they be done together, as one spec.

**Input**: Issue #130, including Jeff's clarification (two ways to set doors open, only one shown
at a time, switching keeps the value). Issue #128: picking a date and a time must feel the same in
Chrome, Edge, Safari (macOS and iOS), and Firefox, and the time must not be easy to miss. The
roadmap number is reserved by this PR's amendment (Constitution 3.9.8). Number 035 is already
reserved (merged PRs #155 and #156). `034-sell-until-end-impl` is Mahdi's and is not touched.

## Context

Builds on `020` (times entered and shown in the venue's time zone; a skipped local time is refused;
a repeated one is chosen by its offset), `025` (every event has a doors-open instant, 0 to 6 hours
before the start, measured in elapsed time; default 1 hour before; the form already follows the
start until Doors open is edited; customers, the Ticket Booth, and check-in use `doorsOpenAt`),
and `035` (the Admin event form in three sections; field errors beside the field; the form never
sends a known problem).

Today the Admin event form has three native date-and-time fields: Doors open, Starts, and Ends.
That is a third full date and time for doors, even though the only allowed values are 0 to 6 hours
before the start, and admins think of it as "doors open 1 hour before". In Safari, the calendar
popup for those fields has no time picker, so an admin can pick a date and leave the wrong time.
Chrome and Edge show date and time together. `035` left both issues out of scope on purpose.

This feature changes only how the Admin event form picks those times. The Backend, the stored
doors-open instant, the Customer app, the Ticket Booth, and the check-in window stay as they are
in `025`.

## Clarifications

### Session 2026-11-10

The issues and Jeff's comment on #130 settle most of what the form must do. Every question they
leave open took the recommended answer below, written unattended and recorded here as
**recommended answer, open to review**, so Nathan and the team can overturn it in review of this
pull request.

- Q: Whole hours only, or also half hours / 15-minute steps? → A: **15-minute steps**, from 0
  (at the start) through 6 hours. Venues often use 30, 45, or 90 minutes, and #130's own example of
  a 90-minute gap then lands on a regular choice instead of a one-off. The list is *At the start*,
  *15 minutes before*, *30 minutes before*, … *1 hour before*, *1 hour 15 minutes before*, … *6
  hours before* (recommended answer, open to review) (FR-003; research R1).
- Q: Keep the API as `doorsOpenAt`, or add `doorsBeforeStartMinutes`? → A: **Keep `doorsOpenAt`.**
  The form sends the start minus the chosen length (or the date and time the admin picked). No
  OpenAPI change, no Backend change. Smaller, and every other client stays as it is (recommended
  answer, open to review, and the issue's preferred option) (research R3).
- Q: Is "2 hours before" 2 elapsed hours, or 2 hours earlier on the wall clock? → A: **2 elapsed
  hours**, like the Backend's 0-to-6-hour range (`025` FR-004, `020` FR-025). They differ only when
  a daylight-saving change falls between doors and the start. The form shows the resulting local
  time, so the admin can see it (recommended answer, open to review) (FR-009; research R4).
- Q: Default mode for a new event, and which mode an existing event opens in? → A: **A new event
  opens in "Before the start", 1 hour before** (`025` research R4). **An edit opens in "Before the
  start" when the stored gap is a 15-minute step in 0 to 6 hours; otherwise in "At a set time"**,
  showing the exact stored time, and does not change it unless the admin picks a new value
  (recommended answer, open to review) (FR-004, FR-005; research R5).
- Q: In "At a set time" mode, does moving the start move the doors (as `025` FR-003 does today)?
  → A: **No. The doors stay at the date and time shown.** The admin chose a clock time. If that
  puts doors outside 0 to 6 hours before the new start, the form shows the same range message as
  today and does not send. In "Before the start" mode, the doors keep the chosen length and move
  with the start (recommended answer, open to review) (FR-007; research R6).
- Q: Separate date and time controls, a custom picker, or a hint on the native date-time field?
  → A: **A date control and a time control side by side**, joined into one local value, for
  Starts, Ends, and Doors open in "At a set time" mode. Every browser then shows a clear time
  control. A custom picker would be new visual design (Constitution VII). A hint on the native
  field does not really fix Safari (recommended answer, open to review, issue #128 option 1)
  (FR-010; research R2).
- Q: Amend `025` in place, or a new spec? → A: **A new spec (`036`)** that supersedes the form
  parts of `025` (FR-002, FR-003, and the form part of FR-005), with dated notes in `025`. The
  Backend and stored instant stay `025`'s (recommended answer, open to review) (research R7).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Doors Open Before the Start (Priority: P1)

An admin scheduling or editing an event wants to say "doors open 1 hour before", see the resulting
time, and have that time move when they change the start.

**Why this priority**: This is the usual way admins think of doors, and it is the default for a
new event.

**Independent Test**: Can be tested by scheduling an event with doors 2 hours before the start and
checking the Customer app shows that time; also by changing the start and seeing the doors time
move, keeping the same length.

**Acceptance Scenarios**:

1. **Given** a new event and a venue, **When** the admin opens the form, **Then** Doors open is in
   "Before the start" and the length is 1 hour before, and no doors date-and-time controls are
   shown.
2. **Given** a start of 7:00 PM, **When** the length is 1 hour before, **Then** the form shows the
   resulting time next to the control, e.g. "Doors open at 6:00 PM", in the venue's time zone with
   its abbreviation, and the saved event's doors-open time is 6:00 PM in that zone.
3. **Given** "Before the start" and a chosen length, **When** the admin changes the start to a
   time that names one moment, **Then** the doors keep that length and the shown time updates.
4. **Given** a start and a length, **When** the admin picks another length (including *At the
   start* or *6 hours before*), **Then** the shown time updates and what is sent is the start
   minus that length, still inside the 0-to-6-hour range.

### User Story 2 - Switching How Doors Open Are Set (Priority: P1)

An admin sometimes needs an exact clock time, including a gap that is not a 15-minute step, and
must be able to switch without losing the time they already have.

**Why this priority**: Jeff's clarification: two ways, only one shown, switching keeps the value.

**Independent Test**: Can be tested by setting 1 hour before at a 7:00 PM start, switching to "At
a set time", and seeing 6:00 PM on that date; and the other way round.

**Acceptance Scenarios**:

1. **Given** the form, **When** the admin looks at Doors open, **Then** they can choose "Before
   the start" or "At a set time", and only the controls for the chosen way are shown.
2. **Given** a start of 7:00 PM and doors 1 hour before, **When** the admin switches to "At a set
   time", **Then** the date and time show 6:00 PM on that day (venue local), not a reset or empty
   field.
3. **Given** doors at a set 6:00 PM and a 7:00 PM start, **When** the admin switches to "Before
   the start", **Then** the length is 1 hour before and the shown time is still 6:00 PM.
4. **Given** an existing event whose gap is a 15-minute step between 0 and 6 hours (including 90
   minutes), **When** the admin opens the edit form, **Then** it opens in "Before the start" on
   that length and does not change the stored time until they pick a new value.
5. **Given** an existing event whose gap is not a 15-minute step (for example 10 minutes, or a
   time that somehow sits outside 0 to 6 hours), **When** the admin opens the edit form, **Then**
   it opens in "At a set time" showing the exact stored time, and does not change it unless they
   pick a new value.

### User Story 3 - Date and Time in Every Browser (Priority: P1)

An admin on Safari, Chrome, Edge, or Firefox picks a start, an end, and (when using "At a set
time") a doors-open time, and always sees a clear date control and a clear time control, so the
time cannot be overlooked.

**Why this priority**: #128; the current combined field hides the time in Safari's calendar popup.

**Independent Test**: Can be tested by filling the date and the time separately, including a
skipped and a repeated local time, and by running the event-form browser tests in WebKit.

**Acceptance Scenarios**:

1. **Given** Starts or Ends, or Doors open in "At a set time" mode, **When** the admin sets a
   date and a time, **Then** each has its own control, the two are joined into one local value in
   the venue's zone, and a missing date or a missing time is treated as incomplete, the same as an
   empty field today.
2. **Given** a local time the venue's zone skips, **When** the admin enters it in the date and
   time controls, **Then** the form still asks them as `020` does and does not send.
3. **Given** a local time the venue's zone repeats, **When** the admin enters it, **Then** the
   form still asks which occurrence they mean and sends the chosen offset.
4. **Given** a refused save, **When** the form comes back, **Then** the date and time they entered
   are still there (`002` FR-030 / the form's FR-035).
5. **Given** the From and To filters on the Admin event list and the Customer event list, **When**
   they are used, **Then** they remain date-only and stay consistent with the event form's date
   controls (no time part; they already use a date control in every browser).

### User Story 4 - Range and Authority Stay as Today (Priority: P1)

An admin cannot send doors outside 0 to 6 hours before the start, in either mode. The Backend
remains the authority.

**Why this priority**: `025` FR-004 and FR-005, and Constitution IV, must not be weakened.

**Independent Test**: Can be tested by putting doors more than 6 hours before the start in "At a
set time" mode and seeing the same range message, with nothing sent; "Before the start" choices are
all in range.

**Acceptance Scenarios**:

1. **Given** "At a set time" and a start, **When** the admin sets doors more than 6 hours before
   the start or after it, **Then** the form shows `025`'s range message next to Doors open and
   does not send.
2. **Given** "At a set time", doors out of range, and a refused or prevented save, **When** the
   admin changes the start so doors stay put and are now in range, or fixes the doors time,
   **Then** the message clears.
3. **Given** "Before the start", **When** the admin picks any listed length, **Then** the value is
   inside the range, so the range message does not appear for that choice.
4. **Given** a Backend refusal (`DOORS_OPEN_OUT_OF_RANGE` or another field-mapped code), **When**
   it is returned, **Then** it is shown beside its field, with focus, as `035` requires, and every
   value is kept.

## Edge Cases

- A start that does not yet name one moment (empty, skipped, or a repeated time not yet chosen):
  in "Before the start" mode the resulting time is not shown, and doors are not sent until the
  start names one moment, as `025` FR-003 already follows only a start that names one moment.
- Changing venue (and therefore zone) keeps the typed local date and time of Starts, Ends, and
  doors in "At a set time" mode, as `020` does today; in "Before the start" mode the length is
  kept and the shown time is recomputed from the start in the new zone.
- A daylight-saving change between doors and the start: the length is elapsed time; the shown
  local time may not be "2 hours earlier" on the clock, and the form shows that local time.
- Keyboard and screen readers: the mode choice, the length list, and the date and time controls
  are usable without a pointer; the resulting doors time is announced when it changes, not on
  every keystroke of an unrelated field (`035`'s polite live region).
- The From and To event-list filters stay date-only; this feature does not add a time to them.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Admin event form MUST offer two ways to set doors open: **Before the start** and
  **At a set time**. Only the chosen way's controls are shown at once. A short choice (for example
  two radio buttons) switches between them.
- **FR-002**: Switching ways MUST keep the same doors-open instant. "Before the start" shows the
  length that matches that instant when it is a 15-minute step in range; "At a set time" shows the
  corresponding local date and time. Switching MUST NOT reset or clear the value.
- **FR-003**: "Before the start" MUST be a choice of length in **15-minute steps** from 0 (labelled
  *At the start*) to 6 hours inclusive. The default on a new event MUST be **1 hour before**.
- **FR-004**: Next to that choice the form MUST show the resulting doors-open time in the venue's
  time zone, with the zone's abbreviation, once the start names one moment (for example "Doors
  open at 6:00 PM EDT").
- **FR-005**: A new event MUST open in "Before the start". An edit MUST open in "Before the start"
  when the stored gap is a 15-minute step in 0 to 6 hours, and in "At a set time" otherwise,
  showing the exact stored time and not changing it until the admin picks a new value.
- **FR-006**: In "Before the start" mode, a change to a start that names one moment MUST keep the
  chosen length: doors move with the start, and the shown time updates.
- **FR-007**: In "At a set time" mode, a change to the start MUST leave the doors date and time as
  they are. If that puts doors outside 0 to 6 hours before the start, the form shows the range
  message and does not send.
- **FR-008**: In both modes, doors MUST stay no earlier than 6 hours before the start and no later
  than the start, measured in elapsed time (`025` FR-004). The form MUST check this before sending
  and show the same range message as today next to Doors open (`025` FR-005, form part). The
  Backend and the database keep `025`'s rules. "Before the start" choices are all in range.
- **FR-009**: "N hours before" (or N minutes) MUST mean N elapsed hours (or minutes) before the
  start instant, not N hours earlier on the wall clock.
- **FR-010**: Starts, Ends, and Doors open in "At a set time" mode MUST each be a **date control
  and a time control** side by side, joined into one venue-local value. Times are still read in
  the venue's zone (`020`). A skipped local time is still refused; a repeated one is still chosen.
  The controls MUST work with the keyboard and assistive technology. The form MUST keep what was
  entered when a save is refused.
- **FR-011**: The form MUST still send `doorsOpenAt` as the venue-local instant (with the venue
  offset, under `020` FR-018). It MUST NOT require a new API field. Existing create and update
  requests that already send `doorsOpenAt` stay valid.
- **FR-012**: The event-form browser tests that pick these times MUST also run in WebKit
  (Playwright's Safari engine) in CI, so a Safari-only difference is caught there. A walk on a
  real Mac or iPhone Safari remains a manual check.
- **FR-013**: The From and To filters on the Admin and Customer event lists MUST stay date-only
  and remain a date control in every browser. This feature does not change their behaviour unless
  a check finds they are inconsistent with the form's date controls (research R8).

### Key Entities

- **Doors-open instant**: unchanged from `025` — one stored instant per event, `doorsOpenAt`.
- **Doors-open mode**: a form-only choice, not stored: "Before the start" or "At a set time".
- **Doors-open length**: a form-only value in minutes, a 15-minute step from 0 to 360, used only
  in "Before the start" mode to derive the instant from the start.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a new event, doors are set to 1 hour before the start with no extra date-and-time
  entry; changing the start updates the shown doors time to keep that 1 hour (or whichever length
  is chosen).
- **SC-002**: Switching from "Before the start" to "At a set time" and back shows the same
  doors-open time, with no reset, in every trial of a start and an in-range length on a 15-minute
  step.
- **SC-003**: An edit of a stored 90-minute gap opens in "Before the start" as *1 hour 30 minutes
  before* and does not change the stored instant until the admin picks a new value.
- **SC-004**: Starts, Ends, and Doors open in "At a set time" mode can be filled by setting a date
  and a time in separate controls; a browser test in WebKit and one in Chromium both complete the
  event-form journey without depending on a combined date-time popup.
- **SC-005**: A doors-open time more than 6 hours before the start or after it is not sent, and
  the admin sees the same range message as today; every listed "Before the start" length is in
  range.
- **SC-006**: The Customer app, the Ticket Booth, and check-in still use the stored `doorsOpenAt`
  instant; a browser test that sets doors 2 hours before the start sees that time on the Customer
  event page.

## Assumptions

- Only the Admin event form changes. Other clients, the demo data, and the browser tests' API
  setup still send `doorsOpenAt` (or take the Backend default) as today.
- Minute precision stays as today (no seconds in the time control).
- English only; US venues only, as `020`.
- A real Safari walk on a Mac or iPhone is still done by hand; WebKit in CI is the automated
  stand-in, as `028` already used for Safari's engine.

## Out of scope

- A new API field or a contract version bump (`doorsBeforeStartMinutes` or similar).
- Changing the 0-to-6-hour range, the 1-hour default, the check-in window, or how customers and
  the Ticket Booth show doors open (`025`).
- A custom visual date-time picker or a new calendar widget (Constitution VII).
- Event description, age restriction, and category (#49).
- Draft and published events, on-sale and off-sale times (#44).
- Mahdi's `034-sell-until-end-impl` branch, and any other open work that is not this feature.
