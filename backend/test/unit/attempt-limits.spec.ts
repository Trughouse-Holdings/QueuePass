import { Logger, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AttemptLimit } from '../../src/attempt-limits/attempt-limit.decorator';
import { AttemptLimitGuard } from '../../src/attempt-limits/attempt-limit.guard';
import { ATTEMPT_CLOCK, type AttemptClock } from '../../src/attempt-limits/attempt-limits.clock';
import { attemptLimitsFromEnv } from '../../src/attempt-limits/attempt-limits.config';
import { AttemptLimitsModule } from '../../src/attempt-limits/attempt-limits.module';
import {
  AttemptLimitsService,
  type AttemptResult,
} from '../../src/attempt-limits/attempt-limits.service';

/**
 * Spec 026 (research R2, R3, R5, R8, R10): the rolling windows on a hand-moved clock, which this
 * unit test may move backwards; the one log line per wait; the two settings and their checks.
 */
describe('AttemptLimitsService', () => {
  const T = 1_000_000;
  let t: number;
  const clock: AttemptClock = { now: () => t };
  let service: AttemptLimitsService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    t = T;
    service = new AttemptLimitsService(
      { BUY: { perMinute: 10, perFiveSeconds: 3 }, HOLD: { perMinute: 10, perFiveSeconds: 3 } },
      clock,
    );
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
    jest.useRealTimers();
  });

  const at = (ms: number, sub = 'sub-a', kind: 'BUY' | 'HOLD' = 'BUY'): AttemptResult => {
    t = ms;
    return service.tryAttempt(sub, kind);
  };
  const ok: AttemptResult = { ok: true };
  const wait = (retryAfterSeconds: number): AttemptResult => ({ ok: false, retryAfterSeconds });
  /** 3, 3, 3, and 1 attempts at T, T + 5 s, T + 10 s, T + 15 s: no 5 seconds holds 4. */
  const tenSpread = (sub = 'sub-a'): void => {
    for (const [ms, n] of [
      [T, 3],
      [T + 5_000, 3],
      [T + 10_000, 3],
      [T + 15_000, 1],
    ]) {
      for (let i = 0; i < n; i++) expect(at(ms, sub)).toEqual(ok);
    }
  };

  describe('3 in any 5 seconds (FR-002)', () => {
    it('refuses a 4th at the same moment with 5 seconds, then 1, and lets it through at exactly 5 s', () => {
      for (let i = 0; i < 3; i++) expect(at(T)).toEqual(ok);
      expect(at(T)).toEqual(wait(5));
      expect(at(T + 4_000)).toEqual(wait(1));
      expect(at(T + 4_001)).toEqual(wait(1));
      expect(at(T + 4_999)).toEqual(wait(1));
      // Half-open: an attempt counts in [t, t + 5 s).
      expect(at(T + 5_000)).toEqual(ok);
    });

    it('tells exactly 5 seconds on a clock with fractional milliseconds', () => {
      // performance.now() is fractional: `t + 5000 - t` can be a hair over 5000 in floating point.
      for (const frac of [0.1, 1_234.567, 98_765_432.123, 3_600_000.7]) {
        const sub = `frac-${frac}`;
        for (let i = 0; i < 3; i++) expect(at(frac, sub)).toEqual(ok);
        expect(at(frac, sub)).toEqual(wait(5));
        expect(at(frac + 4_000, sub)).toEqual(wait(1));
        expect(at(frac + 5_000, sub)).toEqual(ok);
      }
    });

    it('rounds a part second up', () => {
      for (let i = 0; i < 3; i++) expect(at(T)).toEqual(ok);
      expect(at(T + 1)).toEqual(wait(5));
      expect(at(T + 1_000)).toEqual(wait(4));
      expect(at(T + 3_999)).toEqual(wait(2));
    });
  });

  describe('10 in any 60 seconds (FR-002)', () => {
    it('refuses the 11th 1 ms before the first is a minute old, and lets it through at a minute', () => {
      tenSpread();
      expect(at(T + 59_999)).toEqual(wait(1));
      expect(at(T + 60_000)).toEqual(ok);
    });

    it('says the whole wait for the minute, up to the oldest attempt being a minute old', () => {
      tenSpread();
      expect(at(T + 20_000)).toEqual(wait(40));
      expect(at(T + 47_500)).toEqual(wait(13));
    });

    it('gives the larger wait when both windows bind, and names that window in the log', () => {
      // The minute binds harder: 1 at T, then 3, 3, 3 at T + 10, 20, 30 s.
      for (const [ms, n] of [
        [T, 1],
        [T + 10_000, 3],
        [T + 20_000, 3],
        [T + 30_000, 3],
      ]) {
        for (let i = 0; i < n; i++) expect(at(ms)).toEqual(ok);
      }
      expect(at(T + 30_000)).toEqual(wait(30));
      expect(warn.mock.calls.at(-1)?.[0]).toContain('(10 in 60 seconds)');

      // The 5 seconds bind harder: 1 at T, then 3, 3, 3 at T + 20, 40, 58 s.
      for (const [ms, n] of [
        [T, 1],
        [T + 20_000, 3],
        [T + 40_000, 3],
        [T + 58_000, 3],
      ]) {
        for (let i = 0; i < n; i++) expect(at(ms, 'sub-b')).toEqual(ok);
      }
      expect(at(T + 58_000, 'sub-b')).toEqual(wait(5));
      expect(warn.mock.calls.at(-1)?.[0]).toContain('(3 in 5 seconds)');
      expect(at(T + 59_000, 'sub-b')).toEqual(wait(4));
    });
  });

  it('does not record refused attempts, so the wait told stays exact (FR-003, SC-003)', () => {
    for (let i = 0; i < 3; i++) expect(at(T)).toEqual(ok);
    for (let i = 0; i < 20; i++) expect(at(T + i * 200).ok).toBe(false);
    expect(at(T + 5_000)).toEqual(ok);
  });

  describe('a clock that goes backwards (research R2)', () => {
    it('drops times "in the future", so the account is not shut out', () => {
      for (let i = 0; i < 3; i++) expect(at(T)).toEqual(ok);
      expect(at(T - 30_000)).toEqual(ok);
    });

    it('never tells a wait over 60 seconds', () => {
      tenSpread();
      const results = [T - 3_600_000, T - 3_600_000, T - 3_600_000, T - 3_600_000, T].map((ms) =>
        at(ms),
      );
      for (const r of results) if (!r.ok) expect(r.retryAfterSeconds).toBeLessThanOrEqual(60);
      expect(results.slice(0, 3)).toEqual([ok, ok, ok]);
      expect(results[3]).toEqual(wait(5));
    });
  });

  it('keeps BUY and HOLD, and each account, apart (FR-001, FR-005)', () => {
    for (let i = 0; i < 3; i++) expect(at(T, 'sub-a', 'BUY')).toEqual(ok);
    expect(at(T, 'sub-a', 'BUY')).toEqual(wait(5));
    for (let i = 0; i < 3; i++) expect(at(T, 'sub-a', 'HOLD')).toEqual(ok);
    expect(at(T, 'sub-a', 'HOLD')).toEqual(wait(5));
    for (let i = 0; i < 3; i++) expect(at(T, 'sub-b', 'BUY')).toEqual(ok);
    for (let i = 0; i < 3; i++) expect(at(T, 'sub-b', 'HOLD')).toEqual(ok);
  });

  it("uses each kind's own pair (spec 033 FR-008, research R5)", () => {
    const own = new AttemptLimitsService(
      { BUY: { perMinute: 10, perFiveSeconds: 3 }, HOLD: { perMinute: 30, perFiveSeconds: 10 } },
      clock,
    );
    t = T;
    for (let i = 0; i < 10; i++) expect(own.tryAttempt('sub-a', 'HOLD')).toEqual(ok);
    expect(own.tryAttempt('sub-a', 'HOLD')).toEqual(wait(5));
    expect(warn.mock.calls.at(-1)?.[0]).toBe(
      'Attempt limit: customer sub-a over the HOLD allowance (10 in 5 seconds); try again in 5 s.',
    );
    for (let i = 0; i < 3; i++) expect(own.tryAttempt('sub-a', 'BUY')).toEqual(ok);
    expect(own.tryAttempt('sub-a', 'BUY')).toEqual(wait(5));
    // The minute: 30 holds spread 10 per 5 seconds, then the 31st waits for the oldest's minute.
    for (const ms of [T + 5_000, T + 10_000]) {
      t = ms;
      for (let i = 0; i < 10; i++) expect(own.tryAttempt('sub-a', 'HOLD')).toEqual(ok);
    }
    t = T + 20_000;
    expect(own.tryAttempt('sub-a', 'HOLD')).toEqual(wait(40));
    expect(warn.mock.calls.at(-1)?.[0]).toContain('(30 in 60 seconds)');
  });

  describe('memory (research R3)', () => {
    it('deletes a key with no time left in the last minute', () => {
      expect(at(T, 'sub-a')).toEqual(ok);
      expect(at(T, 'sub-b', 'HOLD')).toEqual(ok);
      expect(service.trackedKeys().sort()).toEqual(['sub-a:BUY', 'sub-b:HOLD']);
      // A refused attempt records nothing, so it adds no key.
      for (let i = 0; i < 2; i++) expect(at(T, 'sub-b', 'HOLD')).toEqual(ok);
      expect(at(T, 'sub-b', 'HOLD')).toEqual(wait(5));
      expect(service.trackedKeys().sort()).toEqual(['sub-a:BUY', 'sub-b:HOLD']);
      t = T + 70_000;
      service.sweepOnce();
      expect(service.trackedKeys()).toEqual([]);
    });

    it('sweeps keys whose newest time is a minute old and keeps the others', () => {
      expect(at(T, 'old')).toEqual(ok);
      expect(at(T + 1, 'edge')).toEqual(ok);
      expect(at(T + 30_000, 'live', 'HOLD')).toEqual(ok);
      t = T + 60_001;
      service.sweepOnce();
      expect(service.trackedKeys().sort()).toEqual(['live:HOLD']);
    });

    it('sweeps every 60 seconds from module start until module end', () => {
      jest.useFakeTimers();
      const sweep = jest.spyOn(service, 'sweepOnce');
      service.onModuleInit();
      jest.advanceTimersByTime(59_999);
      expect(sweep).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(sweep).toHaveBeenCalledTimes(1);
      service.onModuleDestroy();
      jest.advanceTimersByTime(120_000);
      expect(sweep).toHaveBeenCalledTimes(1);
    });
  });

  describe('the log (FR-019, research R8)', () => {
    const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.secret-token-text.signature';

    it('writes one line when an account goes over, none for further refusals in that wait', () => {
      for (let i = 0; i < 3; i++) expect(at(T, 'sub-a', 'HOLD')).toEqual(ok);
      expect(at(T, 'sub-a', 'HOLD')).toEqual(wait(5));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe(
        'Attempt limit: customer sub-a over the HOLD allowance (3 in 5 seconds); try again in 5 s.',
      );
      for (let i = 0; i < 10; i++) at(T + i * 400, 'sub-a', 'HOLD');
      expect(warn).toHaveBeenCalledTimes(1);

      // After the wait, let through again, then over again: one more line.
      for (let i = 0; i < 3; i++) expect(at(T + 5_000, 'sub-a', 'HOLD')).toEqual(ok);
      expect(at(T + 5_000, 'sub-a', 'HOLD')).toEqual(wait(5));
      expect(warn).toHaveBeenCalledTimes(2);
      for (const [line] of warn.mock.calls) expect(String(line)).not.toContain(TOKEN);
    });

    it('logs another kind or account on its own', () => {
      for (const [sub, kind] of [
        ['sub-a', 'BUY'],
        ['sub-a', 'HOLD'],
        ['sub-b', 'BUY'],
      ] as const) {
        for (let i = 0; i < 4; i++) at(T, sub, kind);
      }
      expect(warn).toHaveBeenCalledTimes(3);
    });
  });
});

describe('AttemptLimitsModule (research R2)', () => {
  it('provides a monotonic ATTEMPT_CLOCK, performance.now(), not Date.now()', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AttemptLimitsModule] }).compile();
    const clock = moduleRef.get<AttemptClock>(ATTEMPT_CLOCK);
    const perf = jest.spyOn(performance, 'now').mockReturnValue(12_345.5);
    const date = jest.spyOn(Date, 'now').mockReturnValue(99);
    try {
      expect(clock.now()).toBe(12_345.5);
      expect(perf).toHaveBeenCalled();
      expect(date).not.toHaveBeenCalled();
    } finally {
      perf.mockRestore();
      date.mockRestore();
      await moduleRef.close();
    }
    expect(moduleRef.get(AttemptLimitsService)).toBeInstanceOf(AttemptLimitsService);
  });
});

describe('AttemptLimitGuard (research R1)', () => {
  const context = (handler: () => void, principal?: { sub: string }): ExecutionContext =>
    ({
      getHandler: () => handler,
      switchToHttp: () => ({
        getRequest: () => ({ principal }),
        getResponse: () => ({ setHeader: jest.fn() }),
      }),
    }) as unknown as ExecutionContext;
  const service = new AttemptLimitsService(
    { BUY: { perMinute: 10, perFiveSeconds: 3 }, HOLD: { perMinute: 30, perFiveSeconds: 10 } },
    { now: () => 0 },
  );
  const guard = new AttemptLimitGuard(new Reflector(), service);

  it('lets every unmarked handler through untouched', () => {
    expect(guard.canActivate(context(() => undefined, { sub: 'sub-a' }))).toBe(true);
    expect(service.trackedKeys()).toEqual([]);
  });

  it('refuses to run on a marked handler without a signed-in caller', () => {
    class Marked {
      @AttemptLimit('BUY')
      handler(): void {}
    }
    expect(() => guard.canActivate(context(Marked.prototype.handler))).toThrow(
      'AttemptLimit used on a route without a signed-in caller.',
    );
  });
});

describe('attemptLimitsFromEnv (spec 026 FR-017, spec 033 FR-008, research R5)', () => {
  const BUY = { perMinute: 10, perFiveSeconds: 3 };
  const HOLD = { perMinute: 30, perFiveSeconds: 10 };

  it('defaults to 10 and 3 for buying and 30 and 10 for holding when unset', () => {
    expect(attemptLimitsFromEnv({})).toEqual({ BUY, HOLD });
  });

  it('reads each of the four settings', () => {
    expect(attemptLimitsFromEnv({ RATE_LIMIT_PER_MINUTE: '7' })).toEqual({
      BUY: { perMinute: 7, perFiveSeconds: 3 },
      HOLD,
    });
    expect(attemptLimitsFromEnv({ RATE_LIMIT_PER_5_SECONDS: '2' })).toEqual({
      BUY: { perMinute: 10, perFiveSeconds: 2 },
      HOLD,
    });
    expect(attemptLimitsFromEnv({ RATE_LIMIT_HOLD_PER_MINUTE: '40' })).toEqual({
      BUY,
      HOLD: { perMinute: 40, perFiveSeconds: 10 },
    });
    expect(attemptLimitsFromEnv({ RATE_LIMIT_HOLD_PER_5_SECONDS: '4' })).toEqual({
      BUY,
      HOLD: { perMinute: 30, perFiveSeconds: 4 },
    });
    expect(
      attemptLimitsFromEnv({
        RATE_LIMIT_PER_MINUTE: '10',
        RATE_LIMIT_PER_5_SECONDS: '10',
        RATE_LIMIT_HOLD_PER_MINUTE: '12',
        RATE_LIMIT_HOLD_PER_5_SECONDS: '12',
      }),
    ).toEqual({
      BUY: { perMinute: 10, perFiveSeconds: 10 },
      HOLD: { perMinute: 12, perFiveSeconds: 12 },
    });
  });

  it.each(['0', '-1', '1.5', 'abc', '', ' 3', '03', '1e3', '99999999999999999999'])(
    'refuses %j for any of the four settings, naming it and quoting the value',
    (value) => {
      for (const name of [
        'RATE_LIMIT_PER_MINUTE',
        'RATE_LIMIT_PER_5_SECONDS',
        'RATE_LIMIT_HOLD_PER_MINUTE',
        'RATE_LIMIT_HOLD_PER_5_SECONDS',
      ]) {
        expect(() => attemptLimitsFromEnv({ [name]: value })).toThrow(
          new Error(`${name} must be a whole number of at least 1, got '${value}'`),
        );
      }
    },
  );

  it('refuses a minute number below the default 5-second one, naming both', () => {
    expect(() => attemptLimitsFromEnv({ RATE_LIMIT_PER_MINUTE: '2' })).toThrow(
      new Error("RATE_LIMIT_PER_5_SECONDS ('3') must not be more than RATE_LIMIT_PER_MINUTE ('2')"),
    );
    expect(() => attemptLimitsFromEnv({ RATE_LIMIT_HOLD_PER_MINUTE: '9' })).toThrow(
      new Error(
        "RATE_LIMIT_HOLD_PER_5_SECONDS ('10') must not be more than RATE_LIMIT_HOLD_PER_MINUTE ('9')",
      ),
    );
  });

  it('refuses a 5-second number above the default minute, naming both', () => {
    expect(() => attemptLimitsFromEnv({ RATE_LIMIT_PER_5_SECONDS: '11' })).toThrow(
      new Error(
        "RATE_LIMIT_PER_5_SECONDS ('11') must not be more than RATE_LIMIT_PER_MINUTE ('10')",
      ),
    );
    expect(() => attemptLimitsFromEnv({ RATE_LIMIT_HOLD_PER_5_SECONDS: '31' })).toThrow(
      new Error(
        "RATE_LIMIT_HOLD_PER_5_SECONDS ('31') must not be more than RATE_LIMIT_HOLD_PER_MINUTE ('30')",
      ),
    );
  });

  it('refuses a 5-second number above the minute, naming both', () => {
    expect(() =>
      attemptLimitsFromEnv({ RATE_LIMIT_PER_MINUTE: '10', RATE_LIMIT_PER_5_SECONDS: '11' }),
    ).toThrow(
      new Error(
        "RATE_LIMIT_PER_5_SECONDS ('11') must not be more than RATE_LIMIT_PER_MINUTE ('10')",
      ),
    );
    expect(() =>
      attemptLimitsFromEnv({
        RATE_LIMIT_HOLD_PER_MINUTE: '5',
        RATE_LIMIT_HOLD_PER_5_SECONDS: '6',
      }),
    ).toThrow(
      new Error(
        "RATE_LIMIT_HOLD_PER_5_SECONDS ('6') must not be more than RATE_LIMIT_HOLD_PER_MINUTE ('5')",
      ),
    );
  });
});
