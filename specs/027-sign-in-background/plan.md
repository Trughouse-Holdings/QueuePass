# Implementation Plan: Sign-in Background

**Branch**: `027-sign-in-background-spec` | **Date**: 2026-11-02 | **Spec**: [spec.md](./spec.md) |
**Issue**: [#122](https://github.com/Trughouse-Holdings/QueuePass/issues/122)

**Input**: Feature specification from `specs/027-sign-in-background/spec.md`

## Summary

- **Keycloak's own stones image** (research R1): `login.css` loads it from Keycloak's stock
  `keycloak` theme with `url(../../keycloak/img/keycloak-bg.png)`, which Keycloak serves beside our
  theme's resources (verified on Keycloak 26.0.8). No copy in the repository.
- **The lines between the stones in the app's accent** (R2, R3): a lines image
  (`keycloak/themes/queuepass/login/resources/img/stone-lines.png`, white with alpha on the edges
  between the stones), derived once from Keycloak's image by a TypeScript generator in
  `scripts/seed` that finds the image's flat facets and draws their boundaries, reading and writing
  PNG with `fast-png` (already in the lockfile). The page fills a layer with the app's lighter accent
  (`var(--stone-accent)`, the same in both schemes) and shows it through that image (`mask`). A
  `NOTICE` and `LICENSE-keycloak.txt` beside the theme carry Keycloak's Apache 2.0 license; a
  `--check` mode proves the committed image is what the generator makes (same pixels and metadata).
- **Layers** (R4): one fixed, `aria-hidden` element behind the page holds the stones, the lines
  (`::before`), and the shade (`::after`), all `center / cover` on the same box, so the lines stay on
  the edges at every size; the page color under them is a plain stone grey for when the image is
  missing; in forced-colors mode the backdrop is hidden.
- **Readable on the stones** (R5): a shade (black at 60%) across a 560 px band behind the header and
  the card, fading out over 120 px on each side, so from 800 px wide the stones beyond it are at full
  strength; the realm header, the only text on the stones, in light text meeting 4.5:1 over the
  lightest stone and the brightest line, the same in both schemes. Everything else is on the card.
- **Tokens** (R6): six `--stone-*` tokens in both of the shared theme's token blocks, the same in
  both (eight until the card came back); the `021` drift exception gains one role, `--stone-accent`.
- **Keycloak's card and header** (R7; Mahdi reversed the first "no card" in implementation, spec
  Clarifications): `template.ftl` gains the backdrop element, the realm header ("QUEUEPASS", as
  Keycloak's `#kc-header-wrapper`, decoration), and keeps `021`'s frame on a card modelled on
  Keycloak's `.card-pf` (at most 500 px wide, a 4 px top edge in the app's accent), styled from the
  shared theme so it follows the scheme. Band, brand mark, heading, audience line, banners, and form
  unchanged.
- **Constitution 3.7.0** (R9): Principle VII's sign-in exception allows Keycloak's stock background
  with the app's accent between the stones; roadmap row `027`. In this spec PR.
- **No API change, no database change, no seed change** (contracts/README.md, data-model.md). The
  realm already uses the `queuepass` login theme (`021`); a rebuilt Keycloak image carries the new
  files.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node.js 22 LTS for the generator and tests;
FreeMarker, CSS, and properties files for the Keycloak theme.

**Primary Dependencies**: Keycloak 26.0 (unchanged); `fast-png` 6.4.0 (MIT) as a `devDependency` of
`scripts/seed` for the generator's PNG reading and writing. It is already in `package-lock.json` (a
dependency of `jspdf`), so no new package enters the lockfile.

**Storage**: none. Files in the repository (data-model.md).

**Testing**: Vitest in `packages/shared` (tokens, contrast of the backdrop colors, drift with the
seventh role) and `scripts/seed` (theme files and the lines image; the generator; live sign-in pages
with Keycloak up, skipped with its reason otherwise); Playwright in `e2e/` (the rendered backdrop's
contrast at five window sizes, both schemes, the image blocked). Real browsers in
[quickstart.md](./quickstart.md).

**Target Platform**: the Docker Compose stack; the sign-in pages in current Chrome, Edge, Firefox,
and Safari, desktop and phone, light and dark schemes.

**Project Type**: web application (one Backend, three front ends, Keycloak, a seed job).

**Performance Goals**: none beyond today: the sign-in page loads two images (Keycloak's 82 KB stones
and the lines image, about 70–100 KB). Both are cacheable in production; Keycloak's `start-dev`, which
the Compose stack runs, sends `Cache-Control: no-cache`, so the browser revalidates them there.

**Constraints**: Constitution VII as amended (colors only in the shared theme's token blocks; the
background only on the sign-in screens), Constitution II (no manual step), Keycloak's image not
copied, WCAG 2.1 AA (spec FR-006).

**Scale/Scope**: one template, one stylesheet, one derived image and its notice, one generator,
eight tokens, about fifteen files.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Result |
| --- | --- | --- |
| I. API-only boundary, contract first | No API change | Pass (n/a) |
| II. One command, reproducible | Files in the Keycloak image via the existing `COPY`; `docker compose up --build` from a clean clone; the generator's output is committed, and `--check` confirms it gives the same pixels and metadata (R3) | Pass |
| III. Spec-driven, reviewed | Spec + plan PR first, independent review before it opens; impl in a fresh session | Pass |
| IV. Server-authoritative rules | No domain rule involved | Pass (n/a) |
| V. Sign-in everywhere | Sign-in stays on Keycloak's page; same form, same flow (spec FR-005) | Pass |
| VI. Test-first, real database | Tests first for tokens, contrast, drift, theme files, the generator; live Keycloak test; browser test in the `e2e` job; the generator counts toward `scripts/seed`'s coverage | Pass |
| VII. Function over finish, one shared look | **Needs amendment**: a background is decoration. Amended to 3.7.0 in this PR (R9); colors stay in the shared theme's token blocks, contrast is a stated, tested target, and the apps are untouched | Pass after amendment |
| VIII. Staged simplicity | One image derived once; no runtime work; no animation; no per-app images | Pass |

Re-check after design: unchanged. The amendment is the only deviation and is made, not worked
around.

## Project Structure

### Documentation (this feature)

```text
specs/027-sign-in-background/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R9
├── data-model.md        # tokens, theme files, the lines image
├── quickstart.md        # S0–S8, the running-system gate
├── contracts/README.md  # no API change
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
keycloak/themes/queuepass/
├── NOTICE                                       # NEW: the lines image's source and license (R3)
├── LICENSE-keycloak.txt                         # NEW: Apache License 2.0, as Keycloak ships it (R3)
└── login/
    ├── template.ftl                             # .qp-stones; realm header; Keycloak's card (R4, R7)
    └── resources/
        ├── css/login.css                        # layers, shade, header, card, 7th role (R4–R7)
        └── img/stone-lines.png                  # NEW: generated (R2, R3)
packages/shared/src/web/theme.css                # eight --stone-* tokens in both blocks (R6)
packages/shared/test/theme/
├── check-theme.ts                               # SIGN_IN_ROLES gains --stone-accent (R6)
├── drift.test.ts                                # seventh-role cases; apps use no --stone-* (R8)
├── contrast.test.ts                             # the sign-in backdrop (R5, R8)
└── tokens.test.ts                               # the eight tokens (R6, R8)
scripts/seed/
├── package.json                                 # "stone-lines" script; fast-png devDependency (R3)
├── src/stone-lines/
│   ├── facets.ts                                # NEW: flat regions (R3)
│   ├── lines.ts                                 # NEW: facet boundaries → alpha (R3)
│   └── cli.ts                                   # NEW: SHA check, write or --check (R3)
└── test/
    ├── stone-lines.test.ts                      # NEW: the generator (R8)
    ├── login-theme-files.test.ts                # backdrop, lines image, notice, no copy (R8)
    └── sign-in-screens.test.ts                  # live: images served, SHA-256 (R8)
e2e/tests/027-sign-in-background.spec.ts         # NEW: S1, S3, S6 (R8)
package-lock.json                                # the seed workspace lists fast-png; no new package (R3)
.specify/memory/constitution.md                  # 3.7.0, Principle VII, roadmap 027 (R9) — this spec PR
README.md                                        # version reference; 027 status row; the generator
```

`keycloak/Dockerfile`, `theme.properties`, `login.ftl`, `messages_en.properties`, the seed's
provisioning, `docker-compose.yml`, and the apps are not changed. The existing
`COPY keycloak/themes/queuepass …` puts the new files in the image.

**Structure Decision**: the existing monorepo. The generator lives in `scripts/seed`, the workspace
that already owns Keycloak's configuration and the sign-in look's tests (`021`), so its tests run in
`npm test` and count toward that workspace's coverage. The lines image lives with the theme it is
drawn by.

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| Constitution VII amended (a background on the sign-in screens) | Issue #122 asks for Keycloak's stone background with the app's accent between the stones; Principle VII rules out decoration | No amendment: the code would contradict the principle's words |
| A generated image, its generator in `scripts/seed`, and `fast-png` as a seed `devDependency` | Only the lines may be colored, and CSS cannot find an image's edges (R2) | Tinting the whole image (not chosen by Mahdi); three colored copies (copies Keycloak's image, colors outside the theme); a hand-written PNG codec on `node:zlib` (more code and tests to keep than a library already in the lockfile, Principle VIII) |
| A shade behind the form | White text on the lightest stone is 3.5:1, and on a bright line 1.7:1 (R5) | A text shadow is not measurable against WCAG; an even shade over the whole window dims every line |
| Six new tokens and a seventh drift role | Every color stays in the shared theme and under its tests (Constitution VII, R6) | Colors in `login.css` (fails the drift test); forcing the dark scheme (the controls would stop following the scheme) |
