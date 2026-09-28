import request from 'supertest';
import { as } from '../setup/authed-request';
import { createTestApp, TestContext } from '../setup/test-app';
import { subFor, tokenFor } from '../setup/tokens';

/** Spec 001 FR-020, FR-022 — identity comes only from the validated token. */
describe('GET /me', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('returns the caller, with only QueuePass roles', async () => {
    const token = await tokenFor({
      username: 'admin1',
      roles: ['queuepass-admin', 'offline_access', 'uma_authorization', 'default-roles-queuepass'],
    });
    const res = await as(ctx, token).get('/me').expect(200);
    expect(res.body).toEqual({
      sub: subFor('admin1'),
      username: 'admin1',
      roles: ['queuepass-admin'],
    });
  });

  it('returns no roles when the token has no realm_access claim', async () => {
    const token = await tokenFor({ username: 'customer1', roles: [], noRealmAccess: true });
    const res = await as(ctx, token).get('/me').expect(200);
    expect(res.body.roles).toEqual([]);
  });

  it('ignores identity claimed any other way than a token', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/me?username=admin1')
      .set('X-User', 'admin1')
      .set('X-Roles', 'queuepass-admin');
    expect(res.status).toBe(401);
  });
});
