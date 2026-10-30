import { describe, it, expect } from 'vitest';
import readExcelFile from 'read-excel-file/node';
import { unzipSync, strFromU8 } from 'fflate';
import { toXlsx, XLSX_TYPE } from '../../src/export/xlsx';
import { SAMPLE } from './sample';

/** Spec 023 FR-008, FR-010 (research R2, R4, R5). */
const make = async () => {
  const blob = await toXlsx(SAMPLE);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { blob, bytes, sheets: await readExcelFile(Buffer.from(bytes)) };
};

describe('toXlsx', () => {
  it('is an XLSX blob with the table sheet first and About second', async () => {
    const { blob, sheets } = await make();
    expect(blob.type).toBe(XLSX_TYPE);
    expect(sheets.map((s) => s.sheet)).toEqual(['Attendees', 'About']);
  });

  it('writes the header row, then typed cells', async () => {
    const { sheets } = await make();
    const [head, first, second, third] = sheets[0].data;
    expect(head).toEqual([
      'Order placed',
      'Name on tickets',
      'Seat',
      'Ticket code',
      'Checked in',
      'Price',
      'Tickets',
    ]);
    // R4: the venue's wall-clock time in the date's UTC fields; spreadsheets have no zones.
    expect(first).toEqual([
      new Date(Date.UTC(2026, 8, 30, 10, 0)),
      'Jordan Lee',
      null,
      'ABCDEFGH2345',
      new Date(Date.UTC(2026, 10, 1, 16, 45)),
      84.3,
      1200,
    ]);
    // FR-010: a formula-looking name is read back as the text typed, not run.
    expect(second).toEqual([
      new Date(Date.UTC(2026, 9, 1, 20, 30)),
      '=SUM(1,1)',
      'Section A, Row 3, Seat 7',
      'STUVWXYZ2345',
      null,
      1045,
      0,
    ]);
    expect(third.slice(1, 4)).toEqual(['Zoë “Zo” O’Brien', 'Line one\nline two', '-12']);
    expect(third[5]).toBe(0);
  });

  it('puts the title, the subtitle lines, and the made-at time on About', async () => {
    const { sheets } = await make();
    expect(sheets[1].data.map((r) => r[0])).toEqual([
      'Attendees: Export Test, Café',
      'Made at Oct 30, 2026, 2:05 PM EDT',
      'Made by admin1',
      "Times are in Central Time (the venue's time zone).",
      'Exported at 2026-10-30T14:05:00-04:00',
    ]);
  });

  it('formats money and dates, freezes the header, and writes names as shared strings', async () => {
    const { bytes } = await make();
    const files = unzipSync(bytes);
    const styles = strFromU8(files['xl/styles.xml']);
    expect(styles).toContain('formatCode="&quot;$&quot;#,##0.00"');
    expect(styles).toContain('formatCode="yyyy-mm-dd hh:mm"');
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(sheet).toMatch(/<pane [^>]*ySplit="1"[^>]*state="frozen"/);
    expect(sheet).toMatch(/<c r="B3"[^>]* t="s"/);
    expect(sheet).not.toContain('<f>');
    // Each money cell carries the money format; each date cell the date format.
    const xfs = [...styles.matchAll(/<xf [^>]*?numFmtId="(\d+)"/g)].map((m) => m[1]);
    const styleOf = (ref: string) => sheet.match(new RegExp(`<c r="${ref}" s="(\\d+)"`))?.[1];
    const fmtOf = (ref: string) => {
      const s = Number(styleOf(ref));
      const xf = [...styles.matchAll(/<xf\b[^>]*>/g)][s]?.[0] ?? '';
      return styles.match(
        new RegExp(`numFmtId="${xf.match(/numFmtId="(\d+)"/)?.[1]}" formatCode="([^"]+)"`),
      )?.[1];
    };
    expect(xfs.length).toBeGreaterThan(0);
    expect(fmtOf('F2')).toBe('&quot;$&quot;#,##0.00');
    expect(fmtOf('A2')).toBe('yyyy-mm-dd hh:mm');
    expect(fmtOf('E2')).toBe('yyyy-mm-dd hh:mm');
  });
});
