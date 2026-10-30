# Feature Specification: Sign-in Screens

**Feature Branch**: `021-sign-in-screens-spec`

**Created**: 2026-10-30

**Status**: Draft

**Issue**: [#92](https://github.com/Trughouse-Holdings/QueuePass/issues/92) (sign-in screens: show
which app you are signing in to)

**Input**: User description: "021" (the roadmap entry reserved for #92 in Constitution 3.4.2). From
the issue: the Admin, Customer, and Ticket Booth apps all send people to the same sign-in page,
titled "Sign in to QueuePass" with the heading "Sign in to your account", so with several apps open
it is easy to sign in to the wrong one with the wrong account. The latest team meeting asked
for the three sign-in screens to be redesigned so each portal is visually distinct.

## Context

Builds on `001` (every front end signs in on Keycloak's own sign-in page, never in the app; the seed
creates the realm, its roles, the three front-end clients, and the test accounts, with no manual
steps) and `012` (one shared theme: accent color, fonts, spacing, the "Q" brand mark, light and dark
color schemes).

Today the three apps send the browser to one identical page: Keycloak's stock look, the realm name
"QueuePass" in the tab title, and the heading "Sign in to your account". The seed already gives each
app a name in Keycloak (`QueuePass Admin`, `QueuePass`, `QueuePass Ticket Booth`), but the stock page
does not show it. Nothing on the page matches the apps' own look either.

This feature gives QueuePass its own sign-in look, in the shared theme's fonts, brand mark, and
colors, and gives each app its own identity on it: its name in the heading and tab title, a line
saying who it is for, and its own accent color. The look ships with the repository and is applied by
the seed, so a clean clone gets it from one command.

The constitution's roadmap row for `021` (Constitution 3.4.2) already describes this feature, so it
is not amended.

## Clarifications

### Session 2026-10-30

Nate asked for this spec to be written unattended: each question below took the recommended answer,
recorded here so the team can overturn it in review of the spec PR.

- Q: Show the app's name only, or a custom QueuePass sign-in look? (issue open question 1) → A: A
  custom QueuePass sign-in look, with a distinct identity per app (the team meeting asked for each
  portal to be visually distinct; a name alone is easy to miss).
- Q: Should the Customer app's name change from plain `QueuePass` to something clearer? (issue open
  question 2) → A: Yes, to **QueuePass Tickets**, everywhere the Customer app names itself: its
  sign-in screen, its browser tab title, and its header. The name a person signs in to is the name
  they then see (FR-003). The product is still called QueuePass.
- Q: What tells the apps apart at a glance? → A: Three things together: the app's name in the
  heading, a line saying who the app is for, and the app's own accent color on the screen's brand
  mark, primary button, and top band. Never color alone (FR-005).
- Q: Which accent does each app get? → A: The Admin app keeps the shared theme's indigo; the Customer
  app and the Ticket Booth app each get a different accent, chosen in the plan, that meets the same
  contrast rules as indigo in light and dark schemes (FR-006).
- Q: Do the apps themselves change color after sign-in? → A: No. Only the sign-in screens get
  per-app accents; the apps keep the shared theme as it is. The only change inside an app is the
  Customer app's name (out of scope, Assumptions).
- Q: What about a Keycloak page reached with no app in view (for example the account page opened
  directly)? → A: It uses the QueuePass look with no app identity: "Sign in to QueuePass" and the
  shared indigo (FR-008).
- Q: Should a person signing in to the wrong app be stopped on the sign-in screen? → A: No. The
  screen makes the app obvious; what each role may do is still decided after sign-in, as today
  (`001`'s wrong-role page). Out of scope.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Gate Agent Sees They Are Signing In to the Ticket Booth (Priority: P1)

At the doors, a gate agent opens the Ticket Booth app on the booth laptop. It sends them to sign in.
The tab says "Sign in to QueuePass Ticket Booth", the heading says "Sign in to QueuePass Ticket
Booth", a line under it says it is for gate agents checking tickets in, and the screen's accent is
the Ticket Booth's own color. They know at once that this is the booth and sign in with their gate
agent account.

**Why this priority**: This is the issue's problem: with several apps open, the screen must say
which app it is for. The Ticket Booth is where a wrong sign-in costs most (a queue at the door).

**Independent Test**: From a clean clone, start the stack, open the Ticket Booth app signed out, and
read the tab title, heading, and audience line on the sign-in screen.

**Acceptance Scenarios**:

1. **Given** the stack started from a clean clone, **When** someone opens the Ticket Booth app
   signed out, **Then** the sign-in screen's browser tab title and heading both read "Sign in to
   QueuePass Ticket Booth", a line says it is for gate agents, and the screen uses the Ticket
   Booth's accent.
2. **Given** the same, **When** someone opens the Admin app signed out, **Then** both read "Sign in
   to QueuePass Admin", a line says it is for administrators, and the screen uses the Admin accent.
3. **Given** the same, **When** someone opens the Customer app signed out, **Then** both read "Sign
   in to QueuePass Tickets", a line says it is for buying and viewing tickets, and the screen uses
   the Customer accent.
4. **Given** the three sign-in screens side by side, **When** anyone compares them, **Then** each
   differs from the other two in its name, its audience line, and its accent color.

---

### User Story 2 - Every Sign-in Screen Keeps the App's Identity (Priority: P1)

An admin mistypes their password in the Admin app. The screen that says so is still clearly the
Admin sign-in: same name, same line, same accent, with the error stated plainly. Later their session
ends while the Admin app is open; when they sign back in, the screen is again the Admin's.

**Why this priority**: The issue requires every sign-in screen the apps reach to show the app, not
only the first one. A screen that loses its identity on an error is where people retry in the wrong
app.

**Independent Test**: In each app, enter a wrong password, then a right one; separately, let a
session end (or sign out) and sign back in. Check the identity on each screen.

**Acceptance Scenarios**:

1. **Given** any of the three apps' sign-in screens, **When** a wrong username or password is
   entered, **Then** the screen states the error and keeps that app's name, audience line, and
   accent.
2. **Given** a person signed in to any app whose session has ended, **When** the app sends them to
   sign in again, **Then** the screen shows that app's identity.
3. **Given** a person who signed out of an app, **When** they choose to sign in again, **Then** the
   screen shows that app's identity.
4. **Given** any of these screens, **When** it shows an error or notice, **Then** the message is
   announced to assistive technology and does not rely on color alone.

---

### User Story 3 - A Clean Clone Has the New Screens With No Manual Steps (Priority: P1)

A teammate clones the repository and starts the stack with the one documented command. They open
each app and see its own sign-in screen. Nobody opened the Keycloak admin console.

**Why this priority**: Constitution II: one command, no manual configuration. A sign-in look that
needs a click in the Keycloak console is broken for every new clone and in CI.

**Independent Test**: From a fresh clone with no prior Keycloak data, start the stack and check the
three screens (User Story 1). Then start it again on the same data and check again.

**Acceptance Scenarios**:

1. **Given** a fresh clone and no Keycloak data, **When** the stack starts with the documented
   command, **Then** all three sign-in screens show their app's identity.
2. **Given** a stack whose Keycloak data was created before this feature (the stock look), **When**
   the seed runs again, **Then** the screens show the new look and identities, with no data
   removed.
3. **Given** the seed has already applied the look, **When** it runs again, **Then** nothing
   changes and it reports the look as already in place.

---

### User Story 4 - The Screens Read Well for Everyone (Priority: P2)

A customer signs in on a phone in dark mode; an admin signs in with a keyboard and a screen reader.
Both get a screen that is readable, reachable, and announced properly.

**Why this priority**: `008` and `012` set phone width, keyboard access, and AA contrast for every
screen the apps show; the sign-in screen is the first one.

**Independent Test**: Open each sign-in screen at phone width, in light and dark color schemes, with
the keyboard only, and with a screen reader.

**Acceptance Scenarios**:

1. **Given** a phone-width window (360 px wide), **When** any sign-in screen opens, **Then** it
   needs no sideways scrolling and every control is usable.
2. **Given** the system set to a dark or light color scheme, **When** any sign-in screen opens,
   **Then** it follows that scheme, and every text and control meets WCAG 2.1 AA contrast in both.
3. **Given** keyboard only, **When** someone signs in, **Then** focus starts on the username field,
   moves in reading order, is always visible, and Enter submits.
4. **Given** a screen reader, **When** the screen opens, **Then** the page title and the single
   top-level heading both name the app.

---

### Edge Cases

- **A Keycloak page reached with no app in view** (the realm's account page opened directly, or an
  error before Keycloak knows the app): the QueuePass look, no app identity (FR-008).
- **An app whose name changes later in the seed**: the screen follows the name Keycloak holds for
  that app, so renaming in one place renames the screen (FR-002).
- **An unrecognized app** (a client added later without an identity): the QueuePass look with that
  client's name if it has one, the shared accent, and no audience line (FR-008).
- **A wrong username vs. a wrong password**: one message for both, as today; the screen never says
  which was wrong.
- **A disabled account, an expired sign-in page, too many attempts**: any notice Keycloak shows on
  the way to signing in keeps the app's identity (FR-004).
- **Keycloak data from before this feature**: the seed brings it to the new look without removing
  anything (FR-010).
- **The admin console of Keycloak**: not changed; it is a developer tool, not a QueuePass screen.
- **Browser translation or a missing font**: text stays readable; the fonts fall back like the
  apps' (FR-007).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every sign-in screen reached from one of the three apps MUST name that app in its
  browser tab title and in its only top-level heading, as "Sign in to {app name}".
- **FR-002**: The app names MUST be **QueuePass Admin**, **QueuePass Tickets** (the Customer app),
  and **QueuePass Ticket Booth**, each held in one place (the name the seed gives the app in
  Keycloak) and shown from there.
- **FR-003**: The Customer app MUST call itself **QueuePass Tickets** in its own browser tab title
  and header, matching its sign-in screen. The Admin and Ticket Booth apps already match theirs.
- **FR-004**: Every screen on the way to signing in (the sign-in form, a wrong username or password,
  and any other notice or error shown before sign-in completes) MUST keep the app's identity: its
  name, its audience line, and its accent.
- **FR-005**: Each app's sign-in screen MUST show a short line saying who the app is for:
  administrators managing venues, events, and sales (Admin); customers buying and viewing tickets
  (Customer); gate agents checking tickets in at the door (Ticket Booth). The three screens MUST
  differ in name, audience line, and accent color, so none is told apart by color alone.
- **FR-006**: Each app MUST have its own accent color on its sign-in screen, used on the brand mark,
  the primary button, and a band at the top of the screen. The Admin accent MUST be the shared
  theme's accent; the Customer and Ticket Booth accents MUST each be clearly different from it and
  from each other, and meet the same contrast rules (FR-012).
- **FR-007**: The sign-in screens MUST use the shared theme's look: its fonts, spacing, control
  styles, brand mark, and light and dark color schemes, so they look like part of QueuePass, not a
  separate product.
- **FR-008**: A sign-in screen with no recognized app MUST show the QueuePass look with the heading
  "Sign in to QueuePass" (or "Sign in to {name}" when the client has a name), the shared accent, and
  no audience line.
- **FR-009**: The look and each app's identity MUST ship in the repository and be applied when the
  stack starts from a clean clone with the documented command, with no step in the Keycloak admin
  console (Constitution II).
- **FR-010**: The seed MUST bring existing Keycloak data to the new look and identities on its next
  run, without removing any data, and MUST leave them unchanged and say so when they are already in
  place (as `001` FR-005/FR-006 for the realm and clients).
- **FR-011**: The sign-in form MUST keep today's behavior: username or email and password, no
  self-registration, the same error for a wrong username or a wrong password, and the return to the
  app after sign-in. Only the look and text around the form change.
- **FR-012**: Every sign-in screen MUST meet WCAG 2.1 AA contrast in light and dark schemes, work at
  360 px wide with no sideways scrolling, start focus on the username field, keep a visible focus,
  be fully usable by keyboard, and announce errors to assistive technology (as `008`).
- **FR-013**: The Keycloak admin console MUST NOT change.

### Key Entities

- **App identity**: per front end, its name (FR-002), its audience line (FR-005), and its accent
  color (FR-006). The name is the one the seed gives the app's sign-in client; the audience line
  and accent are kept with the sign-in look and the shared theme, matched to the app (plan,
  research R3).
- **QueuePass sign-in look**: the realm's sign-in screens styled in the shared theme, with a place
  for the app identity. Ships in the repository.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For each of the three apps, its sign-in screen's tab title and heading name that app,
  on the first screen and after a wrong password: 6 of 6 screens.
- **SC-002**: Shown the three sign-in screens with the app names covered, a tester matches each to
  its app from the audience line and accent within 5 seconds per screen, 3 of 3.
- **SC-003**: From a fresh clone and the one documented command, the three screens show their
  identities with zero manual steps.
- **SC-004**: A second seed run changes nothing, and a seed run on Keycloak data from before this
  feature brings in the new look with no user, client, or role lost.
- **SC-005**: Every sign-in screen passes WCAG 2.1 AA contrast in light and dark schemes and has no
  sideways scrolling at 360 px wide, for all three apps.
- **SC-006**: Signing in still takes the same steps as before: no new field, click, or screen.

## Assumptions

- The sign-in pages stay Keycloak's own (Constitution: identity is Keycloak's; no password is typed
  into an app). Only their look and text change, through Keycloak's supported theming.
- English only, as the rest of QueuePass.
- The apps after sign-in keep the shared theme unchanged (Clarifications); per-app accents inside
  the apps are out of scope. The Customer app's name change (FR-003) is the only app change.
- Other screens Keycloak can show (account management, password reset) are not offered by
  QueuePass today (no self-service account management, no email); if reached directly they get the
  QueuePass look without an app identity (FR-008), and nothing more is required of them.
- Stopping a person from signing in to the wrong app is out of scope; each app still checks roles
  after sign-in (`001`).
- The test accounts and their passwords are unchanged.
