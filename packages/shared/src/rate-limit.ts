/**
 * Spec 026 FR-008 (research R4): the two kinds of attempt each customer account has an allowance
 * for, as `details.action` of a `429 RATE_LIMITED` names them.
 */
export type RateLimitedAction = 'BUY' | 'HOLD';

/**
 * Spec 026 FR-008 (research R4): the one message for a refusal for the limit, used by the
 * Backend's `429` and by the Customer app's countdown, so they always say the same words.
 * "1 second" in the singular.
 */
export function rateLimitMessage(seconds: number): string {
  return `Too many tries. You can try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`;
}
