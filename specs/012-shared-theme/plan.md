# Implementation Plan: Shared Theme

**Branch**: `012-shared-theme-spec` | **Date**: 2026-10-11 | **Spec**: [spec.md](./spec.md)
| **Issue**: [#24](https://github.com/Trughouse-Holdings/QueuePass/issues/24)

**Input**: Feature specification from `specs/012-shared-theme/spec.md`

## Summary

- **One theme file**, `packages/shared/src/web/theme.css`, exported as
  `@queuepass/shared/theme.css` and imported first by the Admin and Customer apps' `main.tsx`
  (research R1).
- **What moves**: the tokens and every rule both apps use today. Rules only one app uses stay in
  that app's `styles.css`, which shrinks to its own screens (R2).
- **Tokens**: today's names, plus `--font`, seven spacing steps, `--radius-pill`, and two brand
  mark colors that were literals (R3). Where the apps differ, the Customer app's tested value
  wins (R4). Dark mode follows the device; the unused `data-theme` hook goes (R5).
- **No drift**: a checker in the shared package's tests fails, naming file and line, when an
  app's CSS defines a token, writes a color, sets a typeface, radius, shadow, or off-step spacing,
  or when an inline style sets a color or typeface, or when an app does not load the theme (R6).
- **Contrast** tests move from the Customer app to the theme and gain the status message pairs
  (R7).
- **Status messages**: "Can't reach the QueuePass service" (shared and Admin copies) and the
  Customer Get tickets messages get the theme's banner classes (R8).
- **Spacing** in app screen rules moves to the nearest step, at most 2 pixels (R9).
- **Proof**: static tests (load, tokens, drift, contrast), class render tests in each app, and a
  computed-style comparison in the running system (R10).

**No Backend, database, contract, Compose, or root `package.json` change.** `packages/shared/` is
shared surface, so both PRs need every team member's approval (R11).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node.js 22 LTS; plain CSS

**Primary Dependencies**: unchanged. **No new dependencies** (no Stylelint, PostCSS, or
screenshot tool; R6, R10).

**Storage**: none.

**Testing**: Vitest in `packages/shared` (theme load, tokens, contrast, drift checker and its
self-tests, `ServiceUnreachable`); Vitest + React Testing Library in `admin-app` and
`customer-app` (theme classes on key controls). Light, dark, phone width, and computed styles in
the browser ([quickstart.md](./quickstart.md)).

**Target Platform**: the existing Docker Compose stack; the app Dockerfiles already copy
`packages/shared` before building.

**Project Type**: web application (one Backend, three front ends, one shared package).

**Performance Goals**: none; the two apps' CSS shrinks overall, as shared rules are no longer
duplicated within the repository.

**Constraints**: every behavior and text unchanged (FR-013); visible changes limited to FR-012;
the Booth app unchanged (FR-015); seat picker rules untouched except spacing tokens (R11).

**Scale/Scope**: 1 new CSS file (about 600 lines, moved, not written); 2 stylesheets cut to their
own screens; 4 Vite/Vitest configs gain one alias line; 2 `main.tsx` gain one import; 6 components
gain a `className`; 0 Backend files.

## Constitution Check

Evaluated against constitution **v3.0.0**.

| Principle | Pre | Post | Evidence |
|---|---|---|---|
| **I. API-Only, Contract First** | PASS | **PASS** | No API change; the contract is untouched ([contracts/README.md](./contracts/README.md)). |
| **II. One Repo, One Command** | PASS | **PASS** | No new service, variable, or dependency. The theme is bundled by each app's existing Vite build; the Dockerfiles already copy `packages/shared`. |
| **III. Spec-Driven, Reviewed** | PASS | **PASS** | Issue #24; spec and plan on `012-shared-theme-spec`, reviewed by a second Claude session before the PR; implementation on `012-shared-theme-impl` in a fresh session, closing #24. |
| **IV. Server-Authoritative, DB-Guaranteed** | PASS | **PASS** | No rule changes or moves to a front end. Error messages keep their text and roles; only their look changes. |
| **V. Sign-In Everywhere** | PASS | **PASS** | No route, role, or sign-in change. |
| **VI. Test-First, Real Database** | PASS | **PASS** | Every phase in `tasks.md` writes its tests first; the drift checker has self-tests for each rule. No persistence, so no database tests. The 80% coverage floor is a recorded deferral until `010` and `011`; this feature reports its coverage. |
| **VII. Function Over Finish, One Shared Look** | PASS | **PASS** | This feature implements it: one theme in `packages/shared/`; neither app defines an accent or redefines a theme value (checked, R6); app screen styles use theme values; one fixed set, no switching or variants (R5); the Booth app stays plain (R12). The few visible changes are the Customer app's tested usability values (contrast, targets, focus), not new design (R4). |
| **VIII. Staged Simplicity** | PASS | **PASS** | One CSS file and an existing alias pattern; no theming system, no new dependency, no type scale, no shared React components (spec Out of Scope). No control deferred. |

**Shared surface**: `packages/shared/` changes (a new CSS file, one `package.json` export, one
component's class, new tests). Per the constitution, both the spec and plan PR and the
implementation PR need approval from every team member.

**Visible Admin changes need sign-off**: spec FR-012's Admin changes (darker control borders,
44-pixel buttons and fields, larger checkboxes and radios, the focus outline) land on dense Admin
screens. The teammate review of the implementation PR must sign them off explicitly (quickstart
S5b).

## Project Structure

```text
specs/012-shared-theme/
├── spec.md, plan.md, research.md (R1–R12), data-model.md, quickstart.md (S1–S6), tasks.md
├── checklists/requirements.md
└── contracts/README.md

packages/shared/
├── ~ package.json                         # exports "./theme.css" (R1)
├── src/web/+ theme.css                    # tokens, base, shared controls, page parts (R2–R5)
├── src/web/~ service-unreachable.tsx      # banner classes (R8)
└── test/
    ├── theme/+ check-theme.ts             # the drift checker (R6)
    ├── theme/+ drift.test.ts              # checker self-tests + scan of the three apps (R6)
    ├── theme/+ load.test.ts               # export, aliases, main.tsx imports (R10)
    ├── theme/+ tokens.test.ts             # light/dark pairs; literals only in tokens (R10)
    ├── theme/+ contrast.test.ts           # moved from customer-app, more pairs (R7)
    └── web/+ service-unreachable.test.tsx # classes and role (R8)
admin-app/
├── ~ vite.config.ts, ~ vitest.config.ts   # theme alias (R1)
├── src/~ main.tsx                         # imports the theme first (R1)
├── src/~ styles.css                       # Admin-only rules, spacing on steps (R2, R9)
├── src/pages/~ Attendees.tsx, ~ EventDetail.tsx, ~ LocationDetail.tsx, ~ Reports.tsx  # R8
└── test/+ theme-classes.test.tsx          # R10
customer-app/
├── ~ vite.config.ts, ~ vitest.config.ts   # theme alias (R1)
├── src/~ main.tsx                         # imports the theme first (R1)
├── src/~ styles.css                       # Customer-only rules, spacing on steps (R2, R9)
├── src/components/~ GetTickets.tsx        # banner classes on two messages (R8)
└── test/+ theme-classes.test.tsx; - shared-look.test.ts; - contrast.test.ts (moved)
~ README.md                                # Status row; where the look lives
```

`booth-app/` is not changed (R12). Legend: `+` new, `~` changed, `-` removed.

**Structure Decision**: the existing monorepo layout. The theme sits in `packages/shared/src/web/`
next to the shared React code the same apps already import, and its tests sit in the shared
package's existing test folder.

## Conflicts with work in progress

- **`015-seat-holds`** (Nate, in progress, not on the remote yet) will change the Customer seat
  picker. 012 moves tokens and shared controls only; it does not touch `SeatPicker.tsx`, and in
  the seat rules of `customer-app/src/styles.css` it changes only three spacing values to theme
  steps (two keep their size; the seat map's padding grows by 2 pixels). The drift check names
  anything the second-merged branch must adjust (R11).
- **`016-per-user-ticket-limit`** (spec pending) edits `GetTickets.tsx`; 012 adds two class names
  there. The second to merge gives any new status text the banner classes (R11).

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| A hand-written CSS checker (about 100 lines, with self-tests) | FR-005 needs a failing test, naming file and line, for each kind of drift | Stylelint or PostCSS adds a dependency and cannot express "theme steps only" without a plugin (R6). |
| An alias line in four configs | The apps resolve shared code through exact-match aliases; the theme must resolve the same way in dev, build, and tests | Relying on the package export alone would make the theme the one shared import that skips the aliases. |
| App spacing rounded to steps (≤2 px) | Constitution VII requires app styles to use theme spacing, and C5 checks it | Leaving spacing unchecked would leave one of the three values the constitution names unenforced. |
