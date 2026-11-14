import { bounds, type Bounds } from '@queuepass/shared/web';
import type { EdLevel, EdSection, EditorDoc } from './editor-doc';
import { totals } from './editor-state';

/** R15: seats of two sections closer than this overlap. */
export const OVERLAP_DISTANCE = 1.5;
/** The grid the seats of one section are put in, so each seat is checked only near itself. */
const CELL = 2;

const meet = (a: Bounds, b: Bounds): boolean =>
  a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

const cellKey = (i: number, j: number): string => `${i},${j}`;

/** Whether a seat of `b` is closer than 1.5 units to a seat of `a`. */
function seatsOverlap(a: EdSection, b: EdSection): boolean {
  const grid = new Map<string, [number, number][]>();
  for (const r of a.rows) {
    for (const s of r.seats) {
      const k = cellKey(Math.floor(s.at[0] / CELL), Math.floor(s.at[1] / CELL));
      const list = grid.get(k);
      if (list) list.push(s.at);
      else grid.set(k, [s.at]);
    }
  }
  for (const r of b.rows) {
    for (const s of r.seats) {
      const ci = Math.floor(s.at[0] / CELL);
      const cj = Math.floor(s.at[1] / CELL);
      for (let di = -1; di <= 1; di += 1) {
        for (let dj = -1; dj <= 1; dj += 1) {
          for (const p of grid.get(cellKey(ci + di, cj + dj)) ?? []) {
            if (Math.hypot(p[0] - s.at[0], p[1] - s.at[1]) < OVERLAP_DISTANCE) return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * Spec 039 FR-020, research R15 (T034): the pairs of sections whose seats overlap, earlier section
 * first. Only sections whose outlines' bounds meet are compared (`compared` counts them), each
 * through a 2-unit grid of seats, so a 22,090-seat layout is checked well within 100 ms.
 */
export function findOverlaps(doc: EditorDoc): { pairs: [string, string][]; compared: number } {
  const boxes = doc.sections.map((s) => bounds(s.outline));
  const pairs: [string, string][] = [];
  let compared = 0;
  for (let i = 0; i < doc.sections.length; i += 1) {
    for (let j = i + 1; j < doc.sections.length; j += 1) {
      if (!meet(boxes[i], boxes[j])) continue;
      compared += 1;
      if (seatsOverlap(doc.sections[i], doc.sections[j])) {
        pairs.push([doc.sections[i].id, doc.sections[j].id]);
      }
    }
  }
  return { pairs, compared };
}

/** FR-020: the levels no seat is in (allowed; events never ask a price for them). */
export const emptyLevels = (doc: EditorDoc): EdLevel[] => {
  const t = totals(doc);
  return doc.levels.filter((l) => (t.byLevel[l.id] ?? 0) === 0);
};

/** The warnings before a save, in words, and the sections to outline on the map. */
export function warningsOf(doc: EditorDoc): { messages: string[]; sections: Set<string> } {
  const name = new Map(doc.sections.map((s) => [s.id, s.name]));
  const { pairs } = findOverlaps(doc);
  return {
    messages: [
      ...pairs.map(([a, b]) => `Section ${name.get(b)} overlaps ${name.get(a)}`),
      ...emptyLevels(doc).map((l) => `${l.name} has no seats`),
    ],
    sections: new Set(pairs.flat()),
  };
}
