# Research: Sign-in Screens

**Feature**: `021-sign-in-screens` | **Spec**: [spec.md](./spec.md) | **Date**: 2026-10-30

Written unattended at Nate's request: each decision takes the recommended option and records the
alternatives, for the team to overturn in review of the spec PR.

## R1. Keycloak's own theming, one realm login theme

**Decision**: A Keycloak **login theme** named `queuepass`, set as the realm's login theme. One theme
serves all three apps; the app identity is picked inside it from the client that started the
sign-in (R3).

**Rationale**: Constitution V keeps sign-in on Keycloak's own page, so the look must come from
Keycloak's supported theming (FreeMarker templates, messages, and static resources under
`themes/<name>/login/`). One theme keeps the shared layout in one place.

**Alternatives considered**:

- Three themes, one per client, chosen by each client's `login_theme` attribute: three copies of the
  same template and stylesheet that differ only in three values; a fourth for the no-app case.
- Sign-in forms inside the apps: forbidden (Constitution V: no front end handles a password).
- Only renaming the realm's display name: one name for all three apps; does not solve the issue.

## R2. Parent theme: `base`, with the shared control styles

**Decision**: `parent=base`, `import=common/keycloak`. The theme overrides `template.ftl` (the page
frame: `<title>`, the band, the brand mark, the heading, the audience line, the message area) and
keeps `base`'s form templates (`login.ftl`, `error.ftl`, `info.ftl`, `logout-confirm.ftl`, and the
rest). `theme.properties` maps Keycloak's class hooks to the shared theme's classes:
`kcFormGroupClass=field`, `kcButtonClass=btn`, `kcButtonPrimaryClass=btn--primary`,
`kcButtonBlockClass=` (empty), `kcInputErrorMessageClass=qp-field-error`, `kcAlertClass=banner`,
`kcAlertTitleClass=banner__body`, and empties the PatternFly-only ones. No PatternFly stylesheet is
loaded. `qp-field-error` is a `login.css` rule using `var(--danger)` (the shared theme has no field
error class). `base`'s `template.ftl` writes no viewport tag (the PatternFly themes add one through
the `meta` property), so `theme.properties` sets `meta=viewport==width=device-width,initial-scale=1`;
without it a phone lays the page out at desktop width (FR-012). The shared theme's
`input:focus { outline: none }` also reaches the Sign In button (an `<input type="submit">`), so
`login.css` gives `#kc-login:focus-visible` the shared focus ring back (implementation, 2026-10-30).

The show-password toggle (`base` `login.ftl`: a button with `aria-label` "Show password" holding an
icon `<i>` whose class `passwordVisibility.js` swaps between `kcFormPasswordVisibilityIconShow` and
`…Hide`) stays (FR-011): `kcFormPasswordVisibilityButtonClass=btn btn--ghost qp-reveal`,
`kcFormPasswordVisibilityIconShow=qp-reveal--show`, `kcFormPasswordVisibilityIconHide=qp-reveal--hide`,
and `login.css` gives the icon visible text with `::before` ("Show" / "Hide"). Its accessible name is
the button's `aria-label`, unchanged. Tab order: username, password, Show, Sign in.

(Review round 1, findings 6 and 7: an unmapped error class left the error unstyled; an empty icon
class left an invisible focusable button.)

**Rationale**: `base` has the forms with no styling, so the shared theme's `.field`, `.btn`,
`.btn--primary`, `.banner`, and `.brand__mark` apply without fighting another stylesheet (FR-007).
Keeping `base`'s form templates keeps the form's behavior exactly as today (FR-011): same fields,
same error, same submit, no self-registration (the realm already has `registrationAllowed: false`).

**Alternatives considered**:

- `parent=keycloak` (PatternFly 4): its stylesheet and class names would have to be overridden rule
  by rule.
- `parent=keycloak.v2` (PatternFly 5, Keycloak 26's default): same problem, with larger templates.
- Writing every template from scratch: more code to keep in step with Keycloak upgrades for no gain.

## R3. Where each part of the app identity lives

**Decision**:

| Part | Held in | Read by the template as |
| --- | --- | --- |
| Name | the client's name, set by the seed (`provision-clients.ts`) | `advancedMsg(client.name)` |
| Audience line | the theme's `messages_en.properties`, key `qpAudience.<clientId>` | `msg("qpAudience." + client.clientId)` |
| Accent | the shared theme's tokens (R4), chosen by a body class `qp-app--<clientId>` | CSS |

With no `client` in the page, or a client with no name, the heading is "Sign in to QueuePass" (the
realm's display name); a client with no `qpAudience.*` key shows no audience line; a body class
with no accent rule falls back to the shared accent (FR-008). `advancedMsg` resolves Keycloak's
built-in clients' localized names (`${client_account-console}` → "Account Console").

**Rationale**: The name stays in the one place it is already set (FR-002), so renaming a client in
the seed renames its screen. The audience lines are page text, which Keycloak keeps in message
bundles. The accent stays in the shared theme (R4), so colors are still written out only in its
token blocks.

**Alternatives considered**: client attributes for the audience line and accent, set by the seed:
Keycloak's `ClientBean` exposes attributes to templates, but colors would leave the shared theme
and the drift and contrast tests (spec `012`) could not check them.

## R4. The shared theme inside the sign-in look; per-app accent tokens

**Decision**:

- The Keycloak image copies `packages/shared/src/web/theme.css` into the theme's resources at build
  (R6). `theme.properties`: `styles=css/theme.css css/login.css`. One copy of the shared theme in the
  repository (FR-007).
- The shared theme's two token blocks (light and dark) gain the two extra app accents, each with the
  same six roles as the shared accent set (accent, hover, soft, text on the accent, and the brand
  mark's gradient end and letter): `--accent-tickets`, `--accent-tickets-hover`,
  `--accent-tickets-soft`, `--accent-tickets-text`, `--brand-mark-end-tickets`,
  `--brand-mark-text-tickets`, and the same six for `booth`. The Admin uses the existing set.
- `keycloak/themes/queuepass/login/resources/css/login.css` holds only the sign-in layout (a
  centered card, the top band, the audience line) using theme values, plus one rule per app that
  points the shared roles at that app's set:
  `.qp-app--customer-app { --accent: var(--accent-tickets); --accent-hover: …; --accent-soft: …;
  --accent-text: …; --brand-mark-end: …; --brand-mark-text: …; }`, and the same for `booth-app`.
- The `012` drift checker (`packages/shared/test/theme/check-theme.ts`) scans `login.css` as it scans
  an app stylesheet, with one exception: inside a `.qp-app--<clientId>` rule, setting the six
  accent roles to `var(--…)` of a theme token is allowed. Any color literal or any other redefinition
  still fails. Today's parser (`declarations()` in `check-theme.ts`) drops the selector at `{`,
  so it must first track the enclosing rule's selector, including rules nested in `@media` (review
  round 1, finding 5).

**Rationale**: Constitution VII (as amended, R8) keeps every color in the shared theme and checked
by its tests; the apps keep one accent, and the sign-in look is the only place the three meet.

**Alternatives considered**: a copy of the theme's tokens in the Keycloak theme, kept in step by a
drift test: two copies where one will do. Mounting the file at run time: R6.

## R5. The three accents

**Decision** (contrast computed with the `012` contrast test's formula; AA needs 4.5:1):

| App | Light accent / hover / soft / text | Dark accent / hover / soft / text | Light: text on accent, accent on bg | Dark: text on accent, accent on bg |
| --- | --- | --- | --- | --- |
| Admin (shared, unchanged) | `#4f46e5` / `#4338ca` / `#eef2ff` / `#ffffff` | `#8b85f5` / `#a29bff` / `#1e1b4b` / `#0f1115` | 6.29, 5.87 | 6.09, 6.09 |
| Customer (teal) | `#0f766e` / `#115e59` / `#f0fdfa` / `#ffffff` | `#2dd4bf` / `#5eead4` / `#042f2e` / `#0f1115` | 5.47, 5.11 | 10.15, 10.15 |
| Ticket Booth (amber) | `#b45309` / `#92400e` / `#fffbeb` / `#ffffff` | `#fbbf24` / `#fcd34d` / `#451a03` / `#0f1115` | 5.02, 4.68 | 11.32, 11.32 |

Brand mark (a decorative, `aria-hidden` bold "Q" on a gradient from the accent to the end color;
large text, so 3:1): Customer end `#0d9488` / `#14b8a6`, letter `#ffffff` / `#0f1115`; Booth end
`#c2410c` / `#f59e0b`, letter `#ffffff` / `#0f1115` (light / dark). In dark mode the letter is dark
because the light accents would leave a white letter under 2:1. Every pair is at least 3.7:1.

**Rationale**: indigo, teal, and amber are far apart in hue and differ in lightness too, so they are
told apart by most people with color-vision differences; each passes AA for text on the accent and
the accent on every background, in both schemes. Color is never the only difference (FR-005).

**Alternatives considered**: red for the booth (reads as an error state, clashes with `--danger`);
green for the customer (reads as success, clashes with `--ok`).

## R6. Shipping the theme: a Keycloak Dockerfile

**Decision**: `keycloak/Dockerfile`:
`FROM quay.io/keycloak/keycloak:26.0`, `COPY keycloak/themes/queuepass /opt/keycloak/themes/queuepass`,
`COPY packages/shared/src/web/theme.css /opt/keycloak/themes/queuepass/login/resources/css/theme.css`.
`docker-compose.yml`'s `keycloak` service gets `build: { context: ., dockerfile: keycloak/Dockerfile }`
in place of `image:` (same tag, same command `start-dev`, same health check). `.dockerignore` already
excludes `node_modules`, `dist`, and `.git`.

**Rationale**: Constitution II: each service has its own Dockerfile, and `docker compose up --build`
from a clean clone gives the whole system with no manual step (FR-009). `start-dev` already turns
Keycloak's theme cache off, so a rebuilt image shows a changed theme at once.

**Alternatives considered**: bind-mounting `keycloak/themes/queuepass` and the shared file: a file
mounted inside a read-only mounted folder needs the target to exist on the host side, behaves
differently on Docker Desktop and Linux, and is not what the other services do.

## R7. The seed converges the realm's login theme and the Customer client's name

**Decision**:

- `provision-realm.ts`: create the realm with `loginTheme: 'queuepass'`; for an existing realm, read
  it and update `loginTheme` only when it differs, logging `set login theme 'queuepass'` or
  `login theme already 'queuepass'` (FR-010). Nothing else on an existing realm changes, as today.
- `provision-clients.ts`: `customer-app`'s name becomes `QueuePass Tickets`. The existing client
  convergence already rewrites the name on every run, so an existing stack is renamed on its next
  seed.

**Rationale**: `001` FR-005/FR-006 and Constitution II: the seed is idempotent and repairs drift; a
stack created before this feature gets the look on its next `docker compose up --build`, with no data
removed.

**Alternatives considered**: realm import with the login theme: applies only when the realm does
not exist (`001` research R5), so existing stacks would never get it.

## R8. Constitution 3.5.0 (MINOR): Principle VII allows per-app identity on the sign-in screens

**Decision**: amend Principle VII in this spec PR. Today it says "no per-app variants" and "Neither
app may define its own accent color", and puts branding out of scope. Added: "The sign-in screens
(Keycloak's pages, styled from the shared theme) MAY show each app's name, a line saying who it is
for, and its own accent color, so a person can tell at a glance which app they are signing in to.
Those accents are tokens in the shared theme, checked by its contrast tests; the apps themselves
keep the one shared accent." Version 3.4.2 → **3.5.0** (MINOR: guidance materially expanded; no
control removed). The Sync Impact Report is replaced; the README's version reference follows. The
change rides in this feature's spec PR, as `017` and `018` did with theirs.

**Rationale**: telling the apps apart at sign-in is a usability control against signing in to the
wrong app (the issue's problem), not decoration; the team meeting asked for it. Recording it in the
constitution keeps the drift checker and Principle VII honest.

**Alternatives considered**: name and audience line only, no accent: keeps Principle VII unchanged
but does not meet the meeting's "visually distinct" requirement.

## R9. Title and heading on every page

**Decision**: `template.ftl` renders `<title>` and the page's one `<h1>` as
`msg("qpSignInTo", appName)` with `qpSignInTo=Sign in to {0}` (FR-001). The page's own header (the
`header` section each `base` template passes, such as "Sign in to your account" or "We are sorry...")
is captured (`<#assign pageHeader><#nested "header"></#assign>`) and dropped when its trimmed text
equals `msg("loginAccountTitle")` (the sign-in form), and shown as an `<h2>` on every other page, so
error and info pages keep the app's identity and still say what happened (FR-004). Keycloak 26's
login templates have no `pageId` variable (review round 1, finding 1). Keycloak renders with HTML
auto-escaping, so the capture is markup output, not a string: `pageHeader?trim` fails the page
with a 500 (`NonStringException: … evaluated to a markup_output`, seen on Keycloak 26.0.8). The text
is `pageHeader?markup_string?trim` (when `pageHeader?is_markup_output`), and the `<h2>` prints that
trimmed text with `?no_esc`, since it is already escaped (implementation, 2026-10-30).

Two kinds of message (review round 1, finding 2):

- **Page messages** (`message`, shown when the page passes `displayMessage`): `error` in
  `<div class="banner banner--error" role="alert">`, `success` in `banner--success`, and
  `warning`/`info` in a `banner`, the last two with `role="status"`.
- **Field errors**: on the sign-in form a wrong username or password is a field error, not a page
  message: `base`'s `login.ftl` passes `displayMessage=!messagesPerField.existsError('username',
  'password')` and renders the text in `<span id="input-error" class="${properties.kcInputErrorMessageClass}"
  aria-live="polite">`. That is announced (`aria-live`) and stays as `base` renders it, styled by
  `qp-field-error` (R2). The live test expects the text there (R11).

**Rationale**: one heading per page that names the app, on every page of the flow, without
rewriting each page template.

**Alternatives considered**: overriding `loginAccountTitle` in the messages: a message cannot read
the client's name, and other pages have other headers.

## R10. Customer app's own name

**Decision**: `customer-app/index.html` `<title>QueuePass Tickets</title>` and the header brand in
`customer-app/src/App.tsx` read "QueuePass Tickets" (FR-003). Text that names the product rather
than the app ("Can't reach QueuePass right now", the calendar file's `PRODID`) stays "QueuePass".

## R11. Tests

**Decision**:

- **Shared** (CI): the contrast test covers each app's accent set in light and dark (text on accent
  and on hover, accent on surface and bg, accent on its soft: 4.5:1; the brand letter on both
  gradient ends: 3:1); the token test requires the twelve new tokens in both blocks; the drift checker's new exception is proved rule by rule and then run over `login.css`.
- **Seed** (CI, no Keycloak): the realm settings include `loginTheme: 'queuepass'`; the client names
  are the three of FR-002.
- **Seed, live Keycloak** (`scripts/seed/test/sign-in-screens.test.ts`; skipped with its reason when
  Keycloak is not reachable, as `seed-idempotence.test.ts`, spec `011` research R16): for each client,
  GET the authorization URL with PKCE parameters and check `<title>`, the one `<h1>`, the audience
  line, and the body class; POST a wrong password to the form's action with the session cookies and
  check the page keeps all three and shows "Invalid username or password." in `#input-error`
  (`aria-live="polite"`, R9); GET the authorization URL for `client_id=account-console` with
  `redirect_uri=http://localhost:8080/realms/queuepass/account/` and PKCE for the no-app fallback
  (FR-008). `GET /realms/queuepass/account` itself returns the account console's single-page app,
  which redirects only in JavaScript (review round 1, finding 3), so the Node test cannot use it; the
  browser walk (quickstart S7) does. The seed idempotence test adds the login theme to what it
  checks on a second run.
- **Theme files** (CI, no Keycloak): a Node test reads `theme.properties` and `messages_en.properties`
  and checks the parent, the styles list, and an audience line for each of the three client IDs.
- **Customer app** (CI): the header reads "QueuePass Tickets".
- **Running system**: [quickstart.md](./quickstart.md), including contrast, phone width, dark mode,
  keyboard, and a screen reader on the real pages.

**Rationale**: CI has no Keycloak (spec `011`), so the rendered pages are checked live locally and in
the quickstart; everything that can be checked without Keycloak runs in CI. Spec `022` (browser
tests in CI, #93) will cover the rendered pages in CI.
