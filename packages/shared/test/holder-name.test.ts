import { describe, it, expect } from 'vitest';
import {
  HOLDER_NAME_MAX,
  holderNameMessage,
  holderNameProblem,
  normalizeHolderName,
} from '../src/holder-name';

/** Spec 017 FR-003 (research R2): the one definition of a valid holder's name. */
describe('holderNameProblem', () => {
  it.each([undefined, null, '', '   ', '  \t '])('%j is MISSING', (raw) => {
    expect(holderNameProblem(raw)).toBe('MISSING');
  });

  it('refuses 101 code points as TOO_LONG and accepts exactly 100', () => {
    expect(HOLDER_NAME_MAX).toBe(100);
    expect(holderNameProblem('a'.repeat(101))).toBe('TOO_LONG');
    expect(holderNameProblem('a'.repeat(100))).toBeNull();
    // Emoji: one code point each, two UTF-16 units each (research R2: count code points, the
    // same unit as PostgreSQL's char_length, never UTF-16 units). 100 code points here are 199
    // UTF-16 units, so a UTF-16 count would wrongly refuse this valid name.
    expect(holderNameProblem(`a${'😀'.repeat(99)}`)).toBeNull();
    expect(holderNameProblem(`a${'😀'.repeat(100)}`)).toBe('TOO_LONG');
  });

  it.each(['Jordan\tLee', 'Jordan\nLee', 'Jordan\u0000Lee'])(
    '%j is CONTROL_CHARACTER',
    (raw) => {
      expect(holderNameProblem(raw)).toBe('CONTROL_CHARACTER');
    },
  );

  it.each(['1234', '---'])('%j is NO_LETTER', (raw) => {
    expect(holderNameProblem(raw)).toBe('NO_LETTER');
  });

  it.each(['Jordan Lee', 'José Núñez', '李小龙', "O'Brien", 'Ana  María'])(
    '%j is a valid name (inner spaces kept as typed)',
    (raw) => {
      expect(holderNameProblem(raw)).toBeNull();
    },
  );

  it('checks in the order MISSING, TOO_LONG, CONTROL_CHARACTER, NO_LETTER', () => {
    // Only spaces, however many: MISSING, not TOO_LONG.
    expect(holderNameProblem(' '.repeat(200))).toBe('MISSING');
    // 101 code points with a tab: TOO_LONG before CONTROL_CHARACTER.
    expect(holderNameProblem(`\t${'a'.repeat(101)}`)).toBe('TOO_LONG');
    // A tab and no letter: CONTROL_CHARACTER before NO_LETTER.
    expect(holderNameProblem('12\t34')).toBe('CONTROL_CHARACTER');
  });
});

describe('normalizeHolderName', () => {
  it('trims leading and trailing spaces and keeps inner runs', () => {
    expect(normalizeHolderName('  Jordan Lee ')).toBe('Jordan Lee');
    expect(normalizeHolderName('Ana  María')).toBe('Ana  María');
  });

  it('normalizes to NFC, so e + combining acute becomes é', () => {
    expect(normalizeHolderName('é')).toBe('é');
  });
});

describe('holderNameMessage', () => {
  it('has one message per problem', () => {
    expect(holderNameMessage('MISSING')).toBe('Enter the name on your photo ID.');
    expect(holderNameMessage('TOO_LONG')).toBe('The name can be at most 100 characters.');
    expect(holderNameMessage('CONTROL_CHARACTER')).toBe(
      "The name can't contain tabs or line breaks.",
    );
    expect(holderNameMessage('NO_LETTER')).toBe(
      'The name on the tickets must contain at least one letter.',
    );
  });
});
