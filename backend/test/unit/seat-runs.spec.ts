import { expandRun } from '../../src/layouts/seat-runs';

/**
 * Spec 038 research R5 (T004): a run `{ first, count, from, to }` is `count` seats labelled
 * `first` … `first + count − 1`, spaced evenly from `from` to `to`; with `bend`, along the
 * quadratic curve from `from` to `to` that passes through `bend` halfway.
 */
describe('a seat run (R5)', () => {
  it('labels count seats from first, evenly from `from` to `to`', () => {
    expect(expandRun({ first: 1, count: 5, from: [10, 20], to: [18, 20] })).toEqual([
      { label: '1', at: [10, 20] },
      { label: '2', at: [12, 20] },
      { label: '3', at: [14, 20] },
      { label: '4', at: [16, 20] },
      { label: '5', at: [18, 20] },
    ]);
  });

  it('starts at any first number, along any direction', () => {
    expect(expandRun({ first: 101, count: 3, from: [0, 0], to: [6, 8] })).toEqual([
      { label: '101', at: [0, 0] },
      { label: '102', at: [3, 4] },
      { label: '103', at: [6, 8] },
    ]);
  });

  it('puts a single seat at `from`', () => {
    expect(expandRun({ first: 7, count: 1, from: [5, 9], to: [50, 90] })).toEqual([
      { label: '7', at: [5, 9] },
    ]);
  });

  it('curves through `bend` halfway, on a quadratic curve', () => {
    const seats = expandRun({ first: 1, count: 5, from: [0, 10], to: [8, 10], bend: [4, 6] });
    expect(seats.map((s) => s.label)).toEqual(['1', '2', '3', '4', '5']);
    expect(seats[0].at).toEqual([0, 10]);
    expect(seats[4].at).toEqual([8, 10]);
    expect(seats[2].at[0]).toBeCloseTo(4);
    expect(seats[2].at[1]).toBeCloseTo(6);
    // Control point 2·bend − (from + to)/2 = (4, 2); at t = 1/4: 9/16·from + 6/16·c + 1/16·to.
    expect(seats[1].at[0]).toBeCloseTo((9 * 0 + 6 * 4 + 8) / 16);
    expect(seats[1].at[1]).toBeCloseTo((9 * 10 + 6 * 2 + 10) / 16);
    // Symmetric about the bend.
    expect(seats[3].at[0]).toBeCloseTo(8 - seats[1].at[0]);
    expect(seats[3].at[1]).toBeCloseTo(seats[1].at[1]);
  });

  it('gives 200 seats for the largest run, the last at `to`', () => {
    const seats = expandRun({ first: 1, count: 200, from: [0, 0], to: [398, 0] });
    expect(seats).toHaveLength(200);
    expect(seats[199]).toEqual({ label: '200', at: [398, 0] });
    expect(seats[100].at).toEqual([200, 0]);
  });
});
