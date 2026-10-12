# Research: Shared Theme

Decisions for [plan.md](./plan.md). Each has a decision, its rationale, and the alternatives
considered.

## Where the look lives today

| Place | What it holds |
|---|---|
| `admin-app/src/styles.css` (762 lines) | Color tokens on `:root` and a dark block under `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) }`; base; top bar, nav, page head, buttons, cards, tables, pills, empty/loading, banners, forms, notes, the 640-pixel breakpoint; Admin-only report tiles, meter, conflict detail, section lines; the `008` US4 "shared detail layout" block. |
| `customer-app/src/styles.css` (747 lines) | A copy of most of the above, marked "copied from admin-app", with changed values (below); no banners; Customer-only focus outline, 44-pixel targets, event cards, filters, seat picker, ticket list; the same "shared detail layout" block. |
| `customer-app/test/shared-look.test.ts` | Checks only that the "shared detail layout" block is identical in both files. |
| `customer-app/test/contrast.test.ts` | WCAG contrast of the Customer tokens, light and dark; `--text-faint` never used for text. |
| `admin-app/src/main.tsx`, `customer-app/src/main.tsx` | `import './styles.css'`. |
| `packages/shared/src/web/*.tsx` | No styles and no class names. `ServiceUnreachable` renders a plain `<p role="alert">`. |
| `booth-app/` | No stylesheet. Browser defaults. |
| Screen code | One inline style: `admin-app/src/pages/Reports.tsx` sets a meter's `width`. No color in any inline style. |

The accent color (`#4f46e5` light, `#8b85f5` dark) and every other token are defined **twice**,
once per app. Two color literals outside the token blocks are also duplicated: the brand mark's
gradient end `#7c6cf7` and its text `#fff`.

Differences between the two copies today:

| Rule | Admin app | Customer app |
|---|---|---|
| `--border-strong` (light / dark) | `#cfd4da` / `#363d4a` (1.5:1 / 1.6:1 on surface) | `#868e99` / `#6f7887` (3.3:1 / 3.9:1) |
| `thead th` color | `--text-faint` | `--text-muted` |
| `.field__hint`, `input::placeholder` | `--text-faint` | `--text-muted` |
| `input:hover` border | `--text-faint` | `--text-muted` |
| Checkbox and radio | native size, `margin-right: 6px` | 22 × 22 pixels, `margin: 0 8px 0 0` |
| Buttons, fields | no minimum size | `min-height: 44px`; buttons `min-width: 44px` |
| Focus | browser default | `:focus-visible` 3-pixel accent outline |
| `.choice` | `min-height: 36px` | `min-height: 44px` |
| `.pill--danger` | no border | `1px solid var(--danger-border)` |
| `.pill--warn` | none | defined |
| `.banner` family, `.conflict-detail` | defined | none |

## R1. Ship the theme as one CSS file exported by the shared package

**Decision**: Create `packages/shared/src/web/theme.css`. Add an export to
`packages/shared/package.json`: `"./theme.css": "./src/web/theme.css"`. In `admin-app` and
`customer-app`, add an exact-match alias next to the two that exist, in both `vite.config.ts` and
`vitest.config.ts`:

```ts
{ find: /^@queuepass\/shared\/theme\.css$/, replacement: shared('web/theme.css') },
```

Each app's `src/main.tsx` imports it **before** its own stylesheet:

```ts
import '@queuepass/shared/theme.css';
import './styles.css';
```

**Rationale**: The apps already read `@queuepass/shared/web` straight from `src` through these
aliases, so a CSS file next to it needs no build step: the shared package's build is TypeScript
only, and each app's Vite build bundles the CSS. Every app Dockerfile already copies
`packages/shared` before building. The export entry lets any other tool resolve the same path, and
the alias keeps the lookup identical to the existing pattern. Loading the theme first means an
app's own rules come later, for its own screens only (R6 stops them redefining theme values).
TypeScript accepts a side-effect import of a CSS file (`noUncheckedSideEffectImports` is off, and
`vite/client` types are already referenced).

**Alternatives considered**:

- Theme values in TypeScript (a tokens object, CSS-in-JS, or a React theme provider): a runtime
  dependency and a rewrite of every screen's class names; a provider also invites runtime
  switching, which Constitution VII rules out.
- Generating the CSS from a TypeScript token file: a build step for one fixed file.
- A relative import (`../../packages/shared/...`) from each app: works, but bypasses the package
  boundary that every other shared import uses.
- Keeping the copies and widening the "identical block" test to the whole file: the apps would
  still each define every value, which Constitution VII forbids.

## R2. What moves into the theme, and what stays

**Decision**: Every shared control moves into the theme with all its variants and parts, and so
does every page part both apps use. Styles for one app's own screens stay in that app's
`styles.css` (spec FR-011). A variant only one app uses today (`.pill--warn`, `.banner--success`,
`.banner__icon`, `.tap`) still belongs to its shared control, so it moves too.

- **Theme**: tokens (light and dark); `*` box sizing; `body`; `.app`, `.topbar`, `.topbar__inner`,
  `.brand`, `.brand__mark`, `.navlinks`, `.navlink` and its states; `.main`; `.page-head`,
  `.page-title`, `.page-sub`; `.btn`, `.btn--primary`, `.btn--ghost`; `.card`; `.table-wrap`,
  `table`, `thead th`, `tbody td`, row states, `.cell-strong`, `.cell-muted`, `.cell-num`,
  `.cell-time`, `.cell-action`, `.rowlink`; `.pill`, `.pill--danger`, `.pill--warn`; `.price`;
  `.empty` and its parts, `.loading`; `.banner` and its parts and variants, with its keyframes;
  `.note`; `.form`, `.field`, `.field label`, `.field__hint`; `input`, `select` and their states,
  placeholder, checkbox and radio; `.field-row`; `.form__actions`; `fieldset`, `legend`,
  `.choice`; `.visually-hidden`; `:focus-visible`; the 44-pixel targets and `.tap`; the
  640-pixel breakpoint; and the whole `008` US4 "shared detail layout" block (links, plain `.btn`,
  `.topbar button`, `dl`/`dt`/`dd`, card inner spacing, `.page-head .form__actions`).
- **Stays in `admin-app/src/styles.css`**: `.conflict-detail`, `.stats`, `.stat` and its parts,
  `.meter`, `.meter__fill`, `.cell-meter`, `.card__head`, `.card__title`, `.card__sub`, `.num`,
  `.num-head`, `.row--muted`, `.form__row` and its breakpoint.
- **Stays in `customer-app/src/styles.css`**: `.card-grid`, `.event-card` and its parts,
  `.filters`, `.get-tickets`, `.order-card`, `.seat-scroll`, `.seat-row`, `.seat-row__label`,
  `.seat`, `.seat--chosen`, `.seat--taken`, `.ticket-list`.

The `>>> shared detail layout` markers are dropped: the block is no longer copied.

**Rationale**: The constitution names accent, fonts, spacing, and shared controls. The page frame
(top bar, cards, tables, label/value lists) is used identically by both apps today, so leaving it
copied would keep the drift risk this feature removes. Screen-specific rules would be dead
weight in the other app (FR-011), but a control's variants are part of the control: splitting
`.banner--success` from `.banner` would let the two halves drift. `.banner` is Admin-only today
but becomes shared because the Customer app adopts it (R8). `.choice` is used by both apps'
forms. `fieldset` and `legend` are styled only by the Admin app today, but both apps use them
(the Customer Get tickets "Ticket type" group is a `fieldset`), so they move, and the Customer
group's look changes (spec FR-012).

**Alternatives considered**: Moving only tokens and buttons, inputs, and status messages (the
issue's list): the top bar, cards, and tables would stay copied and could drift. Moving every
rule, including screen-specific ones: the theme would grow with every screen, and every screen
tweak would need every member's approval.

## R3. Token names and the new tokens

**Decision**: Keep every existing token name (`--bg`, `--surface`, `--surface-alt`, `--border`,
`--border-strong`, `--text`, `--text-muted`, `--text-faint`, `--accent`, `--accent-hover`,
`--accent-soft`, `--accent-text`, `--danger*`, `--warn*`, `--ok*`, `--radius`, `--radius-sm`,
`--shadow`, `--shadow-lg`, `--mono`). Add:

| Token | Value | Why |
|---|---|---|
| `--font` | today's body stack | the body typeface becomes a theme value (FR-001) |
| `--space-1` … `--space-6`, `--space-8` | 4, 8, 12, 16, 20, 24, 32 px | spacing steps (R9) |
| `--radius-pill` | `99px` | the pill and meter shape, today a literal in both files |
| `--brand-mark-end` | `#7c6cf7` (light and dark) | the brand mark's gradient end, today a literal |
| `--brand-mark-text` | `#ffffff` (light and dark) | the brand mark's letter, today `#fff` |

In the theme file, a color is written out only inside the two token blocks. Every rule uses
`var(--...)` for color (checked, R6). Lengths inside the theme's own shared rules (button padding,
field padding, page gutters) stay exactly as today; they are the theme's values.

Full table with values: [data-model.md](./data-model.md).

**Rationale**: Keeping names means no screen rule or class changes because of a rename, which
keeps the diff to moves and the few value changes R4 lists. The brand mark's two colors were the
only color literals outside token blocks; making them tokens lets the check be strict without
exceptions. `--text-faint` stays, for borders and decoration only (R7).

**Alternatives considered**: Renaming to a prefixed scheme (`--qp-color-accent`): churn in every
rule for no user-visible gain. A full type scale or size tokens: not in the constitution's list
(spec Assumptions; Principle VIII).

## R4. Where the apps differ, the Customer app's value wins

**Decision**: For each difference in the table above, the theme uses the Customer app's value:
`--border-strong` `#868e99` / `#6f7887`; muted text for table headings, field hints,
placeholders, and input hover borders; 22-pixel checkboxes and radios with `margin: 0 8px 0 0`;
44-pixel minimum height for buttons and fields and minimum width for buttons; the `:focus-visible`
outline; `.choice` at 44 pixels; `.pill--danger` with its border; `.pill--warn`. The Admin app's
`.banner` family and `.conflict-detail` are unchanged (the Customer app had none).

Admin-only rules that set `color: var(--text-faint)` on text (`.stat__note`, `.card__sub`,
`.row--muted td`) change to `--text-muted`, because FR-008 bans faint text in both apps.
`.row--muted .meter__fill` keeps `--border-strong`, which is now darker; a cancelled row's meter
stays muted, and its "Cancelled" text, not its shade, carries the meaning.

**Rationale**: `008` chose and tested these values for WCAG AA contrast, touch targets, and
keyboard focus; the Admin values fail those same tests (border 1.5:1). Constitution VII calls this
usability work, not design. Spec FR-012 lists the visible results.

**Alternatives considered**: Admin values win (would undo `008`'s tested fixes in the Customer
app). Keeping both via per-app overrides (a per-app variant, which Constitution VII forbids).

## R5. Dark mode follows the device, with no override hook

**Decision**: The dark set is `@media (prefers-color-scheme: dark) { :root { ... } }`, redefining
color and shadow tokens only, with the same values as today. The `:not([data-theme='light'])`
guard is dropped. No `color-scheme` property is added.

**Rationale**: Nothing in the repository sets `data-theme`; the guard is an unused switch, and
Constitution VII rules out theme switching. Without it, the cascade is the same for every page,
because no page sets the attribute. Adding `color-scheme` would change native controls (scroll
bars, date pickers) in dark mode, which is a visible change the spec does not ask for.

**Alternatives considered**: Keeping the guard (dead code that suggests a switch). A class-based
dark mode toggled by script (a runtime switch).

## R6. The no-drift check

**Decision**: A Vitest suite in the shared package, `packages/shared/test/theme/drift.test.ts`,
with its checker in `packages/shared/test/theme/check-theme.ts`. It runs in
`npm test --workspace @queuepass/shared`, which the root `npm test` already runs first, right
after the boundary and contract checks. No root `package.json` change.

What it reads: every `*.css` file under `admin-app/src`, `customer-app/src`, and `booth-app/src`;
every `*.tsx` file under the same folders and under `packages/shared/src/web` (inline styles
only, so shared components such as `013`'s planned address link are checked too); and
`packages/shared/src/web/theme.css` outside its two token blocks, for C2 only (paths relative to
the shared package, as `customer-app/test/shared-look.test.ts` does today).

How it reads CSS: strip comments; take each innermost `{ ... }` block (a declaration block, also
inside `@media`); split it into `property: value` pairs; report each violation with the file, the
line number (from the match index), and the declaration.

Rules for app stylesheets:

| # | Fails when | Allowed |
|---|---|---|
| C1 | a custom property is defined (`--anything:`) | none; apps define no theme values |
| C2 | any value contains a color written out: `#` hex, `rgb(`, `rgba(`, `hsl(`, `hsla(`, `hwb(`, `lab(`, `lch(`, `oklab(`, `oklch(`, or `color(`; or the value of a color-bearing property (`color`, `background`, `background-color`, `border*`, `outline*`, `fill`, `stroke`, `box-shadow`, `text-decoration*`, `caret-color`, `accent-color`, `column-rule*`) contains a CSS named color as a whole word | `var(--...)`, `transparent`, `currentcolor`, `inherit`, `color-mix()` of tokens |
| C3 | `font-family` is set to anything but `var(--...)` (a typeface written out), or `font` is set to anything but `inherit` | `font-family: var(--mono)` and other typeface tokens |
| C4 | `border-radius` or `box-shadow` has a space-separated part that is not `0`, `none`, or `var(--...)` | tokens, e.g. `0 var(--radius-sm) var(--radius-sm) 0` |
| C5 | `padding*`, `margin*`, `gap`, `row-gap`, or `column-gap` has a part that is not `0`, `auto`, `var(--space-N)`, or `calc(-1 * var(--space-N))` | spacing steps |
| C6 | `color: var(--text-faint)` | (also checked in the theme) |

Rule for app screen code (`*.tsx`): a `style={{ ... }}` object that sets `color`, `background`,
`backgroundColor`, any `border*Color`, `fontFamily`, or `boxShadow` fails. Lengths such as the
meter's `width` are allowed.

Load rule: `admin-app/src/main.tsx` and `customer-app/src/main.tsx` each import
`@queuepass/shared/theme.css` before `./styles.css` (`load.test.ts`, R10).

The checker's own tests feed it small CSS and TSX strings: one that breaks each rule (C1–C6 and
the inline rule) and must be reported with the right line, and one that uses only allowed forms
and must pass (FR-006, SC-005).

**Rationale**: The shared package owns the theme, so the rules that protect it live with it.
Vitest gives one named failure per violation, and the checker is tested like any other code. A
small rule set on declaration blocks is enough for these files: no nesting beyond `@media`, no
preprocessor. Running in the first workspace of `npm test` fails fast.

**Alternatives considered**:

- A root script like `scripts/check-boundary.mjs`: equally fast, but a change to the root
  `package.json` test command, and the checker itself would have no test.
- Stylelint with `color-no-hex` and similar rules: a new dependency and config, and its built-in
  rules cannot say "only theme spacing steps" without a plugin.
- A CSS parser such as PostCSS: only a transitive dependency of Vite today; depending on it
  directly adds a dependency for files this simple.

Named colors are matched only in color-bearing properties, because the same words appear in
other values (`content: "Gold tier"`, `grid-template-areas`, an animation or font name).

**Limits, accepted**: the checker reads only plain CSS and inline `style` objects; it does not
evaluate class names built at runtime, and it does not check widths, heights, or text sizes,
which stay per screen (spec Assumptions).

## R7. Contrast moves to the theme

**Decision**: Move `customer-app/test/contrast.test.ts` to
`packages/shared/test/theme/contrast.test.ts`, reading `packages/shared/src/web/theme.css`. Keep
its pairs (text, muted, accent, danger, warn, ok on surface and bg; accent-text on accent;
border-strong and accent at 3:1 on surface) and add the pairs the shared controls use: `--accent`
on `--accent-soft` (active nav item, pills), `--danger` on `--danger-bg`, `--warn` on `--warn-bg`,
`--ok` on `--ok-bg` (banners and badges), and `--text-muted` on `--surface-alt` (table headings).
All pass with the Customer values today (lowest text pairs: `--text-muted` on `--bg` 4.88:1 and
on `--surface-alt` 5.05:1 in light; `--accent` on `--accent-soft` 5.15:1 in dark; lowest boundary:
`--border-strong` on `--surface` 3.31:1 in light). The "never faint text" assertion covers the
theme; C6 covers the apps.

**Rationale**: FR-008 is a property of the theme, so the theme's tests own it. The added pairs are
the ones a status message or badge actually shows.

**Alternatives considered**: Keeping a contrast test in each app (both would read the same file).

## R8. Status messages use the theme's banner

**Decision**:

- `packages/shared/src/web/service-unreachable.tsx`: `<p role="alert" className="banner
  banner--error">`, same text. The Booth app renders it too but loads no theme, so it looks as
  before (FR-015).
- `admin-app/src/pages/Attendees.tsx`, `EventDetail.tsx`, `LocationDetail.tsx`, `Reports.tsx`:
  their own "Can't reach the QueuePass service." paragraphs get the same classes.
- `customer-app/src/components/GetTickets.tsx`: the `notice` paragraph gets `banner
  banner--error`; the "couldn't confirm" block gets `banner banner--conflict`, and its two
  paragraphs and Check again button are wrapped in one `<div className="banner__body">`, as in
  `admin-app/src/components/ErrorBanner.tsx`. Without the wrapper, `.banner`'s `display: flex`
  would set the three side by side in narrow columns.
- Status lines another feature has added to `main` by the time 012 is built (R11): `016`'s
  limit line and its "no more seats" line get `note`; its "You have reached the limit" message
  gets `banner banner--conflict` (a warning: the customer can do nothing more here, but nothing
  failed).

Roles, text, and controls stay. Apart from the one `banner__body` wrapper, only `className` is
added. `admin-app/src/pages/EventList.tsx`
already uses a plain `<p className="banner banner--error">`, so a banner without the icon and body
parts is an existing pattern.

**Rationale**: FR-010 needs the same look for the same kind of message; adding a class is the
smallest change that gets it, and every existing test that finds messages by role or text keeps
passing.

**Alternatives considered**: Replacing the Admin pages' copies with the shared
`ServiceUnreachable` component (a reasonable cleanup, but a behavior-neutral refactor outside this
feature). A new shared React `Banner` component (Out of Scope: the theme shares styles, not
components).

## R9. Spacing steps, and moving app spacing onto them

**Decision**: Steps of 4, 8, 12, 16, 20, 24, and 32 pixels (R3). The theme's own shared rules keep
their exact spacing. In each app's remaining screen rules, each spacing value moves to the
nearest step, ties going up, and `0` stays `0`: 2→4, 6→8, 10→12, 11→12, 14→16, 18→20, 22→24; 4,
8, 12, 16, and 24 map exactly. A negative margin (`.conflict-detail`'s `-8px`) becomes
`calc(-1 * var(--space-2))`.

**Rationale**: Constitution VII requires app styles to take spacing from the theme; C5 makes that
checkable. Rounding moves nothing by more than 2 pixels (spec FR-012). Ties go up so nothing gets
tighter than today.

**Alternatives considered**: Steps matching every value in use (2, 4, 6, 8, 10, 11, 12, 14, 16,
18, 22, ...): not a set of steps, just today's numbers renamed. Leaving app spacing unchecked: the
constitution names spacing explicitly.

## R10. Showing both apps really use the theme

**Decision**: Three layers, no screenshot tooling:

1. **Static**, in the shared package: `load.test.ts` checks the package export, that both apps'
   `vite.config.ts` and `vitest.config.ts` alias `@queuepass/shared/theme.css` to
   `packages/shared/src/web/theme.css`, and that both `main.tsx` files import it before
   `./styles.css`. `tokens.test.ts` checks the theme file: every color token in the light set is
   also in the dark set; colors are written out only inside the two token blocks; the spacing
   steps and new tokens exist; no `data-theme`. Plus `drift.test.ts` (R6) and `contrast.test.ts`
   (R7).
2. **Render**, in each app: a test renders key controls and asserts they carry theme classes.
   Customer (`customer-app/test/theme-classes.test.tsx`): the Get tickets confirm button
   (`.btn.btn--primary`), a refusal (`.banner.banner--error`, role `alert`), the couldn't-confirm
   message (`.banner.banner--conflict`), and `ServiceUnreachable` (`.banner.banner--error`). Admin
   (`admin-app/test/theme-classes.test.tsx`): an unreachable event page shows
   `.banner.banner--error`, and the form's save button is `.btn.btn--primary`. Shared
   (`packages/shared/test/web/service-unreachable.test.tsx`): the component's classes and role.
3. **Running system** (quickstart S2): the same short browser console snippet, run in both apps,
   prints the computed colors, typeface, and radius of the primary button, a field, a link, and an
   error banner; the two outputs must match, in light and dark.

**Rationale**: jsdom does not apply stylesheets, so render tests can prove only the classes, and
the static tests prove those classes come from one file. Real computed styles are compared in the
browser, where they exist. Together they cover SC-001, SC-002, and FR-014 without a new tool.

**Alternatives considered**: Screenshot diffing with Playwright (a new dependency, browser
installs in CI, and flaky pixel baselines for a proof of concept). Asserting computed styles in
jsdom (it does not cascade linked CSS, so the test would prove nothing).

## R11. Shared surface, and merging alongside other features

**Decision**: The plan records that this feature changes `packages/shared/` (a new file, an export,
one component's class, and tests), so both its PRs need every team member's approval
(Constitution, shared surface). No root `package.json`, contract, Backend, or Compose change.

To keep conflicts small:

- **`015-seat-holds`** (in progress, not yet on the remote): it will change the Customer seat
  picker. 012 leaves the seat rules in `customer-app/src/styles.css` and `SeatPicker.tsx` alone,
  except that the seat block's spacing values (`4px`, `4px 0`, `6px 2px`) become theme steps. If
  015 merges first, 012's implementer applies R9 to any rules 015 added; the drift check names
  them. If 012 merges first, 015 must pass the check, which tells it what to use. Any new held-seat
  state or message 015 adds uses theme values and existing theme classes.
- **`016-per-user-ticket-limit`**: its spec merged (#29); its implementation is PR #32. It
  changes `GetTickets.tsx` and the Admin `EventForm.tsx` and `EventDetail.tsx`, not
  `SeatPicker.tsx`, and adds no CSS, so it passes the drift check. In `GetTickets.tsx` it adds
  three plain `<p>` lines: the limit ("Limit: 8 tickets per customer. You can get 3 more."), the
  reached message ("You have reached the limit of ..."), and "No more seats can be chosen: ...".
  **Decision**: whichever of 012 and 016 merges second gives those lines theme classes (R8).
  012's implementation will most likely start from a `main` that already has #32, so T022 does it,
  test first in T017, and more generally gives the theme's status styles to every status message
  on `main` when 012's implementation starts (spec FR-010). If 012 merges first, 016 adds the
  classes itself.

**Rationale**: Moving tokens and shared controls, not screen-specific rules, keeps 012's edits
away from the screens other features are changing.

**Alternatives considered**: Waiting for 015 and 016 to merge first (blocks this feature on work
with no date).

## R12. The Booth app

**Decision**: No change. Its `main.tsx` does not import the theme; its configs get no alias. The
drift check already reads `booth-app/src`, which has no stylesheet, so it passes, and any style the
Booth app gains later must follow the same rules.

**Rationale**: Constitution VII: the Booth app stays a plain stub and adopts the theme when a spec
gives it functionality. Covering it in the check costs nothing and means its adoption starts from
the theme.

**Alternatives considered**: Loading the theme in the Booth app now (contradicts Constitution VII
and FR-015).
