import {
  LAYOUT_LIMITS,
  SIZE_MARGIN,
  normalizeAngle,
  outlineAround,
  type FloorKind,
  type LayoutDrawing,
  type LayoutDrawingInput,
  type LevelColor,
  type SectionGenerator,
} from '@queuepass/shared';

/**
 * Spec 039 research R10 (data-model "The editor's document"): the layout as the editor holds it
 * while it is open. Every level, section, row and seat keeps the id it was read with, or a
 * temporary `new:<n>` id until it is saved (R4: what is sent without an id is new). Places are map
 * units, `y` down. A seat's level is its own, else its row's, else its section's (038 FR-003).
 *
 * The layout's id and `revision` are kept beside the document, not in it (`editor-state.ts`), so
 * Undo past a save never sends a stale revision.
 */
export type Place = [number, number];

export interface EdSeat {
  id: string;
  label: string;
  at: Place;
  /** Its own level, or `null` for its row's. */
  levelId: string | null;
  accessible: boolean;
}

export interface EdRow {
  id: string;
  label: string;
  /** Its own level, or `null` for its section's. */
  levelId: string | null;
  /** Left to right as seen from the floor. */
  seats: EdSeat[];
}

export interface EdSection {
  id: string;
  name: string;
  levelId: string;
  /** The point it moves and turns about (R6). */
  origin: Place;
  /** Degrees clockwise it has been turned, in (−180, 180]. */
  angle: number;
  generator: SectionGenerator | null;
  /** Around its seats (`outlineAround`, R5): the editor never takes an outline from elsewhere. */
  outline: Place[];
  /** Front first. */
  rows: EdRow[];
}

export interface EdLevel {
  id: string;
  name: string;
  color: LevelColor;
}

export interface EdFloor {
  kind: FloorKind;
  /** `null` with `NONE`. */
  outline: Place[] | null;
}

export interface EditorDoc {
  name: string;
  floor: EdFloor;
  /** Best first: the order is the rank. */
  levels: EdLevel[];
  /** In drawing order. */
  sections: EdSection[];
}

/** Whether an id was made in the editor and has not been saved. */
export const isNew = (id: string): boolean => id.startsWith('new:');

/** The level a seat is in: its own, else its row's, else its section's. */
export const seatLevel = (section: EdSection, row: EdRow, seat: EdSeat): string =>
  seat.levelId ?? row.levelId ?? section.levelId;

/** The outline around a section's rows of seats (R5). */
export const outlineOf = (rows: readonly EdRow[]): Place[] =>
  outlineAround(rows.map((r) => r.seats.map((s) => s.at)));

/** R12, FR-001: a new layout starts with one level, "Standard", violet, and nothing else. */
export const emptyDoc = (): EditorDoc => ({
  name: '',
  floor: { kind: 'NONE', outline: null },
  levels: [{ id: 'new:0', name: 'Standard', color: 'violet' }],
  sections: [],
});

const place = (p: readonly number[]): Place => [p[0], p[1]];

/** R3: the drawing as the editor's document; levels by rank, outlines drawn around the seats. */
export function fromDrawing(d: LayoutDrawing): EditorDoc {
  return {
    name: d.name,
    floor:
      d.floor.kind === 'NONE' || !d.floor.outline
        ? { kind: d.floor.kind, outline: null }
        : { kind: d.floor.kind, outline: d.floor.outline.map(place) },
    levels: [...d.levels]
      .sort((a, b) => a.rank - b.rank)
      .map((l) => ({ id: l.id, name: l.name, color: l.color })),
    sections: d.sections.map((s) => {
      const rows: EdRow[] = s.rows.map((r) => ({
        id: r.id,
        label: r.label,
        levelId: r.levelId ?? null,
        seats: r.seats.map((x) => ({
          id: x.id,
          label: x.label,
          at: place(x.at),
          levelId: x.levelId ?? null,
          accessible: x.accessible ?? false,
        })),
      }));
      const seated = rows.some((r) => r.seats.length > 0);
      return {
        id: s.id,
        name: s.name,
        levelId: s.levelId,
        origin: place(s.origin),
        angle: s.angle,
        generator: s.generator ?? null,
        outline: seated ? outlineOf(rows) : s.outline.map(place),
        rows,
      };
    }),
  };
}

/** A place to 0.1 of a map unit (R3), never `-0`. */
const tenth = (n: number): number => {
  const r = Math.round(n * 10) / 10;
  return r === 0 ? 0 : r;
};
const roundPlace = (p: Place): Place => [tenth(p[0]), tenth(p[1])];

/**
 * R3, R10: the document as `LayoutDrawingInput`. Levels are keyed `l1`… best first; sections, rows
 * and seats name them by key; new items are sent without an id; places to 0.1; no outlines and no
 * size (the Backend draws and sizes them, R5). `revision` only for a layout that exists. A saved
 * item is sent with its id (R4: kept), a new one without; `fresh` sends none.
 */
export function toInput(
  doc: EditorDoc,
  revision: number | null,
  opts: { fresh?: boolean } = {},
): LayoutDrawingInput {
  // FR-023: Save as a new layout sends everything as new (the Backend ignores ids there anyway).
  const idOf = (id: string): { id?: string } => (opts.fresh || isNew(id) ? {} : { id });
  const keyOf = new Map(doc.levels.map((l, i) => [l.id, `l${i + 1}`]));
  const key = (levelId: string): string => keyOf.get(levelId) ?? levelId;
  return {
    ...(revision === null ? {} : { revision }),
    name: doc.name.trim(),
    floor:
      doc.floor.kind === 'NONE' || !doc.floor.outline
        ? { kind: 'NONE' }
        : { kind: doc.floor.kind, outline: doc.floor.outline.map(roundPlace) },
    levels: doc.levels.map((l) => ({
      ...idOf(l.id),
      key: key(l.id),
      name: l.name,
      color: l.color,
    })),
    sections: doc.sections.map((s) => ({
      ...idOf(s.id),
      name: s.name,
      level: key(s.levelId),
      origin: roundPlace(s.origin),
      angle: normalizeAngle(tenth(s.angle)),
      ...(s.generator ? { generator: s.generator } : {}),
      rows: s.rows.map((r) => ({
        ...idOf(r.id),
        label: r.label,
        ...(r.levelId ? { level: key(r.levelId) } : {}),
        seats: r.seats.map((x) => ({
          ...idOf(x.id),
          label: x.label,
          at: roundPlace(x.at),
          ...(x.levelId ? { level: key(x.levelId) } : {}),
          ...(x.accessible ? { accessible: true } : {}),
        })),
      })),
    })),
  };
}

/** The furthest place drawn (seats, outlines, the floor), for the map's size (R5). */
export function farthest(doc: EditorDoc): Place {
  let x = 0;
  let y = 0;
  const see = (p: Place): void => {
    if (p[0] > x) x = p[0];
    if (p[1] > y) y = p[1];
  };
  for (const s of doc.sections) {
    s.outline.forEach(see);
    see(s.origin);
  }
  doc.floor.outline?.forEach(see);
  return [x, y];
}

/** R5: the map's size as the Backend will set it: everything drawn plus a margin, at most 5,000. */
export function mapSize(doc: EditorDoc): { width: number; height: number } {
  const [x, y] = farthest(doc);
  return {
    width: Math.min(LAYOUT_LIMITS.maxMapUnits, Math.max(1, x + SIZE_MARGIN)),
    height: Math.min(LAYOUT_LIMITS.maxMapUnits, Math.max(1, y + SIZE_MARGIN)),
  };
}

/** A level's name, or '' for none. */
export const levelName = (doc: EditorDoc, id: string | null): string =>
  doc.levels.find((l) => l.id === id)?.name ?? '';
