import { US_STATES } from '@queuepass/shared';

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
