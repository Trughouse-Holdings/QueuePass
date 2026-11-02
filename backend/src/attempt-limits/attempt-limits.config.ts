/**
 * Spec 026 FR-017 (research R5): how many attempts of one kind an account may have handled in any
 * 60 seconds and in any 5 seconds. One pair for buying and holding alike; the window lengths are
 * fixed. Read once at start-up; a wrong value stops the Backend, and no value turns the limits off.
 */
export interface AttemptLimits {
  perMinute: number;
  perFiveSeconds: number;
}

export const ATTEMPT_LIMITS = Symbol('ATTEMPT_LIMITS');

export const DEFAULT_ATTEMPT_LIMITS: AttemptLimits = { perMinute: 10, perFiveSeconds: 3 };

const PER_MINUTE = 'RATE_LIMIT_PER_MINUTE';
const PER_FIVE_SECONDS = 'RATE_LIMIT_PER_5_SECONDS';
const WHOLE = /^[1-9][0-9]*$/;

/** A setting's value, or its default when unset; anything but a whole number of at least 1 throws. */
function setting(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!WHOLE.test(raw) || !Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a whole number of at least 1, got '${raw}'`);
  }
  return value;
}

/** Research R5: the two settings, checked, from the environment the Backend started with. */
export function attemptLimitsFromEnv(env: Record<string, string | undefined>): AttemptLimits {
  const perMinute = setting(env, PER_MINUTE, DEFAULT_ATTEMPT_LIMITS.perMinute);
  const perFiveSeconds = setting(env, PER_FIVE_SECONDS, DEFAULT_ATTEMPT_LIMITS.perFiveSeconds);
  // A 5-second allowance above the minute's could never be used, so it is a mistake.
  if (perFiveSeconds > perMinute) {
    throw new Error(
      `${PER_FIVE_SECONDS} ('${env[PER_FIVE_SECONDS] ?? perFiveSeconds}') must not be more than ` +
        `${PER_MINUTE} ('${env[PER_MINUTE] ?? perMinute}')`,
    );
  }
  return { perMinute, perFiveSeconds };
}
