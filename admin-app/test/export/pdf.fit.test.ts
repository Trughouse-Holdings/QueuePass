import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Order } from '@queuepass/shared';
import { attendeeTable } from '../../src/export/attendee-rows';
import { salesTable } from '../../src/export/sales-rows';
import { toPdf } from '../../src/export/pdf';
import { loadFontsFromDisk } from './fonts';
import { CHICAGO_EVENT, EXPORT_ORDERS, EXPORT_REPORT } from './fixtures';
import { sampleOf } from './sample';

/**
 * Spec 023 FR-009, SC-005 (review round 1, findings 1 and 2): the table fits the printable width
 * of letter landscape even with the widest values, and every page says "Page n of m".
 */
type Doc = {
  text: (...args: unknown[]) => unknown;
  lastAutoTable: { columns: { width: number }[] };
};
const docs: Doc[] = [];
const drawn: string[] = [];

vi.mock('jspdf', async (importOriginal) => {
  const m = await importOriginal<typeof import('jspdf')>();
  class Recording extends m.jsPDF {
    constructor(...args: ConstructorParameters<typeof m.jsPDF>) {
      super(...args);
      const doc = this as unknown as Doc;
      const text = doc.text.bind(this);
      doc.text = (...a: unknown[]) => {
        drawn.push(...[a[0]].flat().filter((s): s is string => typeof s === 'string'));
        return text(...a);
      };
      docs.push(doc);
    }
  }
  return { ...m, jsPDF: Recording };
});

afterEach(() => {
  docs.length = 0;
  drawn.length = 0;
  vi.restoreAllMocks();
});

const PRINTABLE = 792 - 2 * 36;
const tableWidth = () => docs[0].lastAutoTable.columns.reduce((sum, c) => sum + c.width, 0);

/** The widest values each column can hold in practice. */
const WIDEST: Order = {
  ...EXPORT_ORDERS[0],
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  customerUsername: 'm'.repeat(24),
  holderName: 'Maximilian Featherstonehaugh-Wolfeschlegelsteinhausen',
  tierName: 'General admission',
  unitPrice: '9999.99',
  tickets: [
    {
      id: 'w1',
      code: 'WWWWMMMMWWWW',
      status: 'VALID',
      checkedInAt: '2026-11-01T22:45:00.000Z',
      seat: { section: 'MMMM', row: 300, seat: 300 },
    },
  ],
};

describe('the PDF table fits the page', () => {
  it.each([
    ['the sample attendee list', [...EXPORT_ORDERS]],
    ['the widest attendee values', [WIDEST, ...EXPORT_ORDERS]],
  ])('%s', async (_, orders) => {
    const log = vi.spyOn(console, 'log');
    const table = attendeeTable(CHICAGO_EVENT, orders, 0, 'admin1', 'UTC');
    await toPdf(table, loadFontsFromDisk);
    expect(log).not.toHaveBeenCalledWith(expect.stringMatching(/could not fit/));
    expect(tableWidth()).toBeLessThanOrEqual(PRINTABLE + 0.01);
  });

  it('the sales report with a large revenue', async () => {
    const log = vi.spyOn(console, 'log');
    const report = {
      ...EXPORT_REPORT,
      totals: { ...EXPORT_REPORT.totals, revenue: '99999999.99', ticketCapacity: 9_999_999 },
    };
    await toPdf(salesTable(report, 'admin1', 'UTC'), loadFontsFromDisk);
    expect(log).not.toHaveBeenCalledWith(expect.stringMatching(/could not fit/));
    expect(tableWidth()).toBeLessThanOrEqual(PRINTABLE + 0.01);
  });
});

describe('the footer', () => {
  it('says "Page n of m" on every page', async () => {
    await toPdf(sampleOf(200), loadFontsFromDisk);
    const footers = drawn.filter((s) => /^Page \d+ of \d+$/.test(s));
    const pages = footers.length;
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(footers).toEqual(Array.from({ length: pages }, (_, i) => `Page ${i + 1} of ${pages}`));
  });
});
