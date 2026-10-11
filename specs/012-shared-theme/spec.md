# Feature Specification: Shared Theme

**Feature Branch**: `012-shared-theme-spec`

**Created**: 2026-10-11

**Status**: Draft

**Issue**: [#24](https://github.com/Trughouse-Holdings/QueuePass/issues/24)

**Input**: User description: "Move theming into shared code used by both the Admin and Customer
apps, so the accent color and styles are guaranteed to match (Constitution VII, v3.0.0). One theme
in the shared code: accent color, fonts, spacing, and shared control styles (buttons, inputs,
status messages). Neither app defines its own accent color; app-specific styles use the theme's
values. One fixed set of values: no theme switching or per-app variants. The Booth app adopts it
when it gets functionality."

## Context

Builds on `008`, which gave the Customer app the Admin app's look by **copying** the Admin app's
styles into a second stylesheet. Today the two apps each hold a full copy of the same colors,
typefaces, buttons, fields, cards, and tables. Only one block of rules (the detail-page layout from
`008` US4) is checked to stay identical. Everything else can already drift, and has:

- The Customer app darkened the control border color and moved field hints, placeholders, and
  table headings to a darker gray, so they meet WCAG AA contrast. The Admin app still uses the old
  values, so its field borders are about 1.5:1 against the page and its hints are below 4.5:1.
- The Customer app gives buttons and fields a 44-pixel touch target and a visible keyboard focus
  outline. The Admin app does not.
- The Admin app shows errors and confirmations as colored banners. The Customer app shows its
  refusals on the Get tickets form, and "Can't reach the QueuePass service", as plain text.
- The red "Cancelled" badge has a border in one app and not the other.

Constitution VII (v3.0.0) now requires one shared theme that both apps take their look from, so
they are guaranteed to match. This feature creates that theme from the look the apps already
have, removes the copies, and adds an automated check that fails when an app goes its own way. It
does not design anything new.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Both Apps Look the Same (Priority: P1)

Someone who uses both apps, such as an admin who also buys tickets, sees one product. The accent
color, the typeface, the buttons, the text fields and menus, the cards, the tables, and the
status messages look the same in the Admin app and the Customer app, in light mode and in dark
mode.

**Why this priority**: This is the guarantee the constitution asks for. Without it, the two apps
look alike only until someone edits one of them.

**Independent Test**: Open the Admin app's event list and the Customer app's event page side by
side. Compare the primary button, a text field, a menu, a card, and an error message, in light
mode and then in dark mode. Each pair looks the same.

**Acceptance Scenarios**:

1. **Given** both apps open side by side in light mode, **When** a person compares the primary
   button, a secondary button, a text field, a menu, a checkbox, a card, a table, and a status
   badge, **Then** each pair has the same colors, typeface, corner rounding, and border.
2. **Given** the device is switched to dark mode, **When** both apps are reloaded, **Then** both
   switch to the same dark colors, and each pair still matches.
3. **Given** an error message in each app, **When** they are compared, **Then** both show as the
   same red banner.
4. **Given** a page that only one app has (the Admin reports tiles, the Customer seat picker),
   **When** it is viewed, **Then** it uses the same accent, text, border, and status colors as
   every other page.

---

### User Story 2 - The Apps Cannot Drift Apart (Priority: P1)

A team member styling a new screen in either app cannot give it its own colors or redefine the
shared look by accident. If they write a color directly, set their own typeface, or override a
shared value, the test suite fails and says which file and line to fix.

**Why this priority**: A shared look that nothing enforces decays the same way the copies did.
The check is what turns "should match" into "guaranteed to match".

**Independent Test**: In a branch, add a rule to one app's stylesheet that sets a color directly,
and another that redefines the accent color. Run the test suite. It fails, naming both lines.
Remove them and it passes.

**Acceptance Scenarios**:

1. **Given** an app stylesheet with a color written directly (for example a hex code), **When**
   the test suite runs, **Then** it fails, naming the file, the line, and the color.
2. **Given** an app stylesheet that redefines a theme value, such as the accent color, **When**
   the test suite runs, **Then** it fails, naming the file and the value.
3. **Given** an app stylesheet that sets its own typeface, corner rounding, shadow, or spacing not
   taken from the theme, **When** the test suite runs, **Then** it fails, naming the file and line.
4. **Given** a style written directly on an element in an app's screen code that sets a color or
   typeface, **When** the test suite runs, **Then** it fails, naming the file and line.
5. **Given** either app stops loading the shared theme, **When** the test suite runs, **Then** it
   fails, naming the app.
6. **Given** app styles that use only theme values, **When** the test suite runs, **Then** the
   check passes.

---

### User Story 3 - Status Messages Look the Same Everywhere (Priority: P2)

Errors, warnings, and confirmations look the same wherever they appear. A customer whose order is
refused on the Get tickets form sees the same red error banner an admin sees when a save is
refused. "Can't reach the QueuePass service" is an error banner in both apps.

**Why this priority**: Status messages are named in the constitution as a shared control, and the
Customer app is the one place where they are still plain text today.

**Independent Test**: Stop the Backend and reload a page in each app. Both show "Can't reach the
QueuePass service" as the same red banner. In the Customer app, trigger a refusal on the Get
tickets form and see the same banner.

**Acceptance Scenarios**:

1. **Given** the Backend is unreachable, **When** a page loads in either app, **Then** "Can't
   reach the QueuePass service" shows as an error banner, and is still announced to screen readers
   as an alert.
2. **Given** an order the Backend refuses on the Customer app's Get tickets form, **When** the
   refusal shows, **Then** it is an error banner with the same text as today.
3. **Given** the Customer app cannot confirm whether an order went through, **When** that message
   shows, **Then** it is a warning banner (the look the Admin app uses for a scheduling conflict),
   with the same text and the same Check again control as today.
4. **Given** any status badge (Cancelled, Sold out, Sales closed), **When** it shows in either app,
   **Then** it has the same look, including its border.

---

### User Story 4 - One Change Updates Both Apps (Priority: P2)

When the team decides to change the look, for example the accent color, it is changed in one
place, and both apps change with it. Nothing in either app has to be edited.

**Why this priority**: This is the payoff of one theme, but it matters only once the apps share
it (US1) and cannot drift (US2).

**Independent Test**: Change the accent color in the shared theme only, rebuild both apps, and
confirm both show the new accent on buttons, links, and the current navigation item. Revert it.

**Acceptance Scenarios**:

1. **Given** the accent color is changed in the shared theme only, **When** both apps are
   rebuilt, **Then** both show the new accent in every place they showed the old one.
2. **Given** that change, **When** the changed files are listed, **Then** only the shared theme
   changed.

---

### Edge Cases

- **Dark mode**: The theme holds one light set and one dark set of colors. Which one shows follows
  the device's setting, as today. There is no control to switch it, and no app or page can force
  one.
- **Phone width**: At 375 pixels wide, no Customer app page scrolls sideways (as `008` requires),
  and the Admin app's pages behave at least as well as today. The theme keeps the existing
  640-pixel layout change.
- **Contrast**: Every text color in the theme meets WCAG 2.1 AA (4.5:1) on every background it is
  used on, including status message text on its own banner color, and every control border and
  state meets 3:1, in light and dark. The faintest gray is used only for borders and decoration,
  never for text, in either app.
- **Existing screens**: Every screen looks the same as today, except where the two apps differed.
  There the theme takes the Customer app's value, because `008` set it to meet a tested usability
  target. The full list of visible changes is in FR-012.
- **A screen needs a color the theme does not have**: it is added to the theme, for both apps, in a
  pull request that changes the shared code. It is never added in one app.
- **Spacing on app-specific screens**: a few spacing values sit between the theme's steps. They
  move to the nearest step, a change of at most 2 pixels.
- **Seat picker**: the Customer app's seat states keep their look. Their colors already come from
  theme values; only their spacing is expressed as theme steps of the same size.
- **Ticket Booth app**: unchanged. It keeps the browser's plain look and does not load the theme.
- **The theme fails to load**: not a case to design for. The theme is part of each app's build, so
  an app without it does not build or fails the check (US2-5).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The project MUST have exactly one theme, in the shared code, holding: the accent
  colors; every other color the apps use (page, surface, text, border, and the error, warning,
  and success colors), in a light set and a dark set; the typefaces; a fixed set of spacing steps;
  the corner rounding; and the shadows.
- **FR-002**: The theme MUST also hold the styles of the controls and page parts both apps share:
  buttons (primary, secondary, and plain), text fields and menus, checkboxes and radio buttons,
  field labels and hints, status messages (error, warning, and success banners, notes, status
  badges, empty and loading states), the keyboard focus outline, links, the top bar and
  navigation, page headings, cards, tables, and label/value lists.
- **FR-003**: The Admin app and the Customer app MUST both load the theme, and MUST load the same
  one.
- **FR-004**: Neither app MAY define a color, typeface, corner rounding, shadow, or theme value of
  its own, or redefine one the theme defines. Styles for an app's own screens MUST take their
  colors, typefaces, corner rounding, shadows, and spacing from the theme.
- **FR-005**: An automated check, run by the standard test command, MUST fail, naming the file and
  line, when any app's own styles or screen code: defines or redefines a theme value; writes a
  color directly; sets a typeface; sets corner rounding or a shadow not taken from the theme; or
  sets spacing (padding, margin, or gaps) other than a theme step or zero. It MUST also fail when
  the Admin app or the Customer app does not load the theme.
- **FR-006**: The check MUST be shown to catch each kind of violation in FR-005 and to accept
  theme values, by its own tests.
- **FR-007**: The theme MUST be one fixed set of values: a light set and a dark set chosen by the
  device's setting. There MUST be no control to switch themes, no user-chosen theme, and no
  per-app variant.
- **FR-008**: Every text color in the theme MUST meet 4.5:1 contrast on each background it is used
  on, and every control border and state MUST meet 3:1, in light and dark, checked by a test. The
  faintest gray MUST NOT be used for text in the theme or in either app.
- **FR-009**: Where the two apps style a shared control differently today, the theme MUST use the
  Customer app's value (the one `008` set and tested for contrast, touch target size, and focus).
- **FR-010**: Every error and status message in both apps MUST use the theme's status message
  styles, including "Can't reach the QueuePass service" and the Customer app's Get tickets
  messages, and MUST keep its text and the way it is announced to screen readers.
- **FR-011**: Styles for one app's own screens (for example the Admin reports tiles and seat
  layout lines, and the Customer event cards, filters, and seat picker) MUST stay with that app.
  The theme MUST NOT hold styles that only one app uses.
- **FR-012**: Apart from these changes, every screen in both apps MUST look as it does today:
  - in the Admin app: darker control borders; field hints, placeholders, table headings, and the
    reports page's notes, subtitles, and cancelled rows in the darker gray; buttons, fields, and
    choices at least 44 pixels tall; larger checkboxes and radio buttons; a visible focus outline;
    a border on status badges; and "Can't reach the QueuePass service" as an error banner;
  - in the Customer app: its Get tickets messages and "Can't reach the QueuePass service" as
    banners;
  - in both apps: spacing on app-specific screens moved by at most 2 pixels to the nearest theme
    step.
- **FR-013**: Every behavior MUST stay the same: the same text, controls, flows, and messages.
  Every existing test MUST still pass, except the two Customer app tests that check the copied
  styles, which move to the shared code and check the theme instead.
- **FR-014**: Automated tests MUST show that both apps load the same theme file, and that key
  controls in each app (the primary and secondary buttons, an error banner, and "Can't reach the
  QueuePass service") carry the theme's styles.
- **FR-015**: The Ticket Booth app MUST NOT change. It does not load the theme until a spec gives
  it functionality, but the check in FR-005 MUST also cover any styles it adds.
- **FR-016**: This feature MUST NOT change the Backend, the database, or the API contract.

### Key Entities

- **Theme**: the one fixed set of named values (colors in a light and a dark set, typefaces,
  spacing steps, corner rounding, shadows) and the shared control styles built from them. Not
  data: it is part of each app's build. See [data-model.md](./data-model.md).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 0 colors written directly, 0 typeface declarations, and 0 theme value definitions
  in any app's own styles, verified by the automated check on every test run.
- **SC-002**: In the running system, the primary button, a text field, an error banner, and a
  link have identical text color, background color, border color, typeface, and corner rounding
  in both apps, measured in the browser, in light and in dark mode.
- **SC-003**: A change to the accent color takes 1 file edit, and shows in both apps.
- **SC-004**: 100% of the theme's text colors meet 4.5:1 and 100% of its control borders and
  states meet 3:1 on the backgrounds they are used on, in light and dark.
- **SC-005**: Each kind of violation in FR-005, introduced on purpose, fails the test suite with
  the file and line named.
- **SC-006**: 0 Customer app pages scroll sideways at 375 pixels wide, as before.
- **SC-007**: The full test suite passes from a clean checkout.

## Assumptions

- **"Fonts" means typefaces**: the body typeface and the monospace typeface for ticket codes. Text
  sizes stay with the screen that uses them; the theme does not add a type scale.
- **Spacing steps** are 4, 8, 12, 16, 20, 24, and 32 pixels. Spacing in the theme's own shared
  controls stays exactly as today; spacing on app-specific screens moves to the nearest step.
- **Light and dark follow the device**, as both apps do today. Both sets are part of the one fixed
  theme; neither is a user choice. The unused hook that would let a page force light mode is
  removed, since nothing sets it.
- **The Customer app's values win** where the apps differ, because they were chosen in `008` to
  meet measured targets (WCAG AA contrast, 44-pixel targets, visible focus) and are covered by its
  tests. The Admin app gains them as a usability fix, not a redesign (Constitution VII).
- **The existing names** for colors and control styles are kept, so screens need no renaming.
- **A change to the theme is a change to the shared code**, so it needs every team member's
  approval (Constitution, shared surface). That is intended: it is how the look stays one look.
- **Seat holds (`015`)** will change the Customer app's seat picker. This feature changes only the
  seat picker's spacing values, to theme steps of the same size, so the two can merge in either
  order with little conflict.

## Out of Scope

- Any new design: new colors, typefaces, branding, logos, illustrations, or animation.
- A theme switch, user-chosen themes, a high-contrast mode, or a per-app variant.
- A type scale, or any other new kind of theme value beyond FR-001.
- Shared screen components (a shared button or card component in code); the theme shares styles,
  not components.
- Screenshot comparison tooling.
- Styling the Ticket Booth app.
- Restyling either app's own screens beyond FR-012.
