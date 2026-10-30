import { describe, it, expect } from 'vitest';
import { fontGlyphs, pdfLayout, pdfText, toPdf, REPLACED_NOTE } from '../../src/export/pdf';
import { REGULAR, loadFontsFromDisk } from './fonts';
import { SAMPLE, sampleOf } from './sample';

/** Spec 023 FR-009 (research R10). */
const GLYPHS = fontGlyphs(REGULAR);
const latin1 = async (b: Blob) =>
  new TextDecoder('latin1').decode(new Uint8Array(await b.arrayBuffer()));
const pages = (raw: string) => (raw.match(/\/Type \/Page\b(?!s)/g) ?? []).length;

describe('pdfText', () => {
  it('keeps Latin, Greek, Cyrillic, and common punctuation as typed', () => {
    expect(pdfText('Zoë – Łukasz O’Brien Ελένη Пётр “quoted”…', GLYPHS)).toEqual({
      text: 'Zoë – Łukasz O’Brien Ελένη Пётр “quoted”…',
      replaced: false,
    });
  });

  it('turns a character outside the font into ? and says so', () => {
    expect(pdfText('山田 Zoë 😀', GLYPHS)).toEqual({ text: '?? Zoë ?', replaced: true });
  });

  it('composes a decomposed letter before checking it', () => {
    expect(pdfText('Zoë', GLYPHS)).toEqual({ text: 'Zoë', replaced: false });
  });
});

describe('pdfLayout', () => {
  it('is the heading, the head, and the body strings, as the page shows them', () => {
    expect(pdfLayout(SAMPLE, GLYPHS)).toEqual({
      heading: [
        'Attendees: Export Test, Café',
        'Made at Oct 30, 2026, 2:05 PM EDT',
        'Made by admin1',
        "Times are in Central Time (the venue's time zone).",
      ],
      head: [
        'Order placed',
        'Name on tickets',
        'Seat',
        'Ticket code',
        'Checked in',
        'Price',
        'Tickets',
      ],
      body: [
        [
          '2026-09-30 10:00',
          'Jordan Lee',
          '',
          'ABCDEFGH2345',
          '2026-11-01 16:45',
          '$84.30',
          '1,200',
        ],
        [
          '2026-10-01 20:30',
          '=SUM(1,1)',
          'Section A, Row 3, Seat 7',
          'STUVWXYZ2345',
          '',
          '$1,045.00',
          '0',
        ],
        ['2026-10-03 07:00', 'Zoë “Zo” O’Brien', 'Line one\nline two', '-12', '', '$0.00', '-1'],
      ],
      // Codes, dates, and numbers are sized to their content; text wraps.
      nowrap: [true, false, false, true, true, true, true],
    });
  });

  it('adds the note to the heading when a character was replaced', () => {
    const table = {
      ...SAMPLE,
      rows: [[{ kind: 'text' as const, value: '山' }, ...SAMPLE.rows[0].slice(1)]],
    };
    const layout = pdfLayout(table, GLYPHS);
    expect(layout.body[0][0]).toBe('?');
    expect(layout.heading.at(-1)).toBe(REPLACED_NOTE);
    expect(REPLACED_NOTE).toBe(
      'Some characters are shown as ?; the CSV and Excel files have the exact text.',
    );
  });
});

describe('toPdf', () => {
  it('is a letter-landscape PDF with Noto Sans embedded, one page for 10 rows', async () => {
    const blob = await toPdf(sampleOf(10), loadFontsFromDisk);
    expect(blob.type).toBe('application/pdf');
    const raw = await latin1(blob);
    expect(raw.startsWith('%PDF-')).toBe(true);
    // jsPDF 4.2.1 writes the box as "[0 0 792. 612.]"; compare the numbers.
    const box = raw
      .match(/\/MediaBox \[([^\]]*)\]/)?.[1]
      .trim()
      .split(/\s+/)
      .map(Number);
    expect(box).toEqual([0, 0, 792, 612]);
    expect(raw).toMatch(/\/BaseFont \/NotoSans/);
    expect(raw).toMatch(/\/FontFile2 /);
    expect(pages(raw)).toBe(1);
  });

  it('breaks 200 rows across pages', async () => {
    const raw = await latin1(await toPdf(sampleOf(200), loadFontsFromDisk));
    expect(pages(raw)).toBeGreaterThanOrEqual(2);
  });
});
