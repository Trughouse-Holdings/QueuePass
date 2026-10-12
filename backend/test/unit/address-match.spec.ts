import { houseNumber, matchesTyped } from '../../src/locations/address-match';

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

  it('accepts a corrected city when ZIP and house number hold', () => {
    expect(matchesTyped({ ...typed, city: 'Lexinton' }, match('1540 UNIVERSITY DR', '40508'))).toBe(
      true,
    );
  });
});
