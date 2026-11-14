import type { LayoutDrawing, LayoutDrawingInput } from '@queuepass/shared';

/**
 * Spec 039 (T002): helpers for the layout editor's whole-layout read and save.
 *
 * - `drawingToInput(drawing)`: what the editor would send back unchanged for a `LayoutDrawing`
 *   it read: every level keyed by its own id (a UUID matches the key pattern `^[a-z0-9-]{1,40}$`),
 *   every id kept, `revision` copied, each section's `origin`, `angle` and `generator` copied, and
 *   a row's or seat's `level` only where it has its own (`levelId`).
 * - `newDrawing()`: a new layout "Drawn": floor `COURT` (a rectangle), levels `a` "Front" (red)
 *   and `b` "Back" (teal), and three sections whose places are worked out here by hand (not by
 *   `generateBlock`), every place from 20 to 200 units:
 *   - "101" (level `b`), straight, 3 rows A–C × 4 seats, its row A in `a` (a row-level override);
 *   - "102" (level `a`), curved, 4 rows A–D of 4, 4, 6 and 6 seats on arcs about (140, 150), seats
 *     2 units apart along each arc; its row C seat 3 in `b` (a seat-level override);
 *   - "103" (level `b`), one row A of 5 seats, its seat 1 `accessible`.
 *   37 seats in all.
 */

type Input = LayoutDrawingInput;
type InputSection = Input['sections'][number];
type InputRow = InputSection['rows'][number];

export function drawingToInput(drawing: LayoutDrawing): Input {
  return {
    revision: drawing.revision,
    name: drawing.name,
    floor:
      drawing.floor.kind === 'NONE'
        ? { kind: 'NONE' }
        : { kind: drawing.floor.kind, outline: drawing.floor.outline },
    levels: drawing.levels.map((l) => ({ id: l.id, key: l.id, name: l.name, color: l.color })),
    sections: drawing.sections.map((s) => ({
      id: s.id,
      name: s.name,
      level: s.levelId,
      origin: s.origin,
      angle: s.angle,
      generator: s.generator,
      rows: s.rows.map((r) => ({
        id: r.id,
        label: r.label,
        ...(r.levelId ? { level: r.levelId } : {}),
        seats: r.seats.map((seat) => ({
          id: seat.id,
          label: seat.label,
          at: seat.at,
          ...(seat.levelId ? { level: seat.levelId } : {}),
          ...(seat.accessible ? { accessible: true } : {}),
        })),
      })),
    })),
  };
}

const round = (v: number): number => Math.round(v * 1000) / 1000;

/** `n` seats 2 apart along an arc of `radius` about `center`, centered on its top, left to right. */
function arc(center: [number, number], radius: number, n: number): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const a = ((i - (n - 1) / 2) * 2) / radius;
    return [round(center[0] + radius * Math.sin(a)), round(center[1] - radius * Math.cos(a))];
  });
}

export function newDrawing(): Input {
  const letters = 'ABCD';
  const straight: InputRow[] = [0, 1, 2].map((k) => ({
    label: letters[k],
    ...(k === 0 ? { level: 'a' } : {}),
    seats: [0, 1, 2, 3].map((i) => ({ label: String(i + 1), at: [47 + 2 * i, 60 - 2 * k] })),
  }));
  const counts = [4, 4, 6, 6];
  const curved: InputRow[] = counts.map((n, k) => ({
    label: letters[k],
    seats: arc([140, 150], 30 + 2 * k, n).map((at, i) => ({
      label: String(i + 1),
      at,
      ...(k === 2 && i === 2 ? { level: 'b' } : {}),
    })),
  }));
  const single: InputRow[] = [
    {
      label: 'A',
      seats: [0, 1, 2, 3, 4].map((i) => ({
        label: String(i + 1),
        at: [60 + 2 * i, 180],
        ...(i === 0 ? { accessible: true } : {}),
      })),
    },
  ];
  return {
    name: 'Drawn',
    floor: {
      kind: 'COURT',
      outline: [
        [80, 80],
        [120, 80],
        [120, 110],
        [80, 110],
      ],
    },
    levels: [
      { key: 'a', name: 'Front', color: 'red' },
      { key: 'b', name: 'Back', color: 'teal' },
    ],
    sections: [
      { name: '101', level: 'b', origin: [50, 60], angle: 0, rows: straight },
      { name: '102', level: 'a', origin: [140, 120], angle: 0, rows: curved },
      { name: '103', level: 'b', origin: [64, 180], angle: 0, rows: single },
    ],
  };
}

/** The seats `newDrawing()` makes. */
export const NEW_DRAWING_SEATS = 12 + 20 + 5;
