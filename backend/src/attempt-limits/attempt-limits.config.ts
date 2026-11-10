import type { RateLimitedAction } from '@queuepass/shared';

/** How many attempts of one kind an account may have handled in any 60 seconds and any 5 seconds. */
export interface AttemptPair {
  perMinute: number;
  perFiveSeconds: number;
}

/**
 * Spec 026 FR-017 (research R5), spec 033 FR-008 (research R5): each kind's pair. Buying and
 * holding seats each have their own, since the Customer app holds a seat per click; the window
 * lengths are fixed. Read once at start-up; a wrong value stops the Backend, and no value turns the
 * limits off.
 */
export type AttemptLimits = Record<RateLimitedAction, AttemptPair>;

export const ATTEMPT_LIMITS = Symbol('ATTEMPT_LIMITS');

export const DEFAULT_ATTEMPT_LIMITS: AttemptLimits = {
  BUY: { perMinute: 10, perFiveSeconds: 3 },
  HOLD: { perMinute: 30, perFiveSeconds: 10 },
};

/** Each kind's two settings: the buy pair keeps `026`'s names, the hold pair has its own. */
const SETTINGS: Record<RateLimitedAction, { perMinute: string; perFiveSeconds: string }> = {
  BUY: { perMinute: 'RATE_LIMIT_PER_MINUTE', perFiveSeconds: 'RATE_LIMIT_PER_5_SECONDS' },
  HOLD: {
    perMinute: 'RATE_LIMIT_HOLD_PER_MINUTE',
    perFiveSeconds: 'RATE_LIMIT_HOLD_PER_5_SECONDS',
  },
};
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

/** One kind's pair, checked. */
function pairFromEnv(
  env: Record<string, string | undefined>,
  kind: RateLimitedAction,
): AttemptPair {
  const names = SETTINGS[kind];
  const defaults = DEFAULT_ATTEMPT_LIMITS[kind];
  const perMinute = setting(env, names.perMinute, defaults.perMinute);
  const perFiveSeconds = setting(env, names.perFiveSeconds, defaults.perFiveSeconds);
  // A 5-second allowance above the minute's could never be used, so it is a mistake.
  if (perFiveSeconds > perMinute) {
    throw new Error(
      `${names.perFiveSeconds} ('${env[names.perFiveSeconds] ?? perFiveSeconds}') must not be ` +
        `more than ${names.perMinute} ('${env[names.perMinute] ?? perMinute}')`,
    );
  }
  return { perMinute, perFiveSeconds };
}

/** Research R5: the four settings, checked, from the environment the Backend started with. */
export function attemptLimitsFromEnv(env: Record<string, string | undefined>): AttemptLimits {
  return { BUY: pairFromEnv(env, 'BUY'), HOLD: pairFromEnv(env, 'HOLD') };
}
