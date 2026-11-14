import { centroid, checkLayoutFile } from '../../src/layouts/layout-file';

/**
 * Spec 038 FR-004, research R5 (T057): a layout file checked as a whole, each problem with its
 * place in the file. The Backend `layouts` test refuses whole files through the API; these are the
 * shapes it does not send: a file, floor, level, section, row or seat that is not what the format
 * says, each refused with its own path and message.
 */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const square = (x: number, y: number, side: number) => [
  [x, y],
  [x + side, y],
  [x + side, y + side],
  [x, y + side],
];

/** A valid file: one section of two rows, one a run and one listed seats. */
const valid = (): Json => ({
  format: 1,
  name: 'Hall',
  floor: { kind: 'COURT', outline: square(60, 10, 20) },
  size: { width: 100, height: 60 },
  levels: [
    { key: 'front', name: 'Front', rank: 1, color: 'violet' },
    { key: 'back', name: 'Back', rank: 2, color: 'teal' },
  ],
  sections: [
    {
      name: 'A',
      level: 'front',
      outline: square(5, 5, 40),
      rows: [
        { label: 'A', seats: { first: 1, count: 3, from: [10, 10], to: [30, 10] } },
        {
          label: 'B',
          level: 'back',
          seats: [
            { label: '1', at: [10, 20] },
            { label: '2', at: [20, 20], level: 'front', accessible: true },
          ],
        },
      ],
    },
  ],
});

/** The problems of `valid()` changed by `change`. */
function problems(change: (f: Json) => void): { path: string; message: string }[] {
  const f = valid();
  change(f);
  const result = checkLayoutFile(f);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.problems;
}

describe('checkLayoutFile (R5)', () => {
  it('takes the valid file, its seats numbered in order and the label at the centroid', () => {
    const result = checkLayoutFile(valid());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout).toMatchObject({ name: 'Hall', floorKind: 'COURT', seatCount: 5 });
    const [a] = result.layout.sections;
    expect(a.labelAt).toEqual([25, 25]);
    expect(a.rows[1].seats.map((s) => [s.number, s.label, s.levelKey, s.accessible])).toEqual([
      [1, '1', null, false],
      [2, '2', 'front', true],
    ]);
  });

  it('refuses anything but an object', () => {
    for (const file of [null, [], 'layout', 3]) {
      expect(checkLayoutFile(file)).toEqual({
        ok: false,
        problems: [{ path: 'file', message: 'The layout file must be a JSON object.' }],
        more: 0,
      });
    }
  });

  it.each<[string, (f: Json) => void, string, string]>([
    ['format 2', (f) => (f.format = 2), 'file.format', 'The layout file must say "format": 1.'],
    ['no name', (f) => (f.name = '  '), 'file.name', "The layout's name is missing."],
    [
      'no size',
      (f) => delete f.size,
      'file.size',
      'The layout file needs a "size" with a width and a height.',
    ],
    [
      'a height of 0',
      (f) => (f.size.height = 0),
      'file.size.height',
      "The map's height must be a whole number from 1 to 5,000.",
    ],
    [
      'no floor',
      (f) => delete f.floor,
      'file.floor',
      'The layout file needs a "floor" with its "kind".',
    ],
    [
      'an unknown floor kind',
      (f) => (f.floor.kind = 'POOL'),
      'file.floor.kind',
      "The floor's kind must be one of COURT, END_STAGE, CENTER_STAGE, RING, NONE.",
    ],
    [
      'a NONE floor with an outline',
      (f) => (f.floor.kind = 'NONE'),
      'file.floor.outline',
      'A floor of kind NONE has no outline.',
    ],
    [
      'a COURT floor without an outline',
      (f) => delete f.floor.outline,
      'file.floor.outline',
      'A floor of kind COURT needs an outline.',
    ],
    [
      'an outline of 2 points',
      (f) =>
        (f.floor.outline = [
          [1, 1],
          [2, 2],
        ]),
      'file.floor.outline',
      'The floor: the outline needs at least 3 points.',
    ],
    [
      'an outline point that is not a point',
      (f) => (f.floor.outline[1] = [1]),
      'file.floor.outline[1]',
      'The floor: outline point 2 must be a point [x, y].',
    ],
    [
      'no levels',
      (f) => (f.levels = []),
      'file.levels',
      'The layout file needs at least one price level.',
    ],
    [
      'a level that is not an object',
      (f) => (f.levels[1] = 'back'),
      'file.levels[1]',
      'Level 2 must be an object with a key, name, rank and color.',
    ],
    [
      'a key with capitals',
      (f) => (f.levels[1].key = 'Back'),
      'file.levels[1].key',
      'Level 2: the key must be 1 to 30 lower-case letters, digits or hyphens.',
    ],
    [
      'a key twice',
      (f) => (f.levels[1].key = 'front'),
      'file.levels[1].key',
      'Level key "front" appears twice',
    ],
    [
      'a level name twice',
      (f) => (f.levels[1].name = 'FRONT'),
      'file.levels[1].name',
      'Level FRONT appears twice',
    ],
    [
      'a rank of 13',
      (f) => (f.levels[1].rank = 13),
      'file.levels[1].rank',
      'Level "back": the rank must be a whole number from 1 to 12.',
    ],
    [
      'a rank twice',
      (f) => (f.levels[1].rank = 1),
      'file.levels[1].rank',
      'Level "back": rank 1 is another level\'s too',
    ],
    [
      'an unknown color',
      (f) => (f.levels[1].color = 'chartreuse'),
      'file.levels[1].color',
      'Level "back": the color must be one of ',
    ],
    [
      'no sections',
      (f) => (f.sections = []),
      'file.sections',
      'The layout file needs at least one section.',
    ],
    [
      'a section that is not an object',
      (f) => f.sections.push(7),
      'file.sections[1]',
      'Section 2 must be an object with a name, level, outline and rows.',
    ],
    [
      'a section name twice',
      (f) => f.sections.push({ ...valid().sections[0], name: 'a' }),
      'file.sections[1].name',
      'Section a appears twice',
    ],
    [
      'a section level that is not a key',
      (f) => (f.sections[0].level = 1),
      'file.sections[0].level',
      "Section A: the level must be a level's key.",
    ],
    [
      'a label point outside the map',
      (f) => (f.sections[0].labelAt = [120, 5]),
      'file.sections[0].labelAt',
      'Section A: the label point (120, 5) is outside the map (100 × 60)',
    ],
    [
      'no rows',
      (f) => (f.sections[0].rows = []),
      'file.sections[0].rows',
      'Section A: a section needs at least one row.',
    ],
    [
      'a row that is not an object',
      (f) => (f.sections[0].rows[1] = 'B'),
      'file.sections[0].rows[1]',
      'Section A, row 2 must be an object with a label and seats.',
    ],
    [
      'a row label twice',
      (f) => (f.sections[0].rows[1].label = 'a'),
      'file.sections[0].rows[1].label',
      'Section A, row a appears twice',
    ],
    [
      'a row label missing',
      (f) => (f.sections[0].rows[1].label = ''),
      'file.sections[0].rows[1].label',
      'Section A, row 2: the label is missing.',
    ],
    [
      'a row of no seats',
      (f) => (f.sections[0].rows[1].seats = []),
      'file.sections[0].rows[1].seats',
      'Section A, row B: a row needs at least one seat.',
    ],
    [
      'a row of 201 listed seats',
      (f) =>
        (f.sections[0].rows[1].seats = Array.from({ length: 201 }, (_, i) => ({
          label: String(i + 1),
          at: [10, 20],
        }))),
      'file.sections[0].rows[1].seats',
      'Section A, row B: 201 seats; a row has at most 200',
    ],
    [
      'seats that are neither a list nor a run',
      (f) => (f.sections[0].rows[1].seats = 'all'),
      'file.sections[0].rows[1].seats',
      'Section A, row B: seats must be a list of seats or a run.',
    ],
    [
      'a run from seat 0',
      (f) => (f.sections[0].rows[0].seats.first = 0),
      'file.sections[0].rows[0].seats.first',
      "Section A, row A: a run's first seat must be a whole number from 1 to 9,999.",
    ],
    [
      'a run of no seats',
      (f) => (f.sections[0].rows[0].seats.count = 0),
      'file.sections[0].rows[0].seats.count',
      "Section A, row A: a run's count must be a whole number of 1 or more.",
    ],
    [
      'a run of 201 seats',
      (f) => (f.sections[0].rows[0].seats.count = 201),
      'file.sections[0].rows[0].seats.count',
      'Section A, row A: 201 seats; a row has at most 200',
    ],
    [
      'a run whose bend is not a point',
      (f) => (f.sections[0].rows[0].seats.bend = 'up'),
      'file.sections[0].rows[0].seats.bend',
      'Section A, row A: the bend must be a point [x, y].',
    ],
    [
      'a seat label missing',
      (f) => delete f.sections[0].rows[1].seats[0].label,
      'file.sections[0].rows[1].seats[0].label',
      'Section A, row B, seat 1: the label is missing.',
    ],
    [
      'a seat label twice',
      (f) => (f.sections[0].rows[1].seats[1].label = '1'),
      'file.sections[0].rows[1].seats[1]',
      'Section A, row B: seat 1 appears twice',
    ],
    [
      'a seat level not in the file',
      (f) => (f.sections[0].rows[1].seats[1].level = 'upper'),
      'file.sections[0].rows[1].seats[1].level',
      'Section A, row B, seat 2: level "upper" is not in the file',
    ],
    [
      'accessible that is not true or false',
      (f) => (f.sections[0].rows[1].seats[1].accessible = 'yes'),
      'file.sections[0].rows[1].seats[1].accessible',
      'Section A, row B, seat 2: accessible must be true or false.',
    ],
    [
      'a seat outside the map',
      (f) => (f.sections[0].rows[1].seats[1].at = [20, 70]),
      'file.sections[0].rows[1].seats[1].at',
      'Section A, row B: seat 2 (20, 70) is outside the map (100 × 60)',
    ],
  ])('refuses %s', (_label, change, path, message) => {
    const found = problems(change);
    expect(found.map((p) => p.path)).toContain(path);
    expect(found.find((p) => p.path === path)?.message).toContain(message);
  });

  it('keeps the first 50 problems and counts the rest', () => {
    const f = valid();
    f.levels = Array.from({ length: 60 }, (_, i) => ({ key: `l${i}`, name: '', rank: 1 }));
    const result = checkLayoutFile(f);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toHaveLength(50);
    expect(result.more).toBeGreaterThan(0);
  });
});

describe('centroid', () => {
  it('is the area centroid of a polygon', () => {
    expect(centroid(square(0, 0, 10) as [number, number][])).toEqual([5, 5]);
  });

  it('is the mean of the points when they enclose no area', () => {
    expect(
      centroid([
        [0, 0],
        [2, 0],
        [4, 0],
      ]),
    ).toEqual([2, 0]);
  });
});
