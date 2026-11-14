import { describe, expect, it } from 'vitest';
import {
  emptyDoc,
  outlineOf,
  type EdSection,
  type EditorDoc,
} from '../../src/layout-editor/editor-doc';
import { emptyLevels, findOverlaps, warningsOf } from '../../src/layout-editor/overlap';

/**
 * Spec 039 research R15 (T027): sections overlap when a seat of one is closer than 1.5 units to a
 * seat of another; only sections whose outlines' bounds meet are compared. Levels with no seats
 * are listed too. Neither blocks a save.
 */
const section = (id: string, name: string, x: number, y: number): EdSection => {
  const rows = [0, 1].map((k) => ({
    id: `${id}-r${k}`,
    label: String(k + 1),
    levelId: null,
    seats: [0, 1, 2].map((i) => ({
      id: `${id}-r${k}-s${i}`,
      label: String(i + 1),
      at: [x + 2 * i, y - 2 * k] as [number, number],
      levelId: null,
      accessible: false,
    })),
  }));
  return {
    id,
    name,
    levelId: 'new:0',
    origin: [x + 2, y],
    angle: 0,
    generator: null,
    outline: outlineOf(rows),
    rows,
  };
};

const docOf = (...sections: EdSection[]): EditorDoc => ({ ...emptyDoc(), sections });

describe('findOverlaps', () => {
  it('finds sections with seats 1.4 units apart, and not 1.6', () => {
    expect(
      findOverlaps(docOf(section('a', '101', 10, 10), section('b', '102', 15.4, 10))).pairs,
    ).toEqual([['a', 'b']]);
    expect(
      findOverlaps(docOf(section('a', '101', 10, 10), section('b', '102', 15.6, 10))).pairs,
    ).toEqual([]);
  });

  it('does not compare sections whose bounds do not meet', () => {
    const r = findOverlaps(
      docOf(
        section('a', '101', 10, 10),
        section('b', '102', 100, 10),
        section('c', '103', 10, 100),
      ),
    );
    expect(r.pairs).toEqual([]);
    expect(r.compared).toBe(0);
  });
});

describe('warningsOf', () => {
  it('names each overlap and each level with no seats', () => {
    const doc: EditorDoc = {
      ...docOf(section('a', '101', 10, 10), section('b', '102', 15, 10)),
      levels: [
        { id: 'new:0', name: 'Standard', color: 'violet' },
        { id: 'new:9', name: 'Upper', color: 'teal' },
      ],
    };
    expect(emptyLevels(doc).map((l) => l.name)).toEqual(['Upper']);
    expect(warningsOf(doc).messages).toEqual(['Section 102 overlaps 101', 'Upper has no seats']);
    expect([...warningsOf(doc).sections].sort()).toEqual(['a', 'b']);
  });
});
