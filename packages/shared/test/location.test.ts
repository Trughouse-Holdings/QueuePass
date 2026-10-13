import { describe, it, expect } from 'vitest';
import { LOCATION_LIMITS, US_STATES, ZIP_PATTERN, formatAddress, mapsUrl } from '../src/location';

/** Spec 013 FR-001, FR-010, FR-014; data-model.md "Shared types and helpers". */
describe('US_STATES', () => {
  const codes = US_STATES.map((s) => s.code);

  it('lists the 50 states and DC, each once', () => {
    expect(codes).toHaveLength(51);
    expect(new Set(codes).size).toBe(51);
    expect(codes).toContain('DC');
    expect(codes).toContain('KY');
  });

  it('lists no territory', () => {
    for (const territory of ['PR', 'GU', 'VI', 'AS', 'MP', 'UM']) {
      expect(codes).not.toContain(territory);
    }
  });

  it('gives every state a name', () => {
    expect(US_STATES.find((s) => s.code === 'KY')?.name).toBe('Kentucky');
    expect(US_STATES.every((s) => s.name.length > 0)).toBe(true);
  });
});

describe('ZIP_PATTERN', () => {
  it.each(['40507', '40507-1234'])('accepts %s', (zip) => {
    expect(ZIP_PATTERN.test(zip)).toBe(true);
  });

  it.each(['4050', '405071', '40507-123', 'ABCDE'])('refuses %s', (zip) => {
    expect(ZIP_PATTERN.test(zip)).toBe(false);
  });
});

describe('LOCATION_LIMITS', () => {
  it('caps street at 200 and city at 100 characters', () => {
    expect(LOCATION_LIMITS.streetMaxLength).toBe(200);
    expect(LOCATION_LIMITS.cityMaxLength).toBe(100);
  });
});

describe('formatAddress', () => {
  it('builds "STREET, CITY, ST ZIP"', () => {
    expect(
      formatAddress({ street: '430 W VINE ST', city: 'LEXINGTON', state: 'KY', zip: '40507' }),
    ).toBe('430 W VINE ST, LEXINGTON, KY 40507');
  });
});

describe('mapsUrl', () => {
  it('searches Google Maps for the address', () => {
    expect(mapsUrl('430 W VINE ST, LEXINGTON, KY 40507')).toBe(
      'https://www.google.com/maps/search/?api=1&query=430%20W%20VINE%20ST%2C%20LEXINGTON%2C%20KY%2040507',
    );
  });

  it('encodes spaces, commas, # and & with encodeURIComponent', () => {
    const address = '1 A St #2 & B, City';
    expect(mapsUrl(address)).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
    );
    expect(mapsUrl(address)).toContain('%23');
    expect(mapsUrl(address)).toContain('%26');
    expect(mapsUrl(address)).not.toContain(' ');
  });
});
