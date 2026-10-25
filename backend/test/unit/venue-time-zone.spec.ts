import { HttpException } from '@nestjs/common';
import type { UsTimeZone } from '@queuepass/shared';
import { decideZone } from '../../src/locations/venue-time-zone';

/**
 * Spec 020 research R7 (with R3, R4, R19): which zone a venue save decides, row by row. Pure:
 * the finder is a stub that answers by latitude.
 */
const LEXINGTON = { latitude: 38.0494, longitude: -84.501 };
const PHOENIX = { latitude: 33.4465, longitude: -112.0706 };
const ATLANTIC = { latitude: 30, longitude: -70 };

const finder = jest.fn((latitude: number): UsTimeZone | null => {
  if (latitude === LEXINGTON.latitude) return 'America/New_York';
  if (latitude === PHOENIX.latitude) return 'America/Phoenix';
  return null;
});

beforeEach(() => finder.mockClear());

function refusal(fn: () => unknown): { status: number; body: unknown } {
  try {
    fn();
  } catch (err) {
    if (err instanceof HttpException) return { status: err.getStatus(), body: err.getResponse() };
    throw err;
  }
  throw new Error('no refusal');
}

describe('decideZone (R7)', () => {
  it('a sent zone wins over everything, as ADMIN, without asking the finder', () => {
    expect(
      decideZone(
        { sent: 'America/Chicago', address: { state: 'KY', location: LEXINGTON } },
        finder,
      ),
    ).toEqual({ timeZone: 'America/Chicago', timeZoneSource: 'ADMIN' });
    expect(finder).not.toHaveBeenCalled();
  });

  it('a verified match with a zone on the list gives it, as ADDRESS', () => {
    expect(decideZone({ address: { state: 'AZ', location: PHOENIX } }, finder)).toEqual({
      timeZone: 'America/Phoenix',
      timeZoneSource: 'ADDRESS',
    });
    expect(finder).toHaveBeenCalledWith(PHOENIX.latitude, PHOENIX.longitude);
  });

  it('a match without a place falls back to a one-zone state, as STATE', () => {
    expect(decideZone({ address: { state: 'OH', location: null } }, finder)).toEqual({
      timeZone: 'America/New_York',
      timeZoneSource: 'STATE',
    });
    expect(finder).not.toHaveBeenCalled();
  });

  it('a place the finder has no zone for falls back to the state', () => {
    expect(decideZone({ address: { state: 'OH', location: ATLANTIC } }, finder)).toEqual({
      timeZone: 'America/New_York',
      timeZoneSource: 'STATE',
    });
  });

  it('save anyway in a one-zone state: its zone, STATE', () => {
    expect(decideZone({ address: { state: 'HI', location: null } }, finder)).toEqual({
      timeZone: 'Pacific/Honolulu',
      timeZoneSource: 'STATE',
    });
  });

  it('save anyway in a split state: 400 TIME_ZONE_REQUIRED with its zones', () => {
    expect(refusal(() => decideZone({ address: { state: 'KY', location: null } }, finder))).toEqual(
      {
        status: 400,
        body: {
          error: {
            code: 'TIME_ZONE_REQUIRED',
            message:
              "Kentucky has more than one time zone. Choose this venue's time zone: Eastern Time " +
              'or Central Time.',
            details: { state: 'KY', timeZones: ['America/New_York', 'America/Chicago'] },
          },
        },
      },
    );
  });

  it('in a split state the finder still decides when it can', () => {
    expect(decideZone({ address: { state: 'KY', location: LEXINGTON } }, finder)).toEqual({
      timeZone: 'America/New_York',
      timeZoneSource: 'ADDRESS',
    });
  });

  it('demo data falls back to the default instead of asking (R19)', () => {
    expect(
      decideZone({ address: { state: 'KY', location: null }, fallbackToDefault: true }, finder),
    ).toEqual({ timeZone: 'America/New_York', timeZoneSource: 'DEFAULT' });
    // A one-zone state still gets its zone.
    expect(
      decideZone({ address: { state: 'CO', location: null }, fallbackToDefault: true }, finder),
    ).toEqual({ timeZone: 'America/Denver', timeZoneSource: 'STATE' });
  });

  describe('updates', () => {
    it('no address change (or the same address) and no zone: the zone is not touched', () => {
      expect(decideZone({}, finder)).toBeNull();
      expect(finder).not.toHaveBeenCalled();
    });

    it('a changed address decides as on create', () => {
      expect(decideZone({ address: { state: 'AZ', location: PHOENIX } }, finder)).toEqual({
        timeZone: 'America/Phoenix',
        timeZoneSource: 'ADDRESS',
      });
    });

    it('a zone alone: ADMIN', () => {
      expect(decideZone({ sent: 'America/Denver' }, finder)).toEqual({
        timeZone: 'America/Denver',
        timeZoneSource: 'ADMIN',
      });
    });
  });
});
