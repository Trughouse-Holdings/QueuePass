import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import readExcelFile from 'read-excel-file/node';
import { toXlsx } from '../../src/export/xlsx';
import { SAMPLE } from './sample';

/**
 * Spec 023 research R4 (review round 1, finding 3): an Excel date cell holds the venue's
 * wall-clock time whatever the device zone. Named *.tz.test.tsx so the zone re-run runs it, and
 * it sets a zone with a half-hour offset itself, so a run in UTC also catches a cell built from
 * the device's local time.
 */
const before = process.env.TZ;
beforeAll(() => {
  process.env.TZ =
    process.env.QP_TEST_TZ && process.env.QP_TEST_TZ !== 'UTC'
      ? process.env.QP_TEST_TZ
      : 'Asia/Kolkata';
});
afterAll(() => {
  process.env.TZ = before;
});

describe('Excel date cells in any device zone', () => {
  it('keep the venue wall-clock time', async () => {
    expect(new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset()).not.toBe(0);
    const blob = await toXlsx(SAMPLE);
    const [sheet] = await readExcelFile(Buffer.from(await blob.arrayBuffer()));
    expect(sheet.data[1][0]).toEqual(new Date(Date.UTC(2026, 8, 30, 10, 0)));
    expect(sheet.data[1][4]).toEqual(new Date(Date.UTC(2026, 10, 1, 16, 45)));
  });
});
