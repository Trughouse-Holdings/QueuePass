/**
 * Spec 035 T005 (FR-003 to FR-009, research R3, R6): preview errors appear and clear; seat
 * totals name what is left, and general admission over capacity is a problem.
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
  reserved: false,
  totalTicketCapacity: '100',
  venueCapacity: 100,
  layoutSeats: null,
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

describe('seatTotals', () => {
  const sections = [
    { id: 's-front', name: 'Front', rows: 1, seatsPerRow: 10 },
    { id: 's-middle', name: 'Middle', rows: 1, seatsPerRow: 10 },
    { id: 's-back', name: 'Back', rows: 1, seatsPerRow: 10 },
  ];

  it('counts a reserved layout as 20 of 30, then all 30 assigned', () => {
    const partial = seatTotals({
      reserved: true,
      types: [
        { name: 'Front', price: '120.00', quantity: '' },
        { name: 'Standard', price: '70.00', quantity: '' },
      ],
      sections,
      sectionType: { 's-front': '0', 's-middle': '1', 's-back': '' },
      totalTicketCapacity: '',
      venueCapacity: 30,
      layoutSeats: 30,
    });
    expect(partial.assigned).toBe(20);
    expect(partial.total).toBe(30);
    expect(partial.summary).toBe('20 of 30 seats assigned');
    expect(partial.leftoverSentence).toBe('10 seats not assigned to a ticket type');

    const full = seatTotals({
      reserved: true,
      types: [
        { name: 'Front', price: '120.00', quantity: '' },
        { name: 'Standard', price: '70.00', quantity: '' },
      ],
      sections,
      sectionType: { 's-front': '0', 's-middle': '1', 's-back': '1' },
      totalTicketCapacity: '',
      venueCapacity: 30,
      layoutSeats: 30,
    });
    expect(full.assigned).toBe(30);
    expect(full.leftoverSentence).toBe('All 30 seats are assigned.');
  });

  it('counts general admission 80 of 100 with 20 left, and names seats over capacity', () => {
    const under = seatTotals({
      reserved: false,
      types: [{ name: 'Floor', price: '80.00', quantity: '80' }],
      totalTicketCapacity: '100',
      venueCapacity: 100,
      layoutSeats: null,
    });
    expect(under.summary).toBe('80 of 100 seats assigned');
    expect(under.leftoverSentence).toBe('20 seats not assigned to a ticket type');

    const over = seatTotals({
      reserved: false,
      types: [{ name: 'Floor', price: '80.00', quantity: '112' }],
      totalTicketCapacity: '100',
      venueCapacity: 100,
      layoutSeats: null,
    });
    expect(over.over).toBe(12);
    expect(over.leftoverSentence).toBe("12 seats over the event's capacity");
  });
});
