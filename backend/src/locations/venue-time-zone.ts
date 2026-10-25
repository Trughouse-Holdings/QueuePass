import { HttpException, HttpStatus } from '@nestjs/common';
import {
  DEFAULT_TIME_ZONE,
  STATE_TIME_ZONES,
  US_STATES,
  zoneName,
  type TimeZoneSource,
  type UsState,
  type UsTimeZone,
} from '@queuepass/shared';
import type { Place } from '../address/address-geocoder';

/** A venue's zone and how it was set (data-model.md). */
export interface ZoneDecision {
  timeZone: UsTimeZone;
  timeZoneSource: TimeZoneSource;
}

/** The address decided in this request: its state, and the matched place when verified. */
export interface DecidedAddress {
  state: string;
  /** The verified match's place; null when saved anyway, or the match had none (R1). */
  location: Place | null;
}

export interface ZoneQuestion {
  /** `timeZone` sent by the admin (R4). */
  sent?: UsTimeZone;
  /** Undefined when the address is not decided in this request (no change, R7). */
  address?: DecidedAddress;
  /** Demo data only: DEFAULT instead of TIME_ZONE_REQUIRED (R19). */
  fallbackToDefault?: boolean;
}

const stateName = (code: string): string => US_STATES.find((s) => s.code === code)?.name ?? code;

/** `Eastern Time or Central Time`. */
const either = (zones: readonly UsTimeZone[]): string =>
  zones.length <= 2
    ? zones.map(zoneName).join(' or ')
    : `${zones.slice(0, -1).map(zoneName).join(', ')}, or ${zoneName(zones[zones.length - 1])}`;

/** Spec 020 FR-003, research R3: a split state's address saved anyway needs the admin's choice. */
export function timeZoneRequired(state: string, zones: readonly UsTimeZone[]): HttpException {
  return new HttpException(
    {
      error: {
        code: 'TIME_ZONE_REQUIRED',
        message:
          `${stateName(state)} has more than one time zone. Choose this venue's time zone: ` +
          `${either(zones)}.`,
        details: { state, timeZones: [...zones] },
      },
    },
    HttpStatus.BAD_REQUEST,
  );
}

/**
 * Spec 020 research R7 (with R3, R4): the zone decided by this request, or null when it does not
 * touch the zone. In order: a sent zone (ADMIN); a verified match's place with a zone on the list
 * (ADDRESS); the state when it has one zone (STATE); else TIME_ZONE_REQUIRED, or DEFAULT for demo
 * data. Pure, apart from `zoneAt`.
 */
export function decideZone(
  question: ZoneQuestion,
  zoneAt: (latitude: number, longitude: number) => UsTimeZone | null,
): ZoneDecision | null {
  if (question.sent) return { timeZone: question.sent, timeZoneSource: 'ADMIN' };
  const address = question.address;
  if (!address) return null;
  if (address.location) {
    const zone = zoneAt(address.location.latitude, address.location.longitude);
    if (zone) return { timeZone: zone, timeZoneSource: 'ADDRESS' };
  }
  const zones = STATE_TIME_ZONES[address.state as UsState] ?? [];
  if (zones.length === 1) return { timeZone: zones[0], timeZoneSource: 'STATE' };
  if (question.fallbackToDefault) return { timeZone: DEFAULT_TIME_ZONE, timeZoneSource: 'DEFAULT' };
  throw timeZoneRequired(address.state, zones);
}
