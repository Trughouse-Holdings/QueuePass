import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet } from 'jose';
import { ADDRESS_GEOCODER } from '../../src/address/address-geocoder';
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
import { testKeys } from './keys';
import { ADMIN, TEST_AUDIENCE, TEST_ISSUER, tokenFor } from './tokens';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  /** A valid `admin1` token, pre-signed so request helpers can stay synchronous. */
  adminToken: string;
  /** Spec 013 research R9: the address service's stand-in; no test uses the network. */
  geocoder: FakeGeocoder;
  /** Spec 018 research R3: the live-code clock, real time unless a test sets it. */
  clock: FakeClock;
  /**
   * Spec 026 research R2, R10: the attempt windows' clock, standing still until a test calls
   * `advance(ms)`. Not `clock`, which never moves these windows.
   */
  attemptClock: FakeAttemptClock;
}

export interface TestAppOptions {
  /**
   * Spec 026 research R5: the attempt limits. Unset, 1000 a minute and 1000 in 5 seconds, so tests
   * about other features (20 orders from one customer at once, say) run unchanged with the check
   * still on; `'defaults'`, the code's own 10 and 3, for this feature's tests; or the given pair.
   */
  attemptLimits?: 'defaults' | { perMinute: number; perFiveSeconds: number };
}

/**
 * Boots the real application graph with the same pipes, filters, guards, CORS, and /docs as
 * production (src/configure-app.ts), so responses under test are what clients receive.
 *
 * Five substitutions: the key set (the app trusts only the test key pair instead of fetching
 * Keycloak's JWKS, research R11; token validation itself is NOT bypassed), the address service,
 * replaced by a `FakeGeocoder` (spec 013 research R9), the seat hold sweep's interval, 0 so
 * no timer runs (spec 015 research R4), the live-code clock, a `FakeClock` (spec 018
 * research R3), and the attempt windows' clock, a `FakeAttemptClock` (spec 026 research R2). A
 * sixth setting, the attempt limits, is configuration, as in production (spec 026 research R5):
 * the limits are never off.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestContext> {
  // Spec 026 research R5: assigned, never `??=`, so no app inherits another test file's numbers.
  const limits = options.attemptLimits ?? { perMinute: 1000, perFiveSeconds: 1000 };
  if (limits === 'defaults') {
    delete process.env.RATE_LIMIT_PER_MINUTE;
    delete process.env.RATE_LIMIT_PER_5_SECONDS;
  } else {
    process.env.RATE_LIMIT_PER_MINUTE = String(limits.perMinute);
    process.env.RATE_LIMIT_PER_5_SECONDS = String(limits.perFiveSeconds);
  }
  process.env.OIDC_ISSUER = TEST_ISSUER;
  process.env.OIDC_AUDIENCE = TEST_AUDIENCE;
  process.env.OIDC_JWKS_URL ??= 'http://keycloak.invalid/certs';
  process.env.CORS_ORIGINS = 'http://localhost:5173,http://localhost:5174,http://localhost:5175';

  const { trusted } = await testKeys();
  const geocoder = new FakeGeocoder();
  const clock = new FakeClock();
  const attemptClock = new FakeAttemptClock();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ATTEMPT_CLOCK)
    .useValue(attemptClock)
    .overrideProvider(JWKS)
    .useValue(createLocalJWKSet({ keys: [trusted.publicJwk] }))
    .overrideProvider(ADDRESS_GEOCODER)
    .useValue(geocoder)
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
    clock,
    attemptClock,
  };
}
