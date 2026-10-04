# Research: Customer Event Search and Usability

Decisions for feature `008`, planned under constitution v2.3.0 on top of `007`. No Backend,
database, or contract change (spec FR-012).

## R1: Filters through the existing search, state in the address

The Events page reads its filters from the page address (`useSearchParams`) and writes them back
on every change, with `replace` for typing so the back button is not flooded:

| Address parameter | Control | Sent to `GET /events` as |
|---|---|---|
| `q` | Search box (trimmed) | `q` |
| `venue` | Venue select (from `GET /locations`) | `locationId` |
| `from` | Start date (`YYYY-MM-DD`) | `from`: local midnight of that day, as an instant |
| `to` | End date (`YYYY-MM-DD`) | `to`: local midnight of the **next** day (the Backend's `to` is exclusive) |
| `hideCancelled=1` | "Hide cancelled" checkbox | not sent; applied in the app (spec FR-002) |

Typing waits about 300 ms after the last keystroke before searching. **Invalid parameters are
dropped before any request** (spec FR-003): a `venue` that is not a UUID or not among the venues,
a date that does not parse, or a `to` before `from`. Otherwise the Backend would answer `400` for
input the customer never typed.

**Empty states** (FR-004): with any filter active and nothing returned, "No events match your
filters" and a **Clear filters** button that empties the address; with no filters and nothing
returned, `003`'s "Nothing is scheduled yet." (unchanged, FR-011).

**Alternatives rejected**: downloading every event and filtering in the app would ignore `004`'s
search and grow with every event; a Search button adds a step for no benefit at this size.

## R2: Reusing the Admin app's look by copying its stylesheet

`customer-app/src/styles.css` starts as a copy of the parts of `admin-app/src/styles.css` the
Customer app uses (tokens in light and dark, base, top bar, nav links, buttons, cards, pills,
fields, notes, empty and loading states, the 640-pixel breakpoint), plus Customer-only rules
(R3–R5). Each copied block notes its source.

**Alternatives rejected**: moving the stylesheet into `packages/shared` would make every future
style tweak a shared-surface change needing every member's approval, and the shared package
builds TypeScript only; a new design would break Constitution VII and FR-010.

**Contrast** (FR-007): `--text-faint` (#8b939d on white, about 3.3:1) fails AA for text, so the
Customer app uses it only for borders and decoration, never text. A test (R6) computes the
contrast of every text and state token pair the Customer stylesheet uses, in light and dark.

## R3: Event cards

The event list and a venue's event list become a list of `article` cards (spec FR-005): name as
a link, local date and time, venue as a link, base price, and a `Cancelled` badge (a pill using
the danger tokens) when cancelled. Cards sit in a grid, `repeat(auto-fill, minmax(260px, 1fr))`,
one column on a phone. Card content comes only from `GET /events`, with no per-card requests
(spec Clarifications).

On the event page, the `006` Get tickets form keeps its data; sold-out tiers, a cancelled event,
and closed sales show as badges, and the lowest tier price shows as "from $X" when the event has
tiers.

`003`'s Customer tests read the event list as table rows; they are updated to read cards, with the
same assertions about content and order (spec FR-011 keeps behavior, not markup).

## R4: Phone width and touch targets

- Page container padding and the 640-pixel breakpoint from the Admin app; every page is one column
  below 640 pixels.
- `.btn`, form fields, radio and checkbox labels, and seat buttons get `min-height: 44px` and
  `min-width: 44px` (FR-006).
- **The seat map scrolls inside its own box**, not the page: a section can be 200 seats wide, so
  each section's grid sits in a region with `overflow-x: auto`, labelled for screen readers, while
  the page itself never scrolls sideways. Rows stay straight, which keeps a seat map readable.

**Alternatives rejected**: wrapping a row of 200 seats onto 25 lines would make rows unreadable.

## R5: Seat and status states beyond color (FR-008, FR-009)

| State | Look | Announced as |
|---|---|---|
| Open | outlined button, seat number | the button's name ("Row 1, Seat 5") |
| Chosen | filled with the accent color, a ✓ before the number, a thicker border | `aria-pressed="true"` |
| Taken | hatched background (a repeating stripe), a ✕ instead of the number, dashed border | `disabled` |

Glyph, border style, and pattern each differ, so states hold in grayscale. Names stay exactly as in
`007` ("Row R, Seat S"), so its tests keep passing; the state comes from `aria-pressed` and
`disabled`, which assistive technology already announces. Every control gets a visible
`:focus-visible` outline in the accent color.

## R6: Tests

- **Customer app (Vitest, React Testing Library)**: each filter alone and combined builds the
  right `GET /events` query; the address round trip (render at an address, filters filled, results
  match); invalid address parameters dropped; hide-cancelled; both empty states and Clear filters;
  cards' content and Cancelled badge on the Events and venue pages; seat states' `aria-pressed`,
  `disabled`, and glyphs; `003`, `006`, and `007` tests updated only where they read the table.
- **Contrast** (`customer-app/test/contrast.test.ts`): parses the stylesheet's tokens and checks
  each text pair is at least 4.5:1 and each state boundary at least 3:1, light and dark.
- **Running-system check**: 375-pixel width with no sideways scrolling and 44-pixel targets,
  checked in a browser's device mode (quickstart).

## R7: Detail pages match the top bar, in both apps (US4, added during the browser check)

The browser check showed four gaps the Admin app shares: `.btn` has no background unless a
variant class is added (so `.btn` links look like links and `.btn` buttons fall back to gray system
buttons), no base link color (browser blue and purple in dark mode), `<dl>` in browser defaults
(label above, value indented), and content placed straight in a `.card` touching its edges.

**Decision**: one block of shared rules, **identical in both stylesheets** between marker
comments: `a` in the accent color; `.btn` with the ghost look by default (variants still
override); the top bar's Log out button styled as a `.btn`; `dl` as a two-column label/value grid
with muted labels; inner spacing for a card's direct children except tables and forms, which pad
themselves; space between stacked cards; and `.page-head .form__actions` without the form's top
rule. My tickets' codes become `ticket-list` rows. A test compares the two blocks so the apps
cannot drift.

**Alternatives rejected**: classes on each element would touch every page for the same result;
a shared stylesheet package is the shared-surface change R2 already declined.

## R8: A seated venue in one step (US5, added during the browser check)

The New venue form gets a Seated / General admission choice (General admission by default, so
`002`'s flow and tests are unchanged). Seated shows the same section lines as the venue page's
layout editor, extracted into a shared `SectionLines` component, and the running total. Creating
sends `POST /locations` with `seatingCapacity` set to that total (the contract still requires one)
and then `PUT /locations/{id}/layout`, which sets the capacity authoritatively (`007` R11). If the
layout is refused, the venue exists without a layout; the form says so and links to the venue's
page. No Backend or contract change.

**Alternatives rejected**: a single create-with-layout endpoint would be a contract change for one
form; requiring a layout on every venue is the option the user declined.

## R9: Ticket types and sections while scheduling (US6, added during the browser check)

When the chosen venue has a layout (`GET /locations/{id}/layout`), the Schedule event form shows
a **Tickets and seating** section: Reserved seating (default) or General admission; ticket type
lines (name, price); one row per section with a ticket type select, defaulting to the first type;
each type's seat total. Scheduling runs the existing operations in order: `POST /events` without a
capacity (the venue's, `007` FR-019); `PUT /events/{id}/seating` to turn reserved seating on;
`POST /events/{id}/tiers` per type without a quantity; `PUT /events/{id}/seating` with the
mappings, which sets each tier's quantity (`007` R11); then navigate to `/events/{id}`. A refusal
after the first step stops there, shows the Backend's message, and links to the event's page,
whose cards can finish the setup. No Backend or contract change.

**Alternatives rejected**: one create-with-seating endpoint would be atomic but is a contract
change with all-member approval for one form; the event page's cards stay for later changes.

