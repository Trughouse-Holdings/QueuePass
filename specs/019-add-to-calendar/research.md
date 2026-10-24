# Research: Add to Calendar

Decisions behind [plan.md](./plan.md). Each one names the spec requirements it serves.

## R1: The calendar file is made in the browser, not by a Backend endpoint

**Decision**: The Customer app builds the `.ics` text and the Google Calendar link itself, in one
module, `customer-app/src/calendar.ts`, from the order's event summary that **My tickets** already
loads (`GET /me/orders`). No Backend endpoint is added for the file.

**Rationale**:

- **Constitution I** puts business logic and persistent state in the Backend. A calendar file is
  neither: it is a presentation format of data the customer is already allowed to see, like the
  date formatting in `customer-app/src/format.ts` or the QR codes the Customer app draws for spec
  017's printed tickets. It enforces nothing and writes nothing. The one rule involved, when to
  offer it (FR-002), guards no write and protects nothing (anyone may type an event into their own
  calendar), so it is a display choice like hiding **Show entry code** on a used ticket (R10).
- **Auth on downloads**: every API call carries the access token as a `Bearer` header and never in a
  URL (Constitution V). A plain `<a href="/me/orders/…/calendar.ics">` cannot send that header, so a
  Backend file would still have to be fetched by script and saved from a `Blob`, exactly as the
  browser-made file is, plus a request, its error states, and its authorization tests. A signed or
  cookie-authenticated download URL would be a new authentication path, which the constitution does
  not allow for a convenience.
- **FR-010**: the file needs no request, so it works on a weak connection once **My tickets** has
  loaded, and there is no new failure state to design.
- **Contract**: no new operation, no `text/calendar` response to declare, no new error. The only API
  change is one field on an existing response (R2).

**Alternatives considered**:

- `GET /me/orders/{orderId}/calendar.ics` in the Backend (`customer`, owner only, `text/calendar`):
  one place that writes iCalendar, reusable by a future email feature. Rejected: a new operation,
  error set, and authorization tests for no rule the Backend must enforce, and the browser would
  still fetch it with the token and save a `Blob`. If a future feature (emailed tickets, a calendar
  feed) needs iCalendar in the Backend, the module moves to `packages/shared` then (Principle VIII).
- `packages/shared/src/calendar.ts` now: only the Customer app uses it (YAGNI). The module has no
  React or browser dependency, so moving it later is a file move.

## R2: The venue's address reaches My tickets as one new field on `OrderEvent.location`

**Decision**: Contract **1.12.0** adds `address` (string, 1–500 characters, the venue's
`Location.address`) to `OrderEvent.location`, the event summary in every `MyOrder` of
`listMyOrders`. In this spec and plan PR it is declared but not in `required`, so `main` stays green
while the Backend does not yet send it; the implementation PR sends it and adds it to `required`
(the pattern of 018's `verifiedBy`). `packages/shared/src/api-schema.ts` is updated with it.

**Rationale**: FR-012. `OrderEvent` is, in the contract's own words, "the parts of an event My
tickets shows next to an order"; the calendar entry needs the address there. The Backend already
loads the whole venue for this response (`orders.service.ts` `mine()`: `include: { location: true
}`), so sending one more column costs nothing. `Location.address` is the one-line address that every
client shows (013 FR-010): the formatted `STREET, CITY, ST ZIP` for a checked venue, or the text a
venue from before 013 was saved with (spec Edge Cases). It is always present (`required` on
`Location`, at least 1 character).

**Alternatives considered**:

- **Fetch `GET /locations/{id}` from My tickets** (allowed to customers, spec 003): no contract
  change, but one request per distinct venue, either on every page load (for a field shown nowhere
  else on the page) or on click, which would delay the download and, for Google Calendar, open the
  tab after an `await` and risk the pop-up blocker. It also adds a loading and an error state to
  each card. Rejected.
- **The four address parts** (`street`, `city`, `state`, `zip`): the calendar wants one line, the
  parts are `null` for venues from before 013, and `formatAddress` would have to be repeated in the
  client. Rejected.
- **The whole `Location`** in `OrderEvent`: capacity, verification flag, and timestamps are not
  needed here (Principle VIII). Rejected.

## R3: The shape of the calendar file

**Decision**: Exactly these lines, in this order, each ending in CRLF (`\r\n`), the last included:

```text
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//QueuePass//Customer app//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:queuepass-event-<event id>
DTSTAMP:<now, UTC>
DTSTART:<event start, UTC>
DTEND:<event end, UTC>
SUMMARY:<event name, escaped>
LOCATION:<venue name, escaped>\, <venue address, escaped>
END:VEVENT
END:VCALENDAR
```

with long lines folded (R7). Example, for an event from 7:30 to 10:45 pm Eastern Daylight Time:

```text
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//QueuePass//Customer app//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:queuepass-event-6f1c2a4e-3b7d-4e2f-9a10-5c8d7e6f4a21
DTSTAMP:20261024T153000Z
DTSTART:20261031T233000Z
DTEND:20261101T024500Z
SUMMARY:Season Opener
LOCATION:KFC Yum! Center\, 1 ARENA PLAZA\, LOUISVILLE\, KY 40202
END:VEVENT
END:VCALENDAR
```

**Why each line**:

- `VERSION:2.0` and `PRODID` are required by RFC 5545 §3.6. `PRODID` names the product, not a
  version, so it never changes and needs no upkeep.
- `CALSCALE:GREGORIAN` is the default; stated because some older Outlook versions expect it.
- `METHOD:PUBLISH` (RFC 5546): the file is information to add, not an invitation to answer. Without
  a `METHOD`, or with `REQUEST`, Outlook can treat the entry as a meeting and offer Accept/Decline,
  and some apps then expect an `ORGANIZER`. RFC 5546 §3.2.1 does list `ORGANIZER` as required in a
  `PUBLISH` event; the file leaves it out on purpose (a deliberate deviation, review round 2, T022):
  it would put a person or address in a file the customer may forward (FR-004), and Apple
  Calendar, Outlook, and Google import a `PUBLISH` event without one. The browser walk (T023)
  confirms each imports it as a plain entry. No `ATTENDEE` either, so no account appears.
- `UID` and `DTSTAMP` are required in every `VEVENT` (§3.6.1); see R4.
- `DTSTART` and `DTEND` in UTC (R5). `DTEND` rather than `DURATION`, because the event has an end
  (R14) and an end time reads plainly. An order whose stored times don't parse, or whose end is not
  after its start, gets no calendar group at all (review round 2, T022), so one bad record can't
  break My tickets.
- `SUMMARY` is the title, `LOCATION` the place (FR-004). The comma between venue name and address is
  escaped like every other comma in a text value (R6).
- No `DESCRIPTION`, `URL`, `ORGANIZER`, `ATTENDEE`, `VALARM`, `SEQUENCE`, `STATUS`, or `TRANSP`:
  FR-004 limits the content, reminders are the calendar app's (spec Out of Scope), and each is
  optional in RFC 5545 (`ORGANIZER`'s RFC 5546 deviation is above). `SEQUENCE` defaults to 0, which is what a snapshot is.
- No `VTIMEZONE`: every time is UTC (R5).
- No byte order mark: RFC 5545 §3.1.4 makes UTF-8 the default, and a BOM before `BEGIN` breaks some
  readers.

**Alternatives considered**: a `DESCRIPTION` with the seat or ticket codes (FR-004 says no; a
forwarded calendar entry would leak them); `METHOD:REQUEST` (an invitation, wrong for a snapshot);
`X-WR-CALNAME` (names a whole calendar on import into Apple Calendar, which then offers a new
calendar called that, not wanted for one entry).

## R4: UID, DTSTAMP, and adding the same event again

**Decision**:

- `UID:queuepass-event-<event id>`, the event's UUID in lower case with dashes. The same for every
  file of that event, whatever the order, the customer, the device, or the moment (FR-007).
- `DTSTAMP`: the moment the file is made, in UTC, to the second (`YYYYMMDDTHHMMSSZ`). The generator
  takes it as a parameter, so tests pass a fixed instant.

**Rationale**:

- RFC 5545 says a `UID` must be globally unique and persistent for the entry; RFC 7986 §5.3
  recommends a value with no host name or other identifying data. A UUID is unique; the prefix makes
  it obvious where the entry came from. A calendar app that honors `UID`s updates an entry it
  already holds when the same `UID` is imported again, so re-adding after the event changed brings
  the new details without a duplicate. Apps differ here: some update, some ask, and some add a
  second entry. FR-007 requires only the same `UID`; the running-system walk records what the apps
  it uses do (quickstart S6, US1 scenario 6).
- **One `UID` per event, not per customer** (confirmed by Mahdi, 2026-10-24): every file of one
  event (two orders, or two downloads) names one entry, which is the point. Adding the customer to
  the `UID` would put an account identifier (the Keycloak subject) into a file customers forward and
  share, for no gain: each customer adds the file to their own calendar, where only their copy
  exists. If two customers share one calendar and both add the event, one entry is the right result.
- With the same `UID` and `SEQUENCE` 0 every time, RFC 5546 orders revisions by `DTSTAMP`, so the
  newer file wins in apps that check. Raising `SEQUENCE` when the event changes would need a
  revision count or `updatedAt` on `OrderEvent`, which a snapshot does not justify (out of scope).

**Alternatives considered**: a random UUID per download (re-adding duplicates; FR-007 fails);
`<event id>@<customer sub>` (leaks the account id, above); `<order id>` (two orders for one event
make two entries); a hash of the content (a changed event would no longer replace the old entry).

## R5: Times are UTC instants with `Z`, independent of every time zone

**Decision**: `DTSTART`, `DTEND`, and `DTSTAMP` are written in RFC 5545's UTC form,
`YYYYMMDDTHHMMSSZ` (§3.3.5, form #2), from the event's `startsAt` and `endsAt` instants, using only
`Date`'s `getUTC…` methods. Milliseconds are dropped (event times are whole minutes in practice; a
second is the format's finest unit). No `TZID`, no `VTIMEZONE`, no floating times.

**Rationale**:

- **FR-005**: a UTC time with `Z` is one exact moment, which every calendar app shows in its user's
  zone. The file therefore does not depend on the zone of the customer's device, browser, or calendar,
  and two devices in different zones make byte-identical files apart from `DTSTAMP` (SC-002).
- **Constitution, Time**: instants are stored in UTC and exchanged as RFC 3339; this keeps them
  instants all the way to the calendar.
- **Feature 020** (venue time zones, #42, specified in parallel): 020 changes how the apps show and
  take times, in the venue's zone. A UTC entry is correct in every zone, so 019 needs nothing from
  020 and is unaffected if 020 lands first. If 020 later wants the entry to carry the venue's zone
  (so a calendar shows "7:30 PM EDT" when the customer travels), it can switch to `TZID` with a
  `VTIMEZONE`; that is 020's call, not a conflict.
- Floating times (no `Z`, no `TZID`) would put the event at 7:30 pm in whatever zone the calendar is
  in: wrong for anyone outside the venue's zone. A `TZID` needs the venue's zone, which 019 does not
  have and must not depend on.

**Tests**: two independent proofs that the file does not depend on the zone, both asserting the
zone really changed, so a run that silently stays in one zone fails instead of passing:

1. **In the file**: the generator's tests run every fixture with `process.env.TZ` set in turn to
   `UTC`, `America/New_York`, `America/Los_Angeles`, and `Asia/Kolkata` (a half-hour offset), assert
   `new Date('2026-10-24T12:00:00Z').getTimezoneOffset()` is `0`, `240`, `420`, and `-330`, and
   require output identical to the committed expected text. Node re-reads `TZ` when it is assigned,
   and Vitest runs each test file in its own process (`forks`, its default pool), so this is reliable.
   **Both checks depend on that pool**: in a `worker_threads` worker, assigning `process.env.TZ`
   changes nothing (checked in spec review round 2). The Customer app sets no pool, and Vitest 3
   defaults to `forks`. If the pool were ever switched to `threads`, the offset and zone assertions
   would fail the file rather than let it pass, which is the right failure; keep `forks`.
2. **From the shell**: the Customer app's `vitest.config.ts` pins `test.env.TZ` to
   `America/New_York` for every test (spec 003 research R6), and Vitest writes `test.env` over the
   inherited environment, so `TZ=UTC npx vitest …` would still run in New York, in CI too. The pin
   stays (other tests depend on it). Instead, `calendar.test.ts` reads its own variable,
   `CALENDAR_TEST_TZ`: when it is set, a `beforeAll` assigns it to `process.env.TZ`, asserts the
   effective zone (`Intl.DateTimeFormat().resolvedOptions().timeZone` equals it) and its offset on
   2026-10-24 (`UTC` 0, `America/New_York` 240, `America/Los_Angeles` 420), prints
   `[calendar-tz] <zone> offset <minutes>`, and fails if either does not match. Because the zone is
   compared by name, the shell runs use only names ICU reports canonically: `UTC`,
   `America/New_York`, and `America/Los_Angeles`. `Asia/Kolkata`, for example, resolves to ICU's
   `Asia/Calcutta` and fails the name check, so it stays in the in-file loop, which checks offsets
   only. (From Git Bash, a plain `TZ` does not even reach a Windows `node.exe`;
   `CALENDAR_TEST_TZ` does.) Every test in the
   file then runs in that zone against the same committed expected text. Tasks T016 runs it three
   times, with `CALENDAR_TEST_TZ` set to `UTC`, `America/New_York`, and `America/Los_Angeles`, and
   checks each run's printed line. Without the variable, the file runs in the pinned zone, as in CI.

**Alternatives considered**: `TZID=America/New_York` from the browser's zone (wrong for a customer
travelling, and depends on the device, against FR-005); waiting for 020 (the issue does not need it;
the roadmap row says 019 depends only on 006).

## R6: Text escaping

**Decision**: In `SUMMARY` and `LOCATION` (RFC 5545 §3.3.11, TEXT), in this order:

1. `\` → `\\`
2. `;` → `\;`
3. `,` → `\,`
4. each line break (`\r\n`, `\n`, or `\r`) → `\n` (backslash, lower-case n)
5. every other control character (U+0000–U+001F except tab, and U+007F) is removed; tab is kept.

Then `LOCATION` is `escape(venue name) + "\, " + escape(address)`. Nothing else is escaped: `:` and
`"` need no escape in a TEXT value. Characters outside ASCII (accents, CJK, emoji) are written as
UTF-8, unescaped.

**Rationale**: FR-008, SC-003. The backslash goes first, or the backslashes the other steps add
would be doubled. RFC 5545 forbids control characters other than tab in TEXT (`TSAFE-CHAR`), and a
raw newline would end the property early. Event and venue names are single-line inputs, but nothing
in the API forbids a line break, so the generator handles it rather than trusting the forms.

**Tests**: each rule with its own fixture, and a combined fixture
`Rock, Paper; Scissors \ Live` with a line break, read back by the test reader (R15) to exactly the
original text minus control characters.

## R7: Line folding at 75 octets, CRLF line ends

**Decision**: After escaping, each content line longer than 75 octets of UTF-8 is folded: the first
line holds at most 75 octets, each continuation line starts with one space and holds at most 74 more
octets (75 with the space), and a fold never falls inside a UTF-8 sequence (a multi-byte character
is moved whole to the next line). Every line, including the last, ends with CRLF.

**Rationale**: RFC 5545 §3.1: "Lines of text SHOULD NOT be longer than 75 octets, excluding the line
break", folded by CRLF plus one space or tab; a reader removes CRLF and the one whitespace character.
Splitting a UTF-8 sequence is legal for the format but produces broken characters in readers that
decode each line separately (Outlook among them), so the generator never does it. Octets, not
JavaScript string length (UTF-16 code units), are counted, with `TextEncoder`. Emoji outside the
Basic Multilingual Plane are two UTF-16 code units and 4 octets; the generator walks by code point.
Lines end in CRLF because §3.1 requires it, and a bare LF is refused by some strict readers.

A fold may fall between a `\` and the character it escapes: readers unfold before they unescape
(§3.1), so that is correct, and the reader test proves it.

**Tests**: a 200-character ASCII name (`SUMMARY:` + 200 = 208 octets, folded into 3 lines of 75, 75,
and 60 octets, the last two counting their leading space); a name of 2-octet letters (`é` × 100); a
name of 3-octet characters (`漢` × 70); a name of 4-octet emoji (`🎉` × 50) where the 75th octet
would fall inside a character; a location whose `\,` lands on a fold; every line ≤ 75 octets; every
line ends in CRLF; no LF without CR; unfolding gives back the unfolded line.

## R8: Google Calendar link

**Decision**:

```text
https://calendar.google.com/calendar/render?action=TEMPLATE
  &text=<event name>
  &dates=<start>/<end>
  &location=<venue name>, <venue address>
```

built with `URLSearchParams` (so spaces become `+` and every reserved character is percent-encoded),
with `<start>` and `<end>` in the same UTC form as the file (`20261031T233000Z/20261101T024500Z`).
No `ctz`, no `details`, no `add`, no `sf`. It is an `<a>` with `target="_blank"` and
`rel="noopener noreferrer"`.

**Rationale**:

- The `render?action=TEMPLATE` form is Google Calendar's long-standing "add event" template link,
  used by Google's own "Add to Google Calendar" buttons; it opens the new-entry page filled in, which
  the customer saves (US2). `text`, `dates`, and `location` are its title, times, and place (FR-004).
- `dates` with `Z` is a UTC instant; `ctz` only names the zone for times written without `Z`, so it
  is not needed (FR-005). Google shows the entry in the account's zone.
- No `details` (FR-004). The `location` value is the same text as the file's `LOCATION`, unescaped
  (URL encoding replaces iCalendar escaping).
- `noopener` so the Google tab cannot reach **My tickets**; `noreferrer` so Google is not told the
  address of the customer's QueuePass page (FR-011: only the entry is sent).
- **Length**: the event name (≤ 200 characters), venue name (≤ 200), and address (≤ 500) are bounded
  by the contract. Typical links are under 300 characters. In ASCII the link is at most about 2,900
  characters even if every character were percent-encoded; with non-ASCII text it grows further (an
  emoji is 12 characters encoded), so a link made only of emoji at every maximum would be around
  10,000 characters. Browsers handle links far longer. How long a link Google's own front end accepts
  is not documented and is not tested beyond the running-system walk, which opens a link with a name
  as long as the Admin form allows, accents and an emoji included (quickstart S5). Nothing is cut
  (spec Edge Cases); if Google ever refused an extreme link, the calendar file still works.
- An `<a>` the customer activates is never blocked as a pop-up (spec Edge Cases), unlike
  `window.open` after an `await`.

**Alternatives considered**: `https://calendar.google.com/calendar/r/eventedit?…` (the newer
editor URL; same parameters, less widely documented, and redirects for signed-out users lose them
more often in practice); `ctz=` with local times (needs a zone; R5); the Google Calendar API (needs
OAuth consent and a Google client, far beyond the issue).

## R9: Outlook is served by the calendar file

**Decision**: The calendar file is Outlook's way in, under the control **Add to Apple Calendar or
Outlook**. No `outlook.live.com` or `outlook.office.com` link is offered.

**Rationale**: The issue asks that a customer can add to Outlook, and Mahdi chose the `.ics` file
for Apple Calendar and Outlook (Clarifications). Outlook for Windows and Mac opens a downloaded
`.ics` as an entry to save; Outlook on iOS and Android opens it from the downloads or share sheet;
Outlook on the web imports it (Add calendar → Upload from file). The Outlook web "compose" deeplinks
(`/calendar/0/deeplink/compose?subject=…&startdt=…`, and the `action/compose` variant) are
undocumented, differ between personal (`outlook.live.com`) and work or school accounts
(`outlook.office.com`), so one link cannot serve both, and have changed shape before. A third control
would also need its own accessible name, tests, and walk (Principle VIII).

**Alternatives considered**: two Outlook web links (personal and work), which the customer must
choose between; one `outlook.live.com` link (wrong for work accounts). Either can be added later in
the same `calendar.ts` if customers ask. Mahdi confirmed the file alone on 2026-10-24.

## R10: Who is offered the controls, decided in the client

**Decision**: A card offers the controls when `order.event.status !== 'CANCELLED'`,
`nowMs < Date.parse(order.event.endsAt)`, and `order.tickets.some(t => t.status === 'VALID')`
(FR-002), in one function, `calendarEligible(order, nowMs)`, in `calendar.ts`. `nowMs` is the moment
**My tickets** received its orders: read once when the load succeeds and kept with the loaded data,
so a later re-render does not re-decide (spec FR-002, Edge Cases).

**Rationale**: Mahdi's rule (not cancelled, not ended) plus the valid-ticket rule (proposed in the
spec, confirmed by Mahdi, 2026-10-24). It
is a display choice, like spec 018 hiding **Show entry code** on a used ticket: offering the control
grants nothing and refusing it protects nothing, so it does not need the Backend (Constitution IV is
about rules a write must obey). `endsAt` is exclusive (Constitution, Time: `[startsAt, endsAt)`), so
at `endsAt` the event has ended. Today the only path that voids tickets or refunds an order is
event cancellation (`005`, `EventsService.cancel`: every `VALID` ticket becomes `VOID`, every
`CONFIRMED` order `REFUNDED`, the event `CANCELLED`), so the status test alone hides every such
order. Spec `009` (single-order refunds, planned, not built) will make orders with only `VOID`
tickets for events still ahead; the ticket test excludes them automatically, with no change here. A
used ticket (`checkedInAt` set) is still `VALID`.

**The device clock**: the spec accepts that a badly wrong device clock shows or hides the controls
near an event's end (spec Edge Cases). Following the Backend's clock (spec 018 R3) would need a
`serverTime` on `listMyOrders` for a decision that protects nothing. Not worth a contract change.

**Alternatives considered**: a Backend `calendarEligible` flag on each order (a contract field for a
display choice, and it would still be stale while the page is open); re-checking every minute while
the page is open (a timer for a harmless edge case; Principle VIII).

## R11: Where the controls sit, and how they behave

**Decision**:

- **Placement**: in each eligible order card, after the event's details (`<dl>`) and before the
  ticket list, in a `<div role="group" aria-labelledby=…>` whose visible label is "Add to calendar".
  Inside, in this order: a short note with an `id`, "A copy for your calendar: it won't change if
  the event does." (FR-003); a `<button type="button">` **Add to Apple Calendar or Outlook**; and an
  `<a>` **Add to Google Calendar**. Both controls carry `aria-describedby` pointing at the note, so a
  screen reader reads it with each control (FR-003). The label's and the note's `id`s are unique per
  card (built from the order's id, for example `calendar-label-<order id>` and
  `calendar-note-<order id>`, or React's `useId()`), since My tickets shows one group per eligible
  card and a repeated `id` would point every card at the first card's elements.
- **Names** (FR-013): `aria-label="Add to Apple Calendar or Outlook: <event name>, downloads a
  calendar file"` and `aria-label="Add to Google Calendar: <event name>, opens in a new tab"`. Each
  starts with the visible text (WCAG 2.5.3, Label in Name), names the event so the controls on
  different cards differ in a screen reader's list, and says what will happen (a download, a new tab;
  WCAG 3.2.5 advises warning of a new window).
- **Look** (FR-014): both controls use the shared theme's `btn btn--ghost` classes (`012`), the
  link included, because `.btn` is what gives a control its 44-pixel minimum size (`theme.css`); a
  plain link would not reach 44 pixels. The two sit side by side and wrap under each other at phone
  width. No icons, no new theme value.
- **Keyboard**: a native `<button>` (Enter and Space) and a native `<a href>` (Enter), in reading
  order, with the theme's focus ring. No `tabindex`, no custom key handling.
- A button for the file because it performs an action on the page (making and saving a file); a link
  for Google because it navigates to a URL.

**Rationale**: The issue says "from My tickets". The page lists orders, each card headed by its
event, so the card is the event's place on the page. Per ticket would repeat one entry up to ten
times per order. Grouping orders by event would redesign **My tickets**, which the issue does not ask
for (spec Out of Scope); two orders for one event each offer the controls and make the same entry
(R4).

**Alternatives considered**: one control per ticket (repetition); one per event, on the newest order
only (a customer looking at an older order's card would not find it); a single "Add to calendar"
button opening a menu of calendar apps (a menu needs focus management and Esc handling, and hides
what each option does; two plain controls are simpler and accessible by default); a `data:` URL in
an `<a download>` (works, but a long `data:` URL lives in the DOM for every card and some browsers
cap its length; the `Blob` is made only on click, R12).

## R12: File name, MIME type, and how the file is saved

**Decision**:

- **Name** (FR-009): `icsFileName(eventName)`: lower-case, NFKD-normalized with combining marks
  removed (so `Café` becomes `cafe`), every run of characters other than `a`–`z` and `0`–`9` replaced
  by `-`, leading and trailing `-` removed, cut to 60 characters (and any `-` the cut leaves at the
  end removed), then `.ics`; `event.ics` when nothing is left (a name of only emoji or CJK).
  `Season Opener` → `season-opener.ics`.
- **MIME type**: `text/calendar;charset=utf-8` on the `Blob` (RFC 5545 §8.1 registers
  `text/calendar`; the charset makes the UTF-8 explicit).
- **Saving**: on click, `new Blob([text], { type })`, `URL.createObjectURL`, a temporary
  `<a href download="<name>">` clicked and removed, and `URL.revokeObjectURL` 60 seconds later (an
  immediate revoke can cancel the download in Safari and Firefox). Nothing is stored in
  `localStorage`, `sessionStorage`, or the URL.

**Rationale**: A readable, safe file name on every operating system (no `/`, `\`, `:`, or spaces) that
tells the customer which event the file is. The date is left out because which date (UTC or local)
would be ambiguous for an event near midnight. Desktop browsers save the file, and opening it starts
the default calendar app. On phones, what happens after the download depends on the system and the
browser: some offer to add it to a calendar, some only save it to the downloads, and some browsers
(in-app browsers in particular) may not save a `Blob` download at all. The spec does not require
more than the download there, and the Google link is the dependable phone path (spec Edge Cases).

**Alternatives considered**: `queuepass.ics` for every event (a customer with several cannot tell
them apart); the event id as the name (unreadable); a `data:` URL (R11).

## R13: No new dependency

**Decision**: No npm package. The generator is about 100 lines of TypeScript using `Date`,
`TextEncoder`, `String.prototype.normalize`, and `URLSearchParams`, all built into browsers and
Node.js 22.

**Rationale**: Principle VIII. The file has one fixed shape with two text fields; the only subtle
parts (escaping, folding, UTC formatting) are small and fully specified here, and the tests pin them
down. A library would bring far more than one entry needs.

**Alternatives considered**: `ics` (adds a validation library and its own date-array API; folds by
character count in some versions, which is wrong for UTF-8); `ical-generator` (a full calendar model
with time zone plug-ins); `ical.js` as a test-only reader (a dev dependency for tests that a 20-line
reader in the test file covers: unfold, split at the first unescaped `:`, unescape). The real-app
import in the running-system check (R15) is the outside validation.

## R14: Events always have an end

**Decision**: No fallback for a missing end time. `OrderEvent.endsAt` is required in the contract,
every event has a start and an end (spec 002; Constitution, Data model minimums), and spec 002
requires the end to be after the start. The generator still refuses (throws) an end not after the
start, which no stored event has, so a broken fixture fails loudly instead of making a zero-length
entry.

## R15: How it is tested

**Decision**:

- **Generator unit tests** (`customer-app/test/calendar.test.ts`, Node environment), written first:
  the exact file for the R3 example, byte for byte; each escaping rule (R6); folding by octets with
  ASCII, 2-, 3-, and 4-octet fixtures (R7); CRLF on every line; `UID` the same across orders and
  `DTSTAMP` values (R4); UTC formatting including an event that crosses midnight and an end in the
  next year; milliseconds dropped; the same output under four `TZ` values (R5); `icsFileName` cases
  (R12); `googleCalendarUrl` exact for the example and for reserved characters (R8);
  `calendarEligible` on both sides of `endsAt` to the millisecond, cancelled, all tickets void,
  used (R10). A small reader in the test file unfolds and unescapes every fixture back to its inputs,
  including a maximum-length `LOCATION` (200-character venue name, 500-character address) (SC-003).
  The same file runs under four zones in-process, and again under three zones from the shell through
  `CALENDAR_TEST_TZ` (R5).
- **Component tests** (`customer-app/test/add-to-calendar.test.tsx`, React Testing Library): the
  controls appear once on eligible cards and not at all on others (SC-005); names and order (FR-013);
  keyboard use (Tab, Enter, Space) downloads the file with the right name, type, and content, via
  spies on `URL.createObjectURL` and the anchor's `click`; the Google link's `href`, `target`, and
  `rel`; the snapshot note (FR-003).
- **Backend** (`backend/test/integration/me-orders.e2e-spec.ts`, Testcontainers): every order's
  `event.location.address` equals its venue's `address`, for a checked venue and a venue from before
  013, and responses match the contract with `address` required (FR-012).
- **Repeat runs**: every affected workspace's suite (`packages/shared`, `backend`, `customer-app`) is
  run three times in a row before the PR, with the results recorded, to catch flaky tests (Mahdi,
  2026-10-24).
- **Running system** (quickstart): two events, each added through the file to a real calendar app and
  through the Google link, checked by eye against the event; the files also checked for CRLF and line
  length from the shell. Mahdi asked for this twice, with two events (2026-10-24).

**Rationale**: The generator is pure, so its tests can be exact; the reader proves round-trips; a
real calendar app is the final judge of "works with Apple Calendar and Outlook", which no unit test
can show.
