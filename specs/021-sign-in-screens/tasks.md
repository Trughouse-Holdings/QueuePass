---
description: "Task list for Sign-in Screens"
---

# Tasks: Sign-in Screens

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R11),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) (no API change),
[quickstart.md](./quickstart.md) (S0–S9)

**Issue**: [#92](https://github.com/Trughouse-Holdings/QueuePass/issues/92). The implementation
PR's **description** says `fixes #92` on its own line. No commit message on either branch may contain
"fixes #92", "closes #92", or "resolves #92".

**Tests**: **REQUIRED and written first** (Constitution VI). In each phase, write the test tasks and
confirm they **fail** before the implementation tasks below them.

## Ground rules

- **Fresh session** (Constitution III): implement on branch `021-sign-in-screens-impl` in a Claude
  session that starts from these files only. While the spec and plan PR is open, cut it from
  `021-sign-in-screens-spec` and carry in every change that PR's review makes; once it merges, bring
  it up to `main`. A gap in the spec or plan is fixed there, not worked around in code.
- **Commits** cite the spec, the task IDs, and the issue: `Impl 021: per-app accent tokens
  (T004–T006, #92)`.
- **One independent review** (Constitution 3.3.0) of the implementation branch before its PR (T030).
- **`npm run ci` locally** before pushing (T031), then **CI green on GitHub** before merge (T033).
- **Docker**: the Keycloak image is built by `docker compose up --build`. Backend tests still run with
  `--runInBand` (`npm test` does).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US4 from spec.md

---

## Phase 1: Setup

- [x] T001 Cut `021-sign-in-screens-impl` from `021-sign-in-screens-spec` (or from `main` once the
  spec PR has merged); `npm ci`; `npm run ci` green before any change, so a later failure is this
  feature's.
  **Result**: worktree branch cut from `021-sign-in-screens-spec` (bae1d74); `npm ci` clean; `npm run ci` before any source change: format, lint, build green; shared 592, backend 942, admin 249, customer 306, booth 76 passed (seed then held only the new T003 tests, failing as expected).
- [x] T002 Create the folders `keycloak/themes/queuepass/login/{messages,resources/css}` and confirm
  `.dockerignore` keeps `node_modules`, `dist`, and `.git` out of a root-context build (plan,
  Project Structure).
  **Result**: folders created; `.dockerignore` already excludes `node_modules/`, `**/node_modules/`, `dist/`, `.git/` (and `specs/`, which the image does not need).

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the theme files, the image, and the seed settings every story's screens need.

### Tests first

- [x] T003 [P] Theme-file test `scripts/seed/test/login-theme-files.test.ts` (Node, no Keycloak):
  reads `keycloak/themes/queuepass/login/theme.properties` and expects `parent=base`,
  `import=common/keycloak`, `styles=css/theme.css css/login.css`, and the class mappings of research
  R2 (`kcFormGroupClass=field`, `kcButtonClass=btn`, `kcButtonPrimaryClass=btn--primary`,
  `kcAlertClass=banner`); reads `messages/messages_en.properties` and expects `qpSignInTo=Sign in to
  {0}` and exactly these audience lines (data-model.md): `qpAudience.admin-app=For administrators
  managing venues, events, and sales.`, `qpAudience.customer-app=For customers buying and viewing
  tickets.`, `qpAudience.booth-app=For gate agents checking tickets in at the door.`; expects
  `template.ftl` to exist and to contain `advancedMsg(client.name)`, `qp-app--`, `role="alert"`,
  and `role="status"`. Must fail (no files yet).
  **Result**: 24 cases; all failed with no theme files, all pass after T008–T010.
- [x] T004 [P] Realm settings test `scripts/seed/test/provision-realm.test.ts` (no Keycloak, a fake
  `kc.realms`): on create, the realm has `loginTheme: 'queuepass'`, `displayName: 'QueuePass'`,
  `registrationAllowed: false`; on an existing realm with no or another login theme, one
  `realms.update` with `{ loginTheme: 'queuepass' }` and the log `set login theme 'queuepass'`; on an
  existing realm already at `queuepass`, no update and the log `login theme already 'queuepass'`
  (research R7, FR-010). Must fail.
  **Result**: 5 cases with a fake `kc.realms`; failed (no `LOGIN_THEME`, no update), pass after T006.
- [x] T005 [P] Client names in `scripts/seed/test/provision-clients.test.ts`: `FRONTEND_CLIENTS` names
  are exactly `QueuePass Admin`, `QueuePass Tickets`, `QueuePass Ticket Booth` for `admin-app`,
  `customer-app`, `booth-app` (FR-002). Must fail on `customer-app`.
  **Result**: new case in `provision-clients.test.ts`; failed on `customer-app` (`QueuePass`), passes after T007.

### Implementation

- [x] T006 `scripts/seed/src/provision-realm.ts`: create with `loginTheme: 'queuepass'`; on an
  existing realm, read it (`kc.realms.findOne`) and update only `loginTheme` when it differs, with
  the two log lines of T004 (R7). Export the login theme name as a constant used by the tests.
  T004 passes.
  **Result**: `LOGIN_THEME` exported; create sets it; an existing realm is read with `findOne` and only `{ loginTheme }` is written when it differs. T004 passes.
- [x] T007 `scripts/seed/src/provision-clients.ts`: `customer-app` name `QueuePass Tickets` (R7).
  T005 passes; the existing convergence renames an existing client.
  **Result**: `customer-app` is `QueuePass Tickets`. T005 passes.
- [x] T008 [P] `keycloak/themes/queuepass/login/theme.properties` (R2): `parent=base`,
  `import=common/keycloak`, `styles=css/theme.css css/login.css`, the class mappings, every other
  `kc*Class` that `base`'s `login.ftl`, `error.ftl`, `info.ftl`, and `logout-confirm.ftl` use set to
  empty or to a shared class, `locales=en`; `kcInputErrorMessageClass=qp-field-error`; the
  show-password mappings of R2 (`kcFormPasswordVisibilityButtonClass=btn btn--ghost qp-reveal`,
  `kcFormPasswordVisibilityIconShow=qp-reveal--show`, `kcFormPasswordVisibilityIconHide=qp-reveal--hide`);
  `meta=viewport==width=device-width,initial-scale=1` (`base` writes no viewport tag, R2).
  **Result**: as R2, plus `kcInputGroup=qp-input-group` (the password row, laid out by `login.css`), `stylesCommon=` and `meta=viewport==width=device-width,initial-scale=1` (base writes no viewport tag; without it a phone renders the page at desktop width, FR-012); every other `kc*` hook of base's `template.ftl`, `login.ftl`, `error.ftl`, `info.ftl`, `logout-confirm.ftl` set empty.
- [x] T009 [P] `keycloak/themes/queuepass/login/messages/messages_en.properties`: `qpSignInTo` and the
  three audience lines, word for word as T003.
  **Result**: word for word as T003.
- [x] T010 `keycloak/themes/queuepass/login/template.ftl` (R3, R9): start from `base`'s whole
  `template.ftl` (extract it from the Keycloak 26.0 image's
  `/opt/keycloak/lib/lib/main/org.keycloak.keycloak-themes-*.jar`, `theme/base/login/template.ftl`)
  and keep all of its behavior: the `registrationLayout` macro signature (`bodyClass`, `displayInfo`,
  `displayMessage`, `displayRequiredFields`, sections `header`, `form`, `info`, `socialProviders`,
  `show-username`), the `auth.showUsername()` branch with the attempted username and restart link,
  try-another-way, the scripts and import map, and the footer import. Then change the frame:
  `<html lang="en">`; `appName` = `advancedMsg(client.name)` when `client??` and
  `client.name?has_content` (`ClientBean.getName` can be null), else `realm.displayName`; `<title>${msg("qpSignInTo", appName)}</title>`;
  `<body class="qp-app--${(client.clientId)!''}">`; a top band; `.brand` with `.brand__mark`
  (`aria-hidden="true"`, "Q"); the one `<h1>` with `msg("qpSignInTo", appName)`; the audience line
  `msg("qpAudience." + client.clientId)` only when that key exists (compare the message to its key);
  the page's own `header` section captured with `<#assign pageHeader><#nested "header"></#assign>` and
  dropped when `pageHeader?markup_string?trim == msg("loginAccountTitle")` (the capture is markup
  output; a plain `?trim` is a 500, R9), otherwise shown in an `<h2>` (Keycloak 26
  has no `pageId`, R9);
  messages: `error` in `<div class="banner banner--error" role="alert">`, `success` in
  `banner--success` and `warning`/`info` in a `banner` with `role="status"`; the form, info, and
  social sections as `base` has them. Field errors stay where `base`'s `login.ftl` puts them
  (`#input-error`, R9). T003 passes.
  **Result**: from Keycloak 26.0.8's `theme/base/login/template.ftl`. Keycloak renders with HTML auto-escaping, so the captured header is markup output: the template takes `?markup_string` when `?is_markup_output`, then `?trim`, before comparing (tried: a plain `?trim` answers 500 with `NonStringException`; R9 and this task corrected in a `Review 021` commit); warnings use the shared `banner--conflict` (warn colors), info a `qp-banner--info`. Verified live: no `<h2>` on the sign-in form.
- [x] T011 `keycloak/Dockerfile` (R6): `FROM quay.io/keycloak/keycloak:26.0`; `COPY
  keycloak/themes/queuepass /opt/keycloak/themes/queuepass`; `COPY packages/shared/src/web/theme.css
  /opt/keycloak/themes/queuepass/login/resources/css/theme.css`. A comment says the build context is
  the repository root and why (one copy of the shared theme).
  **Result**: done; build context is the repository root.
- [x] T012 `docker-compose.yml` `keycloak` service: `build: { context: ., dockerfile:
  keycloak/Dockerfile }` in place of `image:`, everything else unchanged (command `start-dev`,
  environment, ports, volume, health check). `docker compose config` is valid.
  **Result**: `build:` in place of `image:`, with a comment; `docker compose config -q` valid. Checkpoint: `docker compose -p qp021 up --build keycloak seed` healthy, seed logged `created realm 'queuepass'` and `set login theme 'queuepass'`; `npm test --workspace @queuepass/seed` 38 passed with Keycloak up.

**Checkpoint**: `npm test --workspace @queuepass/seed` green (T003–T005); `docker compose up --build`
starts Keycloak healthy and the seed logs `set login theme 'queuepass'`.

---

## Phase 3: User Story 1 - Three screens, three identities (P1) 🎯 MVP

**Goal**: each app's sign-in screen names it, says who it is for, and uses its own accent.

**Independent Test**: quickstart S1, S2; the live test below.

### Tests first

- [x] T013 [P] [US1] Token test in `packages/shared/test/theme/tokens.test.ts`: the twelve new
  tokens exist in both blocks with the values of research R5 (`--accent-tickets` `#0f766e` /
  `#2dd4bf`, `--accent-tickets-hover` `#115e59` / `#5eead4`, `--accent-tickets-soft` `#f0fdfa` /
  `#042f2e`, `--accent-tickets-text` `#ffffff` / `#0f1115`, `--brand-mark-end-tickets` `#0d9488` /
  `#14b8a6`, `--brand-mark-text-tickets` `#ffffff` / `#0f1115`; `--accent-booth` `#b45309` /
  `#fbbf24`, `--accent-booth-hover` `#92400e` / `#fcd34d`, `--accent-booth-soft` `#fffbeb` /
  `#451a03`, `--accent-booth-text` `#ffffff` / `#0f1115`, `--brand-mark-end-booth` `#c2410c` /
  `#f59e0b`, `--brand-mark-text-booth` `#ffffff` / `#0f1115`; light / dark). Must fail.
  **Result**: 24 cases (12 tokens × light/dark) plus one that no rule outside the token blocks uses them; failed, pass after T017.
- [x] T014 [P] [US1] Contrast test in `packages/shared/test/theme/contrast.test.ts`: for `tickets` and
  `booth`, light and dark, at least 4.5:1 for accent-text on accent and on hover, accent on surface
  and on bg, accent on its soft; at least 3:1 for the brand-mark text on the accent and on the
  brand-mark end (R5, FR-012). Must fail (tokens missing).
  **Result**: 32 cases (2 apps × 2 schemes × 8: six roles defined, accent-text on accent and on hover, accent on soft, accent on surface and on bg at 4.5:1, brand letter on accent and on the mark end at 3:1); failed with no tokens, pass after T017.
- [x] T015 [P] [US1] Drift checker in `packages/shared/test/theme/check-theme.ts` and
  `drift.test.ts` (R4): new rule cases proved on small inputs first: inside `.qp-app--x { }`, the
  six roles `--accent`, `--accent-hover`, `--accent-soft`, `--accent-text`, `--brand-mark-end`,
  `--brand-mark-text` set to `var(--<token>)` are allowed; a literal color there, another custom
  property there, or the same roles outside such a rule are still C1/C2 violations; cases inside
  `@media (prefers-color-scheme: dark) { .qp-app--x { … } }` too. Then scan
  `keycloak/themes/queuepass/login/resources/css/login.css` with the app stylesheets and expect no
  violations. The rule cases must fail before the checker changes.
  **Result**: `cssViolations` takes `{ signInAccents: true }` for `login.css` only, so an app stylesheet still may not map accents (a case proves it). 20 rule cases: the mapping allowed in `.qp-app--x` and in `@media`; still reported: a literal, a color function, a `var()` fallback with a literal, another custom property, a non-token value, a token of another kind (`--accent: var(--danger)`), another role's token, a written-out color, and the roles under another rule, a compound selector, a selector list, a nested rule, `body.qp-app--x`, and another rule in `@media`. The three allow cases failed before T018; then `login.css` is scanned and only the customer and booth rules may set `--accent`.
- [x] T016 [US1] Live test `scripts/seed/test/sign-in-screens.test.ts` (Keycloak reachable, else
  skipped with the reason, as `seed-idempotence.test.ts`): for each of `admin-app`, `customer-app`,
  `booth-app`, GET `/realms/queuepass/protocol/openid-connect/auth` with `client_id`,
  `redirect_uri=http://localhost:<port>/`, `response_type=code`, `scope=openid`, a `state`, and an
  S256 `code_challenge`; parse the HTML and expect `<title>` and the only `<h1>` to read "Sign in to
  {name}" (contracts/README.md table), the audience line text, and `body` class
  `qp-app--<clientId>`; expect no PatternFly stylesheet link and the two theme stylesheets; expect the
  form's show-password button to have the `aria-label` "Show password" and the class `qp-reveal`.
  Must fail against today's stock theme.
  **Result**: `scripts/seed/test/sign-in-screens.test.ts`, 9 cases (3 clients × title/one `<h1>`/audience/body class; the two stylesheets, each served 200, no PatternFly; the form with autofocus, `aria-label="Show password"` + `qp-reveal`, primary button, no registration). Parsed with regular expressions (no new package). Proved against the stock look by setting the realm's `loginTheme` to `keycloak` by hand: 9 of 9 failed; set back.

### Implementation

- [x] T017 [US1] `packages/shared/src/web/theme.css`: the twelve tokens in the light `:root` block and
  in the dark block, after the existing accent and brand-mark tokens, with a comment that they are
  for the sign-in screens only (Constitution VII as amended, R8). T013, T014 pass; no other token
  changes; the existing contrast, drift, and load tests stay green.
  **Result**: the twelve tokens after `--brand-mark-*` in both blocks, with comments; the dark block notes the dark brand letter. T013, T014 pass; tokens, contrast, load: 222 passed.
- [x] T018 [US1] `packages/shared/test/theme/check-theme.ts`: the exception of T015. `declarations()`
  drops the selector at `{` today, so first make the parser track each declaration's enclosing rule
  selector (through `@media` blocks), then add the exception (R4). T015's rule cases pass, and every
  existing drift case still passes.
  **Result**: `declarations()` keeps a stack of open blocks' selectors (through `@media` and nesting) and gives each declaration its innermost one; the exception (selector exactly `.qp-app--[a-z0-9-]+`, role → `var(--<role with app>)` of the same role) applies only with `signInAccents`. All 318 shared theme cases pass.
- [x] T019 [US1] `keycloak/themes/queuepass/login/resources/css/login.css` (R4): a centered card on
  `--bg` (max width about 400 px, full width under 480 px), the top band (`--accent`, 6 px), the
  audience line in `--text-muted`, the `h2` page header, spacing from `--space-*`; `.qp-field-error`
  in `var(--danger)`; `.qp-reveal--show::before { content: "Show" }` and `.qp-reveal--hide::before {
  content: "Hide" }` (R2); the two
  `.qp-app--customer-app` and `.qp-app--booth-app` rules mapping the six roles to their tokens;
  `#kc-login:focus-visible` with the shared focus ring (the shared `input:focus` removes it, R2);
  nothing else defines a color. T015's scan passes.
  **Result**: as specified, plus: `#kc-login` full width and its focus ring restored (the shared `input:focus { outline: none }` would otherwise remove it from the submit input), `.qp-input-group` for the password row, the empty options row hidden with `:has()`, `.qp-banner--info`, phone rules under 480 px. Drift scan clean.
- [x] T020 [US1] Rebuild (`docker compose up --build keycloak seed`) and run T016. It passes for all
  three clients. Fix the template, not the test, on a mismatch.
  **Result**: `docker compose -p qp021 up -d --build --wait keycloak`; T016 9 of 9 pass, no template change needed.

**Checkpoint**: quickstart S1 holds in a browser.

---

## Phase 4: User Story 2 - Every screen keeps the identity (P1)

**Goal**: errors, notices, sign-out, and an ended session keep the app's identity.

**Independent Test**: quickstart S3, S4; the live test below.

- [x] T021 [US2] Extend `scripts/seed/test/sign-in-screens.test.ts`: for each client, take the form's
  `action` and the cookies from T016's page, POST `username=admin1&password=wrong`, and expect the
  same title, `<h1>`, audience line, and body class, plus "Invalid username or password." inside
  `#input-error` with `aria-live="polite"` and class `qp-field-error` (a field error, not a page
  message: R9), and the username field's value kept (FR-004, FR-011).
  **Result**: 3 cases: after `admin1`/`wrong`, same title, one `<h1>`, audience line, body class; "Invalid username or password." in `#input-error` with `class="qp-field-error"` and `aria-live="polite"`; no `role="alert"` banner repeating it; username kept and `aria-invalid="true"`.
- [x] T022 [US2] Extend the same test: GET the authorization URL with `client_id=account-console`,
  `redirect_uri=http://localhost:8080/realms/queuepass/account/`, `response_type=code`,
  `scope=openid`, a `state`, and an S256 `code_challenge` (not `/realms/queuepass/account`, which
  answers 200 with a single-page app that redirects only in JavaScript, R11): expect "Sign in to
  Account Console", no audience line, body class `qp-app--account-console` (FR-008,
  contracts/README.md).
  **Result**: 1 case as written ("Sign in to Account Console", no audience line, `qp-app--account-console`), plus 1 for the contracts table's no-client row: `GET /realms/queuepass/login-actions/authenticate` with no sign-in under way renders "Sign in to QueuePass", body class `qp-app--`, no audience line, and the page's own `<h2>` "We are sorry...". All 14 live cases fail with the realm set to the stock look by hand (set back after).
- [x] T023 [US2] Fix anything T021 or T022 finds in `template.ftl` or `login.css`. Both pass.
  **Result**: nothing to fix: 14 of 14 pass against the rebuilt image.

**Checkpoint**: quickstart S3, S4, S7 hold.

---

## Phase 5: User Story 3 - A clean clone, no manual steps (P1)

**Goal**: the look arrives from one command on new and existing Keycloak data.

**Independent Test**: quickstart S0, S8.

- [x] T024 [US3] `scripts/seed/test/seed-idempotence.test.ts` (live Keycloak): after a second seed
  run, the realm's `loginTheme` is `queuepass` and `customer-app`'s name is `QueuePass Tickets`; a new
  case sets the realm's `loginTheme` back to `keycloak` and the client's name back to `QueuePass`, runs
  the seed, and expects both restored (FR-010, SC-004). Must fail before T006/T007 are in the running
  seed image (rebuild).
  **Result**: 2 cases: after two runs, `loginTheme` is `queuepass` and `customer-app` is `QueuePass Tickets`; a realm set back to `keycloak` and a client renamed `QueuePass` by hand are both restored by the next run, with the same user counts and client ids. Both failed with the seed source put back to its pre-T006/T007 behavior, and pass with it. The rebuilt seed image, run again (`docker compose -p qp021 run --rm seed`), logs `login theme already 'queuepass'`.
- [x] T025 [US3] README "Running it" section: one line that the sign-in screens come from
  `keycloak/themes/queuepass` and need `--build` after a theme change (Keycloak's own image).
  **Result**: README has no "Running it" section; the line is in **Start the system**, after the startup order paragraph.

**Checkpoint**: quickstart S0 and S8 hold.

---

## Phase 6: User Story 4 - Reads well for everyone (P2)

**Goal**: phone width, both color schemes, keyboard, screen reader.

**Independent Test**: quickstart S5, S6.

- [ ] T026 [US4] Check in a browser at 360 px, light and dark, keyboard only, VoiceOver (quickstart
  S5, S6); fix `login.css` or `template.ftl` for anything that fails (sideways scroll, focus ring,
  heading order, autofocus on username from `base`'s `login.ftl`). Record what was checked here.
  **Result**: **partly done headlessly, needs Nate's browser walk.** Checked in headless Chrome 2026-10-30 over the DevTools protocol, for admin, customer, booth (and account console) at 360 px and 1280 px, light and dark, on the first screen and after a wrong password typed and sent with Enter: no sideways scroll (scrollWidth = width in all 34 renders); focus starts in `#username` (also after the error); Tab goes username → password → Show → Sign In; Show and Sign In draw a 3 px outline in the app's accent, the fields the shared accent border and ring; Space on Show reveals the password, its `aria-label` turns to "Hide password" and it shows "Hide"; one `<h1>` and the `<title>` name the app; computed contrast on the rendered pages: heading 17.63 / 14.45, audience line 5.23 / 6.83, labels 17.63 / 14.45, button text on accent 5.02–6.29 / 6.09–11.32, field error 6.57 / 8.97 (light / dark), brand letter ≥ 3.1. Screenshots looked over by eye: the band, mark and button take each app's accent. No fix was needed. **Not checked**: VoiceOver (the title and heading are right in the markup; whether the wrong-password text, which arrives with a full page load in base's `aria-live` span that the username field does not reference with `aria-describedby`, is actually read out needs a person to hear it; if it is not, `login.ftl` would need an override, a plan change), a real phone, and DevTools' own contrast panel.

---

## Phase 7: The Customer app's name (FR-003)

- [x] T027 [P] Test in `customer-app/test/` (the app shell test that renders `App`): the header brand
  reads "QueuePass Tickets"; and a test that reads `customer-app/index.html` and expects
  `<title>QueuePass Tickets</title>`. Must fail.
  **Result**: 2 cases in `customer-app/test/app.test.tsx` (header brand, `index.html` title); both failed.
- [x] T028 `customer-app/index.html` title and `customer-app/src/App.tsx` header brand to
  "QueuePass Tickets"; product mentions ("Can't reach QueuePass", the calendar `PRODID`) unchanged
  (R10). T027 passes; update any other Customer test that expected the old brand.
  **Result**: both renamed; "Can't reach QueuePass" and the calendar `PRODID` unchanged; no other Customer test expected the old brand. Customer: 308 passed.

---

## Phase 8: Polish, review, pull request

- [x] T029 README: the `021` status row in the features table (spec link, scope, status) and the
  "Today" paragraph; the constitution reference already reads v3.5.0.
  **Result**: status paragraph and a `021` row (`Built (walk pending)`, 29/33 tasks), a sentence in **Today**, a note in **One shared look**, `keycloak/` in the repository layout; the constitution reference already reads v3.5.0.
- [ ] T030 Independent review by a separate Claude session (Constitution 3.3.0) of the
  implementation against spec.md, plan.md, and research.md; fix the findings; record the round, its
  findings, and any left open here.
  **Result**: not done here: left for the independent review session.
- [x] T031 `npm run ci` locally, green; record the counts per workspace.
  **Result**: `npm run ci` green on 2026-10-30 (exit 0) with Keycloak up: format, lint, build; root node tests 45; shared 669 (21 files); backend 942 (94 suites); admin 249 (27 files); customer 308 (22 files); booth 76 (5 files); seed 54 (5 files, all live: 14 sign-in screen and 6 idempotence cases run; without Keycloak, as in GitHub CI, those 20 skip with their reason); test:tz quick pass. Coverage: shared 93.13%, backend 97.02%, admin 97.06%, customer 97.46%, booth 92.28%, seed 75.37% (floor not enforced until 010).
- [ ] T032 Running-system walk, quickstart S0–S9, on a stack built from this branch; record each
  scenario's result here (Constitution VI smoke test: each front end signed into, used, signed out).
  **Result**: **partly done headlessly, needs Nate's browser walk.** The apps' ports 5173–5175 were held by another session's stack (`qp018walk`), which was left running, so only Keycloak and the seed ran here (`-p qp021`). Done: **S0** from an empty volume, the seed logged `created realm 'queuepass'` and `set login theme 'queuepass'`, no console step. **S1** by each app's authorization request (as the apps send it): titles, headings, audience lines and accents (band, mark, button computed colors) as the table, no registration link. **S3** wrong password for each app keeps the identity with the error under the fields, username kept; then `admin1`/`customer1`/`agent1` with `test123` return 302 to `http://localhost:517x/?…code=…`. **S5/S6** as T026 (no VoiceOver). **S7** headless Chrome opened `/realms/queuepass/account`; its script landed on "Sign in to Account Console", `qp-app--account-console`, no audience line. **S8** a stack started from `bae1d74` (stock look, `QueuePass` customer client), then rebuilt from this branch on the same Keycloak data: seed logged `set login theme 'queuepass'` and converged `customer-app`; the 14 live sign-in cases pass; all three test accounts still sign in; a third run logged `login theme already 'queuepass'`. Not done: S1 through the running apps, **S2** (a person matching covered screens), **S4** (sign out and an ended session, through the apps), **S6** VoiceOver, **S9** the Customer app's tab and header in a browser (covered by T027's tests only).
- [ ] T033 Push and open the implementation PR (after the spec PR has merged and the branch is up to
  date with `main`): description says `fixes #92`, lists the review, the walk, the test counts, and
  the shared surface touched (`docker-compose.yml`, `packages/shared/`, the constitution was in the
  spec PR). Wait for CI green on GitHub on the final commit; merge only when green and approved.
  **Result**: branch pushed (`git push -u origin 021-sign-in-screens-impl`) on 2026-10-30; no pull request opened yet, since the spec PR (#96) has not merged; CI on GitHub runs once the PR is open.

---

## Dependencies & Execution Order

- **Setup (T001–T002)** → **Foundational (T003–T012)** → every story.
- **US1 (T013–T020)** needs the foundation. **US2 (T021–T023)** needs T016's test harness and the
  template. **US3 (T024–T025)** needs T006/T007. **US4 (T026)** needs US1's stylesheet. **Phase 7
  (T027–T028)** is independent of the theme and can go any time after T001.
- **Polish (T029–T033)** after every story.

### Parallel opportunities

- T003, T004, T005 (three test files); T008, T009 (two theme files).
- T013, T014, T015 (three shared test files).
- T027–T028 alongside any phase after Setup.

## Implementation Strategy

- **MVP**: Setup + Foundational + US1 (T001–T020): the three screens show their identity. Already
  solves the issue's problem.
- Then US2 (errors and fallback), US3 (existing stacks), US4 (accessibility pass), the Customer
  name, and the PR.

## Review record (spec branch)

- **Round 1** (independent Claude session, 2026-10-30, checked against the Keycloak 26.0.8 theme and
  services jars and a running 26.0 container): 3 must-fix, 4 should-fix, 3 minor; all fixed in the
  `Review 021` commit:
  - must: `pageId` does not exist in Keycloak 26 (R9 now captures the header and compares it to
    `loginAccountTitle`); the wrong-password message is a field error in `#input-error`
    (`aria-live="polite"`), not a page message (R9, T021); `/realms/queuepass/account` is a
    single-page app that redirects in JavaScript (T022 calls the authorization URL for
    `account-console` directly).
  - should: the spec contradicted itself on the account page's heading (now "Sign in to Account
    Console" everywhere); the drift checker needs selector tracking first (T018); `field__error` does
    not exist (now `qp-field-error` in `login.css`); the show-password toggle would have been an
    invisible focusable button (R2, T008, T019, quickstart S6).
  - minor: the spec said the constitution "is not amended"; the amendment now calls itself the one
    exception to "no per-app variants"; T010 keeps all of `base`'s `template.ftl` (show-username,
    try-another-way, footer, a null client name).
- **Open findings**: none.
