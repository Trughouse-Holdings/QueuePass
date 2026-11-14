# Contract Changes: Layout Editor

The single contract is [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) (Constitution I).

**2.0.0 → 2.1.0** (MINOR), in this spec and plan PR, on top of `038`'s step 2 (research R1).
Additions only: three operations marked `x-planned: '039'`, four new schemas, `DRAWN` added to
`LayoutSummary.source`, one error code, and two sentences on existing operations.
`packages/shared/src/api-schema.ts` is regenerated (`npm run generate:api`) and
`node scripts/check-contract-drift.mjs` passes; `ERROR_CODES` in `packages/shared/src/errors.ts`
gains `LAYOUT_CHANGED`.

**Why `main` stays green**: the new operations are `x-planned`, so the route-coverage test expects
`404` until the implementation; no response loses a field or changes type; `DRAWN` is never sent
before the implementation (research R1 on response enums); `revision` is new only in the new
`LayoutDrawing`. The apps compile unchanged against the regenerated types.

## New operations (`x-planned: '039'`)

| Operation | Method, path | Roles | Request → response | Errors |
| --- | --- | --- | --- | --- |
| `getLayoutDrawing` | `GET /layouts/{layoutId}/drawing` | `queuepass-admin` | → `LayoutDrawing` (every seat with its id and own level; `revision`; `locked`, `lockedBy`) | 400, 401, 403, 404 |
| `saveLayoutDrawing` | `PUT /layouts/{layoutId}/drawing` | `queuepass-admin` | `LayoutDrawingInput` (≤ 4 MB, `revision` required) → `LayoutDetail` | 400 `LAYOUT_FILE_INVALID` / `VALIDATION_FAILED`, 401, 403, 404, 409 `LAYOUT_CHANGED` / `LAYOUT_IN_USE` / `LAYOUT_NAME_TAKEN` / `CAPACITY_EXCEEDED`, 413 |
| `createLayoutDrawing` | `POST /locations/{id}/layouts/drawing` | `queuepass-admin` | `LayoutDrawingInput` (≤ 4 MB; ids and `revision` ignored) → 201 `LayoutDetail` | 400 `LAYOUT_FILE_INVALID` / `VALIDATION_FAILED`, 401, 403, 404, 409 `LAYOUT_NAME_TAKEN` / `CAPACITY_EXCEEDED`, 413 |

`saveLayoutDrawing` keeps every level, section, row and seat sent with its `id` (with the events'
prices and off-sale entries on them), deletes what is not sent, makes what has no `id`, numbers
rows and seats by order, puts new seats off sale for the scheduled events using the layout and
recomputes them, or refuses (`409 LAYOUT_IN_USE`) naming each event that would be left unable to
sell (research R4, R8).

Reads are `queuepass-admin` only, unlike `getVenueLayout`: the drawing carries editing state
(`revision`, `generator`, own levels, who locks it) that only the editor needs (Constitution V,
least privilege).

## New schemas

| Schema | Holds |
| --- | --- |
| `SectionGenerator` | `rows`, `seatsPerRow` (one number or one per row), `rowLabels` (`LETTERS`/`NUMBERS`), `firstRow`, `firstSeat`, `direction` (`LEFT_TO_RIGHT`/`RIGHT_TO_LEFT`), `curve` (0–120 degrees) (research R7) |
| `LayoutDrawing` | the layout as the editor reads it: ids, `revision`, `locked`, `lockedBy`, floor, size, levels with ids, sections with `origin`, `angle`, `generator`, `outline`, rows and seats with ids and own levels (defaults left out) |
| `LayoutDrawingFloor` | `kind`, and `outline` unless `NONE` |
| `LayoutDrawingInput` | the layout as the editor saves it: optional `revision`, `name`, floor, levels by `key` (optional `id`, best first), sections (optional `id`, `level` key, `origin`, `angle`, optional `generator`), rows and seats (optional `id`, labels, places, `level` keys, `accessible`); no outlines and no size (the Backend computes them, research R5) |

## Changed

- `LayoutSummary.source`: `enum: [FILE, LINES, DRAWN]`, description says which becomes which.
- `LayoutSummary.seatCount`: description includes drawn layouts in the 30,000 limit.
- `updateVenueLayout`: "a rename or a lines edit raises the layout's `revision` by one".
- `ErrorEnvelope.error.code`: `LAYOUT_CHANGED`; an example under `Conflict`.
- `info.version`: `2.1.0`.

## Error codes

| Code | Status | When | `details` |
| --- | --- | --- | --- |
| `LAYOUT_CHANGED` (new) | 409 | `saveLayoutDrawing` with a `revision` that is not the layout's current one | `revision`: the current one |
| `LAYOUT_FILE_INVALID` | 400 | a drawing with problems; the same shape as a file's (`problems` with `path` into the body, `more`) | as 038 |
| `LAYOUT_IN_USE` | 409 | locked, or an event would be left unable to sell | `events` as 038 |
