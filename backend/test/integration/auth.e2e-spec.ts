import { SignJWT } from 'jose';
import request from 'supertest';
import { anon, as } from '../setup/authed-request';
import { createTestApp, TestContext } from '../setup/test-app';
import { ADMIN, tokenFor } from '../setup/tokens';

/**
 * Spec 001 FR-018, FR-019, FR-030 — the Backend trusts only valid, correctly scoped tokens.
 * Every refused case must look identical to the caller: same status, code, and message.
 */
describe('Token validation', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const MESSAGE = 'A valid access token is required.';

  const expectUnauthenticated = (res: request.Response): void => {
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.body.error.message).toBe(MESSAGE);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  };

  it('refuses a request with no Authorization header', async () => {
    expectUnauthenticated(await anon(ctx).get('/me'));
  });

  it('refuses a malformed token', async () => {
    expectUnauthenticated(await as(ctx, 'not-a-jwt').get('/me'));
  });

  it('refuses a token signed by an unknown key', async () => {
    expectUnauthenticated(await as(ctx, await tokenFor({ ...ADMIN, rogue: true })).get('/me'));
  });

  it('refuses an expired token', async () => {
    expectUnauthenticated(await as(ctx, await tokenFor({ ...ADMIN, expiresIn: -300 })).get('/me'));
  });

  it('accepts a token expired by less than the 30-second clock tolerance', async () => {
    await as(ctx, await tokenFor({ ...ADMIN, expiresIn: -10 }))
      .get('/me')
      .expect(200);
  });

  it('refuses a token from another issuer', async () => {
    const token = await tokenFor({ ...ADMIN, iss: 'http://localhost:8080/realms/other' });
    expectUnauthenticated(await as(ctx, token).get('/me'));
  });

  it('refuses a token for another audience', async () => {
    expectUnauthenticated(await as(ctx, await tokenFor({ ...ADMIN, aud: 'account' })).get('/me'));
  });

  it('refuses an HS256 token, even with otherwise valid claims', async () => {
    const token = await new SignJWT({
      preferred_username: 'admin1',
      realm_access: { roles: ['queuepass-admin'] },
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('x')
      .setIssuer('http://localhost:8080/realms/queuepass')
      .setAudience('queuepass-api')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('a-shared-secret-that-is-at-least-32-bytes'));
    expectUnauthenticated(await as(ctx, token).get('/me'));
  });

  it('refuses the Basic scheme', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/me')
      .set('Authorization', 'Basic YWRtaW4xOnRlc3QxMjM=');
    expectUnauthenticated(res);
  });

  it('refuses a token with no preferred_username', async () => {
    expectUnauthenticated(await as(ctx, await tokenFor({ ...ADMIN, username: '' })).get('/me'));
  });
});
