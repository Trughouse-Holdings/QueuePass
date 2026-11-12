# Feature Specification: Sign-in Background

**Feature Branch**: `027-sign-in-background-spec`

**Created**: 2026-11-02

**Status**: Draft

**Issue**: [#122](https://github.com/Trughouse-Holdings/QueuePass/issues/122) (sign-in pages:
Keycloak's stone background, with each app's colour in the cracks)

**Input**: User description: "027" (issue #122; the roadmap number is reserved by this PR's
amendment, Constitution 3.7.0). From the issue: bring back Keycloak's low-poly "stones" background
on every sign-in page, for all three apps; the stones stay grey and the lines between them take the
app's accent; no card, the form sits straight on the stones with light text; keep everything `021`
added; still meet `021`'s usability targets on the stones. (Changed in implementation: Mahdi brought
back Keycloak's card and its realm-name header, see Clarifications, implementation session 2.)

## Context

Builds on `021` (every sign-in page names the app in its tab title and its one heading, says who the
app is for, and uses the app's own accent: indigo for Admin, teal for Tickets, amber for the Ticket
Booth; the look ships with the repository and is applied from a clean clone) and `012` (one shared
theme: accent color, fonts, spacing, light and dark color schemes).

> **Note (2026-11-11, spec `037`)**: A fourth sign-in look, red, is added for the Rust Admin app
> (client `admin-rust-app`), with its own accent set and line colour, so there are four line
> colours, not three (Constitution 3.10.0).

Today, since `021`, the sign-in pages are a card on the flat page color, with a 6 px accent band at
the top, the brand mark, the app's name as the heading, and the audience line. Before `021`,
Keycloak's stock sign-in page showed a background of grey low-poly "stones", lighter at the top left
and near black at the bottom right, with no color between them.

This feature puts the stones back behind every sign-in page and draws the lines between the stones
in the app's accent, so the stones themselves say which app this is. As on Keycloak's original page,
the form sits on a card on the stones, with the realm's name in large capitals above it; the card is
styled from the shared theme and follows the scheme. Everything else `021` gave the pages stays.

Principle VII says no effort goes into decoration, and a background is decoration. The spec PR
amended it (3.7.0, MINOR) to widen the sign-in exception to Keycloak's stock background with the
app's accent between the stones, and reserves `027` in the roadmap (plan, research R9). The
constitution is shared surface, so every team member approved that PR. The realm header added in
implementation is allowed by Constitution 3.8.0, in the implementation PR (tasks T038).

## Clarifications

### Session 2026-11-02

Mahdi took the decisions marked "decided by Mahdi" (he previewed the options on the running stack).
Every other question below took the recommended answer, written unattended and recorded here as
**recommended answer, open to review**, so the team can overturn it in review of the spec PR.

- Q: Which background? → A: **Keycloak's own stones image**, the one its stock sign-in page shows,
  served by Keycloak from its own theme. QueuePass keeps no copy of it (decided by Mahdi) (FR-001,
  FR-002).
- Q: Tint the whole image in the app's accent, or color only the lines between the stones? → A:
  **The stones stay grey; only the lines between them take the app's accent**: Admin the shared
  accent (indigo), Tickets its teal, Ticket Booth its amber, from the shared theme. Both were
  previewed; the lines were chosen (decided by Mahdi) (FR-003). The shade of the accent is settled
  below (spec review).
- Q: Keep the card behind the form? → A: **No card.** The form sits straight on the stones with
  light text, like Keycloak's original page (decided by Mahdi) (FR-004). **Reversed** in
  implementation: see the implementation session 2 below.
- Q: What stays from `021`? → A: **All of it**: the app's name as the one top-level heading and in
  the tab title, the audience line, the accent on the Sign In button and on focus rings, the
  wrong-password message read out by assistive technology, phone width, and keyboard use (decided by
  Mahdi) (FR-005, FR-008).
- Q: How do text and controls stay readable over the stones? → A: **A darkening shade behind the
  column the form sits in**, strong enough that the contrast targets hold over the lightest stone
  and the brightest line the page can show, fading out over a fixed width on each side, so that on
  a window 800 px wide or wider the stones and lines beyond the fade show at full strength. The
  shade has no edge, border, or box, so it is not a card (recommended answer, open to review)
  (FR-004, FR-006).
- Q: Which contrast targets, and where? → A: **WCAG 2.1 AA everywhere the form can sit**: 4.5:1 for
  every piece of text, and 3:1 for each text field's boundary and the focus ring of every control
  (text fields, Show, Sign In, links), against the
  lightest and the darkest point of the background behind them, at every window size, in light and
  dark schemes (recommended answer, open to review) (FR-006, SC-002).
- Q: Light and dark schemes? → A: **The background is dark in both**, so the text on it is light in
  both. The controls (text fields, buttons, notices) still follow the scheme as in `021`
  (recommended answer, open to review) (FR-007).
- Q: The light scheme's accents are dark (indigo, teal, amber at their light-scheme shades); a focus
  ring in them is too dark against the darkest stones. → A: **Focus rings drawn over the stones use
  the app's accent in its lighter shade** (the dark scheme's value) in both schemes. The Sign In
  button keeps the scheme's accent (recommended answer, open to review) (FR-006). **Superseded** in
  implementation session 2: the rings are on the card, in the scheme's `--accent`.
- Q: What if the stones cannot be shown (Keycloak stops shipping the image, or it fails to load)? →
  A: **The page is a plain dark stone grey, with the lines still drawn under the shade and the same
  light text**, still meeting the contrast targets; a test catches a changed or missing image
  (recommended answer, open to review) (FR-009, FR-010).
- Q: Does anything move? → A: **No.** The background is still: no animation, no parallax
  (recommended answer, open to review) (FR-013). **Reversed** in implementation session 3: the
  lines pulse gently, with a pause button; strengthened, with a glow, in session 4.

### Session 2026-11-02 (spec review)

The independent review of the spec branch raised two questions for Mahdi; he decided both.

- Q: Keep `021`'s accent band at the top and the brand mark? → A: **Yes**, unchanged (`021`
  FR-006) (decided by Mahdi).
- Q: In which shade of the accent are the lines drawn? → A: **Always the app's accent in its lighter
  shade** (the dark scheme's value: indigo `#8b85f5`, teal `#2dd4bf`, amber `#fbbf24`), in both
  schemes, the same shade as the focus rings on the stones. The backdrop is then truly the same in
  both schemes (FR-007), and the light scheme's darker accents, which barely show on the near-black
  stones, are not used on it (decided by Mahdi) (FR-003).

### Session 2026-11-02 (implementation, T010)

Mahdi chose from previews of four lines images (fine, soft, bold, and dim), each composited for all
three apps (tasks T010).

- Q: How thick and how strong are the lines? → A: **The dim lines**: 2 px with a 1 px softened
  edge, at about 63% strength (alpha 160 of 255), not opaque, so the accent shows as a quieter
  line between the stones. Dimmer lines only darken the brightest point of the backdrop, so every
  contrast figure of research R5 still holds, with room (decided by Mahdi) (FR-003, FR-006).

### Session 2026-11-02 (implementation, session 2)

Mahdi saw the pages with no card and reversed that decision.

- Q: Card or no card? → A: **Keycloak's card is back**, modelled on Keycloak 26.0's stock `keycloak`
  login theme (`.card-pf`: centred, at most 500 px wide, with a 4 px top edge in the primary color),
  styled from the shared theme: the shared surface, text, field, and focus-ring colors, so the card
  follows the light or dark scheme; its top edge is in the app's accent. The brand mark, the app's
  name as the one `<h1>`, the audience line, the page's own header, notices, and the form all sit in
  the card. `021`'s accent band at the top of the page stays (decided by Mahdi) (FR-004, FR-005).
- Q: Anything above the card? → A: **The realm's name in large capitals**, on the stones above the
  card, as Keycloak's original `#kc-header-wrapper` ("QUEUEPASS"). It is decoration, hidden from
  assistive technology, not a heading: the app's name stays the one `<h1>` and the tab title. It is
  the only text on the stones, and it meets 4.5:1 there, on the shade, at every width (decided by
  Mahdi) (FR-004, FR-006).
- Q: What happens to the colors made for text on the stones? → A: Only the header's light text
  (`--stone-text`) stays; the muted text, field edge, and error colors made for the stones
  (`--stone-text-muted`, `--stone-danger`) go, since that text is now on the card. The focus rings
  are in the card, so they return to the scheme's `--accent`; `--stone-accent` colors only the
  lines. The shade stays as it is, behind the header and the card (recommended answer, open to
  review) (research R5–R7).
- Constitution: the card itself needed no change to Constitution 3.7.0 (it is the shared theme's
  card, as in `021`). The realm header is decoration, which 3.7.0 did not allow beside the
  background, and roadmap row `027` said "no card". Mahdi decided both the card and the header, so
  Constitution 3.8.0 (MINOR), in the implementation PR, adds the realm-name header to the sign-in
  exception and rewords the row; every team member approves it there (tasks T038).

### Session 2026-11-02 (implementation, session 3)

Mahdi walked the card and the header ("much better") and asked for one more change; he chose both
answers below from the options he was offered.

- Q: Should anything move? → A: **The color in the lines pulses gently, forever.** The lines rest at
  the dim level he chose (alpha 160 of 255) and slowly glow up to full strength and back, a whole
  cycle about every 4 s, eased in and out; a smooth fade only, nothing that flashes (decided by
  Mahdi) (FR-013).
- Q: How can it be stopped? → A: **A small pause button** in the page's bottom corner, a real
  button reading "Pause animation" or "Play animation", last in the Tab order after the form,
  remembered in the browser (decided by Mahdi) (FR-013; WCAG 2.2.2). Its changing name alone says
  its state, with no `aria-pressed`: that follows the implementation's review round 2 (a changing
  name together with `aria-pressed` reads "Play animation, pressed" to a screen reader), not a
  choice of Mahdi's; the brief had named both.
- Q: Reduced motion, forced colors, and no scripts? → A: With reduced motion asked for, nothing
  moves (the lines stay at their resting level) and the button is not shown, since there is nothing
  to pause; in forced colors the button is hidden with the backdrop; without scripts the lines do
  not move and the button stays hidden, since a pulse with no way to pause it would fail WCAG 2.2.2
  (recommended answers, open to review) (FR-013, research R10).

### Session 2026-11-03 (implementation, session 4)

Mahdi walked the pulse on the team stack: it ran (63% to 100% every 4 s), but he could not see it.
From a live mock-up in the browser he chose a **strong glow** (decided by Mahdi):

- Q: How strong is the pulse? → A: **From faint to full**: the lines' opacity runs from 0.1 to 1
  and back, 1.5 s each way (a 3 s cycle), eased in and out (FR-013).
- Q: Anything besides the lines? → A: **A glow**: a second copy of the lines, in the same accent,
  blurred by 6 px, pulsing in step with them, under the shade like them (FR-013, research R4,
  R10).
- Q: And at rest? → A: Paused, under reduced motion, without scripts, or without mask support,
  the lines stay at the dim look he chose (160 of 255) and there is no glow; forced colors still
  hide everything (FR-013).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Each App's Sign-in Shows the Stones in Its Own Color (Priority: P1)

An admin opens the Admin app signed out. Keycloak's sign-in page fills the window with grey stones,
lighter at the top left, with indigo lines between them. Over the stones, "QUEUEPASS" in large
capitals; below it a card with an indigo top edge says "Sign in to QueuePass Admin", who the app is
for, and asks for a username and password. On the
booth laptop next to them, the Ticket Booth's sign-in page shows the same stones with amber lines.

**Why this priority**: This is the issue: the stones back, the lines in the app's color, and
Keycloak's card on them.

**Independent Test**: Start the stack, open each app signed out, and look at the page.

**Acceptance Scenarios**:

1. **Given** the stack started from a clean clone, **When** someone opens the Admin app signed out,
   **Then** the sign-in page shows Keycloak's grey stones behind the whole page, with the lines
   between the stones in the Admin accent (indigo), "QUEUEPASS" in large capitals on the stones, and
   below it the form on a card with an indigo top edge.
2. **Given** the same, **When** someone opens the Customer app signed out, **Then** the same stones
   show with teal lines; **and** the Ticket Booth app's page shows amber lines.
3. **Given** any of the three pages, **When** it opens, **Then** the stones themselves stay grey;
   only the lines between them are colored, and each line sits on the edge between two stones.
4. **Given** the three pages side by side, **When** anyone compares them, **Then** each still
   differs from the other two in its name, its audience line, and its accent (`021` FR-005), now
   including the color of the lines.
5. **Given** any of the three pages, **When** it opens, **Then** the tab title and the one heading
   read "Sign in to {app name}", the audience line is there, and the Sign In button is in the app's
   accent, as in `021`.
6. **Given** any of the three pages, **When** it opens, **Then** the lines pulse from faint to full
   strength and back with a soft glow around them, every 3 s, and a small "Pause animation" button
   sits in the bottom corner; **When** someone presses it, **Then** the lines stop, the button reads
   "Play animation", and the choice holds after a reload; **and** with reduced motion asked for,
   nothing moves and no button shows.

---

### User Story 2 - Everything Stays Readable on the Stones (Priority: P1)

A customer signs in on a phone in light mode, sitting in the sun; an admin signs in on a wide
monitor in dark mode with the keyboard. Both read every word, see every field, and see where the
keyboard focus is, wherever the form lands on the stones.

**Why this priority**: The stones run from mid grey to black and the lines are bright; text on
them is unreadable unless the page is built for it, and the card must still meet the shared theme's
targets. `021`'s usability targets (Constitution VII:
usability work, not decoration) must still hold.

**Independent Test**: Open each sign-in page at phone width and on a wide window, in light and dark
schemes, measure the contrast of every text and every field boundary and focus ring against the
background behind it, and sign in with the keyboard only.

**Acceptance Scenarios**:

1. **Given** any sign-in page at any window size from 360 px wide up to 2560 px wide, in light or
   dark scheme, **When** it opens, **Then** the realm header on the stones meets 4.5:1 against the
   lightest and the darkest point of the stones behind it, and every piece of text in the card
   (heading, audience line, labels, page text, links, the wrong-password message) meets 4.5:1
   against the lightest and the darkest point behind it in the card.
2. **Given** the same, **When** it opens, **Then** each text field's boundary meets 3:1 against the
   card next to it.
3. **Given** the same, **When** someone moves through the page with the keyboard, **Then** the focus
   ring on each control meets 3:1 against the card next to it, and focus moves username →
   password → Show → Sign In as in `021`.
4. **Given** a phone-width window (360 px wide), **When** any sign-in page opens, **Then** it needs
   no sideways scrolling and every control is usable.
5. **Given** a wrong password, **When** the page comes back, **Then** the message is shown in the
   card in a readable color and read out by assistive technology, as in `021`.
6. **Given** a window 800 px wide or wider, **When** the page opens, **Then** the stones and lines
   beyond the shade's fade show at full strength; only the column behind the header and the card
   is darkened.

---

### User Story 3 - Every Sign-in Page Has the Stones (Priority: P1)

An admin mistypes their password, then their session ends and they sign back in; a developer opens
Keycloak's account page directly. Every one of these pages has the stones, in the right color.

**Why this priority**: `021` FR-004: every screen on the way to signing in keeps the app's identity.
A page that drops back to a flat color is a page that looks like a different product.

**Independent Test**: From each app, reach the sign-in form, a wrong password, and a Keycloak error
or notice; open the account page directly; check each page.

**Acceptance Scenarios**:

1. **Given** any of the three apps, **When** the sign-in form, a wrong-password page, or any other
   notice or error on the way to signing in is shown, **Then** it has the stones with the lines in
   that app's accent.
2. **Given** a Keycloak page reached with no QueuePass app in view (the account page opened
   directly, or a page with no client), **When** it opens, **Then** it has the stones with the lines
   in the shared accent (indigo), as `021` FR-008 gives such pages the shared accent.
3. **Given** the Keycloak admin console, **When** it opens, **Then** it is unchanged.

---

### User Story 4 - It Ships With the Repository, Using Keycloak's Own Image (Priority: P2)

A teammate clones the repository and starts the stack with the one documented command. The sign-in
pages have the stones. The repository holds no copy of Keycloak's image, and the one image QueuePass
derives from it says where it came from and under which license.

**Why this priority**: Constitution II (one command, no manual steps) and the issue's ask to use the
image Keycloak already ships and keep its license notice on anything derived from it.

**Independent Test**: From a fresh clone, start the stack and open each app; search the repository
for the image; read the derived image's notice.

**Acceptance Scenarios**:

1. **Given** a fresh clone, **When** the stack starts with the documented command, **Then** every
   sign-in page shows the stones and the lines, with no manual step.
2. **Given** a stack started before this feature, **When** it is started again with the documented
   command, **Then** the sign-in pages show the stones, with no data removed.
3. **Given** the repository, **When** anyone looks for Keycloak's stones image in it, **Then** it is
   not there; the page loads it from Keycloak.
4. **Given** the image QueuePass derives from Keycloak's (the lines between the stones), **When**
   anyone looks at it, **Then** Keycloak's Apache 2.0 license notice is with it, and the repository
   holds the steps that make it again from Keycloak's image.
5. **Given** a Keycloak whose stones image has changed or gone, **When** the tests run against it,
   **Then** a test says so, so the lines are never drawn over a different image unnoticed.

---

### Edge Cases

- **The stones image cannot be loaded** (a Keycloak upgrade drops it, or the request fails): the
  page is a plain stone grey, with the lines still drawn on it under the shade; the header, the
  card, and every text and control still meet FR-006 (FR-009).
- **A browser that cannot draw the colored lines**: the stones show without lines; nothing else
  changes, and readability does not depend on the lines.
- **Very wide, very tall, or portrait windows** (a 2560 px monitor, a phone held upright): the
  stones cover the whole window, cropped rather than stretched; the lines stay on the stones' edges
  at every size (FR-003).
- **A page longer than the window** (a small phone, browser zoom): the stones stay put behind the
  page while it scrolls; the text stays readable all the way down (FR-006).
- **Browser zoom up to 400%** (a 1440 px window at 400% is 360 CSS px wide): as a narrower
  window; no sideways scrolling at 360 CSS px (FR-008).
- **Windows high-contrast (forced colors) mode**: the sign-in look hides the whole backdrop (some
  browsers, Chromium among them, keep image backgrounds in that mode); the page uses the system's
  colors and stays usable.
- **Keycloak's admin console, and the account console after sign-in**: not changed.
- **Reduced motion asked for** (the system setting): the lines do not move, at their resting level,
  and the pause button is not shown (FR-013).
- **Scripts off, or the browser's storage unavailable**: without scripts, nothing moves and the
  button stays hidden; with storage refused, the button still pauses and plays, and the choice is
  not remembered (FR-013).
- **A client with no accent of its own**: the shared accent in the lines, as `021` FR-008.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every page shown in the QueuePass sign-in look (the sign-in form, a wrong username or
  password, and every other notice or error on the way to signing in, for every app and for pages
  with no QueuePass app) MUST show Keycloak's stock low-poly stones image as its background,
  covering the whole window.
- **FR-002**: The stones image MUST be the one Keycloak itself ships and serves. The repository MUST
  NOT hold a copy of it.
- **FR-003**: The stones MUST stay grey. The lines between the stones MUST be drawn in the app's
  accent, in its lighter shade (the dark scheme's) in both schemes: the shared accent for the Admin
  app and for pages with no QueuePass app, the Tickets accent for the Customer app, the Ticket Booth
  accent for the Ticket Booth app, all from the shared theme. The lines MUST sit on the edges
  between the stones at every window size and shape.
- **FR-004**: The form MUST sit on a card modelled on Keycloak 26.0's stock sign-in card: centred,
  at most 500 px wide, with a 4 px top edge in the app's accent, in the shared theme's surface, so
  it follows the scheme. The brand mark, the app's name as the one top-level heading, the audience
  line, the page's own header, the notices, and the form are on the card. Above the card, on the
  stones, the realm's name MUST show in large capitals, as Keycloak's original header; it is
  decoration, hidden from assistive technology, and not a heading. A shade that darkens the stones
  behind the header and the card, with no visible edge, is allowed. It MUST fade out over a fixed
  width, and on a window 800 px wide or wider it MUST leave the stones and lines beyond that fade at
  full strength. (Mahdi reversed the earlier "no card" in implementation; Clarifications.)
- **FR-005**: Everything `021` requires of the sign-in pages MUST still hold, except the flat page
  color this feature replaces: the app's name as the one top-level heading and in the tab
  title (`021` FR-001, FR-002), the audience line (FR-005), the accent on the band, the brand mark,
  and the Sign In button (FR-006), the shared fonts and controls (FR-007), the no-app fallback
  (FR-008), the form's behavior (FR-011), the accessibility targets (FR-012), and the admin console
  unchanged (FR-013).
- **FR-006**: On every sign-in page, at every window size from 360 px to 2560 px wide, in light and
  dark schemes: the realm header MUST meet 4.5:1 against the lightest and the darkest point of the
  stones that can be behind it (the lightest stone and the brightest line color the page can show,
  both under the shade); and against the card behind them, every piece of text on the card (the
  heading, the audience line, the page's own header, labels, page text, links, the required-fields
  note, and the wrong-password message) MUST meet 4.5:1, each text field's boundary MUST meet 3:1,
  and the focus ring of every control (each text field, Show, Sign In, each other button, and each
  link) MUST meet 3:1. Text inside a control or a notice keeps `021`'s rule (4.5:1 against that
  control's or notice's own color).
- **FR-007**: The background and the header drawn on it MUST be the same in light and dark schemes
  (dark background, light header). The card and everything on it (text, text fields, buttons,
  notices) MUST follow the scheme, as in `021`.
- **FR-008**: Every sign-in page MUST work at 360 px wide with no sideways scrolling, start focus on
  the username field, keep a visible focus, be fully usable by keyboard, and announce errors to
  assistive technology (`021` FR-012).
- **FR-009**: When the stones image cannot be shown, the page MUST show a plain dark stone-grey
  background instead (the lines may still be drawn on it, under the shade) and still meet FR-006 and
  FR-008.
- **FR-010**: Any image QueuePass derives from Keycloak's (the lines between the stones) MUST ship
  with Keycloak's Apache 2.0 license and a notice saying what it came from and what was changed, and
  the repository MUST hold the steps to make it again from Keycloak's image, giving the same result:
  identical pixels and the same metadata. A test MUST fail when the image Keycloak serves is no
  longer the one the lines were made from.
- **FR-011**: The new look MUST ship in the repository and be applied when the stack starts from a
  clean clone or is restarted with the documented command, with no manual step (`021` FR-009,
  Constitution II).
- **FR-012**: The apps themselves MUST NOT change: no background, no new colors, and no use of the
  sign-in look's colors (Constitution VII).
- **FR-013**: The lines between the stones MUST pulse, with a glow: their opacity from 0.1 up to 1
  and back, a whole cycle every 3 s, eased in and out, a smooth fade with no flash (WCAG 2.3.1),
  with a copy of the lines blurred by 6 px glowing in step with them, under the shade; nothing else
  in the backdrop moves. At rest (paused, reduced motion, no scripts, no mask support) the lines
  show at their resting strength (alpha 160 of 255, the dim level Mahdi chose in T010) with no glow.
  A small pause button in the page's bottom corner MUST stop and restart the pulse (WCAG 2.2.2): a
  real button, last in the Tab order after the form, whose name, "Pause animation" or "Play
  animation", alone says its state (no `aria-pressed`), at least 24 × 24 px, with 4.5:1 text and a
  3:1 focus ring against what is behind them wherever it sits, on every page that shows the stones.
  The choice MUST be remembered in the browser, and the page MUST work when storage is refused. With
  reduced motion asked for, the lines MUST NOT move and the button MUST NOT show; in forced colors
  the button is hidden with the backdrop; without scripts the lines do not move and the button is
  not shown. (Until implementation session 3: "the background MUST be still"; until session 4, a
  gentle pulse from 160 of 255 to full every 4 s, with no glow.)

### Key Entities

- **Stones image**: Keycloak's stock low-poly background, grey, served by Keycloak from its own
  theme. Not in the repository.
- **Lines image**: an image QueuePass derives from the stones image, marking where the edges between
  the stones are, so they can be drawn in the app's accent. In the repository, beside Keycloak's
  license and a notice, with the steps that made it.
- **Sign-in backdrop**: what is behind the card: the stones, the lines in the app's accent, and the
  shade behind the header and the card; with a plain stone grey under them for when the image is
  missing.
- **Sign-in card**: Keycloak's card, styled from the shared theme, with the app's accent as its top
  edge; it holds the form and everything `021` added. Above it, the realm header on the stones.
- **Backdrop colors**: the colors the sign-in look draws on the backdrop (the header's light text,
  the lighter accent for the lines, the shade, the stone grey), held in the shared theme beside
  `021`'s accents.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For each of the three apps, in light and dark schemes, the sign-in page shows the grey
  stones with the lines in that app's accent, the realm header, and the card with that app's accent
  as its top edge: 6 of 6.
- **SC-002**: An automated check of the rendered pages, for the three apps, in light and dark
  schemes, at no fewer than five window sizes (360×800, 768×1024, 1280×800, 1920×1080, 2560×1440),
  on the first page and after a wrong password, finds the realm header at 4.5:1 or more against the
  stones behind it, and every text on the card at 4.5:1 or more and every text field boundary and
  every control's focus ring at 3:1 or more against the card behind it: 0 failures; and at 1920×1080
  the backdrop beyond the shade's fade is the unshaded stones.
- **SC-003**: At 360 px wide, no sign-in page scrolls sideways, and signing in with the keyboard
  only takes the same steps as before (`021` SC-006).
- **SC-004**: The repository holds no file identical to Keycloak's stones image; the derived lines
  image ships beside Keycloak's license and a notice; regenerating it from Keycloak's image gives
  identical pixels and the same metadata.
- **SC-005**: With the stones image blocked, the same check as SC-002 finds 0 failures.
- **SC-006**: Shown the three sign-in pages with the app names covered, a tester still matches each
  to its app within 5 seconds per page, 3 of 3 (`021` SC-002).
- **SC-007**: For each of the three apps, an automated browser check finds the lines pulsing (a 3 s
  eased cycle from 0.1 to full strength, the glow layer blurred and in step with them), the pause
  button reached by Tab after Sign In, pressing it pausing the pulse and switching its name (with no
  `aria-pressed`), the choice kept after a reload, the button's text at 4.5:1 and its ring at 3:1
  against its own backdrop, and, paused or with reduced motion emulated, no animation, no glow, the
  lines at rest, and (with reduced motion) no button: 0 failures.

## Assumptions

- Keycloak 26.0 (the version the constitution fixes) keeps shipping its stock `keycloak` sign-in
  theme with this image; a later Keycloak that drops or changes it is caught by a test (FR-010) and
  shows the plain grey fallback until this feature is revisited (FR-009).
- The browsers QueuePass supports (current Chrome, Edge, Firefox, and Safari) can draw an image's
  shape in a color; one that cannot shows the stones without lines (Edge Cases).
- The sign-in pages are the only place the stones appear. The apps keep the one shared look
  (Constitution VII as amended).
- The text and wording on the pages do not change, except the realm header above the card, which
  shows the realm's existing display name ("QueuePass") as Keycloak's own theme does; only what is
  behind them changes.
- English only, as the rest of QueuePass. The test accounts and passwords are unchanged.
