# Implementation Plan: Report Exports

**Branch**: `023-report-exports-spec` | **Date**: 2026-10-30 | **Spec**: [spec.md](./spec.md) |
**Issue**: [#52](https://github.com/Trughouse-Holdings/QueuePass/issues/52)

**Input**: Feature specification from `specs/023-report-exports/spec.md`

## Summary

- **Made in the Admin app** (research R1) from the data the Attendees and Reports pages already
  hold, so files always match the screen. No Backend, contract, or database change.
- **One table model, three writers** (R3): pure builders turn `Order[]` and `SalesReport` into typed
  rows (one per ticket; one per event plus Total); `csv.ts` (no library, R9), `xlsx.ts`
  (`write-excel-file`, R2), and `pdf.ts` (`jspdf` + `jspdf-autotable`, R10) write them. The libraries
  load on first use only.
- **Times in the venue's zone** (R4), **money exact** (R5), **no formula runs** (R6), **made-at**
  from the report's `generatedAt` or the attendee load time (R7), **file names** (R8).
- **A Download disclosure** on each page (R11): CSV, Excel (XLSX), PDF; a personal-data note on the
  attendee list; "Preparing…" and errors announced.
- **Exports are not recorded**: a recorded deferral to the audit log #51 (R13).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict), React 19, Vite 6, Node.js 22 LTS.

**Primary Dependencies**: new in `admin-app`: `write-excel-file` 4.1.1, `jspdf` 4.2.1,
`jspdf-autotable` 5.0.8 (exact pins); dev: `read-excel-file` (exact, T001). `@queuepass/shared` for
`toLocalDateTime`, `zoneName`, and the API types.

**Storage**: none.

**Testing**: Vitest + React Testing Library in `admin-app`: the table builders with exact expected
rows; each writer on the same small table (CSV text exactly; XLSX read back with `read-excel-file`
for types and values; PDF: the layout model exactly and the bytes for structure, R10); the Download control (keyboard, states, the save
call); size runs at 5,000 and 25,000 tickets.

**Target Platform**: the Admin app in desktop browsers and at phone width; Excel, Numbers, Google
Sheets, and a PDF viewer as readers.

**Project Type**: web application (Admin front end only).

**Performance Goals**: 5,000 tickets in each format within 10 s (SC-003).

**Constraints**: no new Backend surface (FR-013 via existing admin-only operations); shared theme
styles only (Constitution VII); the Admin app's first-load bundle unchanged (dynamic imports).

**Scale/Scope**: two pages, about eight new modules.

## Constitution Check

| Principle | Check | Result |
| --- | --- | --- |
| I. Contract first | No operation added or changed; files are made from existing typed responses | Pass |
| II. One command | No new service or setup | Pass |
| III. Spec-driven | Spec + plan PR, independent review, fresh implementer | Pass |
| IV. Server-authoritative | Exports enforce no rule; the figures are the Backend's | Pass (n/a) |
| V. Least privilege | Only the admin-only Admin app and admin-only operations (FR-013) | Pass |
| VI. Test-first | Builders, writers, and control tested first; the quickstart walk | Pass |
| VII. Shared look | `.btn`, `.note`, `.banner` only; no new colors | Pass |
| VIII. Simplicity | No worker until measured (R12); recording deferred to #51, named (R13) | Pass |

No constitution change.

## Project Structure

### Documentation (this feature)

```text
specs/023-report-exports/
├── spec.md, plan.md, research.md (R1–R13), data-model.md, quickstart.md (E0–E6)
├── contracts/README.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code

```text
admin-app/
├── package.json                      # three dependencies, one dev dependency (R2)
├── src/export/
│   ├── table.ts                      # Cell, ExportTable types (data-model.md)
│   ├── attendee-rows.ts, sales-rows.ts
│   ├── csv.ts, xlsx.ts, pdf.ts
│   ├── file-name.ts, save.ts
│   └── ExportMenu.tsx
├── src/pages/Attendees.tsx           # load time; ExportMenu with the note
├── src/pages/Reports.tsx             # ExportMenu
└── test/export/                      # builders, writers, control, size
README.md                             # 023 status row
```

**Structure Decision**: a folder in the Admin app; nothing shared, since no other app exports.

## Complexity Tracking

None.
