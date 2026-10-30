---
description: "Task list for Report Exports"
---

# Tasks: Report Exports

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1–R13),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) (no API change),
[quickstart.md](./quickstart.md) (E0–E6)

**Issue**: [#52](https://github.com/Trughouse-Holdings/QueuePass/issues/52). The implementation
PR's **description** says `fixes #52` on its own line. No commit message may contain "fixes #52",
"closes #52", or "resolves #52".

**Tests**: **REQUIRED and written first** (Constitution VI). Write each phase's tests and see them
fail before the implementation below them.

## Ground rules

- **Fresh session** (Constitution III) on `023-report-exports-impl`, cut from the spec branch while
  its PR is open.
- **Commits**: `Impl 023: <what> (T0xx, #52)`.
- One independent review (T024), `npm run ci` green (T025), CI green on GitHub (T028).
- If spec `022`'s browser tests are on `main` when this is implemented, Constitution VI (as amended
  there) requires browser tests for this feature's main journey: add `e2e/tests/023-exports.spec.ts`
  (download each format from both pages, check the file name and a row) and the quickstart's
  Automation table (T027).

---

## Phase 1: Setup

- [x] T001 Cut the branch; `npm ci`; `npm run ci` green. Add to `admin-app/package.json` exactly
  `write-excel-file` `4.1.1`, `jspdf` `4.2.1`, `jspdf-autotable` `5.0.8`, and as a dev dependency
  `read-excel-file` and `fflate` at their newest versions at least two weeks old (record them here)
  (R2). Add the Noto Sans Regular and Bold TTFs and `OFL.txt` under `admin-app/src/export/fonts/`
  (R10), from the Noto project's release, recording the version and source URL here. `npm ci`
  green; the build still passes.
  **Done**: pinned `write-excel-file` 4.1.1, `jspdf` 4.2.1, `jspdf-autotable` 5.0.8; dev `read-excel-file` 9.3.12 (2026-10-07; 9.3.13+ are under two weeks old) and `fflate` 0.8.3 (2026-05-16). Fonts: Noto Sans v2.015 (unhinted static TTFs, 2024-11-20) from https://github.com/notofonts/latin-greek-cyrillic/releases/download/NotoSans-v2.015/NotoSans-v2.015.zip (`NotoSans/unhinted/ttf/NotoSans-{Regular,Bold}.ttf`, `OFL.txt`); sha256 Regular `f3961a9c…48b0e8`, Bold `87cb2d84…2529d9`. `npm ci` and the build green.
- [x] T002 `admin-app/src/export/table.ts`: the `Cell` and `ExportTable` types exactly as
  data-model.md.
  **Done**: `table.ts` as data-model.md, plus an optional `nowrap` on a column (Review 023, R10).

## Phase 2: Foundational (the table model)

### Tests first

- [x] T003 [P] `admin-app/test/export/attendee-rows.test.ts`: `attendeeTable(event, orders, madeAt, madeBy)`
  on fixtures with two tiers, a general-admission order, a seated order, a refunded order with a void
  ticket, an order with no holder name, a checked-in ticket, and a venue in `America/Chicago`, and a void ticket that has a check-in time (its Checked in
  stays empty, R13b):
  exact columns and rows as data-model.md (one per ticket, orders oldest first, tickets in order;
  "General admission", "No name on ticket", "Valid"/"Void", "Confirmed"/"Refunded"; Price =
  `unitPrice`; Order = first 8 characters of the id upper-cased; date-times as `YYYY-MM-DDTHH:mm` in
  Chicago time; empty Checked in when null); title "Attendees: <event>"; subtitle lines with made at,
  made by, and "Times are in Central Time (the venue's time zone)." Must fail.
  **Done**: 6 tests; failed (no module) before T005.
- [x] T004 [P] `admin-app/test/export/sales-rows.test.ts`: `salesTable(report, madeBy)` with events in
  two zones, one cancelled: one row per event in order, Time zone `zoneName`, Status, counts, revenue;
  last row Total with `totals` and Status "`<n>` scheduled events"; made at = `generatedAt` shown in a given admin zone with its offset (R7).
  Must fail.
  **Done**: 4 tests; failed (no module) before T005.

### Implementation

- [x] T005 `admin-app/src/export/attendee-rows.ts` and `sales-rows.ts` (R3, R4, R7), using
  `toLocalDateTime` and `zoneName` from `@queuepass/shared` and `seatLabel` from `../format`. T003,
  T004 pass.
  **Done**: `attendee-rows.ts`, `sales-rows.ts`, and `made.ts` (made-at and made-by lines); T003, T004 pass.

## Phase 3: User Story 1 + 2 - The three formats (P1) 🎯 MVP

### Tests first

- [x] T006 [P] [US1] `admin-app/test/export/csv.test.ts`: `toCsv(table)` returns a `Blob` whose text is
  exactly: BOM, header row, rows, CRLF line ends, `Exported at` last on every row; quoting of commas,
  quotes (doubled), CR and LF; dates `YYYY-MM-DD HH:MM`; money `45.00`; counts plain; a text cell
  starting with each of `=`, `+`, `-`, `@`, tab, CR gets a leading `'`, and money/count/date cells never
  do (R6, R9, FR-007, FR-010). Must fail.
  **Done**: 10 tests on a shared sample table (`test/export/sample.ts`); failed (no module) before T010.
- [x] T007 [P] [US1] `admin-app/test/export/xlsx.test.ts`: `toXlsx(table)` → `Blob`; read back with
  `read-excel-file` (both sheets): sheet 1 named per `sheetName`, header row then rows; date-time cells
  are `Date` with the venue wall-clock parts in UTC fields (R4); money cells are numbers (45 for
  `45.00`); counts numbers; `=SUM(1,1)` read back as the string `=SUM(1,1)`; sheet "About" holds title,
  subtitle lines, made at, and made by (FR-008, FR-010). Then unzip the file with `fflate`: in
  `xl/styles.xml` the money column's number format is `"$"#,##0.00` and the date columns'
  `yyyy-mm-dd hh:mm`; in `xl/worksheets/sheet1.xml` a frozen pane on row 1 (`state="frozen"`); the name
  cell is a shared string (`t="s"`), never a formula (`<f>`). Must fail.
  **Done**: 4 tests: read back with read-excel-file, then unzipped with fflate for formats, the frozen pane, and `t="s"`; failed before T011.
- [x] T008 [P] [US2] `admin-app/test/export/pdf.test.ts` (R10, FR-009): `pdfLayout(table, glyphs)` returns
  exactly the heading lines (title, event, made at, made by), the head, and the body strings;
  `pdfText` keeps `Zoë – Łukasz O’Brien Ελένη Пётр` unchanged and turns a character outside the font
  (for example `山`) into `?`, setting the flag that adds the heading note; `toPdf(table)` → a `Blob`
  starting `%PDF`, with a `/MediaBox` of `0 0 792 612` (jsPDF writes `[0 0 792. 612.]`; compare the numbers), the embedded Noto Sans font, one page for 10 rows
  and at least two for 200 rows (count `/Type /Page` objects). Must fail.
  **Done**: 7 tests; fonts read from disk (`test/export/fonts.ts`); failed before T012.
- [x] T009 [P] [US1] `admin-app/test/export/file-name.test.ts`: R8's examples with an explicit zone:
  "Export Test, Café", made at `2026-10-30T18:05:00Z`, zone `America/New_York` →
  `attendees-export-test-cafe-2026-10-30-1405.csv`; the same in `America/Los_Angeles` → `…-1105.csv`; empty-after-cleaning → `event`; 61+ characters
  cut to 60; `sales-report-…`. Must fail.
  **Done**: 6 tests (`fileName` and `slug`); per R8, "Zoë’s" becomes `zoe-s`; failed before T013.

### Implementation

- [x] T010 [US1] `admin-app/src/export/csv.ts` (R6, R9). T006 passes.
  **Done**: `csv.ts`; T006 passes.
- [x] T011 [US1] `admin-app/src/export/xlsx.ts` (R2, R4, R5): dynamic `import('write-excel-file/browser')`;
  two sheets; column widths from the table; frozen header row; typed cells. T007 passes.
  **Done**: `xlsx.ts` (bold frozen header, column widths, About sheet ending `Exported at <made at>`); T007 passes.
- [x] T012 [US2] `admin-app/src/export/pdf.ts` (R10): dynamic `import('jspdf')` and
  `import('jspdf-autotable')`; letter landscape; heading; table with repeated header, line-break
  overflow, 9 pt; footer "Page n of m". List any character the built-in font replaced in the test.
  T008 passes.
  **Done**: `pdf.ts` with `fontGlyphs`, `pdfText`, `pdfLayout`, `toPdf`; checked visually (PDFKit render: header on every page, Page n of m, long names wrapped). No character of the test strings is replaced; `山` and emoji become `?`. T008 passes.
- [x] T013 [US1] `admin-app/src/export/file-name.ts` (R8) and `save.ts` (a `Blob` URL on a temporary
  `<a download>`, revoked after the click, as `019`'s `AddToCalendar.tsx`). T009 passes.
  **Done**: `file-name.ts` and `save.ts`; T009 passes.

## Phase 4: The Download control on both pages (US1, US2, US3)

### Tests first

- [x] T014 [P] [US1] `admin-app/test/export/export-menu.test.tsx`: `ExportMenu` renders a `<details>`
  with summary "Download" and buttons "CSV", "Excel (XLSX)", "PDF"; keyboard: Tab to the summary,
  Enter opens, Tab to a button, Enter starts it; while a writer's promise is pending all three are
  disabled and a `role="status"` says "Preparing the <format>…"; a rejected writer shows a
  `role="alert"` "Couldn't make the <format>. Try again." and re-enables the buttons; a resolved one
  calls `save` with the file name and the `Blob` (FR-014, FR-015). Must fail.
  **Done**: 8 tests (writers and `save` mocked); jsdom has no Enter-opens-`<summary>` behavior, so a click stands in for that one key (Tab to the summary, Tab to a button, and Enter on it are real keys; E5 checks Enter in a browser). A failure to save also shows the alert. Failed before T017.
- [x] T015 [P] [US1] `admin-app/test/attendees-export.test.tsx` (tests are flat in `admin-app/test/`) (extend the existing Attendees
  test if there is one): with orders, the Download control and the note "The file contains customers'
  names and usernames. Keep it private." are shown; with no orders, while loading, and on a load
  error, neither is (FR-001, FR-011); choosing CSV saves a file built from the page's own orders and
  load time (FR-003, the stubbed API called once). Must fail.
  **Done**: 4 tests (new file; the existing `attendees.test.tsx` is untouched); failed before T018.
- [x] T016 [P] [US2] `admin-app/test/reports-export.test.tsx`: the control on Reports when the
  report is shown; CSV saved with `generatedAt` as made at (FR-002, FR-003). Must fail.
  **Done**: 4 tests, one through `App` and `AuthProvider` reading "Made by admin1" back from the Excel About sheet (R13a); failed before T019.

### Implementation

- [x] T017 [US1] `admin-app/src/export/ExportMenu.tsx` (R11): props `{ label, makeTable, fileName,
  note? }`; shared classes only. T014 passes.
  **Done**: `ExportMenu.tsx`: `<details>` with `.btn` summary, `.btn--ghost` buttons in a labelled group, `.note`, `role="status"`, `.banner--error` alert; writers loaded by dynamic import. T014 passes.
- [x] T018 [US1] `admin-app/src/pages/Attendees.tsx`: record the load time; pass
  `useAuth().username` as made by (R13a: from `App` as a `username` prop); place `ExportMenu` in the page head beside "Back to …", only
  when orders exist. T015 passes.
  **Done**: load time kept with the data; `username` prop from `App` (Review 023); Download in a `.form__actions` row beside "Back to …". T015 passes.
- [x] T019 [US2] `admin-app/src/pages/Reports.tsx`: `ExportMenu` in the page head with the signed-in
  admin's username as made by (from `useAuth()` in `App`, as a `username` prop, R13a). T016 passes.
  **Done**: Download in the page head; made at `generatedAt`; `username` prop from `App`. T016 passes.

## Phase 5: User Story 4, size, polish

- [ ] T020 [US4] Check FR-013 holds with no new code: the Customer and Booth apps have no export; the
  Admin app's role check covers both pages (existing tests); record here.
- [ ] T021 [P] `admin-app/test/export/size.test.ts` (R12, SC-003, SC-004): generated tables of 5,000
  and 25,000 tickets through each writer in Vitest; 5,000 finishes each format within 10 s (assert
  with a generous timer and print the times); 25,000 completes without error. Record the times here.
- [ ] T022 Confirm the Admin app's first-load chunk did not grow with the libraries (compare `vite
  build` output before and after; the libraries are in their own chunks). Record sizes.
- [ ] T023 README: the `023` status row and "Today" paragraph; one line in the Admin app section
  about Download.
- [ ] T024 Independent review by a separate Claude session (Constitution 3.3.0) against spec, plan,
  research; fix findings; record the round here.
- [ ] T025 `npm run ci` locally green; record counts.
- [ ] T026 Running-system walk, quickstart E0–E6 (Excel or Numbers, and a PDF print preview), on a
  stack built from this branch; record each result.
- [ ] T027 If `022` is on `main`: `e2e/tests/023-exports.spec.ts` and the Automation table in this
  quickstart (ground rules).
- [ ] T028 Push; open the implementation PR (after the spec PR merges and the branch is up to date):
  `fixes #52`, the review, test counts, sizes and times, the walk. CI green on GitHub; merge when
  green and approved.

## Dependencies & Execution Order

- T001–T002 → T003–T005 → T006–T013 → T014–T019 → T020–T028.
- T003/T004, T006–T009, T014–T016 are separate files: parallel.

## Implementation Strategy

- **MVP**: T001–T018: the attendee list downloads in three formats.
- Then Reports (T019), size and bundle checks, the review, the walk, the PR.

## Review record (spec branch)

- **Round 1** (independent Claude session, 2026-10-30; it ran jspdf 4.2.1, write-excel-file 4.1.1 and
  read-excel-file in Node): 2 must-fix, 5 should-fix, 4 minor; all fixed in the `Review 023` commit:
  - must: the test name `=1+1` is refused by `017` FR-003 (no letter), now `=SUM(1,1)`; jspdf's
    built-in font garbles any string with a character above U+00FF and drops curly apostrophes, so the
    PDF embeds Noto Sans and replaces characters outside it with `?`, noted in its heading (FR-009,
    R10, T001, T008).
  - should: the libraries' entry points are `write-excel-file/browser` and `read-excel-file/node`
    (R2, T011); number formats and the frozen row are checked by unzipping with `fflate` (T007); the
    CSV formula guard's apostrophe is visible on import and is now specified as such (FR-010, R6,
    SC-006); made by reaches both tables (R13a, T003, T018); file names use the made-at time with an
    explicit zone (FR-012, R8, T009), and `generatedAt` is shown in the admin's zone (R7).
  - minor: T021 for size; the default-zone fallback and a void ticket's empty check-in (R13b); SC-002
    sorts the attendee list only; flat test paths (T015, T016).
- **Open findings**: none.
