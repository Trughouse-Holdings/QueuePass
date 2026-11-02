import { describe, it, expect } from 'vitest';
import { rateLimitMessage } from '../src/rate-limit';
import * as shared from '../src/index';

/**
 * Spec 026 FR-008 (research R4): the one message for a refusal for the limit, said the same by the
 * Backend's 429 and the Customer app's countdown.
 */
describe('rateLimitMessage', () => {
  it('says "1 second" in the singular', () => {
    expect(rateLimitMessage(1)).toBe('Too many tries. You can try again in 1 second.');
  });

  it('says "N seconds" in the plural', () => {
    expect(rateLimitMessage(3)).toBe('Too many tries. You can try again in 3 seconds.');
    expect(rateLimitMessage(60)).toBe('Too many tries. You can try again in 60 seconds.');
  });

  it('is exported from the package', () => {
    expect(shared.rateLimitMessage).toBe(rateLimitMessage);
  });
});
