import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet } from 'jose';
import { ADDRESS_GEOCODER } from '../../src/address/address-geocoder';
import { AppModule } from '../../src/app.module';
import { JWKS } from '../../src/auth/jwks.provider';
import { configureApp } from '../../src/configure-app';
import { PrismaService } from '../../src/prisma/prisma.service';
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
}

/**
 * Boots the real application graph with the same pipes, filters, guards, CORS, and /docs as
 * production (src/configure-app.ts), so responses under test are what clients receive.
 *
 * Two substitutions: the key set (the app trusts only the test key pair instead of fetching
 * Keycloak's JWKS, research R11; token validation itself is NOT bypassed), and the address
 * service, replaced by a `FakeGeocoder` (spec 013 research R9).
 */
export async function createTestApp(): Promise<TestContext> {
  process.env.OIDC_ISSUER = TEST_ISSUER;
  process.env.OIDC_AUDIENCE = TEST_AUDIENCE;
  process.env.OIDC_JWKS_URL ??= 'http://keycloak.invalid/certs';
  process.env.CORS_ORIGINS = 'http://localhost:5173,http://localhost:5174,http://localhost:5175';

  const { trusted } = await testKeys();
  const geocoder = new FakeGeocoder();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(JWKS)
    .useValue(createLocalJWKSet({ keys: [trusted.publicJwk] }))
    .overrideProvider(ADDRESS_GEOCODER)
    .useValue(geocoder)
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
  };
}
