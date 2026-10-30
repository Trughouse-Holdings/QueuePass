import { describe, it, expect } from 'vitest';
import { toCsv } from '../../src/export/csv';
import type { ExportTable } from '../../src/export/table';
import { SAMPLE } from './sample';

/** Spec 023 FR-007, FR-010 (research R6, R9). */
const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const textOf = async (b: Blob) =>
  new TextDecoder('utf-8', { ignoreBOM: true }).decode(await bytes(b));

const MADE = '2026-10-30T14:05:00-04:00';

describe('toCsv', () => {
  it('is UTF-8 with a byte-order mark, typed as CSV', async () => {
    const blob = toCsv(SAMPLE);
    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect([...(await bytes(blob)).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('writes exactly the header, the rows, and Exported at, with CRLF line ends', async () => {
    expect(await textOf(toCsv(SAMPLE))).toBe(
      '﻿' +
        [
          'Order placed,Name on tickets,Seat,Ticket code,Checked in,Price,Tickets,Exported at',
          `2026-09-30 10:00,Jordan Lee,,ABCDEFGH2345,2026-11-01 16:45,84.30,1200,${MADE}`,
          `2026-10-01 20:30,"'=SUM(1,1)","Section A, Row 3, Seat 7",STUVWXYZ2345,,1045.00,0,${MADE}`,
          `2026-10-03 07:00,Zoë “Zo” O’Brien,"Line one\nline two",'-12,,0.00,-1,${MADE}`,
        ].join('\r\n') +
        '\r\n',
    );
  });

  it('doubles quotes and quotes fields with a comma, quote, CR, or LF (RFC 4180)', async () => {
    const table: ExportTable = {
      ...SAMPLE,
      columns: [{ header: 'Say "hi", all', kind: 'text', width: 10 }],
      rows: [
        [{ kind: 'text', value: 'He said "no"' }],
        [{ kind: 'text', value: 'a\rb' }],
        [{ kind: 'text', value: 'plain' }],
      ],
    };
    const lines = (await textOf(toCsv(table))).slice(1).split('\r\n');
    expect(lines).toEqual([
      `"Say ""hi"", all",Exported at`,
      `"He said ""no""",${MADE}`,
      `"a\rb",${MADE}`,
      `plain,${MADE}`,
      '',
    ]);
  });

  it.each(['=', '+', '-', '@', '\t', '\r'])(
    'guards a text cell starting with %j with a leading apostrophe (FR-010)',
    async (first) => {
      const table: ExportTable = {
        ...SAMPLE,
        columns: [{ header: 'Name', kind: 'text', width: 10 }],
        rows: [[{ kind: 'text', value: `${first}x` }]],
      };
      const row = (await textOf(toCsv(table))).split('\r\n')[1];
      const field = first === '\r' ? `"'\rx"` : `'${first}x`;
      expect((await textOf(toCsv(table))).slice(1)).toContain(`\r\n${field},${MADE}\r\n`);
      expect(row.startsWith(first === '\r' ? `"'` : `'`)).toBe(true);
    },
  );

  it('never guards money, count, or date cells', async () => {
    const table: ExportTable = {
      ...SAMPLE,
      columns: [
        { header: 'Price', kind: 'money', width: 10 },
        { header: 'Count', kind: 'count', width: 10 },
        { header: 'When', kind: 'dateTime', width: 10 },
      ],
      rows: [
        [
          { kind: 'money', value: '-5.00' },
          { kind: 'count', value: -3 },
          { kind: 'dateTime', value: '2026-01-02T03:04' },
        ],
      ],
    };
    expect((await textOf(toCsv(table))).split('\r\n')[1]).toBe(`-5.00,-3,2026-01-02 03:04,${MADE}`);
  });
});
