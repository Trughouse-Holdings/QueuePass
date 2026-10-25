import { US_STATES, US_TIME_ZONES } from '@queuepass/shared';

/** Trims strings, so "   " fails a length check rather than passing as length 3 (FR-012). */
export const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Spec 013 FR-001: the 50 states and DC, by code. */
export const STATE_CODES: string[] = US_STATES.map((s) => s.code);

export const MESSAGES = {
  street: 'street must be between 1 and 200 characters',
  city: 'city must be between 1 and 100 characters',
  state: 'state must be the two-letter code of a US state or DC',
  zip: 'zip must be 5 digits, or 5 digits, a hyphen, and 4 digits',
  acceptUnverifiedAddress: 'acceptUnverifiedAddress must be true or false',
} as const;

/** Spec 020 FR-001, research R2, R4: the admin's explicit zone, one of the eight. */
export const TIME_ZONE_IDS: string[] = US_TIME_ZONES.map((z) => z.id);
export const TIME_ZONE_MESSAGE = `timeZone must be one of the US time zones: ${TIME_ZONE_IDS.join(', ')}`;
