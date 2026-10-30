import regularUrl from './fonts/NotoSans-Regular.ttf?url';
import boldUrl from './fonts/NotoSans-Bold.ttf?url';
import { usd } from '../money';
import type { Cell, ExportTable } from './table';

export const PDF_TYPE = 'application/pdf';

/** FR-009: said in the heading when any character had to be shown as `?`. */
export const REPLACED_NOTE =
  'Some characters are shown as ?; the CSV and Excel files have the exact text.';

export interface Fonts {
  regular: Uint8Array;
  bold: Uint8Array;
}

/** The app's font source: the committed TTFs as Vite asset URLs, fetched only for a PDF. */
async function fetchFonts(): Promise<Fonts> {
  const get = async (url: string) => {
    const res = await fetch(url);
    const bytes = new Uint8Array(await res.arrayBuffer());
    // A missing asset can come back as the app's index.html with 200; a TrueType file starts
    // 00 01 00 00.
    if (!res.ok || bytes.length < 12 || new DataView(bytes.buffer).getUint32(0) !== 0x00010000) {
      throw new Error(`Font not loaded: ${url}`);
    }
    return bytes;
  };
  const [regular, bold] = await Promise.all([get(regularUrl), get(boldUrl)]);
  return { regular, bold };
}

// ------------------------------------------------------------------ the font's characters

/**
 * Research R10: every code point the font has a glyph for, read from its `cmap` table (formats 4
 * and 12, the two Noto Sans carries). Built once per font.
 */
export function fontGlyphs(ttf: Uint8Array): Set<number> {
  const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const u16 = (at: number) => view.getUint16(at);
  const u32 = (at: number) => view.getUint32(at);
  const glyphs = new Set<number>();

  let cmap = -1;
  for (let i = 0, n = u16(4); i < n; i++) {
    const record = 12 + i * 16;
    if (String.fromCharCode(...ttf.subarray(record, record + 4)) === 'cmap') cmap = u32(record + 8);
  }
  if (cmap < 0) return glyphs;

  for (let i = 0, n = u16(cmap + 2); i < n; i++) {
    const platform = u16(cmap + 4 + i * 8);
    const sub = cmap + u32(cmap + 4 + i * 8 + 4);
    if (platform !== 0 && platform !== 3) continue; // Unicode and Windows only
    const format = u16(sub);
    if (format === 4) {
      const segments = u16(sub + 6) / 2;
      const ends = sub + 14;
      const starts = ends + segments * 2 + 2;
      const deltas = starts + segments * 2;
      const rangeOffsets = deltas + segments * 2;
      for (let s = 0; s < segments; s++) {
        const start = u16(starts + s * 2);
        const end = u16(ends + s * 2);
        const delta = u16(deltas + s * 2);
        const rangeOffset = u16(rangeOffsets + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let glyph: number;
          if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
          else {
            const g = u16(rangeOffsets + s * 2 + rangeOffset + (c - start) * 2);
            glyph = g === 0 ? 0 : (g + delta) & 0xffff;
          }
          if (glyph !== 0) glyphs.add(c);
        }
      }
    } else if (format === 12) {
      for (let g = 0, groups = u32(sub + 12); g < groups; g++) {
        const group = sub + 16 + g * 12;
        const startGlyph = u32(group + 8);
        for (let c = u32(group); c <= u32(group + 4); c++) {
          if (startGlyph + (c - u32(group)) !== 0) glyphs.add(c);
        }
      }
    }
  }
  return glyphs;
}

/**
 * FR-009 (research R10): the text as the PDF can show it. Composed first (a decomposed "ë" is
 * one character in the font); any character the font lacks becomes `?`. Line breaks stay.
 */
export function pdfText(
  s: string,
  glyphs: ReadonlySet<number>,
): { text: string; replaced: boolean } {
  let replaced = false;
  let text = '';
  for (const ch of s.normalize('NFC')) {
    const cp = ch.codePointAt(0) as number;
    if (ch === '\n' || glyphs.has(cp)) text += ch;
    else {
      text += '?';
      replaced = true;
    }
  }
  return { text, replaced };
}

// ------------------------------------------------------------------ the layout (pure)

export interface PdfLayout {
  heading: string[];
  head: string[];
  body: string[][];
  /** Per column: sized to its content and never wrapped (codes, dates, numbers). */
  nowrap: boolean[];
}

/** As the page shows it: `2026-10-01 19:00`, `$1,045.00`, `1,200`. */
function shown(cell: Cell): string {
  switch (cell.kind) {
    case 'text':
      return cell.value;
    case 'dateTime':
      return cell.value.replace('T', ' ');
    case 'money':
      return usd(cell.value);
    case 'count':
      return cell.value.toLocaleString('en-US');
  }
}

/** Research R10: every string the PDF draws, decided without drawing (the tests' model). */
export function pdfLayout(table: ExportTable, glyphs: ReadonlySet<number>): PdfLayout {
  let replaced = false;
  const fit = (s: string) => {
    const r = pdfText(s, glyphs);
    replaced ||= r.replaced;
    return r.text;
  };
  const heading = [table.title, ...table.subtitle].map(fit);
  const head = table.columns.map((c) => fit(c.header));
  const body = table.rows.map((row) => row.map((cell) => fit(shown(cell))));
  if (replaced) heading.push(REPLACED_NOTE);
  return {
    heading,
    head,
    body,
    nowrap: table.columns.map((c) => c.nowrap ?? c.kind !== 'text'),
  };
}

// ------------------------------------------------------------------ drawing

const MARGIN = 36; // half an inch
/**
 * A text column never gets narrower than this many points per character of its Excel width, so
 * one very long word elsewhere cannot squeeze short words ("customer3", "Confirmed") into pieces.
 */
const MIN_PT_PER_CHAR = 3.6;
const BODY_PT = 9; // FR-009: never below 9 points
const ACCENT: [number, number, number] = [79, 70, 229]; // the theme's --accent, as text
const INK: [number, number, number] = [17, 24, 39];
const RULE: [number, number, number] = [209, 213, 219];

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

let glyphCache: { fonts: Fonts; glyphs: Set<number> } | undefined;

/**
 * Spec 023 FR-009 (research R10): letter landscape, Noto Sans embedded, a heading (report, event,
 * made at, made by), the table with its header on every page and long text wrapped within its
 * column, and "Page n of m" on each page. The libraries and fonts load on first use only.
 */
export async function toPdf(
  table: ExportTable,
  loadFonts: () => Promise<Fonts> = fetchFonts,
): Promise<Blob> {
  const [{ jsPDF }, { autoTable }, fonts] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    glyphCache ? Promise.resolve(glyphCache.fonts) : loadFonts(),
  ]);
  if (!glyphCache) glyphCache = { fonts, glyphs: fontGlyphs(fonts.regular) };
  const layout = pdfLayout(table, glyphCache.glyphs);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter', compress: true });
  doc.addFileToVFS('NotoSans-Regular.ttf', base64(fonts.regular));
  doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
  doc.addFileToVFS('NotoSans-Bold.ttf', base64(fonts.bold));
  doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');
  doc.setProperties({ title: layout.heading[0], creator: 'QueuePass' });

  const width = doc.internal.pageSize.getWidth() - MARGIN * 2;
  const height = doc.internal.pageSize.getHeight();
  let y = MARGIN;
  doc.setTextColor(...INK);
  layout.heading.forEach((line, i) => {
    doc.setFont('NotoSans', i === 0 ? 'bold' : 'normal');
    doc.setFontSize(i === 0 ? 16 : 10);
    const lines = doc.splitTextToSize(line, width) as string[];
    doc.text(lines, MARGIN, y, { baseline: 'top' });
    y += lines.length * (i === 0 ? 20 : 13);
  });

  const right = new Set(
    table.columns.flatMap((c, i) => (c.kind === 'money' || c.kind === 'count' ? [i] : [])),
  );
  autoTable(doc, {
    head: [layout.head],
    body: layout.body,
    startY: y + 8,
    margin: { top: MARGIN, right: MARGIN, bottom: MARGIN + 18, left: MARGIN },
    theme: 'plain',
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    styles: {
      font: 'NotoSans',
      fontSize: BODY_PT,
      overflow: 'linebreak',
      cellPadding: 3,
      textColor: INK,
      lineColor: RULE,
      lineWidth: { bottom: 0.5 },
    },
    headStyles: {
      fontStyle: 'bold',
      textColor: ACCENT,
      lineColor: ACCENT,
      lineWidth: { bottom: 1 },
    },
    // A number column's header sits over its numbers, on the right.
    didParseCell: (data) => {
      if (data.section === 'head' && right.has(data.column.index))
        data.cell.styles.halign = 'right';
    },
    columnStyles: Object.fromEntries(
      table.columns.map((_, i) => [
        i,
        {
          ...(layout.nowrap[i]
            ? { cellWidth: 'wrap' as const }
            : { minCellWidth: table.columns[i].width * MIN_PT_PER_CHAR }),
          ...(right.has(i) ? { halign: 'right' as const } : {}),
        },
      ]),
    ),
  });

  const pages = doc.getNumberOfPages();
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(BODY_PT);
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.text(`Page ${p} of ${pages}`, MARGIN + width, height - MARGIN, { align: 'right' });
  }
  return new Blob([doc.output('arraybuffer')], { type: PDF_TYPE });
}
