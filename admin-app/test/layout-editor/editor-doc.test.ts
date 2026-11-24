import { describe, expect, it } from 'vitest';
import { outlineAround } from '@queuepass/shared';
import { emptyDoc, fromDrawing, seatLevel, toInput } from '../../src/layout-editor/editor-doc';
import { DRAWING } from './fixtures';

/**
 * Spec 039 research R10 (T018): the editor's document from a `LayoutDrawing` and back to a
 * `LayoutDrawingInput`: levels keyed `l1`… by rank, ids and own levels kept, places to 0.1, new
 * items without an id, `revision` only for a layout that exists, outlines around the seats.
 */
describe('fromDrawing', () => {
  it('reads the levels by rank, the sections, rows and seats with their ids and own levels', () => {
    const doc = fromDrawing(DRAWING);
    expect(doc.name).toBe('Riverside');
    expect(doc.levels.map((l) => [l.id, l.name, l.color])).toEqual([
      ['lv-court', 'Courtside', 'red'],
      ['lv-std', 'Standard', 'violet'],
    ]);
    const [s101] = doc.sections;
    expect(s101).toMatchObject({ id: 's-101', name: '101', levelId: 'lv-std', angle: 0 });
    expect(s101.generator?.rows).toBe(2);
    expect(s101.rows[0]).toMatchObject({ id: 'r-101-a', label: 'A', levelId: null });
    expect(s101.rows[1].levelId).toBe('lv-court');
    expect(s101.rows[0].seats[0]).toEqual({
      id: 'st-a1',
      label: '1',
      at: [18, 30],
      levelId: 'lv-court',
      accessible: true,
    });
    expect(s101.rows[0].seats[1]).toMatchObject({ levelId: null, accessible: false });
  });

  it('draws each outline around its seats (R5), as the Backend will', () => {
    const doc = fromDrawing(DRAWING);
    const s = doc.sections[0];
    expect(s.outline).toEqual(outlineAround(s.rows.map((r) => r.seats.map((x) => x.at))));
  });

  it('reads levels by rank even when sent out of order', () => {
    const doc = fromDrawing({ ...DRAWING, levels: [...DRAWING.levels].reverse() });
    expect(doc.levels.map((l) => l.name)).toEqual(['Courtside', 'Standard']);
  });

  it('a floor of kind NONE has no outline', () => {
    expect(fromDrawing({ ...DRAWING, floor: { kind: 'NONE' } }).floor).toEqual({
      kind: 'NONE',
      outline: null,
    });
  });
});

describe('seatLevel', () => {
  it("is the seat's own level, else its row's, else its section's (038 FR-003)", () => {
    const [s] = fromDrawing(DRAWING).sections;
    expect(seatLevel(s, s.rows[0], s.rows[0].seats[0])).toBe('lv-court');
    expect(seatLevel(s, s.rows[0], s.rows[0].seats[1])).toBe('lv-std');
    expect(seatLevel(s, s.rows[1], s.rows[1].seats[2])).toBe('lv-court');
  });
});

describe('toInput', () => {
  it('round-trips a drawing: levels keyed by rank, ids kept, own levels by key', () => {
    const input = toInput(fromDrawing(DRAWING), 4);
    expect(input.revision).toBe(4);
    expect(input.name).toBe('Riverside');
    expect(input.floor).toEqual(DRAWING.floor);
    expect(input.levels).toEqual([
      { id: 'lv-court', key: 'l1', name: 'Courtside', color: 'red' },
      { id: 'lv-std', key: 'l2', name: 'Standard', color: 'violet' },
    ]);
    const [s101, s102] = input.sections;
    expect(s101).toMatchObject({
      id: 's-101',
      name: '101',
      level: 'l2',
      origin: [20, 30],
      angle: 0,
      generator: DRAWING.sections[0].generator,
    });
    expect(s101.rows[0]).toEqual({
      id: 'r-101-a',
      label: 'A',
      seats: [
        { id: 'st-a1', label: '1', at: [18, 30], level: 'l1', accessible: true },
        { id: 'st-a2', label: '2', at: [20, 30] },
        { id: 'st-a3', label: '3', at: [22, 30] },
      ],
    });
    expect(s101.rows[1]).toMatchObject({ id: 'r-101-b', label: 'B', level: 'l1' });
    // No outlines and no size: the Backend computes them (R5).
    expect(s101).not.toHaveProperty('outline');
    expect(input).not.toHaveProperty('size');
    // Places to 0.1; no generator sent as null when there is none.
    expect(s102.origin).toEqual([100, 30]);
    expect(s102.rows[0].seats.map((s) => s.at)).toEqual([
      [100, 30],
      [100, 32],
    ]);
    expect(s102.angle).toBe(90);
    expect(s102).not.toHaveProperty('generator');
  });

  it('sends a new level, section, row or seat (id new:<n>) without an id', () => {
    const doc = fromDrawing(DRAWING);
    const s = doc.sections[0];
    const changed = {
      ...doc,
      levels: [...doc.levels, { id: 'new:1', name: 'Upper', color: 'teal' as const }],
      sections: [
        {
          ...s,
          id: 'new:2',
          rows: [
            {
              id: 'new:3',
              label: 'Z',
              levelId: 'new:1',
              seats: [
                {
                  id: 'new:4',
                  label: '9',
                  at: [5, 5] as [number, number],
                  levelId: null,
                  accessible: false,
                },
              ],
            },
          ],
        },
      ],
    };
    const input = toInput(changed, 4);
    expect(input.levels[2]).toEqual({ key: 'l3', name: 'Upper', color: 'teal' });
    expect(input.sections[0]).not.toHaveProperty('id');
    expect(input.sections[0].rows[0]).toEqual({
      label: 'Z',
      level: 'l3',
      seats: [{ label: '9', at: [5, 5] }],
    });
  });

  it('leaves out the revision for a new layout', () => {
    const input = toInput(emptyDoc(), null);
    expect(input).not.toHaveProperty('revision');
    expect(input.levels).toEqual([{ key: 'l1', name: 'Standard', color: 'violet' }]);
    expect(input.floor).toEqual({ kind: 'NONE' });
  });

  it('keeps an angle in (−180, 180] after rounding', () => {
    const doc = fromDrawing(DRAWING);
    const tilted = { ...doc, sections: [{ ...doc.sections[0], angle: -179.97 }] };
    expect(toInput(tilted, 1).sections[0].angle).toBe(180);
  });
});

describe('emptyDoc', () => {
  it('is a new layout: no name, no floor, one level "Standard", no sections', () => {
    const doc = emptyDoc();
    expect(doc.name).toBe('');
    expect(doc.floor).toEqual({ kind: 'NONE', outline: null });
    expect(doc.levels).toHaveLength(1);
    expect(doc.levels[0]).toMatchObject({ name: 'Standard', color: 'violet' });
    expect(doc.levels[0].id).toMatch(/^new:/);
    expect(doc.sections).toEqual([]);
  });
});
