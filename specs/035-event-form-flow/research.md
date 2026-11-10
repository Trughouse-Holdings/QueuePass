# Research: Event Form Flow

**Feature**: `035-event-form-flow` | **Spec**: [spec.md](./spec.md) | **Date**: 2026-11-09

Decisions that follow from the issue, the constitution, and the specs this builds on (`008`,
`014`, `016`, `025`, `031`). Each records the choice, the alternatives, and why.

## R1. One page with three sections, not a wizard

**Decision**: The form stays one page. It is grouped under three headings, in the issue's example
order: Venue and times; Tickets and seating; Details (tickets per customer, and pictures). Ticket
types and seating wait until a venue is chosen (times already mean nothing without one). Section
mapping shows only with reserved seating at a venue that has a layout. Typed quantities and a
typed total tickets show only for general admission.

**Alternatives**: a wizard with Back, Next, and a review step, as the issue offers. Rejected:
the live seat total belongs next to the types and sections, and an edit's locked fields belong
next to those controls, not on a later step; a review step would hide problems the admin is
already fixing. The venue form (`024`) stayed one page with clearer sections for the same reason.
A wizard can be proposed in review (Clarifications).

## R2. Related issues stay their own work

**Decision**: #128, #130, #49, and #44 are out of scope. #127's scheduling half-save is already
`031` on `main`. This feature closes the edit half-save `031` left to #134, and the form rework
the issue describes.

**Alternatives**: fold #130 (doors as hours before the start) into the times section, since the
form is being reworked anyway. Rejected (Principle VIII, and the issue lists it as a related
issue to keep in step with, not as required work). #130 is its own open issue and would change
how `doorsOpenAt` is picked, which has its own rules in `025`. Folding it in would mix two
features in one session (Constitution III, one feature at a time).

## R3. Browser checks are a preview; submit never sends a known problem

**Decision**: The form previews, next to the field, every rule it can evaluate from the values on
the page, using the same messages the Backend already uses where those messages exist (doors
range, a skipped time, a repeated ticket type name from `031`, tickets per customer, ends after
starts, a price or quantity that is not well formed, a required field). It does not send while any
of those is wrong. The Backend still enforces every rule (Constitution IV), including a stored
ticket type name, a scheduling conflict, sold-ticket rules, and a dropped connection.

Repeated names use `031`'s wording (`Ticket type 2, 'floor', has the same name as ticket type 1,
'Floor'. …`), so a browser test of `031` S3 still reads the same message beside the field, even
when the first press no longer reaches the Backend.

**Alternatives**: keep checking only on submit, but place the first error next to the field.
Rejected: the issue requires "as soon as it happens (as you type or when you leave the field)."
Or disable the submit button while anything is wrong. Rejected for the empty-required case: a
disabled button with no explanation is worse than a press that focuses the first problem
(Clarifications; FR-005). The button stays enabled; it does not send.

## R4. Server errors land on the field; the top banner goes for those

**Decision**: Reuse `fieldErrors` from `031` (paths `tiers.<i>.<field>`, `tiers`,
`reservedSeating`, `totalTicketCapacity`) and extend it to the event's own fields (`name`,
`locationId`, `startsAt`, `endsAt`, `doorsOpenAt`, `maxTicketsPerCustomer`). The message is only
beside the field. Focus moves there. No `ErrorBanner` at the top for a problem that has a field.

A scheduling conflict keeps the existing conflict treatment (`banner--conflict`, the event's name
and times), placed in the venue and times section, with focus on Starts. The no-answer message
(`031` FR-011) and a refusal with no field path stay next to the submit button.

This supersedes `031` FR-009 / FR-010 / SC-003 for this form only (the banner as a second copy),
and the Edit-form "banner only" rule of `031` FR-013.

**Alternatives**: keep the top banner as well as the field message (`031`'s choice). Rejected: the
issue is explicit ("instead of a banner at the top"). Or drop the distinctive conflict treatment.
Rejected: `002` FR-034 and the conflict tests are about naming the other event; moving that
treatment next to the times keeps the information without a page-top banner.

## R5. When to show and announce

**Decision**: A field is "touched" when the admin leaves it, or when they press the button (every
relevant field becomes touched). An error shows when the field is touched and wrong, and while it
is touched it updates as they type, so a fix clears it at once. Empty required fields stay quiet
until then.

Announcement: the message is the field's `aria-describedby` (and `aria-invalid`). A single polite
live region (`aria-live="polite"`, `aria-atomic="false"`) is updated when an error first appears
and on blur if the field is still wrong, not on each keystroke. This is the same "appending,
atomic false" idea spec `033` uses for seat-hold results, applied here to form errors.

**Alternatives**: validate on every keystroke from the first character (floods the live region,
and shows "Enter the name" while they are still typing it). Or validate only on blur, so a fix
is not confirmed until they leave again. The issue wants both "as you type" and "when you leave";
touched-then-as-you-type is the combination that does not shout too early.

## R6. Seat totals: guidance, except general admission over capacity

**Decision**: The total is live and names what is left. Leaving some seats as Not for sale is
allowed today (`031` already tests a type with no sections, quantity 0) and stays allowed; the
total says "12 seats not assigned to a ticket type," it is not a submit-blocking error. General
admission over the event's capacity is already a Backend refusal (`CAPACITY_EXCEEDED`); the form
previews it next to the ticket types and will not send.

For reserved seating, assigned means seats in a section mapped to a ticket type; M is the
layout's `totalSeats`. For general admission, assigned is the sum of typed quantities; M is the
typed total tickets, or the venue's capacity when that is blank (the same capacity
`capacityPreview` already uses).

**Alternatives**: require every seat to be assigned before save. Rejected: that would be a new
business rule, and "Not for sale" exists on purpose. Or show only an overall number, no leftover
sentence. Rejected: the issue's example is the leftover sentence.

## R7. Locked fields, from counts that already exist

**Decision**: The form does not add `ticketsSold` to `Event` or `TicketTier`. On edit it already
loads the seat map (each section's `sold`). It also loads `GET /events/{id}/availability`
(`ticketsLeft` per event and per type). Sold for a type is `quantity - ticketsLeft`; sold for the
event is `totalTicketCapacity - ticketsLeft`. Locks and reasons use the same wording the Backend
already returns:

- Switching reserved seating: "`{name} has sold tickets, so reserved seating can no longer be
  switched on/off.`"
- Removing a type: "`Cannot remove the tier "{name}": it has N order(s).`" — the form can only
  be sure of sold tickets, not of order count as a distinct figure; it locks Remove when that
  type has sold tickets, with "Cannot remove {name}: tickets are already sold." The Backend still
  names the order count if a save slips through. (Recommended wording, open to review.)
- Quantity below sold: "`Cannot set {name} to {n} tickets; {sold} are already sold.`"
- Section remapping: "`Section {name} has sold seats, so it stays in its tier.`"
- Venue while reserved seating is on: the existing "Turn reserved seating off before moving this
  event to another venue."

If availability fails to load, the form does not guess; it leaves controls unlocked and lets the
Backend refuse (Constitution IV).

**Alternatives**: add `ticketsSold` to the contract, so the form does not combine two endpoints.
Rejected as unnecessary (Principle VIII); the data is already published. Or lock nothing and only
show the refusal after save. Rejected: the issue requires showing why next to each locked field.

## R8. All-or-nothing edit: extend `updateEvent`

**Decision**: Same shape as `031` on `createEvent`. `EventUpdate` gains optional `reservedSeating`
and `tiers` (array of `EventTierInput`, at most 50, not `null`). `EventTierInput` gains optional
`id` (UUID). On `createEvent`, an `id` is refused (`400`, `tiers.<i>.id is not allowed when
scheduling`). On `updateEvent`:

- Without `tiers` and `reservedSeating`, the request is answered exactly as today.
- With them, they are the complete new set. An entry with `id` must be a ticket type of this
  event; a missing or foreign id is `400` (`tiers.<i>.id`). A repeated id in the request is
  `400`. An entry without `id` is created. An existing type not listed is removed, subject to
  `TIER_HAS_ORDERS`.
- One transaction, already used by `updateLocked` (event row lock, venues `FOR SHARE`): after
  today's detail checks, the sold-ticket and hold rules of `004`/`005`/`007`/`015`, then
  `planEventSetup` as on create (names, sections, capacity), then the writes (details, types,
  mappings). A failure after the first write leaves the event as it was. Holds on a remapped
  section, or when reserved seating is turned off, are closed as `updateSeating` already does
  (`015` FR-016), and viewers are told after commit.
- Field paths and error codes as `031`, plus today's `TIER_HAS_ORDERS` and `EVENT_HAS_ORDERS`
  (`details.field` `reservedSeating`, `tiers.<i>.quantity`, `tiers.<i>.sectionIds`, or `tiers`
  when a removed type is the problem: the message names the type; path `tiers` because it is no
  longer in the list).
- The Admin Edit form always sends `tiers` and `reservedSeating` once types have loaded. If types
  failed to load, it sends details only, as today.

Contract 1.26.0 → 1.27.0 (MINOR: optional request fields and `EventTierInput.id`). No new
operation, table, column, or error code. `createTier`, `updateTier`, `deleteTier`, and
`updateSeating` stay for other callers (the event page, the demo data).

**Alternatives**: a new `PUT /events/{id}/setup` operation. Rejected: `031` already rejected a
new operation for the same job on create; two ways to save an edit would be worse. Or make every
`updateEvent` require `tiers`. Rejected: existing callers (browser-test helpers, scripts) send
details only. Or also make the event page's type and seating controls atomic. Rejected: out of
scope (the issue is this form); named in Out of scope.

## R9. Where the code goes

**Decision**:

- `contracts/openapi.yaml` and regenerated `packages/shared/src/api-schema.ts` in this spec PR.
- Backend: `EventTierDto` gains optional `id`; `UpdateEventDto` gains optional `reservedSeating`
  and `tiers`; `event-setup.ts` gains the update planner/writer (sold-ticket checks, keep ids,
  close holds as `SeatMapService.update` does); `EventsService.updateLocked` calls it when
  `tiers` or `reservedSeating` is sent, and publishes seat-map changes after commit. No Prisma
  schema change.
- Admin app: extract the preview checks, seat totals, and field-error placement into a helper
  module next to `EventForm.tsx`, tested on their own; `EventForm.tsx` uses the three sections,
  the live total, touched-field errors, focus, locks, and one `updateEvent` call. `updateEvent`
  is typed from the generated schema, as `createEvent` already is. `GET /events/{id}/availability`
  is called on edit.
- Tests: new Backend integration file for the update setup (refusals leave the event unchanged,
  a mid-write failure, concurrency with a sold-ticket rule); unit tests for the planner's new
  branches; new Admin tests for US1–US6; existing EventForm tests updated for placement, the
  hidden tickets section until a venue is chosen, and the one update request; one new browser
  test (SC-001); `031` S3 updated so it no longer requires a top banner and still checks the
  message beside the field, the kept values, and a successful retry.

**Alternatives**: rewrite EventForm as several components in one step. The helper module is the
smallest extract that makes the checks testable; a further split can wait (Principle VIII).

## R10. Specs this supersedes, and work in flight

**Decision**: Dated notes, not rewrites, in:

- `031` spec: FR-013 and Out of scope (edit all-or-nothing now lives here); FR-009, FR-010, SC-003
  (banner at the top no longer a second copy on this form).
- `008` research R10, if it still describes the edit sequence as current: a one-line note
  pointing here.

Work in flight: PR #152 (spec `033`) and PR #153 (spec `034-sell-until-end`) are merged on
`main` (constitution 3.9.6, contract 1.26.0). This branch claims 035 and takes constitution 3.9.7
and contract 1.27.0 on top, keeping row 034 and 034's contract changes (Assumptions). Open
implementation PRs #151 (032) and #154 (033), and branch `034-sell-until-end-impl`, are not
touched. `032` does not change this form's save path.

## R11. Tests (Constitution VI)

**Decision**: Tests written first, seen to fail, then the code.

- Backend, real PostgreSQL: `events.update-setup.e2e-spec.ts` — a successful edit that changes
  details, updates a type, adds a type, removes a type with no orders, and remaps a section, in
  one request; a details-only request unchanged; `id` refused on create; unknown, foreign, and
  repeated ids refused; each sold-ticket refusal (`EVENT_HAS_ORDERS` switch, section, capacity;
  `TIER_HAS_ORDERS` remove; `CAPACITY_EXCEEDED` quantity below sold) leaves the event, types, and
  mappings unchanged; a repeated name and a bad section the same; a mid-write failure (spy on a
  later insert, as `031` T003) leaves everything unchanged; two concurrent conflicting updates
  where that is meaningful (capacity vs a sale is already covered; an update vs a sale that
  would shrink below sold). `expectToMatchContract` on responses. Planner unit tests for the new
  branches (ids, removals).
- Admin app: preview errors appear and clear; submit sends nothing and focuses the first field;
  seat totals and leftover wording; sections and progressive disclosure; locks and reasons;
  a server refusal is placed and focused, with no top banner; an edit sends one `PATCH`/`PUT`
  with `tiers` and `reservedSeating` (whatever the client already uses for `updateEvent`) and
  keeps values on refusal. Existing tests retargeted.
- Browser: `035 S1` — create a seated event that exactly fills a three-section layout, assert the
  live total reaches "all seats assigned," save, and see the event; no submit-time error.
  `031 S3` updated as in R9.

## R12. Contract, constitution, and README

**Decision**: Constitution 3.9.6 → 3.9.7 (PATCH, roadmap row `035` only). The next free number is
036. Row 034 (merged PR #153) is kept. Contract 1.26.0 → 1.27.0, `api-schema.ts`
regenerated, drift check green. README: version reference 3.9.7, status row 035 (Draft / In review
/ Not started on the spec PR; the implementation PR updates the task and build columns). Shared
surface in the spec PR: the constitution, the contract, `api-schema.ts`, and the README version
and row (every member approves). The implementation PR should not have to change those, except
the README's 035 status as `031` did, and quickstart automation marks.
