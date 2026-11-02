---
description: "Task list for Sign-in Background"
---

# Tasks: Sign-in Background

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R9),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) (no API change),
[quickstart.md](./quickstart.md) (S0–S8)

**Issue**: [#122](https://github.com/Trughouse-Holdings/QueuePass/issues/122). The implementation
PR's **description** says `fixes #122` on its own line. No commit message on either branch may
contain "fixes #122", "closes #122", or "resolves #122".

**Tests**: **REQUIRED and written first** (Constitution VI). In each phase, write the test tasks and
confirm they **fail** before the implementation tasks below them.

## Ground rules

- **Fresh session** (Constitution III): implement on branch `027-sign-in-background-impl` in a Claude
  session that starts from these files only. While the spec and plan PR is open, cut it from
  `027-sign-in-background-spec` and carry in every change that PR's review makes; once it merges,
  bring it up to `main`. A gap in the spec or plan is fixed there, not worked around in code.
- **Commits** cite the spec, the task IDs, and the issue: `Impl 027: backdrop tokens (T003, T007,
  #122)`.
- **One independent review** (Constitution III) of the implementation branch before its PR (T027).
- **`npm run ci` locally** before pushing (T028), then **CI green on GitHub**, the `test` and `e2e`
  checks, before merge (T031).
- **Docker**: the Keycloak image is rebuilt by `docker compose up --build`; no other service changes.
  Do not stop or change another session's running stack: use your own Compose project name (`-p`).
- **Keycloak's image stays out of the repository** (FR-002): keep the downloaded `keycloak-bg.png`
  in a scratch folder outside the working tree, never in a commit.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US4 from spec.md

---

## Phase 1: Setup

- [ ] T001 Cut `027-sign-in-background-impl` from `027-sign-in-background-spec` (or from `main` once
  the spec PR has merged); `npm ci`; `npm run ci` green before any change, so a later failure is this
  feature's.
- [ ] T002 Start Keycloak from this branch (`docker compose -p qp027 up --build keycloak seed`) and
  fetch Keycloak's image as quickstart S7 step 1 into a folder outside the repository. Confirm its
  SHA-256 is `0825175291be11f7689e8718295e422bb6fa4f8fefccc5610292b720c701ac4e` and that it is the
  1920×1080 grey image of research R1, R2. A different SHA-256 means Keycloak's image changed: stop
  and fix R1–R3 first.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the backdrop tokens, the drift exception's seventh role, and the lines image.

### Tests first

- [ ] T003 [P] `packages/shared/test/theme/tokens.test.ts`: the eight `--stone-*` tokens of research
  R6 with those exact values in the light block and in the dark block (the same in both); none of
  them used by any rule in `theme.css` outside the token blocks (as `021`'s accents). Must fail.
- [ ] T004 [P] `packages/shared/test/theme/contrast.test.ts`, a new `describe` "the sign-in backdrop
  (spec 027)": the image's lightest and darkest greys as constants (`#898989`, `#000000`, citing
  research R2); a helper that composites `--stone-scrim` (`rgb(r g b / a%)`, as the existing scrim
  helper) over a `#rrggbb`. The `--stone-*` tokens are the same in both blocks (asserted), so one pass
  covers both schemes. For each app (`admin` uses `--stone-accent`, `tickets` and `booth`
  `--stone-accent-<app>`), the backgrounds are black, the lightest grey, the app's line color (its
  `--stone-accent[-<app>]`), and `--stone-base`, each under the shade; expect `--stone-text`,
  `--stone-text-muted`, `--stone-danger` at 4.5:1 or more against every one; the app's
  `--stone-accent[-<app>]` (rings) and `--stone-text-muted` (field edges) at 3:1 or more; the light
  scheme's `--surface` (the field fill) at 3:1 or more (R5). Must fail (no tokens yet).
- [ ] T005 [P] `packages/shared/test/theme/drift.test.ts`: checker cases in "the checker, sign-in
  accent mapping": `--stone-accent: var(--stone-accent-booth)` allowed inside `.qp-app--booth-app`
  beside the six roles; `--stone-accent: var(--accent-booth)`, `--stone-accent: var(--stone-accent-nope)`,
  and a rule whose `--stone-accent` names another app than its other roles each reported; a new test
  that no stylesheet of the Admin, Customer, or Ticket Booth app (the files the drift test already
  scans) contains `--stone-` or `--accent-tickets`/`--accent-booth`/`--brand-mark-*-tickets|booth`
  (FR-012). Must fail on the allowed case.
- [ ] T006 [P] `scripts/seed/test/stone-lines.test.ts` (research R3, R8), images made in the test
  and read and written with `fast-png`: two flat facets with a one-pixel anti-aliased seam give one
  continuous line along the seam (no gap anywhere along it); two facets closer than `MIN_STEP` give
  none; the output is grey 255 wherever alpha is above 0; two encodes in one process give the same
  bytes; `--check` passes on the generator's own output and fails, naming what differs, on an image
  with one pixel changed and on one with another `Source` chunk; `cli.ts` refuses an input whose
  SHA-256 is not the recorded one, naming the one it expected; the input path resolves against
  `INIT_CWD` and the output against the repository root. The CLI tests write only into a temporary
  folder (an output path the test passes in) or check how a path resolves without writing; no test
  ever writes to, or overwrites, the committed `stone-lines.png`. Must fail (no generator yet).

### Implementation

- [ ] T007 `packages/shared/src/web/theme.css`: the eight tokens in both token blocks with a comment
  citing spec 027 and Constitution VII's sign-in exception (R6). T003 and T004 pass.
- [ ] T008 `packages/shared/test/theme/check-theme.ts`: `SIGN_IN_ROLES` gains `'--stone-accent':
  '--stone-accent-<app>'`; the header comment names spec 027. T005 passes; `login.css` as it is still
  passes the drift test.
- [ ] T009 `scripts/seed/src/stone-lines/` (`facets.ts`, `lines.ts`, `cli.ts`), `fast-png` (6.4.0,
  the version already in `package-lock.json`) in `scripts/seed`'s `devDependencies`, and the
  `stone-lines` script in `scripts/seed/package.json` (R3). `npm install` changes only the workspace's
  entry in `package-lock.json`, no new package (check the diff). The CLI takes a file path, checks the
  SHA-256, and writes `keycloak/themes/queuepass/login/resources/img/stone-lines.png` with the one
  `Source` chunk, or with `--check` compares instead of writing. T006 passes; the workspace stays at or
  above its coverage floor.
- [ ] T010 Run the generator on T002's file with a few `MIN_STEP`, widening, and softening values;
  for each, make previews of the stones with the lines in each app's `--stone-accent` color (scratch
  files, outside the repository) and show them to Mahdi; he picks one. Record the values in
  `lines.ts` and here. Commit `stone-lines.png`, `keycloak/themes/queuepass/NOTICE`, and
  `keycloak/themes/queuepass/LICENSE-keycloak.txt` (the Apache License 2.0 text from
  `/opt/keycloak/LICENSE.txt` in the image) (FR-010). Then `--check` passes on the committed file.

**Checkpoint**: `npm test --workspace @queuepass/shared` and `--workspace @queuepass/seed` green.

---

## Phase 3: User Story 1 - Each app's sign-in shows the stones in its own color (P1) 🎯 MVP

**Goal**: the stones behind every page, the lines in the app's accent, no card.

### Tests first

- [ ] T011 [P] [US1] `scripts/seed/test/login-theme-files.test.ts` (R8): `login.css` contains
  `url(../../keycloak/img/keycloak-bg.png)` and `url(../img/stone-lines.png)`, the lines layer inside
  `@supports (mask-image: none)` and filled with `var(--stone-accent)`, `content: ''` on both
  pseudo-elements, `@media (forced-colors: active)` hiding `.qp-stones`, no `animation` or
  `transition` in any rule whose selector names `.qp-stones` (FR-013), and
  `--stone-accent: var(--stone-accent-tickets)` / `-booth` in the two app rules; `template.ftl` has
  `<div class="qp-stones" aria-hidden="true"></div>` as the first element in `<body>` and no `card`
  class; `stone-lines.png` (decoded with `fast-png`) is 1920×1080 grey and alpha, grey 255 wherever
  alpha is above 0, alpha above 0 on 2%–15% of pixels, with a `Source` chunk naming the source
  SHA-256; `NOTICE` names `stone-lines.png`, `keycloak-bg.png` and its SHA-256, Red Hat, the Apache
  License 2.0, and the change; `LICENSE-keycloak.txt` starts with the Apache License 2.0 heading; no
  file under `keycloak/` has the SHA-256 of Keycloak's image (SC-004). Must fail on the template, the
  stylesheet, and the notice.
- [ ] T012 [P] [US1] `scripts/seed/test/sign-in-screens.test.ts` (live; skipped without Keycloak as
  today): for each client, the account console, and the no-client page, the HTML has the
  `.qp-stones` element and no `card` class; from the page's `login.css` link, resolving
  `../../keycloak/img/keycloak-bg.png` gives `200`, `image/png`, and the recorded SHA-256 (FR-010);
  resolving `../img/stone-lines.png` gives `200`, `image/png`. Must fail against a Keycloak built from
  `main`.
- [ ] T013 [US1] Browser test `e2e/tests/027-sign-in-background.spec.ts`, title `027 S1: each app's
  sign-in page shows the stones with its accent in the lines and no card` (R8): for each app, in
  light and dark: the `.qp-stones` element's computed `background-image` is Keycloak's image;
  fetching that URL in the page gives the recorded SHA-256 (`crypto.subtle.digest`), since the
  Dockerfile's `26.0` tag floats and CI builds whatever it points at; an `Image()` of it has
  `naturalWidth` 1920; the `::before` layer's computed `background-color` equals the computed `color`
  of a probe element styled `color: var(--stone-accent)` added to the page (two resolved colors, not
  token strings), and is the same in both schemes; its `mask-image` names `stone-lines.png`; no
  `.card` in the page; the `<h1>` and the audience line as `021`. Seen to fail against the current
  look, then passing after T015.

### Implementation

- [ ] T014 [US1] `keycloak/themes/queuepass/login/template.ftl` (R4, R7): the `.qp-stones` element
  first in `<body>`; `<div class="card card--padded qp-card">` becomes `<div class="qp-form">`;
  update the header comment (spec 027). Everything else unchanged.
- [ ] T015 [US1] `keycloak/themes/queuepass/login/resources/css/login.css` (R4, R6, R7): `body`
  background `--stone-base`; `.qp-stones` fixed full-window with the stones `center / cover
  no-repeat`; `::before` the lines (`content: ''`, `background: var(--stone-accent)`,
  `mask: url(../img/stone-lines.png) center / cover no-repeat`) inside `@supports (mask-image:
  none)`; `@media (forced-colors: active) { .qp-stones { display: none; } }`; no animation or
  transition; `.qp-form` with the card's width and padding and no surface; the seventh role in the
  two app rules; update the header comment. T011, T012 (after a rebuild), and T013 pass; the drift
  test passes.
- [ ] T016 [US1] Mark S1 `Automated: \`027 S1: …\`; rest Manual: the look checked by eye` in
  quickstart.md's Automation table (`npm test` checks it). Look at the three pages at 1280×800 and
  1920×1080 in both schemes (screenshots kept outside the repository) and record what was seen here.

**Checkpoint**: the three pages show the stones and their lines (the text is not yet readable on
them in the light scheme; US2 fixes it).

---

## Phase 4: User Story 2 - Everything stays readable on the stones (P1)

**Goal**: FR-006 to FR-008 at every size, in both schemes.

### Tests first

- [ ] T017 [US2] In `e2e/tests/027-sign-in-background.spec.ts`, title `027 S3: every text, field edge
  and focus ring on the stones meets its contrast at five window sizes, light and dark` (R8). One
  test, as the quickstart check needs one titled test per scenario row, with
  `test.setTimeout(10 * 60_000)` and a `test.step` per app, scheme, and size: 60 page states at about
  3–5 s each, so about 5 minutes on one of CI's two e2e workers (R8). For each app, scheme
  (`page.emulateMedia({ colorScheme })`), and size (360×800, 768×1024, 1280×800, 1920×1080,
  2560×1440), on the first page and after a wrong password:
  - record the boxes and computed colors of every visible text element outside the fields, buttons,
    and notices (the `<h1>`, the audience line, the `<h2>` when shown, labels, links, the required
    note, `#input-error`), each scrolled into view before it is measured (at 360×800 the form can be
    taller than the window), and of each text field (edge color, and fill in the light scheme);
  - Tab through every control (username, password, Show, Sign In, and each link) and record each one's
    box and computed `outline-color` while focused;
  - hide `main` and `.qp-band` (`visibility: hidden`), screenshot the window at the same scroll
    position, and decode it in a blank page (`createImageBitmap`, canvas): that is the backdrop alone;
  - text 4.5:1 or more against the lightest and darkest pixel in its box; each field edge 3:1 or more
    against the lightest and darkest pixel in a 3 px ring around the box; each focus ring 3:1 or more
    against the lightest and darkest pixel where the ring is drawn (2–5 px outside the box) and next to
    it (5–8 px outside);
  - at 360 px, `scrollWidth <= innerWidth`;
  - at 1920×1080, the shade's fade (FR-004): screenshot the backdrop again with an injected
    `.qp-stones::after { display: none }`; pixels more than 400 px left and right of the center are the
    same in both screenshots, and pixels at the center differ.

  Put the decoding and measuring in `e2e/fixtures/backdrop.ts`. Must fail on the current page (dark
  labels on the stones in the light scheme, no shade).

### Implementation

- [ ] T018 [US2] `login.css`: `.qp-stones::after` (`content: ''`), the shade of R5 with its fixed-width
  fade (`linear-gradient(to right, transparent calc(50% - 400px), var(--stone-scrim) calc(50% -
  280px), var(--stone-scrim) calc(50% + 280px), transparent calc(50% + 400px))`), above the lines.
- [ ] T019 [US2] `login.css` (R7): `body` text `--stone-text`; `.qp-audience` and `.qp-required` in
  `--stone-text-muted`; `.qp-field-error` and `.qp-required .required` in `--stone-danger`;
  `#kc-form-login label` and the attempted username in `--stone-text`; `a:not(.banner a)` in
  `--stone-text`, underlined. Notices and links inside them unchanged.
- [ ] T020 [US2] `login.css` (R7): text fields' edge `--stone-text-muted` when neither hovered nor
  focused (the shared hover state untouched); `#kc-form-login input:focus-visible { outline: 3px solid
  var(--stone-accent); outline-offset: 2px; }`; `:focus-visible` rings in `--stone-accent` on every
  other control and link on the backdrop, `021`'s `#kc-login:focus-visible` included, width and offset
  unchanged. T017 passes, three runs in a row (`npm run e2e -- --grep "027 S3"`).
- [ ] T021 [US2] Mark S3 Automated in the Automation table (rest Manual: zoom and forced colors).
  Then, in a browser, each app at 360 px and at 200% and 400% zoom (on a 1440 px window), both
  schemes, keyboard only, and with forced colors emulated (quickstart S3, S5): focus starts in the
  username field, Tab order username → password → Show → Sign In, every ring visible, Enter submits;
  no backdrop in forced colors; fix `login.css` for anything that fails and record what was checked
  here.

---

## Phase 5: User Story 3 - Every sign-in page has the stones (P1)

- [ ] T022 [US3] In a browser on the `qp027` stack, reach every page of quickstart S4 (wrong
  password, sign out and back in, the account console, an expired or broken sign-in URL, Keycloak's
  logout confirmation if shown) for each app: each has the stones, the right lines, and readable
  text; Keycloak's admin console is unchanged. Fix the template or the stylesheet for any that does
  not, with a case added to T012's live test for it first. Record each page checked here.

---

## Phase 6: User Story 4 and the fallback (P2)

- [ ] T023 [US4] In `e2e/tests/027-sign-in-background.spec.ts`, title `027 S6: with the stones image
  blocked, the sign-in page stays readable` (FR-009, SC-005): `page.route` aborts requests for
  `keycloak-bg.png`; the T017 checks (contrast, not the fade) at 360×800 and 1920×1080, light and
  dark, for the Ticket Booth app (its lines are the brightest); the lines and the shade are still
  drawn over `--stone-base`. Its own `test.setTimeout(3 * 60_000)` (8 page states). See it fail by
  pointing `body`'s background at the shared `--bg` for a moment, then restore `--stone-base`.
- [ ] T024 [US4] Mark S6 Automated in the Automation table. Quickstart S7 by hand: `--check` on
  T002's file passes; another PNG is refused; the notice reads right. Record it here.

---

## Phase 7: Polish, review, pull request

- [ ] T025 README: the `027` status row (status and task count), a sentence in **Today** (the sign-in
  pages show Keycloak's stones with each app's color between them), a note under the shared look that
  the sign-in look's backdrop colors are `--stone-*` tokens, and the `stone-lines` command beside the
  Keycloak rebuild note; the constitution reference already reads v3.7.0.
- [ ] T026 Run `npm run e2e` three times in a row, all green, and `npm test` under a second time zone
  (`npm run test:tz`); record the counts, and the e2e job's time on GitHub for this branch: it must
  stay under about 15 minutes (on `main` it is 6 min 10 s, run 41520953833), well inside the job's
  `timeout-minutes: 30` and spec `022` SC-003 (R8). Record `027 S3`'s and `027 S6`'s own times too.
- [ ] T027 Independent review by a separate Claude session (Constitution III) of the implementation
  against spec.md, plan.md, and research.md; fix the findings; record the round, its findings, and
  any left open here.
- [ ] T028 `npm run ci` locally, green, with Keycloak up so the live tests run; record the counts per
  workspace and each workspace's line coverage.
- [ ] T029 Running-system walk, quickstart S0–S8, on a stack built from this branch; record each
  scenario's result here (Constitution VI smoke test: each front end signed into, used, signed out).
- [ ] T030 Mahdi walks the sign-in pages in his own browser and approves the look (the issue's
  Process: "The user walks it before merging"); record it here.
- [ ] T031 Push and open the implementation PR (after the spec PR has merged and the branch is up to
  date with `main`): description says `fixes #122`, lists the review, the walk, the test counts, and
  the shared surface touched (`packages/shared/`; the constitution was in the spec PR). Wait for CI
  green on GitHub (`test` and `e2e`) on the final commit; merge only when green and approved.

---

## Dependencies & Execution Order

- **Setup (T001–T002)** → **Foundational (T003–T010)** → every story.
- **US1 (T011–T016)** needs T007 (tokens), T008 (seventh role), and T010 (the lines image). **US2
  (T017–T021)** needs US1's layers. **US3 (T022)** needs US2. **US4 (T023–T024)** needs T017's
  measuring fixture and T015's page color.
- **Polish (T025–T031)** after every story.

### Parallel opportunities

- T003, T004, T005, T006 (four test files); T007 and T009 (different workspaces).
- T011 and T012 (two seed test files).

## Implementation Strategy

- **MVP**: Setup + Foundational + US1 (T001–T016): the stones and their colored lines on every page.
  Not shippable alone: the text is not readable on the stones in the light scheme until US2.
- Then US2 (readability, the part the issue cares most about after the look), US3 (every page), the
  fallback and the generator's check, and the PR.

## Review record (spec branch)

- **Round 1** (independent Claude session, 2026-11-02): 3 must-fix, 7 should-fix, and nits; all
  fixed in the `Clarify 027`, `Review 027`, and `Constitution` commits that follow it. Mahdi decided
  two questions it raised: keep `021`'s band and brand mark, and draw the lines always in the lighter
  `--stone-accent`, in both schemes (spec Clarifications, spec review session).
  - must: the first draft's shade faded all the way to the window's edges, so the stones were never
    at full strength beside the form (R5 now fades over 120 px; from 800 px wide the stones beyond it
    are unshaded; T017 checks it); lines in `var(--accent)` made the backdrop differ between schemes
    (now `--stone-accent`, R2, R6); blocking the stones image does not remove the lines (spec Edge
    Cases, FR-009, S6).
  - should: every control's focus ring defined and measured, fields included (R7, T017, T020);
    forced colors hides the backdrop, since Chromium keeps `url()` backgrounds there (R4, T011, T015);
    "the same result" is the same decoded pixels and metadata, with `--check`, not bytes across
    machines (FR-010, SC-004, R3, S7, T006, T010); `fast-png` instead of a hand-written PNG codec
    (R3, plan); S1 checks the served image's SHA-256 in CI, as the `26.0` tag floats (T013); S3 is one
    test with a raised timeout and steps, elements scrolled into view (T017); the tasks commit's message
    no longer says the lines image was approved.
  - nits: no license `tEXt` chunks, only `Source` (R3, T011); R5's side figures corrected; the
    constitution paragraph now names both exceptions; the field edge shares `--stone-text-muted`
    (eight tokens); `content: ''`, a probe element for color comparison, the ring's sample area,
    `INIT_CWD` and repository-root paths, a no-animation check, the 400% zoom case at 360 px, and
    caching only outside `start-dev`.
- **Round 2** (independent Claude session, 2026-11-02): approves once 1 should-fix and 4 nits are
  fixed, all in the `Review 027: spec review round 2` commit: the S3 and S6 timeouts, expected times,
  and the e2e job's budget stated (R8, T017, T023, T026); R5's 50% Admin ring figure (2.88–2.91);
  R3's reason for comparing decoded pixels; T006's CLI tests never write the committed image; the
  constitution paragraph rewrapped.
- **Open findings**: none.
