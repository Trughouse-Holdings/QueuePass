# Research: Report Exports

**Feature**: `023-report-exports` | **Spec**: [spec.md](./spec.md) | **Date**: 2026-10-30

Written unattended at Nate's request: each decision takes the recommended option and records the
alternatives, for the team to overturn in review of the spec PR.

## R1. Files are made in the Admin app, from the page's data

**Decision**: the Admin app builds every file in the browser from the data the page already holds
(`listAttendees` for the Attendees page, `getSalesReport` for Reports) and saves it with a `Blob` and
a temporary link, as `019` does for calendar files (`customer-app/src/components/AddToCalendar.tsx`).
No new Backend operation, no contract change.

**Rationale**: FR-003 asks for the same figures as the screen; building from the same objects makes a
difference impossible. Both operations are already admin-only on the Backend (FR-013). `019` research
R1 made the same choice for the same reasons (a presentation format of data the user already sees,
no rule enforced, nothing stored).

**Alternatives considered**: Backend endpoints that stream each format: a second code path that could
drift from the screen, three file libraries in the Backend, and a download that still needs the token
in a header and a `Blob` in the app. They would be the place to record exports for #51; that issue
can add a small "export recorded" call later without moving the files.

## R2. Libraries, loaded only when used

**Decision**: new Admin app dependencies, exact versions, each at least two weeks old today:

| Package | Version | For | License |
| --- | --- | --- | --- |
| `write-excel-file` | 4.1.1 (2026-06-08) | XLSX with typed cells, number formats, several sheets, frozen rows | MIT |
| `jspdf` | 4.2.1 (2026-03-17) | PDF document, fonts, pages | MIT |
| `jspdf-autotable` | 5.0.8 (2026-05-17) | Tables that break across pages with a repeated header | MIT |
| `read-excel-file` (dev only) | newest at T001 | Tests read the XLSX back and check cell values and types | MIT |
| `fflate` (dev only) | newest at T001 | Tests unzip the XLSX to check number formats and the frozen row, which `read-excel-file` does not return | MIT |

Entry points: `write-excel-file/browser` and, in tests, `read-excel-file/node` (neither package has a
`"."` export; review round 1, finding 3). Each format's module is loaded with a dynamic `import()` on
first use, so the Admin app's first load
does not grow; Vite splits them into their own chunks. CSV needs no library.

**Rationale**: small, maintained, browser-first, typed. `write-excel-file` writes real date and number
cells (FR-008); `jspdf-autotable` repeats headers and wraps cells (FR-009).

**Alternatives considered**: SheetJS (`xlsx` on npm is years out of date and has open advisories; its
current builds are off npm); `exceljs` (larger, last release 2024); `pdfmake` (declarative and good,
but bundles its fonts as a large virtual file system).

## R3. One table model, three writers

**Decision**: `admin-app/src/export/` with:

- `attendee-rows.ts`: `attendeeTable(event, orders, madeAt, madeBy)` → `{ title, columns, rows }`, one row per
  ticket (FR-004), cells typed as `{ kind: 'text' | 'dateTime' | 'money' | 'count', value }`;
- `sales-rows.ts`: `salesTable(report, madeBy)` → the same shape, one row per event plus Total (FR-005);
- `csv.ts`, `xlsx.ts`, `pdf.ts`: each takes the table model and returns a `Blob`;
- `file-name.ts` (FR-012) and `save.ts` (the `Blob` link, as `019`);
- `ExportMenu.tsx`: the Download control (FR-001, FR-002, FR-011, FR-014, FR-015).

**Rationale**: every figure is decided once, in the pure table builders, which carry most of the
tests; the writers only format.

## R4. Date-times in the venue's zone

**Decision**: every date-time is converted once, in the table builders, to the venue's local
wall-clock time with `toLocalDateTime(instant, zone)` from `@queuepass/shared` (`020`). CSV writes it
as `YYYY-MM-DD HH:MM` (FR-007). XLSX writes a date cell for that wall-clock time: a `Date` built with
`Date.UTC` from the local parts, because spreadsheet date cells have no zone and `write-excel-file`
converts a `Date` from its UTC value, with the format `yyyy-mm-dd hh:mm`; the About sheet and the
sales report's Time zone column name the zone (FR-006). The PDF shows the same text as CSV. The
made-at time is written with its offset (`2026-10-30T14:05:00-04:00`) in the admin's own zone.

**Rationale**: a reader sees the event's own local time, as on every QueuePass page since `020`; a
zone-less date cell is the only kind spreadsheets have.

## R5. Money exact

**Decision**: money arrives as decimal strings (`"45.00"`). CSV writes the string as it is. XLSX
writes `Number(value)` with the format `"$"#,##0.00`; every amount has at most two decimals and is far
below 2^53 cents, so the number shown is exact and sums display to the cent (SC-002). The PDF shows
`usd()`'s text, as the page does.

**Alternatives considered**: integer cents in the file (exact, but not what a reader expects).

## R6. Formula injection

**Decision**: CSV text cells whose first character is `=`, `+`, `-`, `@`, tab, or carriage return
are written with a leading apostrophe (`'=SUM(1,1)`), the OWASP CSV-injection guidance. On CSV import
Numbers, Google Sheets, and LibreOffice show the apostrophe in the cell (review round 1, finding 5);
that visible guard is accepted and documented (spec FR-010). XLSX text is always written as a string cell (never a formula
cell), which spreadsheets never evaluate (FR-010). Only text cells are touched: money, counts, and
dates are never text.

## R7. The made-at time (FR-003)

**Decision**: Reports uses `SalesReport.generatedAt`, which the Backend sets when it computes the
report (a UTC `Z` string; the files show it converted to the admin's own zone with its offset, through
`toOffsetDateTime(instant, adminZone)`). Attendees records the time its `listAttendees` answer arrived (`Date.now()` when the load
finishes); a reload refreshes both data and time.

## R8. File names (FR-012)

**Decision**: `attendees-<slug>-<YYYY-MM-DD-HHmm>.<ext>` and `sales-report-<YYYY-MM-DD-HHmm>.<ext>`;
`slug` = the event name NFKD-normalized, diacritics removed, lower case, runs of anything but `a-z`
and `0-9` turned into one `-`, trimmed of `-`, cut to 60 characters, `event` if empty. Time: the
file's made-at time (R7) in the admin's own zone, so two downloads from one page load share a name
(review round 1, finding 7). `fileName(kind, slug, madeAt, zone, ext)` takes the zone as an argument
(the app passes `Intl.DateTimeFormat().resolvedOptions().timeZone`), so tests do not depend on the
device zone or `QP_TEST_TZ`.

## R9. CSV details (FR-007)

**Decision**: UTF-8 with a byte-order mark; CRLF line ends; every field quoted only when it holds a
comma, quote, CR, or LF, quotes doubled (RFC 4180); one header row; `Exported at` last on every row.

## R10. PDF layout (FR-009)

**Decision**: letter landscape for both reports (the attendee list has 11 columns). Font: **Noto Sans**
Regular and Bold (SIL Open Font License; static TTFs from the Noto project, committed under
`admin-app/src/export/fonts/` with the license file), fetched as Vite asset URLs only when a PDF is
made and registered with `addFileToVFS`/`addFont`. It covers Latin, Greek, and Cyrillic and common
punctuation. jsPDF's built-in Helvetica is not used: one character above U+00FF switches a whole string
to two-byte codes and garbles it, and curly apostrophes are lost (review round 1, finding 2, run on
jspdf 4.2.1). `pdfText(s)` replaces any character the font lacks (checked against the font's character
map, built once) with `?` and reports whether it replaced any; if so, the heading adds "Some
characters are shown as ?; the CSV and Excel files have the exact text.";
heading: report title, event name (attendees), made at; body 9 pt, header bold with the theme's
accent as text, not a fill; `autoTable` with `showHead: 'everyPage'`, `overflow: 'linebreak'`, column
widths fixed for codes, dates, and numbers; footer "Page n of m" through `putTotalPages`. With an
embedded font the page text is glyph codes, not readable in the raw file, so tests check the layout
model (`pdfLayout(table)`: heading lines, head, body strings, column widths, all pure) exactly, and the
PDF bytes only for structure: `%PDF`, the letter landscape `MediaBox`, the page count, the embedded
font.

## R11. The Download control (FR-001, FR-002, FR-011, FR-014, FR-015)

**Decision**: a native `<details>`/`<summary>` disclosure labelled **Download** with three buttons,
"CSV", "Excel (XLSX)", "PDF", in the page head beside the existing actions, using the shared `.btn`
styles; for attendees, a `.note` under it: "The file contains customers' names and usernames. Keep it
private." While a file is being made the three buttons are disabled and a `role="status"` line says
"Preparing the PDF…"; a failure shows a `role="alert"` banner "Couldn't make the PDF. Try again."
Not shown while loading, on a load error, or with no orders.

**Rationale**: `<details>` is keyboard- and screen-reader-accessible without script; shared styles
only (Constitution VII).

## R12. Size and speed

**Decision**: measured in T021: a generated set of 5,000 and 25,000 tickets through each writer in
Node (Vitest) and once in the browser. If the PDF of 25,000 rows takes long, the UI still shows
"Preparing…" and stays responsive enough to read; a Web Worker is the next step only if SC-003 (5,000
in 10 s) fails (Constitution VIII).

## R13a. Who made it

**Decision**: both pages pass `useAuth().username` (the token's `preferred_username`) as `madeBy` to
their table builder; it appears on the Excel About sheet and in the PDF heading (FR-008).

## R13b. Small rules from review round 1

- A void ticket's Checked in is empty, as the page shows only "(void)" for it.
- Every venue zone falls back to `DEFAULT_TIME_ZONE` when a response lacks it, as `when()` does
  (until #88's required fields are on `main`).

## R13. Recording exports: deferred to #51

**Decision**: not recorded (spec Assumptions). Recorded deferral: the audit log issue #51 closes it.
