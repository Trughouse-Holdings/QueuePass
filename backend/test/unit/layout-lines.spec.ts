import { gridLayout, seatPlace } from '../../src/layouts/layout-lines';

/**
 * Spec 038 FR-005, research R6 (T004): section lines placed on a grid of ceil(√n) columns, in
 * line order, left to right then down. Each section is a rectangle seatsPerRow × 2 + 4 units wide
 * and rows × 2 + 4 high; seats 2 units apart, 3 units in from its edges, row 1 at the top; every
 * grid cell is as large as the largest section, with 8 units between cells; `size` is the grid's
 * bounds.
 */
describe('section lines on a grid (R6)', () => {
  it('places one section at the origin, its size the whole map', () => {
    const { size, sections } = gridLayout([{ rows: 10, seatsPerRow: 20 }]);
    expect(size).toEqual({ width: 44, height: 24 });
    expect(sections).toEqual([
      {
        x: 0,
        y: 0,
        width: 44,
        height: 24,
        outline: [
          [0, 0],
          [44, 0],
          [44, 24],
          [0, 24],
        ],
        labelAt: [22, 12],
      },
    ]);
  });

  it.each([
    [1, 1],
    [2, 2],
    [3, 2],
    [4, 2],
    [5, 3],
    [9, 3],
    [10, 4],
    [50, 8],
    [100, 10],
  ])('puts %i sections in %i columns, in order', (n, columns) => {
    const lines = Array.from({ length: n }, () => ({ rows: 1, seatsPerRow: 1 }));
    const { size, sections } = gridLayout(lines);
    // Each section is 6 × 6; cells 6 + 8 apart.
    sections.forEach((s, i) => {
      expect([s.x, s.y]).toEqual([(i % columns) * 14, Math.floor(i / columns) * 14]);
    });
    const used = Math.min(n, columns);
    const gridRows = Math.ceil(n / columns);
    expect(size).toEqual({ width: used * 14 - 8, height: gridRows * 14 - 8 });
  });

  it('sizes every cell by the largest section, each rectangle by its own lines', () => {
    const { size, sections } = gridLayout([
      { rows: 2, seatsPerRow: 3 },
      { rows: 3, seatsPerRow: 4 },
      { rows: 2, seatsPerRow: 5 },
    ]);
    // Cells 14 wide (5 × 2 + 4) and 10 high (3 × 2 + 4), 2 columns.
    expect(sections.map((s) => [s.x, s.y, s.width, s.height])).toEqual([
      [0, 0, 10, 8],
      [22, 0, 12, 10],
      [0, 18, 14, 8],
    ]);
    expect(size).toEqual({ width: 36, height: 28 });
    expect(sections[1].labelAt).toEqual([28, 5]);
  });

  it('places seats 2 units apart, 3 in from the rectangle, row 1 at the top', () => {
    const { sections } = gridLayout([
      { rows: 2, seatsPerRow: 3 },
      { rows: 3, seatsPerRow: 4 },
    ]);
    expect(seatPlace(sections[0], 1, 1)).toEqual([3, 3]);
    expect(seatPlace(sections[0], 1, 3)).toEqual([7, 3]);
    expect(seatPlace(sections[0], 2, 1)).toEqual([3, 5]);
    // The last seat is 3 in from the right and bottom edges too.
    expect(sections[1].x).toBe(20);
    expect(seatPlace(sections[1], 3, 4)).toEqual([20 + 12 - 3, 10 - 3]);
  });

  it('fits the largest section lines in the 5,000-unit map (100 sections of 100 × 200)', () => {
    const lines = Array.from({ length: 100 }, () => ({ rows: 100, seatsPerRow: 200 }));
    const { size } = gridLayout(lines);
    expect(size).toEqual({ width: 10 * 412 - 8, height: 10 * 212 - 8 });
    expect(size.width).toBeLessThanOrEqual(5000);
  });
});
