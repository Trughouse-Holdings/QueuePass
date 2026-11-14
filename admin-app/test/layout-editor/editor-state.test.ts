import { describe, expect, it } from 'vitest';
import { emptyDoc, fromDrawing } from '../../src/layout-editor/editor-doc';
import {
  currentDoc,
  initState,
  isDirty,
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
