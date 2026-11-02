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
seed test and, in CI, by the browser test S1 (R8), and the page falls back to a plain stone grey
(R4, FR-009).

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
white, whose alpha is about 63% (160 of 255; spec Clarifications, implementation session) on the
edges between the stones and clear elsewhere. The page draws a
layer filled with the app's accent in its lighter shade (`var(--stone-accent)`, R6) and shows it
only through that image (`mask-image`), over the stones, both sized `center / cover` on the same box
so they line up (R4). The file is `keycloak/themes/queuepass/login/resources/img/stone-lines.png`.

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

**Rationale**: a mask keeps the color in the shared theme (the layer's fill is a token, R6), so each
app's lines follow its token with no per-app image; the lines are exactly where the stones' edges
are because they come from the same pixels; and the derived file is small (about 70–100 KB in the
prototype).

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

## R3. Making the lines image: a TypeScript generator in `scripts/seed`, with `fast-png`

**Decision**:

- `scripts/seed/src/stone-lines/` holds the generator as pure functions plus a small command:
  `facets.ts` (label the flat regions; give each anti-aliasing pixel to the facet of the nearest
  large region), `lines.ts` (mark the pixels on a boundary between two facets whose greys differ by
  at least `MIN_STEP` levels; widen to about 2 px; soften by at most 1 px; alpha from the result,
  at most the line's strength, grey 255), and `cli.ts`. PNG reading and writing is `fast-png` (6.4.0, MIT), added to
  `scripts/seed`'s `devDependencies`. It is already in `package-lock.json` as a dependency of
  `jspdf`, so the lockfile gains no new package. Its encoder writes `tEXt` chunks and its decoder
  reads them back.
- `npm run stone-lines --workspace @queuepass/seed -- <keycloak-bg.png>` writes
  `keycloak/themes/queuepass/login/resources/img/stone-lines.png`. The input path is resolved
  against `INIT_CWD` (the folder npm was run from, not the workspace folder); the output path is
  resolved against the repository root. The command refuses an input whose SHA-256 is not the
  recorded one (R1), so the lines always match the image Keycloak serves.
- `--check` regenerates in memory and compares with the committed file: identical decoded pixels
  (size, channels, every byte of pixel data) and the same text chunks; it exits non-zero and says
  what differs otherwise. That is what "the same result" means (FR-010, SC-004). It compares the
  decoded image rather than the file's bytes because the question is what the image is, not how it
  is compressed: a later `fast-png` (or `pako`, its pure-JavaScript zlib) may compress the same
  pixels differently, and that is not a different image. Byte equality is still tested within one
  process: two runs of the encoder in the same test give the same bytes.
- One `tEXt` chunk, `Source`, records the input's file name, Keycloak version (26.0.8), and SHA-256,
  and the generator's settings. No license text in the PNG.
- The source file is taken from the running Keycloak (`curl` the URL of R1, with the `{version}` the
  sign-in page's stylesheet links show) or from the jar; quickstart S7 gives the commands.
- `MIN_STEP`, the widening, the softening, and the line's strength are chosen in implementation
  from previews of all three apps' lines, and Mahdi approves the preview before the file is
  committed (tasks T010). The values are recorded in `lines.ts` and in the `Source` chunk. Chosen
  (T010): `MIN_STEP` 1 (at 2 or more, visible stone edges lose their lines), no widening (2 px), a
  1 px softened edge at 50%, and strength 160 of 255 (about 63%), the "dim" preview.
- License (FR-010): `keycloak/themes/queuepass/LICENSE-keycloak.txt` is the Apache License 2.0 text
  as Keycloak ships it (`/opt/keycloak/LICENSE.txt` in the image), and
  `keycloak/themes/queuepass/NOTICE` names `login/resources/img/stone-lines.png` as derived from
  Keycloak's `keycloak-bg.png` (Keycloak 26.0.8, its SHA-256), the copyright holder (Red Hat, Inc.
  and/or its affiliates, as in Keycloak's sources), the license, and the change ("reduced to the
  edges between the stones, as an alpha mask").

**Rationale**: Constitution, Language and Stack: TypeScript everywhere, tests included, so not a
Python script. `scripts/seed` is the workspace that already owns Keycloak's configuration and the
sign-in look's tests (`021` plan, Structure Decision), and its coverage floor (Constitution VI) then
covers the generator. A PNG library already in the lockfile is less code to write, test, and keep
than a hand-written PNG reader and writer (Principle VIII). The license belongs in the two text
files beside the theme, where a reader looks for it; a PNG chunk is easy to strip and hard to read.

**Alternatives considered**:

- A hand-written PNG reader and writer on `node:zlib`: no new direct dependency, but about a
  hundred lines of codec and its filter tests for a one-off tool.
- Generate at image build time in `keycloak/Dockerfile`: needs Node and the source image inside a
  build stage, on every build, for a file that never changes; and CI's tests could not see the result.
- A Python script: outside the fixed stack.
- Other image libraries (`sharp`, `pngjs`): new packages in the lockfile.

## R4. The layers, and how they line up

**Decision**: `template.ftl` gains one decorative element, the first child of `<body>`:
`<div class="qp-stones" aria-hidden="true"></div>`. In `login.css`:

- `.qp-stones`: `position: fixed; inset: 0; z-index: -1;` with the stones as its background
  (`url(../../keycloak/img/keycloak-bg.png) center / cover no-repeat`).
- `.qp-stones::before` (the lines): `content: ''`, the same box (`position: absolute; inset: 0`),
  `background: var(--stone-accent)`, `mask: url(../img/stone-lines.png) center / cover no-repeat`.
- `.qp-stones::after` (the shade, R5): `content: ''`, the same box, above the lines.
- `body`: `background: var(--stone-base)` (a plain stone grey, R6), under all three: what shows when
  the stones image is missing (FR-009). The lines and the shade do not depend on the stones image,
  so they are still drawn over the grey.
- No `animation` or `transition` on any of them (FR-013).

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
Safari. A browser without it would draw the accent layer unmasked; to keep that from filling the
window with the accent, the lines layer is declared inside `@supports (mask-image: none)` (spec Edge
Cases: no lines, nothing else changes). **Forced colors**: Chromium keeps `url()` background images
in forced-colors mode while it forces the text to system colors, which could put system-colored
text on the stones; so `@media (forced-colors: active) { .qp-stones { display: none; } }` hides the
whole backdrop there, and the page is the system's colors only.

## R5. The shade and the contrast budget

**Decision**: the shade is `.qp-stones::after` with a horizontal gradient whose fade has a fixed
width:

```css
linear-gradient(to right,
  transparent calc(50% - 400px), var(--stone-scrim) calc(50% - 280px),
  var(--stone-scrim) calc(50% + 280px), transparent calc(50% + 400px))
```

`--stone-scrim` is black at 60%. The shade is at full strength across a centered band 560 px wide
(the form's column is at most 400 px plus 16 px of padding a side, so at most 432 px), fades over
120 px on each side, and is clear beyond 400 px from the center. So **on a window 800 px wide or
wider, the stones and lines beyond the fade are at full strength** (FR-004, US2 AS6); on a narrower
window the fade runs off the edges, and below 560 px the whole width is at full strength. It runs
the window's full height.

**Worst case** (FR-006): the backdrop behind the form, under the full shade, lies between pure
black (the darkest stone) and the lighter of the lightest stone (`#898989`) and the page's line
color at full strength (as if the mask were opaque). The lines are drawn at about 63% (T010),
which only darkens them, so the figures below bound the backdrop from above and every contrast from
below: with the 63% lines the Booth's brightest line under the shade is `#53441d`, and the lowest
figures rise to 9.44 (text), 6.40 (muted text and field edges), 6.52 (danger), and 3.74 / 5.34 /
5.65 (Admin / Tickets / Booth rings). The lines are the lighter accents in both schemes
(`#8b85f5`, `#2dd4bf`, `#fbbf24`; Clarifications, decision b), so the backdrop, and every figure
below, is the same in both schemes. Under 60% black, the lightest stone is `#373737`; the brightest
line is the Booth's amber, `#644c0e`. The fallback grey `--stone-base` (`#3a3a3a`) under the shade is
`#171717`.

**Colors drawn on the backdrop** (R6) and their lowest contrast over all of those backgrounds, in
either scheme, computed with the `012` contrast test's formula (the lower of compositing in exact
values and in rounded 8-bit values, which differ by at most 0.05):

| What | Token | Value | Lowest (app) | Target |
| --- | --- | --- | --- | --- |
| Heading, labels, page text, links | `--stone-text` | `#ffffff` | 8.08 (Booth) | 4.5 |
| Audience line, required-fields note | `--stone-text-muted` | `#d0d5dd` | 5.48 (Booth) | 4.5 |
| Wrong-password message, the `*` | `--stone-danger` | `#fecaca` | 5.59 (Booth) | 4.5 |
| Lines and focus rings (Admin / Tickets / Booth) | `--stone-accent`, `-tickets`, `-booth` | `#8b85f5` / `#2dd4bf` / `#fbbf24` | 3.65 / 4.64 / 4.84 | 3 (rings) |
| Text field edge | `--stone-text-muted` | `#d0d5dd` | 5.48 (Booth) | 3 |
| Text field fill (light scheme) | shared `--surface` | `#ffffff` | 8.08 (Booth) | 3 |

The text inside the fields, the buttons, and the notices is on their own fills, which `021` and
`012`'s contrast tests already cover in both schemes. A button is identified by its text, so its
fill needs no contrast with the backdrop (WCAG 1.4.11); a text field has no text until typed in, so
its edge does. Every control's focus ring (each text field, Show, Sign In, each link) is drawn in
the app's `--stone-accent` (R7).

Why these numbers:

- **60%** is the lightest shade at which every row passes. At 50%, the Booth's muted text falls to
  3.99–4.02 and the Admin ring to 2.88–2.91. A darker shade passes too but hides the stones behind
  the form: at 78%, the lightest stone behind the form is `#1e1e1e`.
- **The lighter accents, for the rings and the lines**: the light scheme's accents against the
  lightest backdrop (`#373737`) are 1.89 (indigo), 2.17 (teal), and 2.37 (amber), under 3:1, and as
  lines they barely show on the near-black stones. So neither the rings nor the lines use them; the
  light scheme's accent stays on the Sign In button, which sits on its own fill.
- **The field edge** needs a backdrop color: in the dark scheme, neither the shared `--border-strong`
  (`#6f7887`) nor the field's fill (`#171a21`) reaches 3:1 next to a line under the shade (as low as
  2.01:1 next to a Tickets line). The muted text color passes as an edge with room to spare, so it
  serves for both (no separate edge token).

**Rationale**: FR-004 allows a shade with no edge and asks for the stones at full strength beside
the form; a band at full strength only where text can be, with a fade of fixed width, keeps the
most of the stones visible on wide windows. Every point text can sit on is inside the full-strength
band at every width (the column is centered and at most 432 px wide), so the table holds everywhere
(SC-002), and the browser test (R8) checks the rendered pages rather than trusting the arithmetic.

**Alternatives considered**:

- **One even shade over the whole window**: simpler, but it dims the stones and lines everywhere.
- **A fade from the band to the window's edges** (the first draft): on a wide window the shade
  reaches nearly to the edges, so the stones are never at full strength beside the form.
- **A text shadow or glow instead of a shade**: contrast for shadowed text is not measurable against
  WCAG's rule, and the fields would still need a backdrop.
- **The shade between the stones and the lines** (lines on top at full strength): a bright line
  crossing white text is 1.7:1 (Booth).

## R6. The backdrop colors are shared-theme tokens

**Decision**: `packages/shared/src/web/theme.css` gains, in both token blocks with the same values
(as `014`'s `--scrim` and `--scrim-text`, "dark in both sets"):

| Token | Value | Use |
| --- | --- | --- |
| `--stone-base` | `#3a3a3a` | The page color under the stones (FR-009) |
| `--stone-scrim` | `rgb(0 0 0 / 60%)` | The shade behind the form's column (R5) |
| `--stone-text` | `#ffffff` | Text on the backdrop |
| `--stone-text-muted` | `#d0d5dd` | The audience line, the required-fields note, text field edges |
| `--stone-danger` | `#fecaca` | The wrong-password message and the required `*` |
| `--stone-accent` | `#8b85f5` | The lines and the focus rings: the shared accent's lighter shade |
| `--stone-accent-tickets` | `#2dd4bf` | The same for the Customer app |
| `--stone-accent-booth` | `#fbbf24` | The same for the Ticket Booth app |

The per-app rules in `login.css` gain a seventh role:
`.qp-app--customer-app { …; --stone-accent: var(--stone-accent-tickets); }` and the same for
`booth-app`. The `021` drift exception (`check-theme.ts`, `SIGN_IN_ROLES`) gains the role
`--stone-accent` → `--stone-accent-<app>`; one app per rule, and the theme must define all seven of
that app's tokens. Nothing else in the exception changes. The lines are filled with
`var(--stone-accent)`, so they follow the app through that seventh role and are the same in both
schemes (FR-003, FR-007).

**Rationale**: Constitution VII keeps every color in the shared theme's token blocks and under its
contrast tests; the sign-in look already works this way (`021` research R4). The values are the
same in both blocks because the backdrop is dark in both schemes (FR-007). The three accent shades
equal the dark scheme's `--accent`, `--accent-tickets`, and `--accent-booth` today, but they are a
separate role: a later change to the dark scheme's accents should not silently move the lines and
rings on the stones, whose contrast test is separate. The field edge shares the muted text color
(review finding 14): one token fewer, and the edge still clears 3:1 with room.

**Alternatives considered**: writing the colors in `login.css` (the drift test forbids it, rightly);
reusing the dark scheme's tokens by forcing the dark scheme on the sign-in pages (the dark set lives
in a media query on `:root`, so it would have to be duplicated, and the controls would stop following
the scheme, which `021` FR-012 and FR-007 here keep); the lines in `var(--accent)` (the first draft:
the backdrop would differ between schemes, against FR-007, and the light scheme's lines would barely
show).

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
  - Text fields: `#kc-form-login input:not(:focus):not(:hover)` take
    `border-color: var(--stone-text-muted)`; the shared hover state is left as it is.
  - Focus indicators, every control on the backdrop:
    - `#kc-form-login input:focus-visible { outline: 3px solid var(--stone-accent); outline-offset:
      2px; }`. The shared `input:focus` rule removes the outline and shows the focus as an accent
      edge and a soft glow on the field's own fill; that edge is fine against the fill, but nothing
      in it is measured against the stones, so the fields get the same ring as every other control.
    - `:focus-visible { outline-color: var(--stone-accent); }` for the Show button, the Sign In
      button (`021`'s `#kc-login:focus-visible` rule), and links: 3 px, offset 2 px, as the shared
      rule.
  - The `.qp-banner--info` rule and the notices' own colors are unchanged.
- Nothing in `theme.properties` changes: `styles=css/theme.css css/login.css` already loads both.

**Rationale**: the issue's "keep everything `021` added" with the least change to the frame; every
text and ring that sits on the backdrop gets a backdrop color (R6), and nothing that sits on its own
fill changes. `login.css` is the sign-in look's own stylesheet, so restyling the label and field
colors there does not touch the apps (FR-012).

## R8. Tests

**Decision**:

- **Shared** (CI, `packages/shared/test/theme/`):
  - `tokens.test.ts`: the eight tokens, with R6's values, in both blocks; used by no rule in
    `theme.css` outside the token blocks.
  - `contrast.test.ts`, "the sign-in backdrop (spec 027)": the backdrop colors over R5's worst cases,
    computed from the theme: for each app, the backgrounds are black, the lightest stone, the app's
    `--stone-accent[-<app>]` (the line color), and `--stone-base`, each under `--stone-scrim`;
    `--stone-text`, `--stone-text-muted`, and `--stone-danger` at 4.5:1 or more; the app's
    `--stone-accent[-<app>]` (rings) and `--stone-text-muted` (field edges) at 3:1 or more; the light
    scheme's `--surface` (the field fill) at 3:1 or more. The tokens are the same in both blocks, so
    one pass covers both schemes, plus an assertion that they are the same. The image's lightest and
    darkest greys (`#898989`, `#000000`) are constants in the test, citing R2; the live and browser
    tests (below) keep them true by checking the image's SHA-256.
  - `drift.test.ts`: `login.css` still passes with `signInAccents`; new checker cases: the seventh
    role allowed only with all seven of one app's tokens defined; `--stone-accent: var(--accent-booth)`
    and a rule mixing apps still fail. A new check that no app stylesheet (Admin, Customer, Booth) uses
    `--stone-` or the per-app accent tokens (FR-012).
- **Seed, theme files** (CI, `scripts/seed/test/login-theme-files.test.ts`): `login.css` loads
  `../../keycloak/img/keycloak-bg.png` and `../img/stone-lines.png`, has the forced-colors rule of
  R4, and no `animation` or `transition` in any `.qp-stones` rule (FR-013); `template.ftl` has
  `<div class="qp-stones" aria-hidden="true">` as `<body>`'s first child and no `card` class;
  `stone-lines.png` (decoded with `fast-png`) is 1920×1080 grey and alpha, grey 255 wherever its
  alpha is not 0, with alpha above 0 on between 2% and 15% of pixels, and a `Source` chunk naming
  the source SHA-256; `NOTICE` and `LICENSE-keycloak.txt` exist and say what R3 says; no file under
  `keycloak/` has the stones image's SHA-256 (FR-002, SC-004).
- **Seed, the generator** (CI, `scripts/seed/test/stone-lines.test.ts`): on small made-up images,
  two flat facets with an anti-aliased seam give one continuous line along the seam; facets closer
  than `MIN_STEP` give none; two encodes in one process give the same bytes; `--check` passes on its
  own output and fails, naming the difference, on an image with one pixel changed or another
  `Source` chunk; an input with another SHA-256 is refused; paths resolve against `INIT_CWD` and the
  repository root.
- **Seed, live Keycloak** (`scripts/seed/test/sign-in-screens.test.ts`, skipped with its reason
  without Keycloak, as `021`): for each client and for the account console and the no-client page,
  the page has the `.qp-stones` element; from the page's `login.css` link, the stones image's URL
  answers `200 image/png` with the recorded SHA-256 (FR-010), and the lines image's URL answers
  `200 image/png`.
- **Browser tests** (`e2e/tests/027-sign-in-background.spec.ts`, the CI `e2e` job, against the
  Compose stack, so with the real Keycloak):
  - `027 S1: …`: for each app, the `.qp-stones` element's computed `background-image` is Keycloak's
    image; fetching that URL in the page gives the recorded SHA-256 (`crypto.subtle.digest`), since
    the Dockerfile's `26.0` tag floats and CI builds whatever it points at (FR-010); an `Image()` of
    it has `naturalWidth` 1920; the `::before` layer's computed `background-color` equals the
    computed `color` of a probe element styled `color: var(--stone-accent)` in the same page (so the
    comparison is between two resolved colors, not token strings), in both schemes; its `mask-image`
    names `stone-lines.png`; no `.card` in the page.
  - `027 S3: …`: one test (the quickstart check allows one titled test per scenario row), with
    `test.setTimeout(10 * 60_000)` and a `test.step` per app, scheme, and size. It visits 60 page
    states (3 apps × 2 schemes × 5 sizes × 2 pages), about 3–5 s each, so it should take about 5
    minutes on one of CI's two e2e workers, while the other worker runs the rest of the suite. For each app, light and dark
    (`page.emulateMedia`), at 360×800, 768×1024, 1280×800, 1920×1080, and 2560×1440, on the first page
    and after a wrong password:
    - record each visible text element's box and computed color (scrolled into view first, since at
      360×800 the form can be taller than the window), each text field's box and edge color (and fill
      in the light scheme), and each control's focus ring: Tab through every control (username,
      password, Show, Sign In, and each link) and record its box and computed `outline-color`;
    - hide the page's content (`visibility: hidden` on `main` and the band, and nothing else) and
      screenshot the window at that scroll position: that is the backdrop alone; decode it in a blank
      page (`createImageBitmap` and a canvas, so the test needs no image library);
    - text: 4.5:1 or more against the lightest and darkest backdrop pixel in its box; field edges:
      3:1 or more against the lightest and darkest pixel in a 3 px ring around the box; focus rings:
      3:1 or more against the lightest and darkest pixel where the ring is drawn (2–5 px outside the
      box) and next to it (5–8 px outside);
    - at 360 px, `scrollWidth <= innerWidth`;
    - at 1920×1080, the full-strength-beyond-the-fade check (FR-004): screenshot the backdrop again
      with the shade hidden (an injected `.qp-stones::after { display: none }`); the pixels more than
      400 px left and right of the center are the same in both screenshots, and at the center they
      differ.
  - `027 S6: …`: the same checks as S3 at 360×800 and 1920×1080, light and dark, with the stones image
    request aborted (`page.route`), for the Ticket Booth app (its lines are the brightest); the lines
    and the shade are still drawn over `--stone-base` (SC-005). Its own `test.setTimeout(3 * 60_000)`
    (8 page states).
  - **The e2e job's time**: on `main` it takes 6 min 10 s (run 41520953833). With S3 and S6 it should
    stay under about 15 minutes, well inside the job's `timeout-minutes: 30` and spec `022` SC-003;
    the implementation measures it (tasks T026).
- **Running system**: [quickstart.md](./quickstart.md): the look by eye, telling the apps apart, the
  keyboard and a screen reader, and the generator's output checked with `--check`.

**Rationale**: everything that can be computed from files runs in CI's `test` job; the rendered
backdrop is measured in the `e2e` job, which has Keycloak; the live seed test catches a changed
image locally, and S1 catches it in CI. The browser test measures what a person sees, so a mistake
in R5's arithmetic or a layout that moves text out of the shaded band fails it.

**Alternatives considered**: measuring only from tokens (misses layout and the real image); a
screenshot comparison (brittle across fonts and Chromium versions, and says nothing about contrast);
one test per app and scheme for S3 (the quickstart check needs every browser test to have its own
Automated row, and a scenario has exactly one row).

## R9. Constitution 3.7.0 (MINOR): Principle VII allows Keycloak's stone background on the sign-in screens

**Decision**: amend Principle VII's sign-in exception in this spec PR. Today it allows the sign-in
screens each app's name, an audience line, and its own accent, and nothing more; "decoration" is out
of scope. Added to that paragraph: "They MAY also show Keycloak's stock low-poly background, served
from Keycloak's own theme, with the lines between the stones in the app's accent (spec `027`). That
background is the only decoration allowed, and every text, label, and control on it MUST keep the
contrast its spec states." The tokens sentence becomes: "Those accents, and the colors the sign-in
screens draw on that background, are tokens in the shared theme, defined only in its token blocks
and checked by its contrast tests. The apps themselves keep the one shared accent and use none of
them." The paragraph's opening becomes "The one exception to "no per-app variants" and to "no
decoration": …", since it now makes both. The roadmap gains row `027-sign-in-background` (#122, depends on `021`); the next free number
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
