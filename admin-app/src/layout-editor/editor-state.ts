import {
  LAYOUT_LIMITS,
  LEVEL_COLORS,
  generateBlock,
  moveBy,
  normalizeAngle,
  placeBlock,
  turnAbout,
  type FloorKind,
  type LevelColor,
  type SectionGenerator,
} from '@queuepass/shared';
import {
  levelName,
  outlineOf,
  seatLevel,
  type EdRow,
  type EdSection,
  type EditorDoc,
  type Place,
} from './editor-doc';

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
  NONE: 'None',
  COURT: 'Court',
  END_STAGE: 'End stage',
  CENTER_STAGE: 'Center stage',
  RING: 'Ring',
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
  | { type: 'placeSection'; id: string; origin?: Place; angle?: number }
  | { type: 'selectRows'; sectionId: string; ids: string[]; add?: boolean }
  | { type: 'selectRowRange'; sectionId: string; toId: string }
  | { type: 'selectSeats'; sectionId: string; ids: string[]; add?: boolean }
  | { type: 'addLevel' }
  | { type: 'renameLevel'; id: string; name: string }
  | { type: 'recolorLevel'; id: string; color: LevelColor }
  | { type: 'moveLevel'; id: string; by: -1 | 1 }
  | { type: 'deleteLevel'; id: string; replacement: string }
  | { type: 'paint'; levelId: string }
  | { type: 'clearLevel' }
  | { type: 'duplicateSection'; id: string }
  | { type: 'renameSection'; id: string; name: string }
  | { type: 'deleteSeats'; sectionId: string; ids: string[] }
  | { type: 'deleteSections'; ids: string[] }
  | { type: 'relabelRow'; sectionId: string; rowId: string; label: string }
  | { type: 'relabelSeat'; sectionId: string; seatId: string; label: string }
  | { type: 'markAccessible'; sectionId: string; ids: string[]; accessible: boolean }
  | { type: 'regenerate'; id: string; values: SectionGenerator };

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

// ---------------------------------------------------------------------- levels and painting

/** R12, FR-015: what is wrong with a level's name, or null: 1–50 characters, unique ignoring case. */
export function levelNameProblem(doc: EditorDoc, id: string, name: string): string | null {
  const n = name.trim();
  if (n === '') return 'Name the level';
  if (n.length > LAYOUT_LIMITS.nameMaxLength)
    return `At most ${LAYOUT_LIMITS.nameMaxLength} characters`;
  if (doc.levels.some((l) => l.id !== id && l.name.toLowerCase() === n.toLowerCase()))
    return `Another level is named ${n}`;
  return null;
}

/** "Row A", "Rows A–D" (a run in order), or "Rows A, C". */
export function rowsWord(section: EdSection, ids: readonly string[]): string {
  const idx = section.rows.map((r, i) => (ids.includes(r.id) ? i : -1)).filter((i) => i >= 0);
  const labels = idx.map((i) => section.rows[i].label);
  if (labels.length === 1) return `Row ${labels[0]}`;
  const run = idx.every((i, k) => k === 0 || i === idx[k - 1] + 1);
  return run ? `Rows ${labels[0]}–${labels[labels.length - 1]}` : `Rows ${labels.join(', ')}`;
}

/** "Row B, seat 3", or "2 seats". */
export function seatsWord(section: EdSection, ids: readonly string[]): string {
  if (ids.length !== 1) return `${ids.length} seats`;
  for (const r of section.rows) {
    const x = r.seats.find((q) => q.id === ids[0]);
    if (x) return `Row ${r.label}, seat ${x.label}`;
  }
  return '1 seat';
}

/** The rows of one section changed by `change`, the others shared. */
const changeRows = (doc: EditorDoc, sectionId: string, change: (r: EdRow) => EdRow): EditorDoc =>
  changeSections(doc, [sectionId], (s) => {
    const rows = s.rows.map(change);
    return rows.every((r, i) => r === s.rows[i]) ? s : { ...s, rows };
  });

/** The seats of `ids` in one section with their own level set (or cleared, `null`). */
const setSeatLevels = (
  doc: EditorDoc,
  sectionId: string,
  ids: readonly string[],
  levelId: string | null,
): EditorDoc => {
  const set = new Set(ids);
  return changeRows(doc, sectionId, (r) =>
    r.seats.some((x) => set.has(x.id))
      ? { ...r, seats: r.seats.map((x) => (set.has(x.id) ? { ...x, levelId } : x)) }
      : r,
  );
};

/**
 * R12: a level deleted, everything naming it repointed at `to`; a row's or seat's own level that
 * then equals its parent's is cleared.
 */
function repoint(doc: EditorDoc, from: string, to: string): EditorDoc {
  return {
    ...doc,
    levels: doc.levels.filter((l) => l.id !== from),
    sections: doc.sections.map((s) => {
      const secChanged = s.levelId === from;
      const levelId = secChanged ? to : s.levelId;
      let touched = secChanged;
      const rows = s.rows.map((r) => {
        const rowRe = r.levelId === from;
        let rowLevel = rowRe ? to : r.levelId;
        if (rowLevel === levelId && (rowRe || secChanged)) rowLevel = null;
        const parent = rowLevel ?? levelId;
        let seatTouched = false;
        const seats = r.seats.map((x) => {
          const seatRe = x.levelId === from;
          let own = seatRe ? to : x.levelId;
          if (own === parent && (seatRe || rowRe || secChanged)) own = null;
          if (own === x.levelId) return x;
          seatTouched = true;
          return { ...x, levelId: own };
        });
        if (rowLevel === r.levelId && !seatTouched) return r;
        touched = true;
        return { ...r, levelId: rowLevel, seats: seatTouched ? seats : r.seats };
      });
      return touched ? { ...s, levelId, rows } : s;
    }),
  };
}

// ------------------------------------------------------------------ fine-tuning (US4, T051)

/** FR-010, edge case "Names and labels": what is wrong with a section's name, or null. */
export function sectionNameProblem(doc: EditorDoc, id: string, name: string): string | null {
  const n = name.trim();
  if (n === '') return 'Name the section';
  if (n.length > LAYOUT_LIMITS.nameMaxLength)
    return `At most ${LAYOUT_LIMITS.nameMaxLength} characters`;
  if (doc.sections.some((x) => x.id !== id && x.name.toLowerCase() === n.toLowerCase()))
    return `Another section is named ${n}`;
  return null;
}

const labelShape = (label: string, what: string): string | null => {
  const l = label.trim();
  if (l === '') return `Give the ${what} a label`;
  if (l.length > LAYOUT_LIMITS.labelMaxLength)
    return `At most ${LAYOUT_LIMITS.labelMaxLength} characters`;
  return null;
};

/** FR-012, US4-3: a row's label is 1–5 characters, unique in its section. */
export function rowLabelProblem(
  doc: EditorDoc,
  sectionId: string,
  rowId: string,
  label: string,
): string | null {
  const shape = labelShape(label, 'row');
  if (shape) return shape;
  const section = doc.sections.find((x) => x.id === sectionId);
  const l = label.trim();
  if (section?.rows.some((r) => r.id !== rowId && r.label === l))
    return `Row ${l} is already in section ${section.name}`;
  return null;
}

/** FR-012, US4-3: a seat's label is 1–5 characters, unique in its row. */
export function seatLabelProblem(
  doc: EditorDoc,
  sectionId: string,
  seatId: string,
  label: string,
): string | null {
  const shape = labelShape(label, 'seat');
  if (shape) return shape;
  const row = doc.sections
    .find((x) => x.id === sectionId)
    ?.rows.find((r) => r.seats.some((q) => q.id === seatId));
  const l = label.trim();
  if (row?.seats.some((q) => q.id !== seatId && q.label === l))
    return `Seat ${l} is already in row ${row.label}`;
  return null;
}

/** FR-012: deleting these seats leaves seats in the section ('seats'), or none ('section'). */
export function planDeleteSeats(
  doc: EditorDoc,
  sectionId: string,
  ids: readonly string[],
): 'seats' | 'section' {
  const section = doc.sections.find((x) => x.id === sectionId);
  const set = new Set(ids);
  const left = section?.rows.some((r) => r.seats.some((q) => !set.has(q.id))) ?? false;
  return left ? 'seats' : 'section';
}

/** A section's name with " (n)" for the first n from 2 that no section has. */
function freeName(doc: EditorDoc, name: string): string {
  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`;
    const candidate = `${name.slice(0, LAYOUT_LIMITS.nameMaxLength - suffix.length)}${suffix}`;
    if (!sectionNameProblem(doc, '', candidate)) return candidate;
  }
}

/** The labels a generator makes: rows, and each row's seats. */
function generatedLabels(values: SectionGenerator | null): Map<string, Set<string>> | null {
  if (!values) return null;
  try {
    const block = generateBlock(values);
    return new Map(block.rows.map((r) => [r.label, new Set(r.seats.map((q) => q.label))]));
  } catch {
    return null;
  }
}

/**
 * FR-009, R7: what Regenerate with `values` would do to a section: the seats that would go, and
 * whether labels changed by hand (not in what its generator made) would be replaced.
 */
export function regeneratePlan(
  doc: EditorDoc,
  id: string,
  values: SectionGenerator,
): { removed: number; handLabels: boolean } {
  const section = doc.sections.find((x) => x.id === id);
  const next = generatedLabels(values);
  if (!section || !next) return { removed: 0, handLabels: false };
  let removed = 0;
  for (const r of section.rows) {
    const seats = next.get(r.label);
    for (const q of r.seats) if (!seats?.has(q.label)) removed += 1;
  }
  const before = generatedLabels(section.generator);
  const handLabels =
    before !== null &&
    section.rows.some(
      (r) => !before.has(r.label) || r.seats.some((q) => !before.get(r.label)?.has(q.label)),
    );
  return { removed, handLabels };
}

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
    case 'zoom': {
      // In, the section is selected; out, rows or seats of it give way to the section.
      const sel = s.selection;
      const selection: Selection = a.id
        ? { kind: 'sections', ids: [a.id] }
        : sel.kind === 'rows' || sel.kind === 'seats'
          ? { kind: 'sections', ids: [sel.sectionId] }
          : sel;
      return { ...s, zoomed: a.id, selection, typing: null };
    }

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

    case 'selectRows': {
      const before =
        s.selection.kind === 'rows' && s.selection.sectionId === a.sectionId ? s.selection.ids : [];
      const ids = a.add
        ? a.ids.reduce(
            (acc, id) => (acc.includes(id) ? acc.filter((i) => i !== id) : [...acc, id]),
            before,
          )
        : a.ids;
      return {
        ...s,
        selection:
          ids.length > 0 ? { kind: 'rows', sectionId: a.sectionId, ids } : { kind: 'none' },
        typing: null,
      };
    }
    case 'selectRowRange': {
      const section = doc.sections.find((x) => x.id === a.sectionId);
      if (!section) return s;
      const anchor =
        s.selection.kind === 'rows' && s.selection.sectionId === a.sectionId
          ? s.selection.ids[s.selection.ids.length - 1]
          : a.toId;
      const i = section.rows.findIndex((r) => r.id === anchor);
      const j = section.rows.findIndex((r) => r.id === a.toId);
      if (i < 0 || j < 0) return s;
      const ids = section.rows.slice(Math.min(i, j), Math.max(i, j) + 1).map((r) => r.id);
      return { ...s, selection: { kind: 'rows', sectionId: a.sectionId, ids }, typing: null };
    }
    case 'selectSeats': {
      const before =
        s.selection.kind === 'seats' && s.selection.sectionId === a.sectionId
          ? s.selection.ids
          : [];
      const ids = a.add
        ? a.ids.reduce(
            (acc, id) => (acc.includes(id) ? acc.filter((i) => i !== id) : [...acc, id]),
            before,
          )
        : a.ids;
      return {
        ...s,
        selection:
          ids.length > 0 ? { kind: 'seats', sectionId: a.sectionId, ids } : { kind: 'none' },
        typing: null,
      };
    }

    case 'addLevel': {
      if (doc.levels.length >= LAYOUT_LIMITS.maxLevels) {
        return { ...s, message: `A layout has at most ${LAYOUT_LIMITS.maxLevels} levels` };
      }
      const used = new Set(doc.levels.map((l) => l.color));
      const color = LEVEL_COLORS.find((c) => !used.has(c)) ?? LEVEL_COLORS[0];
      let k = doc.levels.length + 1;
      while (levelNameProblem(doc, '', `Level ${k}`)) k += 1;
      const seq = s.seq + 1;
      const level = { id: `new:${seq}`, name: `Level ${k}`, color };
      return commit(s, { ...doc, levels: [...doc.levels, level] }, `${level.name} added`, { seq });
    }
    case 'renameLevel': {
      const level = doc.levels.find((l) => l.id === a.id);
      if (!level) return s;
      const problem = levelNameProblem(doc, a.id, a.name);
      if (problem) return { ...s, message: problem };
      const name = a.name.trim();
      if (name === level.name) return s;
      return commit(
        s,
        { ...doc, levels: doc.levels.map((l) => (l.id === a.id ? { ...l, name } : l)) },
        `${level.name} renamed ${name}`,
      );
    }
    case 'recolorLevel': {
      const level = doc.levels.find((l) => l.id === a.id);
      if (!level || level.color === a.color) return s;
      return commit(
        s,
        { ...doc, levels: doc.levels.map((l) => (l.id === a.id ? { ...l, color: a.color } : l)) },
        `${level.name} is now ${a.color}`,
      );
    }
    case 'moveLevel': {
      const i = doc.levels.findIndex((l) => l.id === a.id);
      const j = i + a.by;
      if (i < 0 || j < 0 || j >= doc.levels.length) return s;
      const levels = [...doc.levels];
      [levels[i], levels[j]] = [levels[j], levels[i]];
      return commit(s, { ...doc, levels }, `${levels[j].name} moved to rank ${j + 1}`);
    }
    case 'deleteLevel': {
      if (doc.levels.length <= 1) return { ...s, message: "The last level can't be deleted" };
      const level = doc.levels.find((l) => l.id === a.id);
      if (!level || a.replacement === a.id || !doc.levels.some((l) => l.id === a.replacement)) {
        return s;
      }
      return commit(
        s,
        repoint(doc, a.id, a.replacement),
        `${level.name} deleted; its seats are now ${levelName(doc, a.replacement)}`,
      );
    }
    case 'paint':
    case 'clearLevel': {
      const sel = s.selection;
      const levelId = a.type === 'paint' ? a.levelId : null;
      const word = a.type === 'paint' ? `painted ${levelName(doc, a.levelId)}` : '';
      if (sel.kind === 'sections' && a.type === 'paint') {
        const next = changeSections(doc, sel.ids, (x) =>
          x.levelId === a.levelId ? x : { ...x, levelId: a.levelId },
        );
        return commit(s, next, `${sectionsWord(doc, sel.ids)} ${word}`);
      }
      if (sel.kind === 'rows') {
        const section = doc.sections.find((x) => x.id === sel.sectionId);
        if (!section) return s;
        const set = new Set(sel.ids);
        const next = changeRows(doc, sel.sectionId, (r) =>
          set.has(r.id) && r.levelId !== levelId ? { ...r, levelId } : r,
        );
        const who = rowsWord(section, sel.ids);
        const one = sel.ids.length === 1;
        return commit(
          s,
          next,
          a.type === 'paint'
            ? `${who} ${word}`
            : `${who} ${one ? 'takes' : 'take'} the section's level`,
        );
      }
      if (sel.kind === 'seats') {
        const section = doc.sections.find((x) => x.id === sel.sectionId);
        if (!section) return s;
        const who = seatsWord(section, sel.ids);
        const one = sel.ids.length === 1;
        return commit(
          s,
          setSeatLevels(doc, sel.sectionId, sel.ids, levelId),
          a.type === 'paint'
            ? `${who} ${word}`
            : `${who} ${one ? 'takes' : 'take'} the row's level`,
        );
      }
      return s;
    }

    case 'duplicateSection': {
      const from = doc.sections.find((x) => x.id === a.id);
      if (!from) return s;
      if (doc.sections.length >= LAYOUT_LIMITS.maxSections) {
        return { ...s, message: `A layout has at most ${LAYOUT_LIMITS.maxSections} sections` };
      }
      if (totals(doc).seats + seatCount(from) > LAYOUT_LIMITS.maxSeats) {
        return { ...s, message: 'The layout would be over its limits' };
      }
      let seq = s.seq;
      const next = (): string => `new:${(seq += 1)}`;
      const copy: EdSection = {
        ...shiftSection(from, 10, 0),
        id: next(),
        name: freeName(doc, from.name),
      };
      copy.rows = copy.rows.map((r) => ({
        ...r,
        id: next(),
        seats: r.seats.map((q) => ({ ...q, id: next() })),
      }));
      return commit(
        s,
        keepOnMap({ ...doc, sections: [...doc.sections, copy] }),
        `Section ${from.name} duplicated as ${copy.name}`,
        { selection: { kind: 'sections', ids: [copy.id] }, seq },
      );
    }
    case 'renameSection': {
      const section = doc.sections.find((x) => x.id === a.id);
      if (!section) return s;
      const problem = sectionNameProblem(doc, a.id, a.name);
      if (problem) return { ...s, message: problem };
      const name = a.name.trim();
      if (name === section.name) return s;
      return commit(
        s,
        changeSections(doc, [a.id], (x) => ({ ...x, name })),
        `Section ${section.name} renamed ${name}`,
      );
    }
    case 'deleteSeats': {
      const section = doc.sections.find((x) => x.id === a.sectionId);
      if (!section || a.ids.length === 0) return s;
      if (planDeleteSeats(doc, a.sectionId, a.ids) === 'section') {
        return {
          ...s,
          message: `Deleting every seat deletes the section: delete section ${section.name} instead`,
        };
      }
      const set = new Set(a.ids);
      const rows = section.rows
        .map((r) =>
          r.seats.some((q) => set.has(q.id))
            ? { ...r, seats: r.seats.filter((q) => !set.has(q.id)) }
            : r,
        )
        .filter((r) => r.seats.length > 0);
      const gone = seatCount(section) - rows.reduce((n, r) => n + r.seats.length, 0);
      return commit(
        s,
        changeSections(doc, [a.sectionId], (x) => ({ ...x, rows, outline: outlineOf(rows) })),
        `${gone} ${gone === 1 ? 'seat' : 'seats'} deleted from section ${section.name}`,
        { selection: { kind: 'none' } },
      );
    }
    case 'deleteSections': {
      const set = new Set(a.ids);
      if (!doc.sections.some((x) => set.has(x.id))) return s;
      const word = sectionsWord(doc, a.ids);
      return commit(
        s,
        { ...doc, sections: doc.sections.filter((x) => !set.has(x.id)) },
        `${word} deleted`,
        {
          selection: { kind: 'none' },
          zoomed: s.zoomed && set.has(s.zoomed) ? null : s.zoomed,
        },
      );
    }
    case 'relabelRow': {
      const section = doc.sections.find((x) => x.id === a.sectionId);
      const row = section?.rows.find((r) => r.id === a.rowId);
      if (!section || !row) return s;
      const problem = rowLabelProblem(doc, a.sectionId, a.rowId, a.label);
      if (problem) return { ...s, message: problem };
      const label = a.label.trim();
      if (label === row.label) return s;
      return commit(
        s,
        changeRows(doc, a.sectionId, (r) => (r.id === a.rowId ? { ...r, label } : r)),
        `Row ${row.label} relabelled ${label}`,
      );
    }
    case 'relabelSeat': {
      const section = doc.sections.find((x) => x.id === a.sectionId);
      if (!section) return s;
      const problem = seatLabelProblem(doc, a.sectionId, a.seatId, a.label);
      if (problem) return { ...s, message: problem };
      const label = a.label.trim();
      const who = seatsWord(section, [a.seatId]);
      return commit(
        s,
        changeRows(doc, a.sectionId, (r) =>
          r.seats.some((q) => q.id === a.seatId && q.label !== label)
            ? { ...r, seats: r.seats.map((q) => (q.id === a.seatId ? { ...q, label } : q)) }
            : r,
        ),
        `${who} relabelled ${label}`,
      );
    }
    case 'markAccessible': {
      const section = doc.sections.find((x) => x.id === a.sectionId);
      if (!section) return s;
      const set = new Set(a.ids);
      return commit(
        s,
        changeRows(doc, a.sectionId, (r) =>
          r.seats.some((q) => set.has(q.id) && q.accessible !== a.accessible)
            ? {
                ...r,
                seats: r.seats.map((q) => (set.has(q.id) ? { ...q, accessible: a.accessible } : q)),
              }
            : r,
        ),
        `${seatsWord(section, a.ids)} marked ${a.accessible ? 'accessible' : 'not accessible'}`,
      );
    }
    case 'regenerate': {
      const section = doc.sections.find((x) => x.id === a.id);
      if (!section) return s;
      let block;
      try {
        block = placeBlock(generateBlock(a.values), section.origin, section.angle);
      } catch {
        return { ...s, message: 'The section could not be generated' };
      }
      const others = totals(doc).seats - seatCount(section);
      const adding = block.rows.reduce((n, r) => n + r.seats.length, 0);
      if (others + adding > LAYOUT_LIMITS.maxSeats) {
        return { ...s, message: 'The layout would be over its limits' };
      }
      // R7: a row is kept when its label is still generated, a seat when its row is kept and its
      // label is still in it: their ids, own levels and accessible marks stay.
      let seq = s.seq;
      const next = (): string => `new:${(seq += 1)}`;
      const oldRows = new Map(section.rows.map((r) => [r.label, r]));
      const rows: EdRow[] = block.rows.map((r) => {
        const old = oldRows.get(r.label);
        const oldSeats = new Map((old?.seats ?? []).map((q) => [q.label, q]));
        return {
          id: old?.id ?? next(),
          label: r.label,
          levelId: old?.levelId ?? null,
          seats: r.seats.map((q) => {
            const was = oldSeats.get(q.label);
            return {
              id: was?.id ?? next(),
              label: q.label,
              at: q.at as Place,
              levelId: was?.levelId ?? null,
              accessible: was?.accessible ?? false,
            };
          }),
        };
      });
      return commit(
        s,
        keepOnMap(
          changeSections(doc, [a.id], (x) => ({
            ...x,
            generator: a.values,
            rows,
            outline: outlineOf(rows),
          })),
        ),
        `Section ${section.name} regenerated`,
        { selection: { kind: 'sections', ids: [a.id] }, seq },
      );
    }
  }
}
