# Data Model: Shared Theme

**No data model change.** This feature adds no tables, columns, or constraints, and no migration
(spec FR-016). It reads and writes no data.

## The theme (build-time entity)

The one entity is the **theme**: a fixed set of named values in
`packages/shared/src/web/theme.css`, plus the shared control styles built from them (research R2).
It is part of each app's build, not stored data. Names are the existing ones (research R3); new
tokens are marked **new**.

### Colors

Light values are on `:root`. Dark values redefine the same names under
`@media (prefers-color-scheme: dark) { :root { ... } }` (research R5). Values are today's, with the
Customer app's where the apps differ (research R4, marked †).

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | `#f6f7f9` | `#0f1115` | page background |
| `--surface` | `#ffffff` | `#171a21` | cards, top bar, fields, secondary buttons |
| `--surface-alt` | `#fafbfc` | `#1c2029` | table headings, hover, notes |
| `--border` | `#e3e6ea` | `#272c36` | card and table lines |
| `--border-strong` † | `#868e99` | `#6f7887` | control borders (3:1) |
| `--text` | `#16191d` | `#e8eaed` | body text |
| `--text-muted` | `#656d78` | `#9aa3b0` | labels, hints, table headings, secondary text |
| `--text-faint` | `#8b939d` | `#6f7887` | borders and decoration only, never text |
| `--accent` | `#4f46e5` | `#8b85f5` | primary buttons, links, active nav, focus, chosen seats |
| `--accent-hover` | `#4338ca` | `#a29bff` | primary button hover |
| `--accent-soft` | `#eef2ff` | `#1e1b4b` | active nav and pill background |
| `--accent-text` | `#ffffff` | `#0f1115` | text on the accent |
| `--danger`, `--danger-bg`, `--danger-border` | `#b42318`, `#fef3f2`, `#fda29b` | `#fda29b`, `#2a1513`, `#7a271a` | error banners, danger badges |
| `--warn`, `--warn-bg`, `--warn-border` | `#b54708`, `#fffaeb`, `#fdb022` | `#fdb022`, `#2b1c0b`, `#93370d` | warning banners and badges |
| `--ok`, `--ok-bg`, `--ok-border` | `#067647`, `#ecfdf3`, `#75e0a7` | `#75e0a7`, `#0d2a1c`, `#085d3a` | success banners |
| `--brand-mark-end` **new** | `#7c6cf7` | `#7c6cf7` | brand mark gradient end (was a literal) |
| `--brand-mark-text` **new** | `#ffffff` | `#ffffff` | brand mark letter (was `#fff`) |

### Typefaces, shape, and spacing

These are defined once on `:root` and are the same in light and dark, except the shadows.

| Token | Value | Used for |
|---|---|---|
| `--font` **new** | `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif` | body text (was a literal on `body`) |
| `--mono` | `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace` | ticket codes, `code` |
| `--radius` | `10px` | cards, banners |
| `--radius-sm` | `7px` | buttons, fields, seats |
| `--radius-pill` **new** | `99px` | pills, meters |
| `--shadow`, `--shadow-lg` | today's light and dark values | cards, tiles |
| `--space-1` **new** | `4px` | spacing step |
| `--space-2` **new** | `8px` | spacing step |
| `--space-3` **new** | `12px` | spacing step |
| `--space-4` **new** | `16px` | spacing step |
| `--space-5` **new** | `20px` | spacing step |
| `--space-6` **new** | `24px` | spacing step |
| `--space-8` **new** | `32px` | spacing step |

### Rules

- Colors are written out only in the two token blocks; every rule uses `var(--...)`.
- No app defines or redefines any of these names (research R6, C1).
- Every text color meets 4.5:1 and every control border and state 3:1 on the backgrounds it is
  used on, in light and dark (research R7).
- The set is fixed: no switch, no variant, no runtime change (spec FR-007).
