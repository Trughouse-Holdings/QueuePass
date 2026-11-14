import { SEAT_LEVEL_SQL, resolveSeatLevel } from '../../src/seating/seat-levels';

/**
 * Spec 038 FR-003, research R1 (T004): a seat's level is its own, else its row's, else its
 * section's; the SQL computes the same thing with one COALESCE, never a stored copy.
 */
describe("a seat's level (R1)", () => {
  it("is the seat's own level when it has one", () => {
    expect(resolveSeatLevel({ seat: 'seat', row: 'row', section: 'section' })).toBe('seat');
    expect(resolveSeatLevel({ seat: 'seat', row: null, section: 'section' })).toBe('seat');
  });

  it("is the row's level when the seat has none", () => {
    expect(resolveSeatLevel({ seat: null, row: 'row', section: 'section' })).toBe('row');
  });

  it("is the section's level when neither has one", () => {
    expect(resolveSeatLevel({ seat: null, row: null, section: 'section' })).toBe('section');
  });

  it('is computed in SQL as COALESCE(seat, row, section)', () => {
    expect(SEAT_LEVEL_SQL.sql).toBe('COALESCE(s."levelId", r."levelId", sec."levelId")');
  });
});
