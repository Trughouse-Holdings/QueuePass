import { APP_REALMS, LEGACY_REALM } from '@queuepass/shared';
import { SignJWT } from 'jose';
import request from 'supertest';
import { as } from '../setup/authed-request';
import { testKeys } from '../setup/keys';
import { createTestApp, TestContext } from '../setup/test-app';
import { issuerFor, REALM, subFor, TEST_AUDIENCE, tokenFor } from '../setup/tokens';

/**
 * Spec 028 FR-010, FR-011, SC-005 (research R8): the Backend accepts tokens from the three app
 * realms only, each checked against its own realm's keys and issuer, and from each realm honours
 * only its app's role. Every refusal looks the same to the caller (contract `Unauthenticated`).
 */
describe('Tokens from the three app realms', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(() => {
    for (const keys of Object.values(ctx.keySets)) keys.mockClear();
  });

  const ALL_ROLES = APP_REALMS.map((r) => r.role);
  /** The endpoints each role is needed for: its app's greeting, and one of its app's own reads. */
  const ENDPOINTS: Record<string, string[]> = {
    'queuepass-admin': ['/hello/admin', '/reports/sales'],
    customer: ['/hello/customer', '/me/orders'],
    'gate-agent': ['/hello/booth'],
  };
  const userOf = (prefix: string): string => `${prefix}1`;

  const expectUnauthenticated = (res: request.Response): void => {
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'A valid access token is required.',
    });
  };
  const expectNoKeysAskedFor = (): void => {
    for (const keys of Object.values(ctx.keySets)) expect(keys).not.toHaveBeenCalled();
  };

  describe.each(APP_REALMS.map((r) => [r.realm, r] as const))('%s', (realm, app) => {
    it("allows its own role's endpoints, and /me lists that role", async () => {
      const token = await tokenFor({ username: userOf(app.prefix), roles: [app.role], realm });
      for (const path of ENDPOINTS[app.role]!) await as(ctx, token).get(path).expect(200);
      const me = await as(ctx, token).get('/me').expect(200);
      expect(me.body).toEqual({
        sub: subFor(userOf(app.prefix)),
        username: userOf(app.prefix),
        roles: [app.role],
      });
    });

    it('listing all three roles, allows only its own: 403 elsewhere, /me lists one (FR-011)', async () => {
      const token = await tokenFor({ username: userOf(app.prefix), roles: ALL_ROLES, realm });
      for (const [role, paths] of Object.entries(ENDPOINTS)) {
        for (const path of paths) {
          const res = await as(ctx, token).get(path);
          if (role === app.role) {
            expect(res.status).toBe(200);
          } else {
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('FORBIDDEN');
          }
        }
      }
      const me = await as(ctx, token).get('/me').expect(200);
      expect(me.body.roles).toEqual([app.role]);
    });

    it("refuses its issuer on a token signed with another realm's key (R8)", async () => {
      for (const other of APP_REALMS.filter((r) => r.realm !== realm)) {
        const token = await tokenFor({
          username: userOf(app.prefix),
          roles: [app.role],
          realm: other.realm,
          iss: issuerFor(realm),
        });
        expectUnauthenticated(await as(ctx, token).get('/me'));
      }
    });
  });

  it('refuses the retired realm queuepass, whichever trusted key signed the token (FR-010)', async () => {
    for (const { realm, role } of APP_REALMS) {
      const token = await tokenFor({
        username: 'admin1',
        roles: [role],
        realm,
        iss: issuerFor(LEGACY_REALM),
      });
      expectUnauthenticated(await as(ctx, token).get('/me'));
    }
  });

  it('refuses an unknown issuer before asking any realm for keys', async () => {
    for (const iss of [
      issuerFor('other'),
      issuerFor('master'),
      `${issuerFor(REALM.admin)}/`,
      'http://evil.example/realms/queuepass-admin-app',
    ]) {
      const token = await tokenFor({ username: 'admin1', roles: ['queuepass-admin'], iss });
      expectUnauthenticated(await as(ctx, token).get('/me'));
    }
    expectNoKeysAskedFor();
  });

  it('asks only the realm the token names for keys', async () => {
    const token = await tokenFor({ username: 'agent1', roles: ['gate-agent'] });
    await as(ctx, token).get('/hello/booth').expect(200);
    expect(ctx.keySets[REALM.booth]).toHaveBeenCalled();
    expect(ctx.keySets[REALM.admin]).not.toHaveBeenCalled();
    expect(ctx.keySets[REALM.customer]).not.toHaveBeenCalled();
  });

  it('refuses a token with no issuer', async () => {
    const key = (await testKeys()).realms[REALM.admin]!;
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      preferred_username: 'admin1',
      realm_access: { roles: ['queuepass-admin'] },
    })
      .setProtectedHeader({ alg: 'RS256', kid: key.kid, typ: 'JWT' })
      .setSubject(subFor('admin1'))
      .setAudience(TEST_AUDIENCE)
      .setIssuedAt(now - 60)
      .setExpirationTime(now + 300)
      .sign(key.privateKey);
    expectUnauthenticated(await as(ctx, token).get('/me'));
    expectNoKeysAskedFor();
  });
});
