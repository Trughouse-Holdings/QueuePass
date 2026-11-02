# Research: Sign-in Background

**Feature**: `027-sign-in-background` | **Spec**: [spec.md](./spec.md) | **Date**: 2026-11-02

Mahdi's decisions are in the spec's Clarifications; each decision below that goes beyond them takes
the recommended option and records the alternatives, for the team to overturn in review of the spec
PR. Facts marked **verified** were checked on 2026-11-02 against the running stack's Keycloak
(container `queuepass-team-keycloak-1`, Keycloak 26.0.8, built from `keycloak/Dockerfile`) and the
themes jar inside it.

## R1. The stones image, served by Keycloak from its own theme

**Decision**: `login.css` loads the stones image from Keycloak's stock `keycloak` login theme with a
relative URL: `url(../../keycloak/img/keycloak-bg.png)`. The repository holds no copy (FR-002).

**Verified**:

- The image is `theme/keycloak/login/resources/img/keycloak-bg.png` inside
  `/opt/keycloak/lib/lib/main/org.keycloak.keycloak-themes-26.0.8.jar`: a 1920×1080 RGB PNG of
  81,862 bytes, SHA-256 `0825175291be11f7689e8718295e422bb6fa4f8fefccc5610292b720c701ac4e`.
- Keycloak serves any theme's resources at `/resources/{version}/login/{theme}/...`. Our stylesheet
  is `/resources/rh29r/login/queuepass/css/login.css`; `GET
  /resources/rh29r/login/keycloak/img/keycloak-bg.png` answers `200`, `Content-Type: image/png`, and
  the same 81,862 bytes with the same SHA-256 as the jar's file. So `../../keycloak/img/keycloak-bg.png`,
  resolved against the stylesheet, reaches it, whatever `{version}` is.
- Keycloak's own `keycloak` theme draws it the same way: `.login-pf body { background:
  url("../img/keycloak-bg.png") no-repeat center center fixed; background-size: cover; }`.
- Keycloak's sign-in pages send no `img-src` limit in their content security policy, and the image
  is on the page's own origin.

**Rationale**: the issue asks for the image Keycloak already ships, served from its own theme, if
that works; it does. No copy means no 82 KB binary to keep in step with Keycloak and nothing of
Keycloak's to relicense. A Keycloak upgrade that changes or drops the image is caught by the live
test (R8) and falls back to a plain stone grey (R4, FR-009).

**Alternatives considered**:

- A copy in `keycloak/themes/queuepass/login/resources/img/`: what the issue asks to avoid; two copies
  that can drift.
- Extracting it from the jar in `keycloak/Dockerfile` at build time: the Keycloak image has no
  `unzip`, so it would need a second build stage; more to maintain than a relative URL that already
  works.
- `parent=keycloak` instead of `base`, inheriting the image: brings PatternFly's stylesheets back
  (`021` research R2 rejected that parent).

## R2. Coloring only the lines between the stones: a derived lines image as a mask

**Decision**: a **lines image** derived once from Keycloak's image: a 1920×1080 PNG, every pixel
white, whose alpha is opaque on the edges between the stones and clear elsewhere. The page draws a
layer filled with the app's accent (`var(--accent)`) and shows it only through that image
(`mask-image`), over the stones, both sized `center / cover` on the same box so they line up (R4).
The file is `keycloak/themes/queuepass/login/resources/img/stone-lines.png`.

**Facts about the image** (verified with Pillow on the jar's file):

- It is pure grey: every pixel has R = G = B; 138 distinct greys. The lightest is `#898989`, at the
  top left corner; the darkest `#000000`, at the bottom right. The mean is about `#3e3e3e`.
- It is flat facets: 190 regions of one grey each, 500 px or larger, cover 98.7% of it; the rest
  (about 21,000 regions of a pixel or two) are anti-aliasing along the edges.
- The edges are faint: across an edge, neighboring pixels differ by 1 to 12 grey levels.

**Why CSS alone cannot do it**: a filter, a blend mode, or a tint acts on every pixel of the image;
nothing in CSS finds the edges of an image. Coloring only the edges needs the edges as data.

**Prototype** (scratch, not committed): thresholding the difference between neighboring pixels
works only roughly. At a threshold of 3 grey levels, 0.94% of pixels are edges, but faint edges come
out dashed (their anti-aliasing steps are below the threshold in places) and some faint seams inside
a stone show as dotted lines; at 8, almost nothing is left (0.01%). So the generator (R3) works on
facets, not on pixel differences.

**Rationale**: a mask keeps the color in the shared theme (the layer's fill is the accent token,
R6), so each app's lines follow its token with no per-app image; the lines are exactly where the
stones' edges are because they come from the same pixels; and the derived file is small (about
70–100 KB in the prototype).

**Alternatives considered**:

- **An SVG of the edges** (polygon edges traced from the facets, as a mask or an inline image):
  crisp at any size and a few KB, but tracing 190 facets into polygons that land exactly on the
  bitmap's anti-aliased edges is more code and more ways to drift by a pixel. Worth revisiting if the
  PNG's lines look soft on very large screens; not needed for 1920×1080 artwork shown with `cover`.
- **Tinting the whole image** (a blend mode with the accent): previewed and not chosen by Mahdi.
- **Three pre-colored copies of the image**: copies Keycloak's image three times and writes colors
  outside the shared theme's token blocks (Constitution VII).
- **Finding the edges in the browser** (a script drawing on a canvas at page load): script on the
  sign-in page for decoration, and work on every page load for a result that never changes.

## R3. Making the lines image: a TypeScript generator in `scripts/seed`, no new dependency

**Decision**:

- `scripts/seed/src/stone-lines/` holds the generator as pure functions plus a small command:
  `png.ts` (decode an 8-bit non-interlaced PNG, grey or RGB, all five scanline filters; encode an
  8-bit grey-and-alpha PNG with text chunks; `node:zlib` only), `facets.ts` (label the flat
  regions; give each anti-aliasing pixel to the facet of the nearest large region), and `lines.ts`
  (mark the pixels on a boundary between two facets whose greys differ by at least `MIN_STEP`
  levels; widen to about 2 px; soften by at most 1 px; alpha from the result, color white).
- `npm run stone-lines --workspace @queuepass/seed -- <keycloak-bg.png>` writes
  `keycloak/themes/queuepass/login/resources/img/stone-lines.png`. It refuses an input whose SHA-256
  is not the recorded one (R1), so the lines always match the image Keycloak serves. The same input
  gives the same bytes every time (no timestamps; fixed compression settings).
- The source file is taken from the running Keycloak (`curl` the URL of R1, with the `{version}` the
  sign-in page's stylesheet links show) or from the jar; quickstart S7 gives the commands.
- `MIN_STEP`, the widening, and the softening are chosen in implementation from previews of all
  three apps' lines, and Mahdi approves the preview before the file is committed (tasks). The values
  are recorded in `lines.ts` and in the PNG's text chunk.
- License (FR-010): the PNG carries `tEXt` chunks naming the source (`keycloak-bg.png`, Keycloak
  26.0.8, its SHA-256), the copyright holder (Red Hat, Inc. and/or its affiliates, as in Keycloak's
  sources), the license (Apache License 2.0), and the change ("reduced to the edges between the
  stones, as an alpha mask"). Beside it, `keycloak/themes/queuepass/NOTICE` says the same in words,
  and `keycloak/themes/queuepass/LICENSE-keycloak.txt` is the Apache License 2.0 text as Keycloak
  ships it (`/opt/keycloak/LICENSE.txt` in the image).

**Rationale**: Constitution, Language and Stack: TypeScript everywhere, tests included, so not a
Python script. `scripts/seed` is the workspace that already owns Keycloak's configuration and the
sign-in look's tests (`021` plan, Structure Decision), and its coverage floor (Constitution VI) then
covers the generator. A PNG reader and writer for the two formats involved is short with
`node:zlib`; `fast-png` is in the lockfile only as a dependency of `jspdf`, and adding it (or any
image library) as a direct dependency is more to approve and update for a one-off tool.

**Alternatives considered**:

- Generate at image build time in `keycloak/Dockerfile`: needs Node and the source image inside a
  build stage, on every build, for a file that never changes; and CI's tests could not see the result.
- A Python script: outside the fixed stack.
- An image library (`sharp`, `pngjs`, `fast-png`): a new direct dependency for one file.

## R4. The layers, and how they line up

**Decision**: `template.ftl` gains one decorative element, the first child of `<body>`:
`<div class="qp-stones" aria-hidden="true"></div>`. In `login.css`:

- `.qp-stones`: `position: fixed; inset: 0; z-index: -1;` with the stones as its background
  (`url(../../keycloak/img/keycloak-bg.png) center / cover no-repeat`).
- `.qp-stones::before` (the lines): the same box (`position: absolute; inset: 0`),
  `background: var(--accent)`, `mask: url(../img/stone-lines.png) center / cover no-repeat`.
- `.qp-stones::after` (the shade, R5): the same box, above the lines.
- `body`: `background: var(--stone-base)` (a plain stone grey, R6), under all three: what shows when
  the image is missing (FR-009).

The stones and the lines are one box with the same position and sizing, and the image and the lines
image are both 1920×1080, so `cover` scales and crops them identically at every window size and
shape (FR-003). The layers are fixed to the window, not to the page, so a page longer than the
window scrolls over still stones.

**Rationale**: `background-attachment: fixed` (Keycloak's own way) is ignored by Safari on iPhone
and iPad, which would scroll the stones but not a separately fixed lines layer, and the two would
part; a fixed element avoids it. A pseudo-element per layer keeps the markup to one `aria-hidden`
element with no content.

**Alternatives considered**: three background layers on `body` (a mask cannot apply to one layer
only); the lines as a separate `<img>` (markup for decoration, and `cover` for images needs
`object-fit` and the same alignment rules anyway).

**Browsers**: `mask` with an image is supported unprefixed by current Chrome, Edge, Firefox, and
Safari. A browser without it draws the accent layer unmasked; to keep that from filling the window
with the accent, the lines layer is declared inside `@supports (mask-image: none)` (spec Edge
Cases: no lines, nothing else changes). In forced-colors mode the browser drops the backgrounds.

## R5. The shade and the contrast budget

**Decision**: the shade is `.qp-stones::after` with a horizontal gradient:
`linear-gradient(to right, transparent, var(--stone-scrim) calc(50% - 280px), var(--stone-scrim)
calc(50% + 280px), transparent)`, where `--stone-scrim` is black at 60%. It is at full strength
across a centered band 560 px wide (the form's column is at most 400 px plus its padding) and fades
to nothing at the window's edges; a window narrower than 560 px is at full strength throughout. It
runs the window's full height.

**Worst case** (FR-006): the backdrop behind the form, under the full shade, lies between pure
black (the darkest stone) and the lighter of the lightest stone (`#898989`) and the page's line color
at full strength (the mask's opaque core). In the light scheme the lines are the light-scheme
accents (`#4f46e5`, `#0f766e`, `#b45309`); in the dark scheme the dark-scheme ones (`#8b85f5`,
`#2dd4bf`, `#fbbf24`). Under 60% black (composited in sRGB, as browsers do), the lightest stone is
`#373737`; the brightest line is the Booth's dark-scheme amber, `#644c0e`. The fallback grey
`--stone-base` (`#3a3a3a`) under the shade is `#171717`.

**Colors drawn on the backdrop** (R6) and their lowest contrast over all of those backgrounds,
computed with the `012` contrast test's formula:

| What | Token | Value | Light scheme (lowest) | Dark scheme (lowest) | Target |
| --- | --- | --- | --- | --- | --- |
| Heading, labels, page text, links | `--stone-text` | `#ffffff` | 11.90 | 8.13 (Booth) | 4.5 |
| Audience line, required-fields note | `--stone-text-muted` | `#d0d5dd` | 8.07 | 5.52 (Booth) | 4.5 |
| Wrong-password message, the `*` | `--stone-danger` | `#fecaca` | 8.23 | 5.62 (Booth) | 4.5 |
| Focus rings (Admin / Tickets / Booth) | `--stone-accent`, `-tickets`, `-booth` | `#8b85f5` / `#2dd4bf` / `#fbbf24` | 3.84 / 6.39 / 7.13 | 3.65 / 4.64 / 4.87 | 3 |
| Text field edge | `--stone-field-border` | `#9aa3b0` | 4.67 | 3.19 (Booth) | 3 |
| Text field fill (light scheme) | shared `--surface` | `#ffffff` | 11.90 | n/a | 3 |

The text inside the fields, the buttons, and the notices is on their own fills, which `021` and
`012`'s contrast tests already cover in both schemes. A button is identified by its text, so its
fill needs no contrast with the backdrop (WCAG 1.4.11); a text field has no text until typed in, so
its edge does.

Why these numbers:

- **60%** is the lightest shade at which every row passes with these colors. At 50% the Booth's
  muted text falls to 3.99 and the Admin ring to 2.92. A darker shade passes too but hides the stones
  behind the form: at 78%, the strength at which the shared dark-scheme field edge (`#6f7887`) would
  pass without its own token, the lightest stone behind the form is `#1e1e1e`.
- **Focus rings in the lighter accent**: the light-scheme accents reach only 1.58–1.80:1 against
  the lightest backdrop (they pass only against black, 3.34–4.18:1). The dark-scheme values pass in
  both schemes (Clarifications).
- **The field edge** needs its own color: in the dark scheme, neither the shared `--border-strong`
  (`#6f7887`) nor the field's fill (`#171a21`) reaches 3:1 next to a line under the shade (as low as
  2.01:1 next to a Tickets line). The light scheme's white fill passes on its own.

**Rationale**: FR-004 allows a shade with no edge and asks for the stones at full strength beside
the form; a band at full strength only where text can be keeps the most of the stones visible on
wide windows. Every point text can sit on is inside the band, at every width (the column is centered
and narrower than the band), so the table holds everywhere (SC-002), and the browser test (R8)
checks the rendered pages rather than trusting the arithmetic.

**Alternatives considered**:

- **One even shade over the whole window**: simpler, but it dims the stones and lines everywhere;
  the light-scheme accents' lines would be nearly black.
- **A text shadow or glow instead of a shade**: contrast for shadowed text is not measurable against
  WCAG's rule, and the fields would still need a backdrop.
- **The shade between the stones and the lines** (lines on top at full strength): a bright line
  crossing white text is 1.7:1 (Booth, dark scheme).

## R6. The backdrop colors are shared-theme tokens

**Decision**: `packages/shared/src/web/theme.css` gains, in both token blocks with the same values
(as `014`'s `--scrim` and `--scrim-text`, "dark in both sets"):

| Token | Value | Use |
| --- | --- | --- |
| `--stone-base` | `#3a3a3a` | The page color under the stones (FR-009) |
| `--stone-scrim` | `rgb(0 0 0 / 60%)` | The shade behind the form's column (R5) |
| `--stone-text` | `#ffffff` | Text on the backdrop |
| `--stone-text-muted` | `#d0d5dd` | The audience line and the required-fields note |
| `--stone-danger` | `#fecaca` | The wrong-password message and the required `*` |
| `--stone-field-border` | `#9aa3b0` | Text field edges on the sign-in form |
| `--stone-accent` | `#8b85f5` | Focus rings on the backdrop: the shared accent's lighter shade |
| `--stone-accent-tickets` | `#2dd4bf` | The same for the Customer app |
| `--stone-accent-booth` | `#fbbf24` | The same for the Ticket Booth app |

The per-app rules in `login.css` gain a seventh role:
`.qp-app--customer-app { …; --stone-accent: var(--stone-accent-tickets); }` and the same for
`booth-app`. The `021` drift exception (`check-theme.ts`, `SIGN_IN_ROLES`) gains the role
`--stone-accent` → `--stone-accent-<app>`; a rule must then map all seven roles' tokens, one app per
rule, and the theme must define all seven of that app's tokens. Nothing else in the exception
changes. The lines use `var(--accent)` directly, which the existing six-role mapping already points
at the app's accent (FR-003).

**Rationale**: Constitution VII keeps every color in the shared theme's token blocks and under its
contrast tests; the sign-in look already works this way (`021` research R4). The values are the
same in both blocks because the backdrop is dark in both schemes (FR-007). The three accent shades
equal the dark scheme's `--accent`, `--accent-tickets`, and `--accent-booth` today, but they are a
separate role: a later change to the dark scheme's accents should not silently move the rings on the
stones, whose contrast test is separate.

**Alternatives considered**: writing the colors in `login.css` (the drift test forbids it, rightly);
reusing the dark scheme's tokens by forcing the dark scheme on the sign-in pages (the dark set lives
in a media query on `:root`, so it would have to be duplicated, and the controls would stop following
the scheme, which `021` FR-012 and FR-007 here keep).

## R7. The page frame: no card, colors on the stones

**Decision**:

- `template.ftl`: the `.qp-stones` element (R4); the `<div class="card card--padded qp-card">` around
  the form becomes `<div class="qp-form">` (no shared card class, FR-004). Everything else in the
  frame stays: the band, the brand mark, the one `<h1>`, the audience line, the page's own header as
  `<h2>`, the message banners, the body class (`021` R3, R9). `login.ftl` is unchanged.
- `login.css`:
  - `body { color: var(--stone-text); background: var(--stone-base); }`; `.qp-form` keeps the
    card's width and padding (max 400 px) with no background, border, radius, or shadow.
  - On the backdrop only: `.qp-audience` and `.qp-required` in `--stone-text-muted`;
    `.qp-field-error` and `.qp-required .required` in `--stone-danger`; the form's labels
    (`#kc-form-login label`, since the shared `.field label` is `var(--text)`) and the attempted
    username in `--stone-text`; links that are not inside a notice (`a:not(.banner a)`) in
    `--stone-text`, underlined, since the shared link color is the scheme's accent. Links inside
    notices keep the shared colors, which `021`'s contrast test covers on the notices' fills.
  - Text fields: `#kc-form-login input:not(:focus):not(:hover)` (and the Show button's group) take
    `border-color: var(--stone-field-border)`; the shared hover and focus states (focus: the
    scheme's accent edge on the field's own fill) are left as they are.
  - Focus rings: `:focus-visible { outline-color: var(--stone-accent); }` on the backdrop, so the
    Show button, the Sign In button (`021`'s `#kc-login:focus-visible` rule), and links all ring in
    the lighter accent; width and offset unchanged (3 px, 2 px).
  - The `.qp-banner--info` rule and the notices' own colors are unchanged.
- Nothing in `theme.properties` changes: `styles=css/theme.css css/login.css` already loads both.

**Rationale**: the issue's "keep everything `021` added" with the least change to the frame; every
text that sits on the backdrop gets a backdrop color (R6), and nothing that sits on its own fill
changes. `login.css` is the sign-in look's own stylesheet, so restyling the label and field colors
there does not touch the apps (FR-012).

## R8. Tests

**Decision**:

- **Shared** (CI, `packages/shared/test/theme/`):
  - `tokens.test.ts`: the nine tokens, with R6's values, in both blocks; used by no rule in
    `theme.css` outside the token blocks.
  - `contrast.test.ts`, "the sign-in backdrop (spec 027)": the backdrop colors over R5's worst cases,
    computed from the theme: for each app and scheme, the backgrounds are black, the lightest stone,
    the app's line color in that scheme, and `--stone-base`, each under `--stone-scrim`; `--stone-text`,
    `--stone-text-muted`, and `--stone-danger` at 4.5:1 or more; the app's `--stone-accent` and
    `--stone-field-border` (and, light scheme, `--surface`) at 3:1 or more. The image's lightest and
    darkest greys (`#898989`, `#000000`) are constants in the test, citing R2; the live test (below)
    keeps them true by checking the image's SHA-256.
  - `drift.test.ts`: `login.css` still passes with `signInAccents`; new checker cases: the seventh
    role allowed only with all seven of one app's tokens defined; `--stone-accent: var(--accent-booth)`
    and a rule mixing apps still fail. A new check that no app stylesheet (Admin, Customer, Booth) uses
    `--stone-` or the per-app accent tokens (FR-012).
- **Seed, theme files** (CI, `scripts/seed/test/login-theme-files.test.ts`): `login.css` loads
  `../../keycloak/img/keycloak-bg.png` and `../img/stone-lines.png`; `template.ftl` has
  `<div class="qp-stones" aria-hidden="true">` as `<body>`'s first child and no `card` class;
  `stone-lines.png` is a 1920×1080 grey-and-alpha PNG, white wherever its alpha is not 0, with alpha
  above 0 on between 2% and 15% of pixels, and text chunks naming Keycloak, the source SHA-256, and
  the Apache License 2.0; `NOTICE` and `LICENSE-keycloak.txt` exist and say so; no file under
  `keycloak/` has the stones image's SHA-256 (FR-002, SC-004).
- **Seed, the generator** (CI, `scripts/seed/test/stone-lines.test.ts`): PNG decode of each filter
  type and grey, RGB, and grey-and-alpha round trips; on small made-up images, two flat facets with an
  anti-aliased seam give one continuous line along the seam; facets closer than `MIN_STEP` give none;
  the output is identical on a second run; an input with another SHA-256 is refused.
- **Seed, live Keycloak** (`scripts/seed/test/sign-in-screens.test.ts`, skipped with its reason
  without Keycloak, as `021`): for each client and for the account console and the no-client page,
  the page has the `.qp-stones` element; from the page's `login.css` link, the stones image's URL
  answers `200 image/png` with the recorded SHA-256 (FR-010), and the lines image's URL answers
  `200 image/png`.
- **Browser tests** (`e2e/tests/027-sign-in-background.spec.ts`, the CI `e2e` job, against the
  Compose stack, so with the real Keycloak):
  - `027 S1: …`: for each app, the `.qp-stones` element's stones image has loaded (its `naturalWidth`
    through an `Image()` of the computed URL is 1920), its `::before` fill is the app's computed
    `--accent`, and the form has no card (no `.card` in the page).
  - `027 S3: …`: for each app, light and dark (`page.emulateMedia`), at 360×800, 768×1024, 1280×800,
    1920×1080, and 2560×1440, on the first page and after a wrong password: record each text
    element's box and computed color, each text field's box and edge color, and the Sign In button's
    focus-ring box and color (focused with the keyboard); hide the page's content
    (`visibility: hidden` on `main`, the band, and nothing else) and screenshot the window: that is
    the backdrop alone. Decode the screenshot in a blank page (`createImageBitmap` and a canvas, so
    the test needs no image library), and for each box take the lightest and darkest backdrop pixel
    in it (for edges and rings, a 3 px ring around the box): text 4.5:1 or more, field edges and
    focus rings 3:1 or more, against both. Also no sideways scroll at 360 px. (SC-002, SC-003.)
  - `027 S6: …`: the same check as S3 at 360×800 and 1920×1080, with the stones image request
    aborted (`page.route`), for one app (SC-005).
- **Running system**: [quickstart.md](./quickstart.md): the look by eye, telling the apps apart, the
  keyboard and a screen reader, and the generator's output reproduced.

**Rationale**: everything that can be computed from files runs in CI's `test` job; the rendered
backdrop is measured in the `e2e` job, which has Keycloak; the live seed test catches a changed
image locally. The browser test measures what a person sees, so a mistake in R5's arithmetic or a
layout that moves text out of the shaded band fails it.

**Alternatives considered**: measuring only from tokens (misses layout and the real image); a
screenshot comparison (brittle across fonts and Chromium versions, and says nothing about contrast).

## R9. Constitution 3.7.0 (MINOR): Principle VII allows Keycloak's stone background on the sign-in screens

**Decision**: amend Principle VII's sign-in exception in this spec PR. Today it allows the sign-in
screens each app's name, an audience line, and its own accent, and nothing more; "decoration" is out
of scope. Added to that paragraph: "They MAY also show Keycloak's stock low-poly background, served
from Keycloak's own theme, with the lines between the stones in the app's accent (spec `027`). That
background is the only decoration allowed, and every text, label, and control on it MUST keep the
contrast its spec states." The tokens sentence becomes: "Those accents, and the colors the sign-in
screens draw on that background, are tokens in the shared theme, defined only in its token blocks
and checked by its contrast tests. The apps themselves keep the one shared accent and use none of
them." The roadmap gains row `027-sign-in-background` (#122, depends on `021`); the next free number
becomes `028`. Version 3.6.3 → **3.7.0** (MINOR: guidance materially expanded; no control removed).
The Sync Impact Report is replaced; the README's version reference follows.

**Rationale**: the background is decoration, which Principle VII rules out, so it needs the
constitution to say so rather than a quiet exception; keeping it to the sign-in screens, to
Keycloak's own image, and under the contrast rule keeps the principle's intent (the apps get no
decoration, and readability is not traded for looks). The issue names the amendment; the
constitution is shared surface, so Nate approves it in this PR. Reserving `027` here instead of in a
separate PATCH keeps one PR for one feature's constitution change, as `021` did with 3.5.0.

**Alternatives considered**: no amendment (the drift test would pass, since the colors are tokens,
but the code would contradict Principle VII's words); a broader "sign-in screens may have a
background" (more than the issue asks).
