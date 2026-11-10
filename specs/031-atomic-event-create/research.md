# Research: All-or-Nothing Event Scheduling

**Feature**: `031-atomic-event-create` | **Spec**: [spec.md](./spec.md) | **Date**: 2026-11-09

The issue (#127) settles what scheduling must do. Every decision below that the issue leaves open
takes the recommended option and records the alternatives, for Mahdi and the team to overturn in
review of the spec PR. Line numbers are `main` at `5598b67`.

## R1. Extend `createEvent`; keep the separate operations

**Decision**: `POST /events` (`createEvent`) takes two optional fields, `reservedSeating` and
`tiers` (contract 1.23.0, [contracts/README.md](./contracts/README.md)). A body without them is
handled exactly as today (FR-002). `createTier`, `updateTier`, `deleteTier`, and `updateSeating`
stay as they are: the event page's cards and the Edit form use them (FR-013).

**Why**: the issue suggests it, and the Backend already has one transaction for scheduling
(`EventsService.createOnce`, `backend/src/events/events.service.ts:114-155`: the venue row `FOR
SHARE`, the time, capacity, limit, and conflict checks, the insert, all inside
`prisma.$transaction(…, LOCKING_TX)`, retried on deadlock by `retryOnDeadlock`). Adding the ticket
types and the mappings to that transaction makes the whole schedule commit or roll back as one
(FR-003), with no new lock order. Optional fields keep every existing caller unchanged: the demo data
(`backend/src/scripts/demo-data.ts:185-245`, through `EventsService.create`), the browser tests'
helper (`e2e/fixtures/api.ts:137`), and any script.

**Alternatives**:

- **A new operation** (`POST /events/full` or similar): a second path through every event rule, and
  two ways to schedule that can drift. Rejected.
- **Compensation in the form** (delete the event when a later step fails): not atomic. The delete can
  fail too (the connection that broke the setup breaks it), customers can see the half-made event
  in between, and nothing in the database guarantees it (Constitution IV). Rejected.
- **A generic batch endpoint** (several operations in one transaction): a framework the project does
  not need (Principle VIII). Rejected.

## R2. The request's shape: each ticket type lists its sections

**Decision**:

```jsonc
{
  "name": "Season Opener", "locationId": "…", "startsAt": "…", "endsAt": "…",
  "doorsOpenAt": "…", "basePrice": "70.00",
  "reservedSeating": true,
  "tiers": [
    { "name": "Front", "price": "120.00", "sectionIds": ["<front>"] },
    { "name": "Standard", "price": "70.00", "sectionIds": ["<middle>", "<back>"] }
  ]
}
```

`EventTierInput` is `TicketTierInput` (name, price, quantity) plus `sectionIds`. Without reserved
seating, each type has a `quantity` and no `sectionIds`; with it, no `quantity`, and the sections it
sells (none is allowed: quantity 0, as a seated tier is today until mapped, `007` FR-006). A section
listed under no type is not for sale, as with `updateSeating`.

**Why**: the ticket types have no identifiers until they are saved, so the mapping cannot use tier
ids as `SeatingInput` does. Listing the sections under each type needs no cross-reference, keeps a
mapping error on the type it belongs to (R3), and matches what the type means: "Standard sells
middle and back". The form keeps its per-section select and turns it into these lists when sending
(R5).

**Alternatives**: a `seating` object like `SeatingInput` with `{ sectionId, tierIndex }` pairs
(an index into another array: easy to get wrong, and an error would have to say which pair and which
type); temporary client ids on each type (more fields, same result). Rejected.

## R3. How a refusal names its field

**Decision**: the existing envelope and codes, with a **path** that names the part of the body:

- `tiers.<i>.<field>`: one ticket type, zero-based index in `tiers`, field `name`, `price`,
  `quantity`, or `sectionIds`;
- `tiers`: the ticket types together (over capacity);
- `reservedSeating`, `totalTicketCapacity`: the seating choice.

On a `409` (`TIER_NAME_TAKEN`, `CAPACITY_EXCEEDED`) the path is `details.field`. Only the key is
reused: `020` and `025` put `details.field` on their `400`s (`LOCAL_TIME_SKIPPED`,
`UTC_OFFSET_MISMATCH`, `DOORS_OPEN_OUT_OF_RANGE`) for the event's own times.

On `400 VALIDATION_FAILED` each entry of `details.fields` about a field rule **starts with the
path and a space**. That is what the global `ValidationPipe` writes for nested fields:
`@nestjs/common`'s `ValidationPipe.mapChildrenToValidationErrors` and
`prependConstraintsWithParentProp` put the parent path and a dot in front of a nested constraint's
message (`tiers.1.` + `price must be …`), and this project's messages start with the property
name. That holds only when **every decorator on the new fields has its own message starting with
its property name** (R9): class-validator's default messages for `@IsArray`, `@ArrayUnique`,
`@IsUUID({ each: true })`, `@IsBoolean`, `@ArrayMaxSize`, and `@ValidateNested` do not
(`each value in sectionIds must be a UUID`, `each value in nested property tiers must be either
object or array`). Two entries keep another form, which the contract describes:

- **An unknown field** in ticket type *i* is the pipe's whitelist message after the path,
  `tiers.<i>.property <name> should not exist`: the path of the ticket type, not of a field.
- **An entry of `tiers` that is not an object** (`tiers: [5]`): the nested-validation error sits on
  the array's element, and the pipe prefixes it with `tiers.` but not the index, so it reads
  `tiers.` + `@ValidateNested`'s message. With R9's message, `tiers.tiers must be a list of ticket
  types, each an object with a name and a price`. An entry that is itself a list (`tiers: [[1]]`)
  goes one level deeper: `tiers.0.tiers must be a list …`. `tiers` that is a scalar or `null` gives
  `@IsArray`'s and `@ValidateNested`'s messages unprefixed (both start `tiers`). `tiers` that is a
  JSON object (`{ "a": 1 }`) is validated as if it were one ticket type: `tiers.property a should not
  exist`, `tiers.name must be a string`, and so on, and `@IsArray`'s own message is lost (the pipe
  drops a parent's constraints when it has children). Every one of these still starts with `tiers`,
  which is all the client's rule needs.

So the rule a client follows is the contract's: an entry starting `tiers.<i>.` is about ticket type
*i*; any other entry starting `tiers` is about the ticket types; `reservedSeating` and
`totalTicketCapacity` are about seating. T003 pins the exact strings, so a change in the pipe shows.

The service's own `400`s for the setup (R4) are written the same way, through
`BadRequestException({ message: [...] })`, which `AllExceptionsFilter`
(`backend/src/common/filters/prisma-exception.filter.ts`, the `BAD_REQUEST` branch) turns into
`details.fields`. The contract states the format (FR-006), so a client may rely on it rather than on
the message.

The form reads the path to place the message beside the field (R5). Issue #134, which asks "how do
server errors map back onto fields?", can use the same paths.

**Alternatives**:

- **A structured `details.fields` object** (`{ "tiers.1.price": "…" }`): the filter has sent a
  list since `001`, and the Admin and Customer apps read it as a list (`ErrorBanner`); changing it
  changes every operation's `400`. Rejected.
- **New error codes** (`TIER_INVALID`, `SECTION_INVALID`): the existing codes already say what kind
  of refusal it is, and clients branch on them today. Rejected.
- **The first error only, without a field**: the form could not place it. Rejected.

## R4. One transaction: checks first, then the writes

**Decision**: in `EventsService.createLocked`, which already runs inside the transaction after
`lockVenueShared(tx, [locationId])`:

1. The venue (`404`), the times and doors (`020`, `025`), as today.
2. **Seating** (new): with `reservedSeating: true`, read the venue's sections (under the venue's
   share lock, so a layout save, which takes the venue `FOR UPDATE` in `lockVenueAndEvents`, runs
   wholly before or after); none is `400` "`reservedSeating` needs a seating layout; *venue* has
   none"; a `totalTicketCapacity` sent is `400` naming `totalTicketCapacity` (the message `PATCH`
   uses today). The capacity is the layout's total seats.
3. Capacity within the venue, tickets per customer within the capacity, the scheduling conflict, as
   today (the capacity being the layout's total with reserved seating).
4. **Each ticket type in order** (new, a pure function, R9): the name, trimmed, not equal ignoring
   case (compared with JavaScript's `toLowerCase()`) to an earlier one's (`409 TIER_NAME_TAKEN`, `details.field: tiers.<i>.name`, message naming
   both types); quantity required without reserved seating and left out with it (`400`, the
   messages `TiersService.quantityFor` uses, prefixed with the path); a non-empty `sectionIds`
   only with reserved seating (`400`; left out or `[]` is fine without it); each section in the venue's layout (`400`, "lists a section that is not
   in *venue*'s seating layout. Reload the form to see its sections.") and under no earlier type
   (`400`, naming the section and the earlier type).
5. **The ticket types together** (new): without reserved seating, the quantities' sum at most the
   capacity (`409 CAPACITY_EXCEEDED`, `details: { field: 'tiers', totalTicketCapacity, tierTotal
   }`).
6. **Writes**: `tx.event.create` with `reservedSeating` and the capacity; then each ticket type,
   in order, with `tx.ticketTier.create` (its quantity: typed, or its sections' seats); then one
   `tx.sectionTier.createMany` for the mappings. The response is the event, as today.

Every check runs before the first write, so a refusal never depends on a rollback; the transaction is
what makes a failure in the writes themselves (a lost connection, a constraint, a deadlock) leave
nothing (FR-003). `retryOnDeadlock` retries the whole create, ticket types included.

**Why these and not the separate services' code**: `TiersService.create` and `SeatMapService.update`
lock the event row and check things a new event cannot have yet (sold tickets, tierless sales, holds,
reservations to close, live viewers to notify). Calling them would need the event committed first,
which is the bug. The rules that do apply to a new event are restated in R9's pure function, with the
same messages, and pinned by the same tests (R11). The database still guarantees what must hold under
concurrency (Constitution IV):

| Rule | Guarantee |
| --- | --- |
| 60-minute rule at the venue | `event_no_overlap` exclusion constraint, as today |
| Ticket type names unique per event ignoring case | the unique index on `("eventId", lower("name"))` (`004` research R3) |
| One ticket type per section per event | `SectionTier`'s primary key `("eventId", "sectionId")` |
| Ticket types within the capacity | the event is new and uncommitted: no other transaction can see it, so nothing can change its total between the check and the commit |
| Sections from the venue's current layout | the venue row `FOR SHARE` for the whole transaction; a layout save needs it `FOR UPDATE` |

The planner compares names with `toLowerCase()`; PostgreSQL's `lower()` can fold some non-ASCII
letters differently, so two names the planner took as different can still collide in the index. That
case, and any other unique violation the planner did not foresee, reaches the filter as Prisma's
`P2002`, which it already answers `409 TIER_NAME_TAKEN` ("Another tier of this event already has
that name") **without `details.field`**: the database's backstop, naming no ticket type. Nothing is
saved (the transaction rolls back). The form shows it in the banner only, since it cannot tell
which type; the admin renames and schedules again. A section listed twice cannot reach the database:
the DTO's `@ArrayUnique` and the planner's check across types refuse it first.

**Alternatives**: write the event and then check the ticket types, relying on the rollback (same
result, but a refusal would cost a write and the order of errors would depend on write order);
`recalcSeatedTiers` after the mappings (one more query per type; the quantity is known before the
insert). Rejected.

## R5. The Admin form

**Decision** (`admin-app/src/pages/EventForm.tsx`):

- `scheduleEvent` (lines 325-338) sends one `createEvent` with the event's fields, `reservedSeating:
  true` when reserved seating is chosen at a venue with a layout (left out otherwise), and `tiers`:
  each type's `name` and `price` trimmed; without reserved seating its `quantity`; with it
  `sectionIds`, the sections whose select names that type (`sectionType`, line 174). It returns the
  new event's id; the picture steps follow unchanged (lines 580-605).
- `setupRefused`, its banner (lines 863-874), and `seating()` (lines 318-323, still used by Edit)
  are reviewed: the banner and its state go; `seating()` stays for `saveEvent`.
- A refusal keeps every value (the catch at lines 606-612 already leaves the state alone) and shows
  the banner as today. In addition, a helper `fieldErrors(error)` reads the path (R3) from
  `details.field` or from each `details.fields` entry and returns the messages per place: ticket type
  *i*, the ticket types as a group, or the seating choice. Beside each, a `<span
  className="field__hint" role="alert">` with an id; the type's inputs get `aria-invalid` and
  `aria-describedby` pointing to it, as `LocationForm.tsx:384-385` does for the time zone. The
  messages clear when the admin schedules again (`handleSubmit` resets them with the banner). A
  section mapping message (`tiers.<i>.sectionIds`) is shown beside ticket type *i*'s seats line in the
  seating part, where the sections are chosen.
- No answer (FR-011): the request throws something that is not an `ApiError` (a network failure,
  which today would reach `ErrorBanner` without an envelope), **or** it is answered with a `5xx`
  whose body is not the error envelope. `unwrap` (`admin-app/src/api/client.ts`) turns any response
  without an envelope into an `ApiError` with code `VALIDATION_FAILED` and "Request failed with
  status N.", so the form cannot tell those apart today; `ApiError` gains a read-only `enveloped`, a
  third constructor parameter defaulting to `true`. Only `unwrap`'s fallback, the branch that builds
  an envelope for a body that had none, passes `false`; the other places that construct `ApiError`
  directly (such as `EventForm.tsx`'s `validationError` and `ImageStepError`) keep their
  calls unchanged. A gateway error (`502`, `503`,
  `504` from a proxy or the dev server's proxy) can arrive after the Backend committed, so it is
  treated like no answer. A `5xx` **with** the envelope is the Backend's own answer: its transaction
  rolled back and nothing was saved, so it is shown as an error as today. In the no-answer case the
  form shows, in the banner, "No answer from QueuePass, so the event may or may not have been
  scheduled. Check the Events list before scheduling it again." with a link to `/events`, and keeps
  every value. A `4xx` without an envelope stays as today (nothing was saved: the Backend refused or
  never got it).
- `admin-app/src/api/events.ts`: `createEvent` takes the generated request type,
  `ApiComponents['schemas']['EventInput']` (exported by `@queuepass/shared`), so the form builds the
  body against the contract without changing `packages/shared`'s hand-written `EventInput`, which
  `saveEvent` also uses for `updateEvent` (R9).
- The client-side preview checks (blank fields, the limit's range, times) stay as they are; a
  repeated name or a total over capacity is left to the Backend, whose message now lands beside the
  field. Showing errors as the admin types is #134.

**Alternatives**: a structured banner listing each field's problem (the banner already lists
`details.fields`; placing them beside the fields is what the issue and #134 ask); moving focus to the
first field at fault (useful, but #134 settles focus for the whole form). Rejected for now.

## R6. A dropped connection; no request key

**Decision**: FR-011's message, and nothing more, for no answer at all and for a `5xx` without the
Backend's envelope (R5). A request that got no answer either committed the whole event or nothing
(R4). If it committed, scheduling it again at the same venue and time is
refused with `SCHEDULING_CONFLICT`, whose message and `conflictingEvent` name the saved event, and the
form already shows that as a distinct banner with its name and times (`EventForm.tsx:876-883`).

**Alternatives**: an idempotency key like orders' `requestId` (`005`), so a repeat returns the first
answer: a new column, a unique index, a contract field, and handling for "same key, different
body", for a case the conflict rule already catches. Not a control deferred: no rule is weaker
without it. Rejected (Principle VIII); a later issue can add it if repeats ever matter beyond one
venue and time.

## R7. Editing stays as it is; the gap goes to #134

**Finding**: `saveEvent` (`EventForm.tsx:451-481`) sends `updateEvent`, then possibly
`updateSeating` (switching), `updateEvent` again (the limit after a switch), `createTier` per new
type, `updateTier` per changed type, `updateSeating` (mappings), and `deleteTier` per removed type.
A refusal part way leaves the earlier steps saved. Saving again can then be refused for a step that
already happened: a new type was created but the form's state did not record its id (line 463), so
the second save creates it again and gets `409 TIER_NAME_TAKEN`. The admin must reload the form.

**Decision**: out of scope for `031`. The issue is about scheduling, where the damage is an extra
event that customers see and that blocks the venue. Making an edit atomic needs a different
contract (changes, additions, and removals of ticket types; switching seating with its sold-ticket
rules; holds to close and live viewers to tell), a larger change than this bug fix. Issue #134 (the
event form rework, not yet specced) already asks that "saving creates **or updates** the whole event
or nothing (#127)", so the gap is recorded in the spec's Out of scope and goes there (Principle
VIII: no control that exists today is removed; the gap is named with the work that closes it). A
reviewer who wants it sooner can ask for a separate issue.

## R8. Pictures unchanged

**Decision**: no change. `applyImages` runs after `scheduleEvent` returns the id, as today
(`EventForm.tsx:583-603`); a refused or unsent picture gives `014` FR-018's notice, "Event created.
These pictures were not added: …", and the form becomes that event's edit form with the pictures not
yet added. The notice says plainly that the event was created, and the page it opens is that
event's, which is what the issue asks of any partial creation that stays.

**Why not in the request**: pictures are binary uploads with their own checks, limits, and storage
(`014` research R3, R6); putting them in a JSON request, or the request in a multipart upload, is a
much larger change for a case the form already handles honestly. The issue keeps them out.

## R9. Where the code goes

- **Every decorator on the new fields has its own message, starting with its property name**
  (R3), and `null` is refused rather than skipped: `@IsOptional()` would let `null` through, so each
  new field uses `@ValidateIf((o) => o.<field> !== undefined)`, as `CreateTierDto.quantity` does
  since #117. A `null` array then fails every decorator on it, so it gives several entries at once:
  `tiers: null` three (`must be a list of ticket types`, `may hold at most 50 ticket types`, and the
  nested message), `sectionIds: null` four (`must be a list of section ids`, `may list at most 50
  sections`, `lists a section more than once`, `must hold section ids (UUIDs)`), each starting with
  the field's place. Accepted: the form never sends `null`, and every entry still names the field.
- `backend/src/events/dto/create-event.dto.ts`:
  - `reservedSeating?: boolean`: `@ValidateIf(…)`, `@IsBoolean({ message: 'reservedSeating must be
    true or false' })`.
  - `tiers?: EventTierDto[]`: `@ValidateIf(…)`, `@IsArray({ message: 'tiers must be a list of ticket
    types' })`, `@ArrayMaxSize(50, { message: 'tiers may hold at most 50 ticket types' })` (50, as
    many as a layout may have sections, `LayoutInputDto`'s cap, so a seated event can give each
    section its own type), `@ValidateNested({ each: true, message: 'tiers must be a list of ticket
    types, each an object with a name and a price' })`, `@Type(() => EventTierDto)`.
- `backend/src/events/dto/event-tier.dto.ts` (new): `EventTierDto extends CreateTierDto` (same
  messages for name, price, quantity) with `sectionIds?: string[]`: `@ValidateIf(…)`,
  `@IsArray({ message: 'sectionIds must be a list of section ids' })`, `@ArrayMaxSize(50, { message:
  'sectionIds may list at most 50 sections' })`, `@ArrayUnique({ message: 'sectionIds lists a
  section more than once' })`, `@IsUUID('all', { each: true, message: 'sectionIds must hold section
  ids (UUIDs)' })`.
- `backend/src/events/event-setup.ts` (new): `planEventSetup(input, venue, sections)` →
  `{ reservedSeating, capacityFromLayout, tiers: { name, price, quantity, sectionIds }[] }` or throws
  the refusals of R4 steps 2, 4, 5 (step 5 given the capacity); pure, unit-tested. And
  `writeEventSetup(tx, eventId, plan)`.
- `backend/src/events/events.service.ts`: `createLocked` calls them (R4).
- `admin-app/src/api/client.ts`: `ApiError.enveloped`, a constructor parameter defaulting to
  `true`, passed `false` only by `unwrap`'s fallback (R5).
- No change to `TiersService`, `SeatMapService`, `LayoutService`, the filter, `backend/prisma/`, or
  the hand-written types in `packages/shared/src/` (the Admin app uses the generated type, R5).
- `contracts/openapi.yaml` and `packages/shared/src/api-schema.ts`: this PR.

## R10. Specs this supersedes, and work in flight

- **`008` FR-018** ("Scheduling MUST create the event, turn reserved seating on, create the ticket
  types, and map the sections, through the existing operations … A refusal after the event exists
  MUST say what failed and link to the event") and **`008` research R10**'s Create bullet: superseded
  for scheduling by FR-003 and FR-008 here. A note is added to each, pointing here; their editing
  parts stand.
- **`014` research R9**'s "After creating" paragraph describes the old refusal path ("Seating setup
  not finished"); a note says that path is gone (`031` FR-012) and the picture path is unchanged.
  `014` FR-018 itself is unchanged.
- **Spec `030`** (#133): its spec PR merged (`10bd53f`: contract 1.22.0 with `listEvents`'
  `includePast`, constitution 3.9.2); its implementation (`EventsService.findAll`, the Admin events
  and venue pages) is not merged yet. Different functions from this feature's (`createLocked`, the
  event form), so the code does not overlap. This branch is rebased onto it (R12).
- **Issue #130** (doors open as hours before the start, not specced): changes how the form picks
  `doorsOpenAt`, not what it sends. Whichever lands second rebases `EventForm.tsx`.
- **Issue #134** (the event form rework, not specced): builds on this feature: scheduling is already
  one request, and server errors already carry the field's path (R3). It owns editing's
  all-or-nothing (R7) and errors shown as the admin types.

## R11. Tests (Constitution VI)

Written first, seen to fail, then made to pass:

- **Backend integration** (Testcontainers PostgreSQL), new `backend/test/integration/
  events.create-setup.e2e-spec.ts`:
  - success, general admission: two types with quantities; the event and both types saved, in one
    request; the response matches the contract.
  - success, reserved seating: three sections, two types, one section left unsold; `reservedSeating`
    true, capacity the layout's total, each type's quantity its sections' seats, two mappings; the
    seat map (`getSeatMap`) shows them.
  - a body without `tiers` and `reservedSeating` gives exactly today's answer (and `tiers: []`).
  - each refusal of R4, with its status, code, and path: a repeated name (also differing in case
    and spaces), a missing quantity, a quantity with reserved seating, a non-empty `sectionIds`
    without it (and `sectionIds: []` without it accepted), `null` for `reservedSeating`, `tiers`,
    or `sectionIds`, more than 50 ticket types, `tiers: [5]`, a
    section of another venue, a section under two types, a repeated id in one `sectionIds`, reserved
    seating at a venue without a layout, `totalTicketCapacity` with reserved seating, a limit above
    the layout's total, the quantities over capacity, malformed tier fields (all listed at once with
    their paths), an unknown tier field; and a scheduling conflict with ticket types. **For every
    one, the counts of `Event`, `TicketTier`, and `SectionTier` rows are unchanged.**
  - a failure after the event row is written: the test makes `tx.sectionTier.createMany` throw (a
    Jest spy on the Prisma transaction client's model, or a section deleted between planning and
    writing by a trigger set up in the test) and checks no rows remain and the response is a `500`
    envelope. The implementer picks the less invasive of the two and records it in the task.
- **Concurrency** (genuinely concurrent requests), new
  `backend/test/integration/events.create-setup.concurrency.e2e-spec.ts`: two schedules for
  overlapping windows at one venue, each with three ticket types, sent at once, ten rounds: exactly one
  `201` and one `409 SCHEDULING_CONFLICT` each round; the ticket types in the database are exactly the
  winner's three. And a seated schedule racing a layout save at its venue: either the layout is saved
  first and the schedule is refused (its sections are gone) with nothing saved, or the schedule is
  saved first and the layout save then drops its mappings as today (`007` research R11); never a
  mapping to a section that no longer exists.
- **Backend unit**, new `backend/test/unit/event-setup.spec.ts`: `planEventSetup`'s every branch,
  the paths, and the seat sums.
- **Admin app** (Vitest), new `admin-app/test/event-create-atomic.test.tsx`: a schedule sends exactly
  one `POST /events` whose body has `tiers` (and `reservedSeating` and `sectionIds` at a venue with a
  layout) and no `POST …/tiers` or `PUT …/seating`; a `409 TIER_NAME_TAKEN` with `details.field:
  tiers.1.name` shows its message beside ticket type 2 (its inputs `aria-invalid`, described by it)
  and in the banner, keeps every value and the chosen picture, sends no picture, and does not navigate;
  a `400` with `tiers.0.sectionIds …` shows beside ticket type 1's seats line; a `409
  CAPACITY_EXCEEDED` with `field: tiers` beside the ticket types; fixing and scheduling again sends a
  second `POST /events` and opens the event; a thrown network error shows FR-011's message with the
  link and keeps every value. Existing tests written against the old sequence are updated to the one
  request (`event-seating-create.test.tsx`, the "Seating setup not finished" cases in
  `images-field.test.tsx`, and every create flow that stubs `POST /events/{id}/tiers` or `PUT
  /events/{id}/seating`; T007 lists them), keeping what they check.
- **Browser** (`e2e/`), new `e2e/tests/031-atomic-event-create.spec.ts`, `031 S3: …` (quickstart
  S3): on the running stack, schedule an event whose second ticket type repeats the first's name in
  another case; the message shows beside ticket type 2, the form keeps its values, the Events list (API
  search by the unique name) has no such event; rename and schedule; exactly one event, with both
  types.

## R12. Contract, constitution, and README

- **Contract 1.22.0 → 1.23.0** (MINOR: optional request fields), on top of spec `030`'s 1.22.0.
  `api-schema.ts` regenerated; `node scripts/check-contract-drift.mjs` passes. Until the
  implementation merges, `main`'s Backend refuses `tiers` and `reservedSeating` as unknown fields
  (`forbidNonWhitelisted`); no client sends them before then, so `main` stays green. The Backend's
  contract tests check responses only, and the responses do not change.
- **Constitution 3.9.2 → 3.9.3** (PATCH, roadmap row `031` after `030`'s, next free number
  `032`), on top of `030`'s 3.9.2. The branch was cut before `030`'s spec merged and rebased onto
  `main` after it (spec review round 1): the Sync Impact Report is this amendment's, the roadmap keeps
  both rows, the contract keeps `030`'s `listEvents` change and its corrected `VALIDATION_FAILED`
  examples with version 1.23.0, `api-schema.ts` was regenerated, and the README's status table keeps
  both rows.
- **README**: the `031` status row and the version reference (this PR); the Admin app's description of
  scheduling, if it says the event is created before its ticket types, in the implementation PR.
- **Shared surface** in this PR: the constitution, `contracts/openapi.yaml`, and
  `packages/shared/src/api-schema.ts` (generated): every team member approves. The implementation PR
  touches no shared surface (R9).
