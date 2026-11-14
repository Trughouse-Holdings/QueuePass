import {
  LAYOUT_LIMITS,
  generateBlock,
  moveBy,
  normalizeAngle,
  placeBlock,
  turnAbout,
  type FloorKind,
  type SectionGenerator,
} from '@queuepass/shared';
import { outlineOf, seatLevel, type EdSection, type EditorDoc, type Place } from './editor-doc';

/**
 * Spec 039 research R10: the editor's state, one pure reducer over the document, the selection
 * and the history. Every change is an action and one history step; a step replaces only the
 * sections it touches (structural sharing), so the history keeps the last 100 documents cheaply.
 * `dirty` is "the document is not the one last loaded or saved", so an Undo back to it is clean.
 * Each step says what it did (`message`), for the status line and Undo's "Undone: …" (FR-027).
 */
export type Selection =
  | { kind: 'none' }
  | { kind: 'floor' }
  | { kind: 'sections'; ids: string[] }
  | { kind: 'rows'; sectionId: string; ids: string[] }
  | { kind: 'seats'; sectionId: string; ids: string[] };

export interface EditorState {
  /** The documents, oldest first; at most `HISTORY_LIMIT`. */
  history: EditorDoc[];
  /** What made each document (`steps[0]` is the load). */
  steps: string[];
  cursor: number;
  /** The document as last loaded or saved. */
  saved: EditorDoc;
  selection: Selection;
  /** The section zoomed into (its seats drawn), or none. */
  zoomed: string | null;
  /** The last `new:<n>` given out. */
  seq: number;
  /** The status line's announcement of the last action (FR-027). */
  message: string;
  /** A step that typing goes on changing (a name being typed), or none. */
  typing: string | null;
}

/** R10: at most this many documents (FR-014 asks at least the last 50 changes). */
export const HISTORY_LIMIT = 100;

export const FLOOR_NAMES: Record<FloorKind, string> = {
  COURT: 'Court',
  END_STAGE: 'End stage',
  CENTER_STAGE: 'Center stage',
  RING: 'Ring',
  NONE: 'None',
};

/** A new floor object's size in map units (seats are 2 apart). */
const FLOOR_SIZE: Record<Exclude<FloorKind, 'NONE'>, [number, number]> = {
  COURT: [100, 56],
  END_STAGE: [80, 30],
  CENTER_STAGE: [40, 40],
  RING: [30, 30],
};

export type Action =
  | { type: 'load'; doc: EditorDoc }
  | { type: 'saved'; doc?: EditorDoc }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'selectSections'; ids: string[] }
  | { type: 'toggleSection'; id: string }
  | { type: 'selectFloor' }
  | { type: 'clearSelection' }
  | { type: 'zoom'; id: string | null }
  | { type: 'rename'; name: string }
  | { type: 'setFloor'; kind: FloorKind; at: Place }
  | { type: 'moveFloor'; dx: number; dy: number }
  | { type: 'resizeFloor'; to: { x: number; y: number; width: number; height: number } }
  | { type: 'addSection'; name: string; values: SectionGenerator; levelId: string; at: Place }
  | { type: 'moveSections'; ids: string[]; dx: number; dy: number }
  | { type: 'turnSections'; ids: string[]; degrees: number }
  | { type: 'placeSection'; id: string; origin?: Place; angle?: number };

export const currentDoc = (s: EditorState): EditorDoc => s.history[s.cursor];
export const isDirty = (s: EditorState): boolean => currentDoc(s) !== s.saved;

/** The highest `new:<n>` in a document, so new ids never repeat one. */
function highestNew(doc: EditorDoc): number {
  let n = 0;
  const see = (id: string): void => {
    const m = /^new:(\d+)$/.exec(id);
    if (m) n = Math.max(n, Number(m[1]));
  };
  doc.levels.forEach((l) => see(l.id));
  for (const s of doc.sections) {
    see(s.id);
    for (const r of s.rows) {
      see(r.id);
      r.seats.forEach((x) => see(x.id));
    }
  }
  return n;
}

export function initState(doc: EditorDoc): EditorState {
  return {
    history: [doc],
    steps: ['Loaded'],
    cursor: 0,
    saved: doc,
    selection: { kind: 'none' },
    zoomed: null,
    seq: highestNew(doc),
    message: '',
    typing: null,
  };
}

// ------------------------------------------------------------------------------------ totals

export interface Totals {
  sections: number;
  seats: number;
  /** Under the 30,000 limit (FR-017). */
  seatsLeft: number;
  /** Seats in each level, resolved seat → row → section; 0 for a level no seat is in. */
  byLevel: Record<string, number>;
}

/** FR-017: the side panel's counts, from the document. */
export function totals(doc: EditorDoc): Totals {
  const byLevel: Record<string, number> = Object.fromEntries(doc.levels.map((l) => [l.id, 0]));
  let seats = 0;
  for (const s of doc.sections) {
    for (const r of s.rows) {
      for (const x of r.seats) {
        const id = seatLevel(s, r, x);
        byLevel[id] = (byLevel[id] ?? 0) + 1;
        seats += 1;
      }
    }
  }
  return {
    sections: doc.sections.length,
    seats,
    seatsLeft: LAYOUT_LIMITS.maxSeats - seats,
    byLevel,
  };
}

export const seatCount = (s: EdSection): number => s.rows.reduce((n, r) => n + r.seats.length, 0);

// ---------------------------------------------------------------------------------- history

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * One step: `doc` becomes the current document, after the cursor (the redo side goes), the oldest
 * dropped past 100. With `typing`, a step of the same `typing` key just before is replaced, so a
 * name typed letter by letter is one step.
 */
function commit(
  s: EditorState,
  doc: EditorDoc,
  message: string,
  extra: Partial<Pick<EditorState, 'selection' | 'seq' | 'zoomed'>> & { typing?: string } = {},
): EditorState {
  const { typing = null, ...rest } = extra;
  if (doc === currentDoc(s)) return { ...s, ...rest, message };
  const replace =
    typing !== null && s.typing === typing && s.cursor > 0 && s.cursor === s.history.length - 1;
  const keep = replace ? s.cursor : s.cursor + 1;
  let history = [...s.history.slice(0, keep), doc];
  let steps = [...s.steps.slice(0, keep), message];
  if (history.length > HISTORY_LIMIT) {
    history = history.slice(history.length - HISTORY_LIMIT);
    steps = steps.slice(steps.length - HISTORY_LIMIT);
  }
  return { ...s, ...rest, history, steps, cursor: history.length - 1, message, typing };
}

/** The selection with what no longer exists taken out. */
function sanitize(sel: Selection, doc: EditorDoc): Selection {
  if (sel.kind === 'none') return sel;
  if (sel.kind === 'floor') return doc.floor.outline ? sel : { kind: 'none' };
  if (sel.kind === 'sections') {
    const ids = sel.ids.filter((id) => doc.sections.some((x) => x.id === id));
    return ids.length > 0 ? { kind: 'sections', ids } : { kind: 'none' };
  }
  const section = doc.sections.find((x) => x.id === sel.sectionId);
  if (!section) return { kind: 'none' };
  const present = new Set(
    sel.kind === 'rows'
      ? section.rows.map((r) => r.id)
      : section.rows.flatMap((r) => r.seats.map((x) => x.id)),
  );
  const ids = sel.ids.filter((id) => present.has(id));
  return ids.length > 0 ? { ...sel, ids } : { kind: 'none' };
}

function travel(s: EditorState, to: number, word: 'Undone' | 'Redone'): EditorState {
  if (to < 0 || to >= s.history.length) return s;
  const step = word === 'Undone' ? s.steps[s.cursor] : s.steps[to];
  const doc = s.history[to];
  const zoomed = s.zoomed && doc.sections.some((x) => x.id === s.zoomed) ? s.zoomed : null;
  return {
    ...s,
    cursor: to,
    selection: sanitize(s.selection, doc),
    zoomed,
    message: `${word}: ${lowerFirst(step)}`,
    typing: null,
  };
}

// --------------------------------------------------------------------------------- geometry

/** Every place of a document: seats, outlines, origins, the floor. */
function* places(doc: EditorDoc): Generator<Place> {
  for (const s of doc.sections) {
    yield s.origin;
    yield* s.outline;
    for (const r of s.rows) for (const x of r.seats) yield x.at;
  }
  if (doc.floor.outline) yield* doc.floor.outline;
}

const shiftSection = (s: EdSection, dx: number, dy: number): EdSection => ({
  ...s,
  origin: [s.origin[0] + dx, s.origin[1] + dy],
  outline: moveBy(s.outline, dx, dy),
  rows: s.rows.map((r) => ({
    ...r,
    seats: r.seats.map((x) => ({ ...x, at: [x.at[0] + dx, x.at[1] + dy] as Place })),
  })),
});

const turnSection = (s: EdSection, degrees: number): EdSection => ({
  ...s,
  angle: normalizeAngle(s.angle + degrees),
  outline: turnAbout(s.outline, s.origin, degrees),
  rows: s.rows.map((r) => ({
    ...r,
    seats: r.seats.map((x) => ({ ...x, at: turnAbout([x.at], s.origin, degrees)[0] })),
  })),
});

/**
 * R5, FR-005: no place below 0. When something has gone past the top or left edge, everything
 * moves right or down by whole units until it is 1 unit inside; the map grows to fit.
 */
function keepOnMap(doc: EditorDoc): EditorDoc {
  let minX = Infinity;
  let minY = Infinity;
  for (const [x, y] of places(doc)) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  }
  const dx = minX < 0 ? Math.ceil(-minX) + 1 : 0;
  const dy = minY < 0 ? Math.ceil(-minY) + 1 : 0;
  if (dx === 0 && dy === 0) return doc;
  return {
    ...doc,
    floor: doc.floor.outline
      ? { ...doc.floor, outline: moveBy(doc.floor.outline, dx, dy) }
      : doc.floor,
    sections: doc.sections.map((s) => shiftSection(s, dx, dy)),
  };
}

/** The sections of `ids` changed by `change`, the others as they were (shared). */
const changeSections = (
  doc: EditorDoc,
  ids: readonly string[],
  change: (s: EdSection) => EdSection,
): EditorDoc => {
  const set = new Set(ids);
  return { ...doc, sections: doc.sections.map((s) => (set.has(s.id) ? change(s) : s)) };
};

const sectionsWord = (doc: EditorDoc, ids: readonly string[]): string => {
  if (ids.length === 1) return `Section ${doc.sections.find((s) => s.id === ids[0])?.name ?? ''}`;
  return `${ids.length} sections`;
};

const rect = (cx: number, cy: number, w: number, h: number): Place[] => [
  [cx - w / 2, cy - h / 2],
  [cx + w / 2, cy - h / 2],
  [cx + w / 2, cy + h / 2],
  [cx - w / 2, cy + h / 2],
];

// ---------------------------------------------------------------------------------- reducer

export function reduce(s: EditorState, a: Action): EditorState {
  const doc = currentDoc(s);
  switch (a.type) {
    case 'load':
      return initState(a.doc);
    case 'saved': {
      // The document saved, or as read back after the save (with the ids the Backend gave), in
      // place of the current step: the steps before stay, so Undo past the save still works.
      if (!a.doc) return { ...s, saved: doc, typing: null, message: 'Layout saved' };
      const history = [...s.history.slice(0, s.cursor), a.doc];
      return {
        ...s,
        history,
        steps: s.steps.slice(0, s.cursor + 1),
        saved: a.doc,
        seq: Math.max(s.seq, highestNew(a.doc)),
        selection: sanitize(s.selection, a.doc),
        zoomed: s.zoomed && a.doc.sections.some((x) => x.id === s.zoomed) ? s.zoomed : null,
        message: 'Layout saved',
        typing: null,
      };
    }
    case 'undo':
      return travel(s, s.cursor - 1, 'Undone');
    case 'redo':
      return travel(s, s.cursor + 1, 'Redone');

    case 'selectSections':
      return {
        ...s,
        selection: a.ids.length > 0 ? { kind: 'sections', ids: [...a.ids] } : { kind: 'none' },
        typing: null,
      };
    case 'toggleSection': {
      const ids = s.selection.kind === 'sections' ? s.selection.ids : [];
      const next = ids.includes(a.id) ? ids.filter((i) => i !== a.id) : [...ids, a.id];
      return reduce(s, { type: 'selectSections', ids: next });
    }
    case 'selectFloor':
      return doc.floor.outline ? { ...s, selection: { kind: 'floor' }, typing: null } : s;
    case 'clearSelection':
      return { ...s, selection: { kind: 'none' }, typing: null };
    case 'zoom':
      return {
        ...s,
        zoomed: a.id,
        selection: a.id ? { kind: 'sections', ids: [a.id] } : s.selection,
        typing: null,
      };

    case 'rename':
      return commit(s, { ...doc, name: a.name }, `Layout named ${a.name.trim()}`, {
        typing: 'rename',
      });

    case 'setFloor': {
      if (a.kind === 'NONE') {
        return commit(
          s,
          { ...doc, floor: { kind: 'NONE', outline: null } },
          'Floor object removed',
          {
            selection: s.selection.kind === 'floor' ? { kind: 'none' } : s.selection,
          },
        );
      }
      const outline = doc.floor.outline ?? rect(a.at[0], a.at[1], ...FLOOR_SIZE[a.kind]);
      return commit(
        s,
        keepOnMap({ ...doc, floor: { kind: a.kind, outline } }),
        `Floor object set to ${FLOOR_NAMES[a.kind]}`,
      );
    }
    case 'moveFloor': {
      if (!doc.floor.outline || (a.dx === 0 && a.dy === 0)) return s;
      const outline = moveBy(doc.floor.outline, a.dx, a.dy);
      return commit(
        s,
        keepOnMap({ ...doc, floor: { ...doc.floor, outline } }),
        'Floor object moved',
      );
    }
    case 'resizeFloor': {
      const from = doc.floor.outline;
      if (!from || a.to.width < 1 || a.to.height < 1) return s;
      const xs = from.map((p) => p[0]);
      const ys = from.map((p) => p[1]);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      const w = Math.max(...xs) - x0 || 1;
      const h = Math.max(...ys) - y0 || 1;
      // A polygon of any shape is stretched to the new bounds (R11).
      const outline = from.map((p): Place => [
        a.to.x + ((p[0] - x0) * a.to.width) / w,
        a.to.y + ((p[1] - y0) * a.to.height) / h,
      ]);
      return commit(
        s,
        keepOnMap({ ...doc, floor: { ...doc.floor, outline } }),
        'Floor object resized',
      );
    }

    case 'addSection': {
      const { seats } = totals(doc);
      let block;
      try {
        block = placeBlock(generateBlock(a.values), a.at, 0);
      } catch {
        return { ...s, message: 'The section could not be generated' };
      }
      const adding = block.rows.reduce((n, r) => n + r.seats.length, 0);
      if (
        seats + adding > LAYOUT_LIMITS.maxSeats ||
        doc.sections.length >= LAYOUT_LIMITS.maxSections
      ) {
        return { ...s, message: 'The layout would be over its limits' };
      }
      let seq = s.seq;
      const next = (): string => `new:${(seq += 1)}`;
      const rows = block.rows.map((r) => ({
        id: next(),
        label: r.label,
        levelId: null,
        seats: r.seats.map((x) => ({
          id: next(),
          label: x.label,
          at: x.at,
          levelId: null,
          accessible: false,
        })),
      }));
      const section: EdSection = {
        id: next(),
        name: a.name.trim(),
        levelId: a.levelId,
        origin: [a.at[0], a.at[1]],
        angle: 0,
        generator: a.values,
        outline: [],
        rows,
      };
      section.outline = outlineOf(rows);
      return commit(
        s,
        keepOnMap({ ...doc, sections: [...doc.sections, section] }),
        `Section ${section.name} added`,
        { selection: { kind: 'sections', ids: [section.id] }, seq },
      );
    }

    case 'moveSections': {
      const moving = doc.sections.filter((x) => a.ids.includes(x.id));
      if (moving.length === 0) return s;
      // Never past the far edges (5,000): the move stops there.
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const x of moving) {
        for (const [px, py] of x.outline) {
          maxX = Math.max(maxX, px);
          maxY = Math.max(maxY, py);
        }
      }
      const dx = Math.min(a.dx, LAYOUT_LIMITS.maxMapUnits - maxX);
      const dy = Math.min(a.dy, LAYOUT_LIMITS.maxMapUnits - maxY);
      if (dx === 0 && dy === 0) return s;
      return commit(
        s,
        keepOnMap(changeSections(doc, a.ids, (x) => shiftSection(x, dx, dy))),
        `${sectionsWord(doc, a.ids)} moved`,
      );
    }

    case 'turnSections': {
      if (a.degrees % 360 === 0 || !doc.sections.some((x) => a.ids.includes(x.id))) return s;
      const turned = keepOnMap(changeSections(doc, a.ids, (x) => turnSection(x, a.degrees)));
      const one = a.ids.length === 1 ? turned.sections.find((x) => x.id === a.ids[0]) : undefined;
      return commit(
        s,
        turned,
        one
          ? `Section ${one.name} turned to ${one.angle}°`
          : `${a.ids.length} sections turned ${normalizeAngle(a.degrees)}°`,
      );
    }

    case 'placeSection': {
      // Typed in the Selection panel (FR-011): a new origin moves it, a new angle turns it by the
      // difference. Typing on is one step.
      const section = doc.sections.find((x) => x.id === a.id);
      if (!section) return s;
      let changed = section;
      if (a.angle !== undefined && Number.isFinite(a.angle)) {
        changed = turnSection(changed, normalizeAngle(a.angle) - changed.angle);
      }
      if (a.origin && a.origin.every(Number.isFinite)) {
        changed = shiftSection(
          changed,
          a.origin[0] - changed.origin[0],
          a.origin[1] - changed.origin[1],
        );
      }
      if (changed === section) return s;
      const what = a.angle !== undefined ? `turned to ${changed.angle}°` : 'moved';
      return commit(
        s,
        keepOnMap(changeSections(doc, [a.id], () => changed)),
        `Section ${section.name} ${what}`,
        { typing: `place:${a.id}:${a.angle !== undefined ? 'angle' : 'origin'}` },
      );
    }
  }
}
