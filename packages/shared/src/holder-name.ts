/**
 * Spec 017 FR-003 (research R2): the one definition of a valid holder's name, used by the
 * Backend's refusal (400 HOLDER_NAME_INVALID) and the Customer app's preview, so the form and
 * the server never disagree. The stored form is the trimmed, NFC-normalized one.
 */

export const HOLDER_NAME_MAX = 100;

export type HolderNameProblem = 'MISSING' | 'TOO_LONG' | 'CONTROL_CHARACTER' | 'NO_LETTER';

/** Trims leading and trailing white space and normalizes to NFC: the form the Backend stores. */
export function normalizeHolderName(raw: string): string {
  return raw.trim().normalize('NFC');
}

/**
 * Why a name is invalid, or `null` for a valid one. Checks in a fixed order: MISSING, TOO_LONG,
 * CONTROL_CHARACTER, NO_LETTER. Length is counted in Unicode code points (`[...name].length`),
 * the same unit as PostgreSQL's `char_length`, so the CHECK constraint and this rule agree on
 * emoji and on every script.
 */
export function holderNameProblem(raw: unknown): HolderNameProblem | null {
  if (typeof raw !== 'string') return 'MISSING';
  const name = normalizeHolderName(raw);
  if (name.length === 0) return 'MISSING';
  if ([...name].length > HOLDER_NAME_MAX) return 'TOO_LONG';
  if (/\p{Cc}/u.test(name)) return 'CONTROL_CHARACTER';
  if (!/\p{L}/u.test(name)) return 'NO_LETTER';
  return null;
}

/** The message the form shows and the Backend's 400 carries, one per problem. */
export function holderNameMessage(p: HolderNameProblem): string {
  switch (p) {
    case 'MISSING':
      return 'Enter the name on your photo ID.';
    case 'TOO_LONG':
      return `The name can be at most ${HOLDER_NAME_MAX} characters.`;
    case 'CONTROL_CHARACTER':
      return "The name can't contain tabs or line breaks.";
    case 'NO_LETTER':
      return 'The name on the tickets must contain at least one letter.';
  }
}
