import { houseNumber, keepUnit, matchesTyped } from '../../src/locations/address-match';

/**
 * Spec 013 FR-021, research R3: a single match is trusted only when it keeps the typed ZIP code
 * and house number. The street itself is not compared: the service writes it in its own
 * standard form ("West" → "W", "Street" → "ST").
 */
describe('houseNumber', () => {
  it.each([
    ['1540 University Dr', '1540'],
    ['  430  W Vine St', '430'],
    ['12b Main St', '12B'],
    ['100-02 Queens Blvd', '100-02'],
    ['One Arena Plaza', ''],
    ['1540, University Dr', '1540'],
    ['123 1/2 Main St', '123'],
    ['0430 W Vine St', '430'],
    ['0 Main St', '0'],
  ])('reads %p as %p', (street, expected) => {
    expect(houseNumber(street)).toBe(expected);
  });
});

describe('matchesTyped', () => {
  const typed = { street: '1540 University Dr', city: 'Lexington', state: 'KY', zip: '40508' };
  const match = (street: string, zip: string) => ({ street, city: 'LEXINGTON', state: 'KY', zip });

  it('refuses a match with another ZIP code (Kroger Field)', () => {
    expect(matchesTyped(typed, match('1540 UNIVERSITY CT', '40503'))).toBe(false);
  });

  it('refuses a match with another house number', () => {
    expect(matchesTyped(typed, match('1504 UNIVERSITY DR', '40508'))).toBe(false);
  });

  it('accepts the same ZIP and house number with the street in standard form', () => {
    expect(
      matchesTyped(
        { street: '430 West Vine Street', city: 'Lexington', state: 'KY', zip: '40507' },
        { street: '430 W VINE ST', city: 'LEXINGTON', state: 'KY', zip: '40507' },
      ),
    ).toBe(true);
  });

  it('compares only the first 5 digits of a typed ZIP+4', () => {
    expect(
      matchesTyped({ ...typed, zip: '40508-1234' }, match('1540 UNIVERSITY DR', '40508')),
    ).toBe(true);
  });

  it('ignores a comma after the house number and leading zeros', () => {
    expect(
      matchesTyped(
        { ...typed, street: '1540, University Dr' },
        match('1540 UNIVERSITY DR', '40508'),
      ),
    ).toBe(true);
    expect(
      matchesTyped(
        { ...typed, street: '01540 University Dr' },
        match('1540 UNIVERSITY DR', '40508'),
      ),
    ).toBe(true);
  });

  it('accepts a corrected city when ZIP and house number hold', () => {
    expect(matchesTyped({ ...typed, city: 'Lexinton' }, match('1540 UNIVERSITY DR', '40508'))).toBe(
      true,
    );
  });

  // Issue #36 (013 research R15): the live service writes Queens numbers with their hyphen.
  it('accepts a Queens house number the service writes with a hyphen', () => {
    const queens = { street: '10724 71st Ave', city: 'Forest Hills', state: 'NY', zip: '11375' };
    const census = { street: '107-24 71ST AVE', city: 'FOREST HILLS', state: 'NY', zip: '11375' };
    expect(matchesTyped(queens, census)).toBe(true);
    expect(matchesTyped({ ...queens, street: '107-24 71st Ave' }, census)).toBe(true);
  });

  // Issue #36 review, M2: only a hyphenated number against the same digits without one.
  it('does not equate two hyphenated numbers that differ (12-34 vs 1-234)', () => {
    expect(
      matchesTyped(
        { street: '12-34 Main St', city: 'Queens', state: 'NY', zip: '11375' },
        { street: '1-234 MAIN ST', city: 'QUEENS', state: 'NY', zip: '11375' },
      ),
    ).toBe(false);
  });

  it('still refuses a range answered with one of its numbers (430-432 → 432)', () => {
    expect(
      matchesTyped(
        { street: '430-432 W Vine St', city: 'Lexington', state: 'KY', zip: '40507' },
        { street: '432 W VINE ST', city: 'LEXINGTON', state: 'KY', zip: '40507' },
      ),
    ).toBe(false);
  });
});

/**
 * Issue #36 (013 research R15): the service drops a suite or unit; the one the admin typed is
 * kept at the end of the verified street, upper case.
 */
describe('keepUnit', () => {
  it.each([
    ['430 W Vine St Ste 2', '430 W VINE ST', '430 W VINE ST STE 2'],
    ['430 West Vine Street Suite 200', '430 W VINE ST', '430 W VINE ST SUITE 200'],
    ['430 W Vine St, Ste. 2', '430 W VINE ST', '430 W VINE ST STE. 2'],
    ['430 W Vine St #5', '430 W VINE ST', '430 W VINE ST #5'],
    ['430 W Vine St # 5', '430 W VINE ST', '430 W VINE ST # 5'],
    ['430 W Vine St Unit B', '430 W VINE ST', '430 W VINE ST UNIT B'],
    ['430 W Vine St Fl 3', '430 W VINE ST', '430 W VINE ST FL 3'],
    ['430 W Vine St  Room 12A', '430 W VINE ST', '430 W VINE ST ROOM 12A'],
    ['430 W Vine St Bldg 4-B', '430 W VINE ST', '430 W VINE ST BLDG 4-B'],
    // Issue #36 review, M1: a street that ends in the unit's number still gets the unit.
    ['100 Route 9 Ste 9', '100 ROUTE 9', '100 ROUTE 9 STE 9'],
    ['100 Pilot Rd Lot 9', '100 PILOT 9', '100 PILOT 9 LOT 9'],
  ])('keeps the unit of %p on %p', (typed, matched, expected) => {
    expect(keepUnit(typed, matched)).toBe(expected);
  });

  it.each([
    ['no unit', '430 W Vine St', '430 W VINE ST'],
    ['a unit the service kept', '430 W Vine St Ste 2', '430 W VINE ST STE 2'],
    ['a street named like a unit', '123 Unit Rd', '123 UNIT RD'],
    ['a word that is no unit number', '100 Suite Ave', '100 SUITE AVE'],
    ['a unit word right after the number', '12 Ste 5', '12 STE 5'],
  ])('leaves the match as it is with %s', (_label, typed, matched) => {
    expect(keepUnit(typed, matched)).toBe(matched);
  });

  it('leaves the match as it is when the unit would make the street longer than 200', () => {
    const matched = `430 ${'W'.repeat(190)} ST`;
    expect(keepUnit('430 W Vine St Suite 12345', matched)).toBe(matched);
  });
});
