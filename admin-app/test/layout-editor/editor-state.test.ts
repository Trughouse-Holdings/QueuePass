import { describe, expect, it } from 'vitest';
import { emptyDoc, fromDrawing, outlineOf, toInput } from '../../src/layout-editor/editor-doc';
import {
  currentDoc,
  initState,
  isDirty,
  levelNameProblem,
  reduce,
  totals,
  type EditorState,
} from '../../src/layout-editor/editor-state';
import { DRAWING } from './fixtures';

/**
 * Spec 039 research R10 (T019): the editor's state, core: load, selection, rename, the floor
 * object, history (Undo, Redo, at most 100 documents), `dirty`, and the totals.
 */
const loaded = (): EditorState => initState(fromDrawing(DRAWING));
const doc = currentDoc;

describe('load and selection', () => {
  it('loads a document with nothing selected, not dirty, nothing to undo', () => {
    const s = loaded();
    expect(doc(s).name).toBe('Riverside');
    expect(s.selection).toEqual({ kind: 'none' });
    expect(isDirty(s)).toBe(false);
    expect(s.cursor).toBe(0);
  });

  it('a load replaces the document and its history', () => {
    let s = reduce(loaded(), { type: 'rename', name: 'Other' });
    s = reduce(s, { type: 'load', doc: emptyDoc() });
    expect(doc(s).name).toBe('');
    expect(s.history).toHaveLength(1);
    expect(isDirty(s)).toBe(false);
  });

  it('selects sections, adds and removes one with Shift, and clears', () => {
    let s = reduce(loaded(), { type: 'selectSections', ids: ['s-101'] });
    expect(s.selection).toEqual({ kind: 'sections', ids: ['s-101'] });
    s = reduce(s, { type: 'toggleSection', id: 's-102' });
    expect(s.selection).toEqual({ kind: 'sections', ids: ['s-101', 's-102'] });
    s = reduce(s, { type: 'toggleSection', id: 's-101' });
    expect(s.selection).toEqual({ kind: 'sections', ids: ['s-102'] });
    s = reduce(s, { type: 'toggleSection', id: 's-102' });
    expect(s.selection).toEqual({ kind: 'none' });
    s = reduce(s, { type: 'selectFloor' });
    expect(s.selection).toEqual({ kind: 'floor' });
    s = reduce(s, { type: 'clearSelection' });
    expect(s.selection).toEqual({ kind: 'none' });
    // Selecting is not a change.
    expect(s.history).toHaveLength(1);
  });
});

describe('rename and floor', () => {
  it('renames the layout; consecutive renames are one step', () => {
    let s = reduce(loaded(), { type: 'rename', name: 'B' });
    s = reduce(s, { type: 'rename', name: 'Ba' });
    expect(doc(s).name).toBe('Ba');
    expect(s.history).toHaveLength(2);
    s = reduce(s, { type: 'undo' });
    expect(doc(s).name).toBe('Riverside');
  });

  it('sets the floor kind with a rectangle at the given place; None clears the outline', () => {
    let s = initState(emptyDoc());
    s = reduce(s, { type: 'setFloor', kind: 'COURT', at: [150, 100] });
    const { floor } = doc(s);
    expect(floor.kind).toBe('COURT');
    expect(floor.outline).toHaveLength(4);
    const xs = floor.outline!.map((p) => p[0]);
    const ys = floor.outline!.map((p) => p[1]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBe(150);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBe(100);
    // Another kind keeps the place.
    s = reduce(s, { type: 'setFloor', kind: 'RING', at: [0, 0] });
    expect(doc(s).floor).toEqual({ kind: 'RING', outline: floor.outline });
    s = reduce(s, { type: 'setFloor', kind: 'NONE', at: [0, 0] });
    expect(doc(s).floor).toEqual({ kind: 'NONE', outline: null });
    expect(s.message).toBe('Floor object removed');
  });
});

describe('history', () => {
  it('makes each change one step; Undo and Redo walk it and say so', () => {
    let s = reduce(loaded(), { type: 'moveSections', ids: ['s-101'], dx: 1, dy: 0 });
    s = reduce(s, { type: 'setFloor', kind: 'RING', at: [0, 0] });
    expect(s.history).toHaveLength(3);
    s = reduce(s, { type: 'undo' });
    expect(doc(s).floor.kind).toBe('COURT');
    expect(s.message).toBe('Undone: floor object set to Ring');
    s = reduce(s, { type: 'undo' });
    expect(doc(s).sections[0].origin).toEqual([20, 30]);
    expect(s.message).toBe('Undone: section 101 moved');
    // Nothing more to undo: unchanged.
    expect(reduce(s, { type: 'undo' })).toBe(s);
    s = reduce(s, { type: 'redo' });
    expect(doc(s).sections[0].origin).toEqual([21, 30]);
    expect(s.message).toBe('Redone: section 101 moved');
  });

  it('a change after Undo drops the redo side', () => {
    let s = reduce(loaded(), { type: 'setFloor', kind: 'RING', at: [0, 0] });
    s = reduce(s, { type: 'undo' });
    s = reduce(s, { type: 'rename', name: 'X' });
    expect(reduce(s, { type: 'redo' })).toBe(s);
    expect(doc(s).floor.kind).toBe('COURT');
  });

  it('keeps at most 100 documents: the 101st change drops the oldest', () => {
    let s = loaded();
    for (let i = 0; i < 101; i += 1) {
      s = reduce(s, { type: 'moveSections', ids: ['s-101'], dx: 1, dy: 0 });
    }
    expect(s.history).toHaveLength(100);
    for (let i = 0; i < 120; i += 1) s = reduce(s, { type: 'undo' });
    // Back 99 steps: the first two moves can't be undone.
    expect(doc(s).sections[0].origin).toEqual([22, 30]);
  });

  it('shares the sections a change does not touch', () => {
    const s0 = loaded();
    const s1 = reduce(s0, { type: 'moveSections', ids: ['s-101'], dx: 1, dy: 0 });
    expect(doc(s1).sections[1]).toBe(doc(s0).sections[1]);
    expect(doc(s1).levels).toBe(doc(s0).levels);
  });
});

describe('dirty', () => {
  it('is true after a change, false when Undo returns to the saved document and after saved', () => {
    let s = reduce(loaded(), { type: 'rename', name: 'X' });
    expect(isDirty(s)).toBe(true);
    s = reduce(s, { type: 'undo' });
    expect(isDirty(s)).toBe(false);
    s = reduce(s, { type: 'redo' });
    s = reduce(s, { type: 'saved' });
    expect(isDirty(s)).toBe(false);
    // Undo past the save is allowed, and is a change again.
    s = reduce(s, { type: 'undo' });
    expect(isDirty(s)).toBe(true);
  });

  it('saved with a reloaded document takes it as the saved one, keeping the history', () => {
    let s = reduce(loaded(), { type: 'rename', name: 'X' });
    const reloaded = { ...doc(s), name: 'X' };
    s = reduce(s, { type: 'saved', doc: reloaded });
    expect(doc(s)).toBe(reloaded);
    expect(isDirty(s)).toBe(false);
    expect(s.cursor).toBe(1);
  });
});

describe('totals', () => {
  it('counts sections, seats, seats per level (seat → row → section) and seats left', () => {
    const t = totals(doc(loaded()));
    expect(t.sections).toBe(2);
    expect(t.seats).toBe(8);
    expect(t.seatsLeft).toBe(30_000 - 8);
    // 101: row A seat 1 own Courtside, A2 A3 Standard (section), row B Courtside ×3; 102 ×2.
    expect(t.byLevel).toEqual({ 'lv-court': 6, 'lv-std': 2 });
  });

  it('counts 0 for a level no seat is in', () => {
    expect(totals(emptyDoc()).byLevel).toEqual({ [emptyDoc().levels[0].id]: 0 });
  });
});

// ------------------------------------------------------------------- US1 (T031): the generator
// and moving, turning and the floor object (R5–R7, FR-005, FR-007, FR-011).

const BLOCK = {
  rows: 3,
  seatsPerRow: [4],
  rowLabels: 'LETTERS' as const,
  firstRow: 'A',
  firstSeat: 1,
  direction: 'LEFT_TO_RIGHT' as const,
  curve: 0,
};

describe('addSection', () => {
  it('generates the block at the given place, in the level, selected, with its outline', () => {
    const s = reduce(initState(emptyDoc()), {
      type: 'addSection',
      name: ' 101 ',
      values: BLOCK,
      levelId: 'new:0',
      at: [150, 100],
    });
    const [section] = doc(s).sections;
    expect(section).toMatchObject({
      name: '101',
      levelId: 'new:0',
      origin: [150, 100],
      angle: 0,
      generator: BLOCK,
    });
    expect(section.id).toMatch(/^new:\d+$/);
    expect(section.rows.map((r) => r.label)).toEqual(['A', 'B', 'C']);
    // The origin is the middle of the front row; rows go back toward −y (R7).
    expect(section.rows[0].seats.map((x) => x.at)).toEqual([
      [147, 100],
      [149, 100],
      [151, 100],
      [153, 100],
    ]);
    expect(section.rows[2].seats[0].at).toEqual([147, 96]);
    expect(section.rows[0].seats.map((x) => x.label)).toEqual(['1', '2', '3', '4']);
    expect(section.outline).toEqual(outlineOf(section.rows));
    const ids = [section.id, ...section.rows.flatMap((r) => [r.id, ...r.seats.map((x) => x.id)])];
    expect(new Set(ids).size).toBe(ids.length);
    expect(s.selection).toEqual({ kind: 'sections', ids: [section.id] });
    expect(s.message).toBe('Section 101 added');
    expect(totals(doc(s)).seats).toBe(12);
  });

  it('refuses a block that would take the layout over 30,000 seats', () => {
    let s = initState(emptyDoc());
    const big = { ...BLOCK, rows: 100, seatsPerRow: [200] };
    s = reduce(s, {
      type: 'addSection',
      name: 'A',
      values: big,
      levelId: 'new:0',
      at: [2500, 2500],
    });
    const t = reduce(s, {
      type: 'addSection',
      name: 'B',
      values: big,
      levelId: 'new:0',
      at: [2500, 2500],
    });
    expect(doc(t).sections).toHaveLength(1);
    expect(t.message).toBe('The layout would be over its limits');
  });
});

describe('moveSections and turnSections', () => {
  it('moves a section, its seats, outline and origin by the offset', () => {
    const s = reduce(loaded(), { type: 'moveSections', ids: ['s-101'], dx: 10, dy: 5 });
    const [a] = doc(s).sections;
    expect(a.origin).toEqual([30, 35]);
    expect(a.rows[0].seats[0].at).toEqual([28, 35]);
    expect(a.outline[0]).toEqual([
      doc(loaded()).sections[0].outline[0][0] + 10,
      doc(loaded()).sections[0].outline[0][1] + 5,
    ]);
    expect(s.message).toBe('Section 101 moved');
  });

  it('moves several sections as one step', () => {
    const s = reduce(loaded(), { type: 'moveSections', ids: ['s-101', 's-102'], dx: 1, dy: 1 });
    expect(doc(s).sections.map((x) => x.origin)).toEqual([
      [21, 31],
      [101.04, 31],
    ]);
    expect(s.message).toBe('2 sections moved');
    expect(s.history).toHaveLength(2);
  });

  it('past the top or left edge, moves everything right or down so no place is below 0 (R5)', () => {
    const before = doc(loaded());
    const s = reduce(loaded(), { type: 'moveSections', ids: ['s-101'], dx: 0, dy: -40 });
    const after = doc(s);
    // 101's outline reached y = 26.5 − 40 = −13.5: everything moves down 15.
    expect(after.sections[0].origin).toEqual([20, 5]);
    expect(after.sections[1].origin).toEqual([100.04, 45]);
    expect(after.floor.outline![0]).toEqual([40, 55]);
    const ys = after.sections.flatMap((x) => [
      ...x.outline.map((p) => p[1]),
      ...x.rows.flatMap((r) => r.seats.map((q) => q.at[1])),
    ]);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(before.sections[1].origin).toEqual([100.04, 30]);
  });

  it('never moves past 5,000', () => {
    const s = reduce(loaded(), { type: 'moveSections', ids: ['s-101'], dx: 9000, dy: 0 });
    const xs = doc(s).sections[0].outline.map((p) => p[0]);
    expect(Math.max(...xs)).toBeCloseTo(5000, 6);
  });

  it('turns each section about its own origin, clockwise, and keeps the angle in (−180, 180]', () => {
    let s = reduce(loaded(), { type: 'turnSections', ids: ['s-101'], degrees: 90 });
    const [a] = doc(s).sections;
    expect(a.angle).toBe(90);
    // Seat A3 at (22, 30), 2 right of the origin (20, 30), turns to 2 below it.
    const [x, y] = a.rows[0].seats[2].at;
    expect(x).toBeCloseTo(20, 9);
    expect(y).toBeCloseTo(32, 9);
    expect(a.origin).toEqual([20, 30]);
    expect(s.message).toBe('Section 101 turned to 90°');
    s = reduce(s, { type: 'turnSections', ids: ['s-101', 's-102'], degrees: 100 });
    expect(doc(s).sections.map((q) => q.angle)).toEqual([-170, -170]);
    expect(doc(s).sections[1].origin).toEqual([100.04, 30]);
    expect(s.message).toBe('2 sections turned 100°');
  });

  it('a whole turn is no change', () => {
    const s = loaded();
    expect(reduce(s, { type: 'turnSections', ids: ['s-101'], degrees: 360 })).toBe(s);
  });
});

describe('placeSection (typed place and angle)', () => {
  it('a typed angle turns by the difference; a typed place moves the origin there', () => {
    let s = reduce(loaded(), { type: 'placeSection', id: 's-102', angle: 30 });
    expect(doc(s).sections[1].angle).toBe(30);
    s = reduce(s, { type: 'placeSection', id: 's-101', origin: [50, 60] });
    const [a] = doc(s).sections;
    expect(a.origin).toEqual([50, 60]);
    expect(a.rows[0].seats[0].at).toEqual([48, 60]);
    expect(s.message).toBe('Section 101 moved');
  });

  it('typing on in the same box is one step', () => {
    let s = reduce(loaded(), { type: 'placeSection', id: 's-101', angle: 3 });
    s = reduce(s, { type: 'placeSection', id: 's-101', angle: 30 });
    expect(s.history).toHaveLength(2);
    expect(doc(s).sections[0].angle).toBe(30);
  });
});

describe('the floor object, moved and resized', () => {
  it('moves the floor by an offset and resizes it to new bounds', () => {
    let s = reduce(loaded(), { type: 'moveFloor', dx: 10, dy: 0 });
    expect(doc(s).floor.outline).toEqual([
      [50, 40],
      [90, 40],
      [90, 60],
      [50, 60],
    ]);
    expect(s.message).toBe('Floor object moved');
    s = reduce(s, { type: 'resizeFloor', to: { x: 50, y: 40, width: 60, height: 30 } });
    expect(doc(s).floor.outline).toEqual([
      [50, 40],
      [110, 40],
      [110, 70],
      [50, 70],
    ]);
    expect(s.message).toBe('Floor object resized');
  });
});

// ------------------------------------------------------------- US2 (T038): levels and painting
// (R12, FR-015, FR-016). Riverside: Courtside (red) best, Standard (violet). 101's section level
// is Standard, its row B Courtside, seat A1 Courtside; 102 is Courtside.

const levelNames = (s: EditorState) => doc(s).levels.map((l) => l.name);
const sec = (s: EditorState, i = 0) => doc(s).sections[i];

describe('levels', () => {
  it('adds a level with the first of the 12 colors not yet used, up to 12', () => {
    let s = reduce(loaded(), { type: 'addLevel' });
    const added = doc(s).levels[2];
    expect(added).toMatchObject({ name: 'Level 3', color: 'blue' });
    expect(added.id).toMatch(/^new:/);
    expect(s.message).toBe('Level 3 added');
    for (let i = 0; i < 9; i += 1) s = reduce(s, { type: 'addLevel' });
    expect(doc(s).levels).toHaveLength(12);
    expect(new Set(doc(s).levels.map((l) => l.color)).size).toBe(12);
    const t = reduce(s, { type: 'addLevel' });
    expect(doc(t).levels).toHaveLength(12);
    expect(t.message).toBe('A layout has at most 12 levels');
  });

  it('renames a level, refusing an empty name or one another level has (ignoring case)', () => {
    const s = reduce(loaded(), { type: 'renameLevel', id: 'lv-std', name: 'Lower sideline' });
    expect(levelNames(s)).toEqual(['Courtside', 'Lower sideline']);
    expect(levelNameProblem(doc(s), 'lv-std', 'courtside')).toBe(
      'Another level is named courtside',
    );
    expect(levelNameProblem(doc(s), 'lv-std', ' ')).toBe('Name the level');
    expect(levelNameProblem(doc(s), 'lv-std', 'Lower sideline')).toBeNull();
    const refused = reduce(s, { type: 'renameLevel', id: 'lv-std', name: 'COURTSIDE' });
    expect(doc(refused)).toBe(doc(s));
    expect(refused.message).toBe('Another level is named COURTSIDE');
  });

  it('recolors a level', () => {
    const s = reduce(loaded(), { type: 'recolorLevel', id: 'lv-std', color: 'teal' });
    expect(doc(s).levels[1].color).toBe('teal');
    expect(s.message).toBe('Standard is now teal');
  });

  it('moves a level up and down; ranks follow the order', () => {
    let s = reduce(loaded(), { type: 'moveLevel', id: 'lv-std', by: -1 });
    expect(levelNames(s)).toEqual(['Standard', 'Courtside']);
    expect(s.message).toBe('Standard moved to rank 1');
    expect(toInput(doc(s), 4).levels.map((l) => [l.key, l.name])).toEqual([
      ['l1', 'Standard'],
      ['l2', 'Courtside'],
    ]);
    // Not past either end.
    expect(reduce(s, { type: 'moveLevel', id: 'lv-std', by: -1 })).toBe(s);
    s = reduce(s, { type: 'moveLevel', id: 'lv-std', by: 1 });
    expect(levelNames(s)).toEqual(['Courtside', 'Standard']);
  });

  it('deletes a level, its seats taking the replacement; overrides equal to their parent go', () => {
    const s = reduce(loaded(), { type: 'deleteLevel', id: 'lv-court', replacement: 'lv-std' });
    expect(levelNames(s)).toEqual(['Standard']);
    const [a, b] = doc(s).sections;
    // Row B and seat A1 were Courtside, now Standard: the same as their section, so cleared.
    expect(a.rows[1].levelId).toBeNull();
    expect(a.rows[0].seats[0].levelId).toBeNull();
    expect(b.levelId).toBe('lv-std');
    expect(totals(doc(s)).byLevel).toEqual({ 'lv-std': 8 });
    expect(s.message).toBe('Courtside deleted; its seats are now Standard');
  });

  it('keeps an override that differs from its new parent', () => {
    let s = reduce(loaded(), { type: 'addLevel' });
    const upper = doc(s).levels[2].id;
    s = reduce(s, { type: 'deleteLevel', id: 'lv-court', replacement: upper });
    const [a] = doc(s).sections;
    expect(a.rows[1].levelId).toBe(upper);
    expect(a.rows[0].seats[0].levelId).toBe(upper);
  });

  it('refuses to delete the last level', () => {
    let s = reduce(initState(emptyDoc()), {
      type: 'deleteLevel',
      id: 'new:0',
      replacement: 'new:0',
    });
    expect(doc(s).levels).toHaveLength(1);
    expect(s.message).toBe("The last level can't be deleted");
    s = reduce(loaded(), { type: 'deleteLevel', id: 'lv-court', replacement: 'lv-court' });
    expect(doc(s).levels).toHaveLength(2);
  });
});

describe('painting', () => {
  it('paints selected sections: their section level', () => {
    let s = reduce(loaded(), { type: 'selectSections', ids: ['s-101', 's-102'] });
    s = reduce(s, { type: 'paint', levelId: 'lv-std' });
    expect(doc(s).sections.map((x) => x.levelId)).toEqual(['lv-std', 'lv-std']);
    expect(s.message).toBe('2 sections painted Standard');
    // Rows and seats with their own level keep it.
    expect(totals(doc(s)).byLevel).toEqual({ 'lv-court': 4, 'lv-std': 4 });
  });

  it('paints rows their own level, and a range of rows by label', () => {
    let s = reduce(loaded(), { type: 'selectRows', sectionId: 's-101', ids: ['r-101-a'] });
    s = reduce(s, { type: 'selectRowRange', sectionId: 's-101', toId: 'r-101-b' });
    expect(s.selection).toEqual({ kind: 'rows', sectionId: 's-101', ids: ['r-101-a', 'r-101-b'] });
    s = reduce(s, { type: 'paint', levelId: 'lv-court' });
    expect(sec(s).rows.map((r) => r.levelId)).toEqual(['lv-court', 'lv-court']);
    expect(s.message).toBe('Rows A–B painted Courtside');
    expect(totals(doc(s)).byLevel).toEqual({ 'lv-court': 8, 'lv-std': 0 });
  });

  it('paints seats their own level, and Use section’s level clears it', () => {
    let s = reduce(loaded(), { type: 'selectSeats', sectionId: 's-101', ids: ['st-a2'] });
    s = reduce(s, { type: 'selectSeats', sectionId: 's-101', ids: ['st-a3'], add: true });
    s = reduce(s, { type: 'paint', levelId: 'lv-court' });
    expect(sec(s).rows[0].seats.map((x) => x.levelId)).toEqual([
      'lv-court',
      'lv-court',
      'lv-court',
    ]);
    expect(s.message).toBe('2 seats painted Courtside');
    s = reduce(s, { type: 'clearLevel' });
    expect(sec(s).rows[0].seats.map((x) => x.levelId)).toEqual(['lv-court', null, null]);
    expect(s.message).toBe("2 seats take the row's level");
    s = reduce(s, { type: 'selectRows', sectionId: 's-101', ids: ['r-101-b'] });
    s = reduce(s, { type: 'clearLevel' });
    expect(sec(s).rows[1].levelId).toBeNull();
    expect(s.message).toBe("Row B takes the section's level");
  });

  it('a seat selected twice with add is taken out', () => {
    let s = reduce(loaded(), { type: 'selectSeats', sectionId: 's-101', ids: ['st-a2'] });
    s = reduce(s, { type: 'selectSeats', sectionId: 's-101', ids: ['st-a2'], add: true });
    expect(s.selection).toEqual({ kind: 'none' });
  });

  it('names one seat by its row and label', () => {
    let s = reduce(loaded(), { type: 'selectSeats', sectionId: 's-101', ids: ['st-b3'] });
    s = reduce(s, { type: 'paint', levelId: 'lv-std' });
    expect(s.message).toBe('Row B, seat 3 painted Standard');
  });

  it('paints nothing without a selection', () => {
    const s = loaded();
    expect(reduce(s, { type: 'paint', levelId: 'lv-std' })).toBe(s);
  });
});
