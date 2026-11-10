import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CheckInRetention, retentionBound } from '../../src/entry/check-in-retention';

/**
 * Spec 032 FR-006, SC-007 (research R5, R11; review rounds 1 M1, 2 S2): the job runs only when
 * `main.ts`, the Backend that serves the API, starts it; never from a lifecycle hook, which the
 * demo data and demo reset commands' application context would also run. And the bound is exact
 * hours, whatever daylight saving does in the week (review rounds 1 S3, 2 S1).
 */
describe('CheckInRetention start-up', () => {
  it('has no onModuleInit and no onApplicationBootstrap', () => {
    const proto = CheckInRetention.prototype as unknown as Record<string, unknown>;
    expect(proto.onModuleInit).toBeUndefined();
    expect(proto.onApplicationBootstrap).toBeUndefined();
  });

  it('is started by main.ts', () => {
    const main = readFileSync(path.resolve(__dirname, '../../src/main.ts'), 'utf8');
    expect(main).toMatch(/app\.get\(CheckInRetention\)\.start\(\)/);
  });
});

describe('retentionBound', () => {
  it('is now − 604 800 000 ms across the 2026-11-01 fall-back', () => {
    const now = new Date('2026-11-07T23:00:00Z');
    expect(retentionBound(now)).toEqual(new Date('2026-10-31T23:00:00Z'));
    expect(now.getTime() - retentionBound(now).getTime()).toBe(604_800_000);
  });

  it('is now − 604 800 000 ms across the 2027-03-14 spring-forward', () => {
    const now = new Date('2027-03-17T12:00:00Z');
    expect(retentionBound(now)).toEqual(new Date('2027-03-10T12:00:00Z'));
    expect(now.getTime() - retentionBound(now).getTime()).toBe(604_800_000);
  });
});
