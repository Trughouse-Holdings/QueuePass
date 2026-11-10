import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { RateLimitedAction } from '@queuepass/shared';
import { ATTEMPT_CLOCK, type AttemptClock } from './attempt-limits.clock';
import { ATTEMPT_LIMITS, type AttemptLimits } from './attempt-limits.config';

/** The outcome of one attempt: let through, or refused with the whole seconds to wait (1 to 60). */
export type AttemptResult = { ok: true } | { ok: false; retryAfterSeconds: number };

const MINUTE_MS = 60_000;
const FIVE_SECONDS_MS = 5_000;

/**
 * Spec 026 (FR-001 to FR-003, FR-008, FR-010, FR-015, FR-019; research R2, R3, R8): each customer
 * account's buy and seat-hold allowances, as rolling windows over the attempts let through; each
 * kind with its own numbers (spec 033 FR-008, research R5).
 *
 * The counts live in this one Backend's memory and a restart forgets them: a deviation from
 * Constitution IV that Mahdi accepted on 2026-11-02 (plan.md, Complexity Tracking). Deciding
 * touches no stored data, so a flood of refused attempts costs QueuePass almost nothing (FR-015).
 * `tryAttempt` is synchronous, with no `await`, so on Node's one thread no other request can run
 * between the check and the record (FR-010).
 */
@Injectable()
export class AttemptLimitsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttemptLimitsService.name);
  /** Per `${sub}:${kind}`: the times of the attempts let through in the last minute, oldest first. */
  private readonly attempts = new Map<string, number[]>();
  /** Per key: the end of the wait already logged, so one wait writes one line (research R8). */
  private readonly loggedUntil = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(ATTEMPT_LIMITS) private readonly limits: AttemptLimits,
    @Inject(ATTEMPT_CLOCK) private readonly clock: AttemptClock,
  ) {}

  /** Research R3: a sweep every minute keeps memory to the accounts active in the last minute. */
  onModuleInit(): void {
    this.timer = setInterval(() => this.sweepOnce(), MINUTE_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /**
   * Research R2, steps 1 to 4: lets the attempt through and records it, or refuses it and records
   * nothing (FR-003), with the exact wait rounded up to whole seconds, never over 60 (FR-008).
   */
  tryAttempt(sub: string, kind: RateLimitedAction): AttemptResult {
    const key = `${sub}:${kind}`;
    const now = this.clock.now();

    // Ages, not sums: the clock's milliseconds are fractional, and `t + 5000 - now` can come out a
    // hair over 5000 for an attempt made at `now`, which would round up to a wait of 6 seconds.
    // `now - t` is exact for two nearby readings.
    const age = (t: number): number => now - t;

    // 1. An attempt counts in [t, t + 60 s). A time after now is impossible on a monotonic clock;
    //    dropped all the same, so no account is ever shut out by one.
    const times = (this.attempts.get(key) ?? []).filter((t) => age(t) < MINUTE_MS && age(t) >= 0);

    // 2. The minute: the wait until the attempt that fills it is a minute old. Each kind has its
    //    own pair (spec 033 research R5).
    const { perMinute, perFiveSeconds } = this.limits[kind];
    const waitMinute =
      times.length >= perMinute ? MINUTE_MS - age(times[times.length - perMinute]) : 0;
    // 3. The same for the last 5 seconds.
    const recent = times.filter((t) => age(t) < FIVE_SECONDS_MS);
    const waitBurst =
      recent.length >= perFiveSeconds
        ? FIVE_SECONDS_MS - age(recent[recent.length - perFiveSeconds])
        : 0;

    // 4. Refused: nothing recorded (a refusal always has times left, so the pruned list is kept).
    //    Let through: recorded. Either way the key holds times, so a key is forgotten only by the
    //    sweep, once its newest time is a minute old.
    const wait = Math.min(MINUTE_MS, Math.max(waitMinute, waitBurst));
    if (wait > 0) {
      this.attempts.set(key, times);
      const retryAfterSeconds = Math.ceil(wait / 1000);
      this.logOnce(key, sub, kind, now, wait, waitMinute >= waitBurst);
      return { ok: false, retryAfterSeconds };
    }
    times.push(now);
    this.attempts.set(key, times);
    return { ok: true };
  }

  /** Research R3: forgets every key whose newest attempt is a minute old. */
  sweepOnce(): void {
    const now = this.clock.now();
    for (const [key, times] of this.attempts) {
      if (now - times[times.length - 1] >= MINUTE_MS) this.forget(key);
    }
  }

  /** The keys with attempts in memory, for tests and diagnostics. */
  trackedKeys(): string[] {
    return [...this.attempts.keys()];
  }

  private forget(key: string): void {
    this.attempts.delete(key);
    this.loggedUntil.delete(key);
  }

  /**
   * FR-019, research R8: one line when an account goes over, naming the account by its `sub` (never
   * its username or token), the kind, the window that set the wait, and the wait; nothing more
   * until that wait is over.
   */
  private logOnce(
    key: string,
    sub: string,
    kind: RateLimitedAction,
    now: number,
    wait: number,
    minuteBinds: boolean,
  ): void {
    if (now < (this.loggedUntil.get(key) ?? -Infinity)) return;
    this.loggedUntil.set(key, now + wait);
    const { perMinute, perFiveSeconds } = this.limits[kind];
    const window = minuteBinds ? `${perMinute} in 60 seconds` : `${perFiveSeconds} in 5 seconds`;
    this.logger.warn(
      `Attempt limit: customer ${sub} over the ${kind} allowance (${window}); ` +
        `try again in ${Math.ceil(wait / 1000)} s.`,
    );
  }
}
