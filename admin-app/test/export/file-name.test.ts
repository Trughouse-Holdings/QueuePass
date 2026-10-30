import { describe, it, expect } from 'vitest';
import { fileName, slug } from '../../src/export/file-name';

/** Spec 023 FR-012 (research R8): the zone is an argument, so the device zone never matters. */
const AT = '2026-10-30T18:05:00Z';

describe('fileName', () => {
  it('names an attendee list after the event and the made-at time in the admin zone', () => {
    expect(fileName('attendees', 'Export Test, Café', AT, 'America/New_York', 'csv')).toBe(
      'attendees-export-test-cafe-2026-10-30-1405.csv',
    );
    expect(fileName('attendees', 'Export Test, Café', AT, 'America/Los_Angeles', 'csv')).toBe(
      'attendees-export-test-cafe-2026-10-30-1105.csv',
    );
  });

  it('accepts a made-at time with an offset, as the tables carry it', () => {
    expect(
      fileName('attendees', 'Gala', '2026-10-30T14:05:00-04:00', 'America/Chicago', 'xlsx'),
    ).toBe('attendees-gala-2026-10-30-1305.xlsx');
  });

  it('names the sales report without an event', () => {
    expect(fileName('sales-report', null, AT, 'America/New_York', 'pdf')).toBe(
      'sales-report-2026-10-30-1405.pdf',
    );
  });
});

describe('slug', () => {
  it('keeps letters and digits, drops diacritics, and joins the rest with one hyphen', () => {
    expect(slug('  Zoë’s  Night — Part 2!! ')).toBe('zoe-s-night-part-2');
  });

  it('is "event" when nothing is left', () => {
    expect(slug('山田 — !!')).toBe('event');
  });

  it('cuts at 60 characters, never ending in a hyphen', () => {
    const name = `${'a'.repeat(59)} bcd`;
    expect(slug(name)).toBe('a'.repeat(59));
    expect(slug('b'.repeat(61))).toBe('b'.repeat(60));
  });
});
