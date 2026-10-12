---
description: "Task list for the Shared Theme"
---

# Tasks: Shared Theme

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) (no contract
change), [quickstart.md](./quickstart.md)

**Issue**: [#24](https://github.com/Trughouse-Holdings/QueuePass/issues/24). The implementation PR
says `fixes #24`.

**Tests**: **REQUIRED and written first** (Constitution VI). In each phase, write the test tasks
and confirm they **fail** before the implementation tasks below them.

## Ground rules

- **Fresh session** (Constitution III): implement on branch `012-shared-theme-impl`, cut from
  `main` after the spec and plan PR merges, in a Claude session that starts from these files only.
  A gap in the spec or plan is fixed there, not worked around in code.
- **Shared surface**: `packages/shared/` changes, so the implementation PR needs every team
  member's approval.
- **Move, don't redesign**: rules move from `admin-app/src/styles.css` into
  `packages/shared/src/web/theme.css` as they are. The only value changes are research R4 (the
  Customer app's values where the apps differ, and no faint text), R5 (drop the `data-theme`
  guard), and R9 (app screen spacing onto steps). Nothing else changes how a screen looks.
- **Keep names**: no token or class is renamed (research R3).
- **No behavior change** (FR-013): no text, role, control, or flow changes. Only `className`
  attributes are added (research R8).
- **Leave alone**: `booth-app/` (R12), the Backend, the contract, `docker-compose.yml`, the root
  `package.json`, and `SeatPicker.tsx` (R11).
- **No new dependencies.**

## Phase 1: Setup

- [x] T001 Cut `012-shared-theme-impl` from an up-to-date `main`, run `npm install` and `npm test`
  from the repository root, and record the pass counts per workspace in this line (baseline).
  Baseline at b58ff2e: boundary and contract checks pass; shared 22, backend 275 (41 suites),
  admin-app 106, customer-app 144, booth-app 3, seed 3 (Keycloak-dependent cases skip when the
  stack is down); all passing.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the theme file exists, holds today's shared look, and both apps load it. The apps'
own copies stay for now and load after the theme, so their token values still win; the Admin app
already picks up the theme's focus outline and 44-pixel targets, which it did not define.

### Tests (write first, confirm they fail)

- [x] T002 [P] Create `packages/shared/test/theme/load.test.ts` (research R10): read files relative
  to `process.cwd()` (`packages/shared`) and assert
  - `package.json` `exports["./theme.css"]` is `"./src/web/theme.css"`, and that file exists;
  - `../../admin-app/vite.config.ts`, `../../admin-app/vitest.config.ts`,
    `../../customer-app/vite.config.ts`, and `../../customer-app/vitest.config.ts` each contain an
    alias for `/^@queuepass\/shared\/theme\.css$/` to `shared('web/theme.css')`;
  - `../../admin-app/src/main.tsx` and `../../customer-app/src/main.tsx` each import
    `'@queuepass/shared/theme.css'`, and that import comes before `import './styles.css'`;
  - `../../booth-app/src/main.tsx` does not import it (FR-015).
- [x] T003 [P] Create `packages/shared/test/theme/tokens.test.ts` (research R3, R5, R10) over
  `src/web/theme.css`:
  - the light block (`:root { ... }`) defines every token in data-model.md, with those values;
  - every color token in the light block is also redefined in the dark block
    (`@media (prefers-color-scheme: dark) { :root { ... } }`), with data-model.md's dark values;
  - the rules the `008` "shared detail layout" test checks today, moved from
    `customer-app/test/shared-look.test.ts` with the same eight patterns, now matched against
    `theme.css`: links in the accent color (`:where(a...)` with `color: var(--accent)`), buttons
    with a background by default (`.btn:not...` with `background:`), the `.topbar button` rule,
    `dl` as a grid, `dt` in `--text-muted`, spacing inside cards (`.card... > :`), spacing between
    cards (`.card + .card`), and `.page-head .form__actions`;
  - the file contains no `data-theme`;
  - no rule sets `color: var(--text-faint)`.
- [x] T004 [P] Move `customer-app/test/contrast.test.ts` to
  `packages/shared/test/theme/contrast.test.ts` with `git mv`, read `src/web/theme.css` instead,
  and add the pairs in research R7 (`--accent` on `--accent-soft`; `--danger` on `--danger-bg`;
  `--warn` on `--warn-bg`; `--ok` on `--ok-bg` at 4.5:1; `--text-muted` on `--surface-alt` at
  4.5:1), in light and dark. Its dark-block regex must match the block without the `data-theme`
  guard.

### Implementation

- [x] T005 Create `packages/shared/src/web/theme.css`, starting with a header comment citing spec
  012 and Constitution VII ("one fixed set; apps use these values, never redefine them"):
  - the light and dark token blocks exactly as in data-model.md (Customer values for
    `--border-strong`; the new `--font`, `--space-*`, `--radius-pill`, `--brand-mark-end`,
    `--brand-mark-text`), with the dark block as research R5;
  - every rule listed under "Theme" in research R2, copied from `admin-app/src/styles.css`, with
    the research R4 values (muted text for `thead th`, `.field__hint`, placeholder, and input hover;
    checkbox and radio at 22 pixels; `.choice` at 44 pixels; `.pill--danger` border; `.pill--warn`)
    and the Customer app's `:focus-visible`, 44-pixel targets, and `.tap` rules from
    `customer-app/src/styles.css`;
  - `body` uses `font-family: var(--font)`; `.brand__mark` uses `var(--brand-mark-end)` and
    `var(--brand-mark-text)`; `.pill` uses `var(--radius-pill)`;
  - the `008` "shared detail layout" block without its `>>>`/`<<<` markers.
  Run `npx prettier --write` on it.
- [x] T006 Add `"./theme.css": "./src/web/theme.css"` to `exports` in
  `packages/shared/package.json`.
- [x] T007 [P] Add `{ find: /^@queuepass\/shared\/theme\.css$/, replacement:
  shared('web/theme.css') }` to the `alias` list in `admin-app/vite.config.ts`,
  `admin-app/vitest.config.ts`, `customer-app/vite.config.ts`, and `customer-app/vitest.config.ts`.
- [x] T008 [P] In `admin-app/src/main.tsx` and `customer-app/src/main.tsx`, add
  `import '@queuepass/shared/theme.css';` directly above `import './styles.css';`, with a comment
  citing spec 012 and Constitution VII. Update the Customer app's existing "Spec 008" comment.
- [x] T009 Run T002–T004 until they pass, then `npm test`. Every existing test still passes.

**Checkpoint**: both apps load one theme; nothing has been removed from the apps yet.

---

## Phase 3: User Story 2 - The Apps Cannot Drift Apart (Priority: P1)

**Goal**: FR-005 and FR-006: the drift check exists, is tested, and fails on today's duplicated
app stylesheets. (Built before US1 so US1's clean-up is driven by its failures.)

**Independent Test**: the checker reports each violation kind with file and line, accepts theme
values, and the app scan fails today.

### Tests for User Story 2 (write first, confirm they fail)

- [x] T010 [US2] Create `packages/shared/test/theme/drift.test.ts` with:
  - **Self-tests** (FR-006, SC-005), each feeding a small string to the checker and asserting the
    exact rule, line, and declaration reported: C1 `--accent: #000;`; C2 each of `#abc`,
    `#a1b2c3`, `rgb(0 0 0)`, `rgba(0,0,0,.5)`, `hsl(0 0% 0%)`, `oklch(0.5 0.1 200)`, `red`, and a
    hex inside `@media`; C3 `font-family: serif;` and `font: 14px serif;`; C4
    `border-radius: 6px;` and `box-shadow: 0 1px 2px var(--border);`; C5 `padding: 18px;`,
    `margin: 4px 0 0;`, `gap: 6px;`; C6 `color: var(--text-faint);`; the inline rule
    `style={{ color: 'red' }}` and `style={{ fontFamily: 'serif' }}` in TSX; and C4
    `border-radius: 0 6px 6px 0;` (one literal part). Then an allowed-forms
    string that must report nothing: `var(--accent)`, `transparent`, `currentcolor`, `inherit`,
    `color-mix(in srgb, var(--accent) 18%, transparent)`, `padding: 0 var(--space-4)`,
    `margin: calc(-1 * var(--space-2)) 0 var(--space-5)`, `gap: var(--space-1)`,
    `border-radius: var(--radius-sm)`, `border-radius: 0 var(--radius-sm) var(--radius-sm) 0`,
    `font-family: var(--mono)`, `font: inherit`, `width: 44px`, `font-size: 13px`,
    `white-space: nowrap`, a named-color word in a non-color property (`content: "red"` and
    `grid-template-areas: "tan"`), and `style={{ width: '40%' }}`; and a comment containing
    `#fff` that must be ignored.
  - **The scan** (FR-005, SC-001): every `*.css` and `*.tsx` file under `../../admin-app/src`,
    `../../customer-app/src`, and `../../booth-app/src`, and every `*.tsx` file under
    `src/web` (inline styles); the test fails listing every violation as
    `path:line rule declaration`.
  - **The theme itself**: `src/web/theme.css` with its two token blocks removed has no C2
    violation (colors are written out only in the token blocks; research R3).
  Confirm the self-tests fail (no checker yet) and, after T011, that the scan fails on today's two
  app stylesheets (their token blocks and literals).

### Implementation for User Story 2

- [x] T011 [US2] Create `packages/shared/test/theme/check-theme.ts` exporting
  `cssViolations(path: string, css: string): Violation[]` and
  `inlineStyleViolations(path: string, tsx: string): Violation[]`, where `Violation` is
  `{ path, line, rule, text }`, implementing research R6: strip comments keeping line numbers
  (replace comment characters with spaces, newlines kept); take each innermost `{ ... }` block;
  split into declarations; apply C1–C6, judging C4 and C5 part by part (space-separated) and
  letting C3 accept `font-family: var(--...)`; for TSX, find `style={{ ... }}` objects and apply
  the inline rule. Also export `colorLiteralViolations(path, css)` (C2 only), used by T010's
  theme check. Include the CSS named color list (CSS Color Module Level 4), excluding
  `transparent` and `currentcolor`, matched as whole words only in the values of the
  color-bearing properties listed in research R6 (C2); hex and color functions are matched in every
  value. Run T010's self-tests until they pass.

**Checkpoint**: the self-tests pass; the scan fails, listing the work Phase 4 does.

---

## Phase 4: User Story 1 - Both Apps Look the Same (Priority: P1) 🎯 MVP

**Goal**: FR-001–FR-004, FR-009, FR-011, FR-012: each app's stylesheet holds only its own
screens, using theme values; the scan passes.

**Independent Test**: quickstart S1–S3 match side by side; `drift.test.ts` passes.

### Tests for User Story 1

- [x] T012 [US1] The failing scan from T010 is this story's test. Delete
  `customer-app/test/shared-look.test.ts` only after confirming its eight rule-presence
  assertions are in `packages/shared/test/theme/tokens.test.ts` (T003) and pass there; its
  "identical in both apps" assertion is replaced by the block existing once, in the theme
  (FR-013).

### Implementation for User Story 1

- [x] T013 [P] [US1] Cut `admin-app/src/styles.css` to the "Stays in admin-app" rules in research
  R2, with a header comment: "Admin-only screens. Colors, typefaces, radii, shadows, and spacing
  come from @queuepass/shared/theme.css (spec 012)." Then apply research R4 and R9:
  `.stat__note`, `.card__sub`, and `.row--muted td` use `--text-muted`; `.meter` and
  `.meter__fill` use `var(--radius-pill)`; every padding, margin, and gap uses the nearest
  `var(--space-N)` (ties up; `-8px` → `calc(-1 * var(--space-2))`).
- [x] T014 [P] [US1] Cut `customer-app/src/styles.css` to the "Stays in customer-app" rules in
  research R2, with the same kind of header comment, replacing the "copied from" header. Apply
  research R9 to every padding, margin, and gap, including the three seat values
  (`.seat-scroll` padding `6px 2px` → `var(--space-2) var(--space-1)`; `.seat-row` gap and margin
  `4px` → `var(--space-1)`). Change nothing else in the seat rules (research R11).
- [x] T015 [US1] Run `drift.test.ts` until the scan passes, then `npm test`. Every existing Admin
  and Customer test still passes unchanged.

**Checkpoint**: one theme, no copies, no drift; screens look as before except FR-012.

---

## Phase 5: User Story 3 - Status Messages Look the Same Everywhere (Priority: P2)

**Goal**: FR-010, FR-014: every error and status message uses the theme's banner.

**Independent Test**: render tests find the banner classes on each message, with roles and text
unchanged.

### Tests for User Story 3 (write first, confirm they fail)

- [x] T016 [P] [US3] Create `packages/shared/test/web/service-unreachable.test.tsx`: renders one
  element with role `alert`, text "Can't reach the QueuePass service.", and classes `banner` and
  `banner--error`.
- [x] T017 [P] [US3] Create `customer-app/test/theme-classes.test.tsx` with `stubApi` and the
  helpers in `customer-app/test/helpers.tsx`:
  - on an event page, the Get tickets confirm button has `btn` and `btn--primary`;
  - the Events page's Clear filters button (with filters matching nothing) has `btn` and
    `btn--ghost` (FR-014's secondary button);
  - an order refusal (a `409` the form already handles, as in `purchase.test.tsx`) shows its
    message in an element with role `alert` and classes `banner banner--error`, with the same
    text as today;
  - the couldn't-confirm outcome (as in the existing unknown-outcome test) shows role `alert`
    with classes `banner banner--conflict`; its two paragraphs and its Check again button (which
    has `btn btn--ghost`) are inside one `.banner__body` element;
  - **if `016` is on `main`** (`customerLimit` exists in `packages/shared/src/order.ts`): the
    limit line and the "No more seats can be chosen" line have class `note`, and "You have
    reached the limit" has `banner banner--conflict`, with their text unchanged; and any other
    status line found on `main` per T022;
  - with the API unreachable, the Events page shows "Can't reach the QueuePass service." with
    classes `banner banner--error`.
- [x] T018 [P] [US3] Create `admin-app/test/theme-classes.test.tsx` with `stubApi` from
  `admin-app/test/helpers/api-stub.ts`: with the API failing, the event, venue, attendees, and
  reports pages each show "Can't reach the QueuePass service." with role `alert` and classes
  `banner banner--error`; the New event form's save button has `btn btn--primary` and its
  Cancel link has `btn btn--ghost`.

### Implementation for User Story 3

- [x] T019 [P] [US3] In `packages/shared/src/web/service-unreachable.tsx`, add
  `className="banner banner--error"` to the paragraph (research R8).
- [x] T020 [P] [US3] In `admin-app/src/pages/Attendees.tsx`, `EventDetail.tsx`,
  `LocationDetail.tsx`, and `Reports.tsx`, add `className="banner banner--error"` to each
  "Can't reach the QueuePass service." paragraph.
- [x] T021 [P] [US3] In `customer-app/src/components/GetTickets.tsx`, add
  `className="banner banner--error"` to the `notice` paragraph and
  `className="banner banner--conflict"` to the couldn't-confirm `div`, and wrap that `div`'s two
  paragraphs and Check again button in `<div className="banner__body">` (research R8). Text,
  role, and the Check again control stay as they are.
- [x] T022 [US3] Status lines from other features (research R8, R11; spec FR-010): search
  `admin-app/src` and `customer-app/src` for every element with `role="alert"` or
  `role="status"`, and every status sentence added since this plan (on `main` today, `016`'s
  lines in `GetTickets.tsx`: the limit line and "No more seats can be chosen" get
  `className="note"`; "You have reached the limit" gets `className="banner banner--conflict"`).
  Give each the fitting theme class, list them in the PR description, and extend T017 or T018
  first for any not already covered.
  Result: `016` is not on `main` at b58ff2e (no `customerLimit`), so it has no lines to class.
  Classed: `ServiceUnreachable` and the Admin Attendees, EventDetail, LocationDetail, and Reports
  "Can't reach" paragraphs (`banner banner--error`); the Get tickets refusal (`banner
  banner--error`) and couldn't-confirm block (`banner banner--conflict`, with `banner__body`).
  Every other `role="alert"`/`role="status"` element already had a theme banner class; the Admin
  `Notice.tsx` (`role="status"`) keeps the existing bare `.banner`. Review round 1: the Get
  tickets "Ticket information is unavailable right now." line (no role) also gets `banner
  banner--error` (spec FR-010, FR-012), tested in `customer-app/test/theme-classes.test.tsx`.
  Running-system gate: the Admin Events list and event page Cancelled badge gets `pill
  pill--danger`, as on Reports and in the Customer app (US3-4; spec FR-012), tested in
  `admin-app/test/theme-classes.test.tsx`.
- [x] T023 [US3] Run T016–T018 until they pass, then the shared, Admin, Customer, and Booth suites
  (the Booth app renders `ServiceUnreachable` too; its tests must still pass).

**Checkpoint**: status messages match in both apps.

---

## Phase 6: User Story 4 - One Change Updates Both Apps (Priority: P2)

**Goal**: SC-003: the look is changed in one file.

**Independent Test**: quickstart S6.

- [x] T024 [US4] Confirm by test, not by hand: `load.test.ts` (both apps resolve the same file)
  and the C1 rule in `drift.test.ts` (no app defines `--accent` or any token) together guarantee
  SC-003. Add one assertion to `load.test.ts` that `--accent` is defined only in
  `packages/shared/src/web/theme.css` among all `*.css` files under `admin-app/src`,
  `customer-app/src`, `booth-app/src`, and `packages/shared/src`.
- [x] T025 [US4] Update `README.md`: add the `012` row to the Status table, and one short
  paragraph under the front-end section: the look lives in `packages/shared/src/web/theme.css`;
  apps add only their own screens' rules, using theme values; `npm test` fails on drift; a theme
  change needs every member's approval.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T026 Run `npm run lint`, `npx prettier --check .`, and `npm test` from the repository root;
  everything passes.
- [x] T027 Coverage: no workspace has a Vitest coverage provider, and this feature adds no
  dependency, so front-end coverage reporting waits on `010`; the Backend is not touched. Say so
  in the PR description. The 80% floor is not yet blocking (Constitution VI deferral until `010`
  and `011`).
- [ ] T028 Running-system gate: `docker compose up --build`, then walk quickstart.md S1–S6 in the
  browser, including light, dark, and 375 pixels wide, and sign in, use, and sign out of each front
  end. Record the results, and the S2 tables, in this file. Also check the spacing of the Check
  again button inside the Customer couldn't-confirm warning banner (review round 1, item 9).
- [ ] T029 Independent review (Constitution III): a separate Claude session reviews the branch
  against spec.md and plan.md; fix the findings; repeat until only minor findings remain (2–3
  rounds). Record the number of rounds and any open finding in the PR description.
- [ ] T030 Open the implementation PR against `main` with `fixes #24` in its description, noting
  that it changes `packages/shared/` and needs every team member's approval, and listing the
  visible changes from spec FR-012, with a request for the teammate's explicit sign-off of the
  Admin ones and the Customer "Ticket type" group (plan.md; quickstart S5b results attached).

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2** before any story.
- **US2 (Phase 3)** before **US1 (Phase 4)**: the checker's failures drive the clean-up.
- **US3 (Phase 5)** depends on Phase 2 only (the banner classes come from the theme) and can run
  alongside Phase 4.
- **US4 (Phase 6)** after Phase 4.
- **Phase 7** after every story.

## Parallel Opportunities

- Phase 2: T002, T003, T004 (tests); then T007 and T008 alongside T005/T006.
- Phase 4: T013 and T014 (different files).
- Phase 5: T016, T017, T018 (tests); then T019, T020, T021; then T022.

## Implementation Strategy

1. **Theme in place**: Phases 1–2. Both apps load it; nothing visible changes.
2. **Guard first**: Phase 3 builds and proves the drift check.
3. **MVP**: Phase 4 removes the copies until the check passes; the apps now share one look.
4. **Messages**: Phase 5 brings the Customer app's messages and every "Can't reach" into line.
5. **Ship**: Phases 6–7, with the independent review before the PR.
