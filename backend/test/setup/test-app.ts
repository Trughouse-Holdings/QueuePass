import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_REALMS } from '@queuepass/shared';
import { createLocalJWKSet, type JWTVerifyGetKey } from 'jose';
import { ADDRESS_GEOCODER } from '../../src/address/address-geocoder';
import { MAP_SEARCH } from '../../src/address/map-search';
import { AppModule } from '../../src/app.module';
import { ATTEMPT_CLOCK } from '../../src/attempt-limits/attempt-limits.clock';
import { JWKS } from '../../src/auth/jwks.provider';
import { CLOCK } from '../../src/common/clock';
import { configureApp } from '../../src/configure-app';
import { HOLD_SWEEP_INTERVAL_MS } from '../../src/reservations/hold-sweeper';
import { PrismaService } from '../../src/prisma/prisma.service';
import { FakeAttemptClock } from './fake-attempt-clock';
import { FakeClock } from './fake-clock';
import { FakeGeocoder } from './fake-geocoder';
import { FakeMapSearch } from './fake-map-search';
import { testKeys } from './keys';
import { ADMIN, TEST_AUDIENCE, TEST_ISSUER_BASE, tokenFor } from './tokens';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  /** A valid `admin1` token, pre-signed so request helpers can stay synchronous. */
  adminToken: string;
  /** Spec 013 research R9: the address service's stand-in; no test uses the network. */
  geocoder: FakeGeocoder;
  /** Spec 013 research R16: the map search's stand-in; finds nothing unless a test queues it. */
  map: FakeMapSearch;
  /** Spec 018 research R3: the live-code clock, real time unless a test sets it. */
  clock: FakeClock;
  /**
   * Spec 026 research R2, R10: the attempt windows' clock, standing still until a test calls
   * `advance(ms)`. Not `clock`, which never moves these windows.
   */
  attemptClock: FakeAttemptClock;
  /**
   * Spec 028 (research R8, R10): each app realm's key set, as the Backend is given it; each a
   * `jest.fn` around a local key set holding only that realm's test key, so a test can see which
   * realm's keys were asked for.
   */
  keySets: Record<string, jest.Mock<ReturnType<JWTVerifyGetKey>, Parameters<JWTVerifyGetKey>>>;
}

type LimitPair = { perMinute: number; perFiveSeconds: number };

export interface TestAppOptions {
  /**
   * Spec 026 research R5, spec 033 research R5: the attempt limits, the same pair for both kinds.
   * Unset, 1000 a minute and 1000 in 5 seconds, so tests about other features (20 orders from one
   * customer at once, say) run unchanged with the check still on; `'defaults'`, the code's own
   * pairs (buying 10 and 3, holding 30 and 10), for the limits' own tests; the given pair, set for
   * buying and holding alike; or a pair for each kind.
   */
  attemptLimits?: 'defaults' | LimitPair | { BUY: LimitPair; HOLD: LimitPair };
}

/**
 * Boots the real application graph with the same pipes, filters, guards, CORS, and /docs as
 * production (src/configure-app.ts), so responses under test are what clients receive.
 *
 * Five substitutions: the key sets (the app trusts, for each app realm, only that realm's test
 * key pair instead of fetching Keycloak's JWKS, research R11 and spec 028 research R10; token
 * validation itself is NOT bypassed), the address service,
 * replaced by a `FakeGeocoder` (spec 013 research R9), the seat hold sweep's interval, 0 so
 * no timer runs (spec 015 research R4), the live-code clock, a `FakeClock` (spec 018
 * research R3), and the attempt windows' clock, a `FakeAttemptClock` (spec 026 research R2). A
 * sixth setting, the attempt limits, is configuration, as in production (spec 026 research R5):
 * the limits are never off.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestContext> {
  // Spec 026 research R5: assigned, never `??=`, so no app inherits another test file's numbers.
  const limits = options.attemptLimits ?? { perMinute: 1000, perFiveSeconds: 1000 };
  const settings = [
    ['BUY', 'RATE_LIMIT_PER_MINUTE', 'RATE_LIMIT_PER_5_SECONDS'],
    ['HOLD', 'RATE_LIMIT_HOLD_PER_MINUTE', 'RATE_LIMIT_HOLD_PER_5_SECONDS'],
  ] as const;
  for (const [kind, perMinute, perFiveSeconds] of settings) {
    if (limits === 'defaults') {
      delete process.env[perMinute];
      delete process.env[perFiveSeconds];
    } else {
      const pair = 'perMinute' in limits ? limits : limits[kind];
      process.env[perMinute] = String(pair.perMinute);
      process.env[perFiveSeconds] = String(pair.perFiveSeconds);
    }
  }
  process.env.OIDC_ISSUER_BASE = TEST_ISSUER_BASE;
  process.env.OIDC_AUDIENCE = TEST_AUDIENCE;
  process.env.OIDC_JWKS_BASE ??= 'http://keycloak.invalid/realms';
  process.env.CORS_ORIGINS = 'http://localhost:5173,http://localhost:5174,http://localhost:5175';

  const keys = await testKeys();
  const keySets: TestContext['keySets'] = {};
  for (const { realm } of APP_REALMS) {
    const local = createLocalJWKSet({ keys: [keys.realms[realm]!.publicJwk] });
    keySets[realm] = jest.fn((...args: Parameters<JWTVerifyGetKey>) => local(...args));
  }
  const geocoder = new FakeGeocoder();
  const map = new FakeMapSearch();
  const clock = new FakeClock();
  const attemptClock = new FakeAttemptClock();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ATTEMPT_CLOCK)
    .useValue(attemptClock)
    .overrideProvider(JWKS)
    .useValue(keySets)
    .overrideProvider(ADDRESS_GEOCODER)
    .useValue(geocoder)
    .overrideProvider(MAP_SEARCH)
    .useValue(map)
    .overrideProvider(CLOCK)
    .useValue(clock)
    // Spec 015 research R4: no sweep timer in tests; they call HoldSweeper.sweepOnce().
    .overrideProvider(HOLD_SWEEP_INTERVAL_MS)
    .useValue(0)
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  // Listen once on an ephemeral port. Otherwise Supertest starts a listener per request, and
  // concurrent requests on the same server object reset each other's connections.
  await app.listen(0, '127.0.0.1');

  return {
    app,
    prisma: app.get(PrismaService),
    adminToken: await tokenFor(ADMIN),
    geocoder,
    map,
    clock,
    attemptClock,
    keySets,
  };
}
