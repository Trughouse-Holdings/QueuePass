/**
 * Spec 035 T005 (FR-003 to FR-009, research R3, R6): preview errors appear and clear; seat
 * totals name what is left, and general admission over capacity is a problem. Spec 038 (FR-011,
 * FR-014): a seated event's on-sale levels need prices, and its seats on sale are its capacity.
 */
import { describe, expect, it } from 'vitest';
import {
  MSG,
  overCapacityMessage,
  previewErrors,
  repeatedTypeNameMessage,
  seatTotals,
  type PreviewInput,
} from '../src/pages/event-form-checks';

const NAME_TAKEN = repeatedTypeNameMessage(1, 'floor', 0, 'Floor');

const base = (over: Partial<PreviewInput> = {}): PreviewInput => ({
  name: 'Season Opener',
  locationId: 'v-plain',
  startsAt: '2030-05-01T18:00',
  endsAt: '2030-05-01T21:00',
  doorsOpenAt: '2030-05-01T17:00',
  venueZone: 'America/New_York',
  hasVenue: true,
  occurrence: { startsAt: '', endsAt: '', doorsOpenAt: '' },
  typesLoaded: true,
  types: [{ name: 'Floor', price: '80.00', quantity: '80' }],
  seating: null,
  totalTicketCapacity: '100',
  venueCapacity: 100,
  maxPerCustomer: '',
  ...over,
});

describe('previewErrors', () => {
  it('flags an empty name and clears when it is filled', () => {
    const empty = previewErrors(base({ name: '  ' }));
    expect(empty.get('name')).toBe(MSG.name);
    expect(previewErrors(base()).has('name')).toBe(false);
  });

  it('flags a bad price and clears when it is fixed', () => {
    const bad = previewErrors(base({ types: [{ name: 'Floor', price: '8.999', quantity: '80' }] }));
    expect(bad.get('tiers.0.price')).toBe(MSG.badPrice);
    expect(
      previewErrors(base({ types: [{ name: 'Floor', price: '8.99', quantity: '80' }] })).has(
        'tiers.0.price',
      ),
    ).toBe(false);
  });

  it('uses the 031 wording for a repeated type name, on the later type', () => {
    const errors = previewErrors(
      base({
        types: [
          { name: 'Floor', price: '80.00', quantity: '40' },
          { name: 'floor', price: '60.00', quantity: '40' },
        ],
      }),
    );
    expect(errors.get('tiers.1.name')).toBe(NAME_TAKEN);
    expect(errors.has('tiers.0.name')).toBe(false);
  });

  it('flags an end before the start, and doors out of range', () => {
    const order = previewErrors(base({ startsAt: '2030-05-01T21:00', endsAt: '2030-05-01T18:00' }));
    expect(order.get('endsAt')).toBe(MSG.endOrder);
    const doors = previewErrors(base({ doorsOpenAt: '2030-05-01T08:00' }));
    expect(doors.get('doorsOpenAt')).toMatch(/Doors must open no more than 6 hours/);
  });

  it('flags quantities over capacity and a limit outside 1 to the capacity', () => {
    const over = previewErrors(
      base({
        types: [{ name: 'Floor', price: '80.00', quantity: '120' }],
        totalTicketCapacity: '100',
      }),
    );
    expect(over.get('tiers')).toBe(overCapacityMessage('Season Opener', 100, 120));
    const limit = previewErrors(base({ maxPerCustomer: '200' }));
    expect(limit.get('maxTicketsPerCustomer')).toMatch(/from 1 to 100/);
    expect(previewErrors(base({ maxPerCustomer: '4' })).has('maxTicketsPerCustomer')).toBe(false);
  });
});

describe('previewErrors for a seated event (038)', () => {
  const seating = (over: Partial<NonNullable<PreviewInput['seating']>> = {}) => ({
    seatsOnSale: 60,
    levels: [
      { id: 'l-front', name: 'Front', onSale: 30, price: '95.00' },
      { id: 'l-back', name: 'Back', onSale: 30, price: '' },
      { id: 'l-upper', name: 'Upper', onSale: 0, price: '' },
    ],
    ...over,
  });

  it('asks a price of each level with seats on sale only, and checks its form', () => {
    const errors = previewErrors(base({ seating: seating() }));
    expect(errors.get('levelPrices.l-back')).toBe('Give Back a price.');
    expect(errors.has('levelPrices.l-front')).toBe(false);
    expect(errors.has('levelPrices.l-upper')).toBe(false);
    const bad = previewErrors(
      base({
        seating: seating({
          levels: [{ id: 'l-front', name: 'Front', onSale: 60, price: '9.999' }],
        }),
      }),
    );
    expect(bad.get('levelPrices.l-front')).toBe(MSG.badPrice);
  });

  it('checks no ticket type, refuses no seat on sale, and limits per customer to the seats on sale', () => {
    const errors = previewErrors(
      base({
        types: [{ name: '', price: '', quantity: '' }],
        seating: seating({ seatsOnSale: 0, levels: [] }),
        maxPerCustomer: '1',
      }),
    );
    expect([...errors.keys()].filter((k) => k.startsWith('tiers'))).toEqual([]);
    expect(errors.get('offSale')).toBe(MSG.noSeatOnSale);
    expect(errors.get('maxTicketsPerCustomer')).toMatch(/from 1 to 0/);
    const limit = previewErrors(base({ seating: seating(), maxPerCustomer: '61' }));
    expect(limit.get('maxTicketsPerCustomer')).toMatch(/from 1 to 60/);
  });
});

describe('seatTotals', () => {
  it('counts general admission 80 of 100 with 20 left, and names seats over capacity', () => {
    const under = seatTotals({
      types: [{ name: 'Floor', price: '80.00', quantity: '80' }],
      totalTicketCapacity: '100',
      venueCapacity: 100,
    });
    expect(under.summary).toBe('80 of 100 seats assigned');
    expect(under.leftoverSentence).toBe('20 seats not assigned to a ticket type');

    const over = seatTotals({
      types: [{ name: 'Floor', price: '80.00', quantity: '112' }],
      totalTicketCapacity: '100',
      venueCapacity: 100,
    });
    expect(over.over).toBe(12);
    expect(over.leftoverSentence).toBe("12 seats over the event's capacity");
  });
});
