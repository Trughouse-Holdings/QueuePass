import { anon, as } from '../setup/authed-request';
import { createTestApp, TestContext } from '../setup/test-app';
import { tokenFor } from '../setup/tokens';

/** Spec 001 FR-021, FR-023 — one greeting per front end, each for exactly its own role. */
describe('Greeting endpoints', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const APPS = [
    {
      path: '/hello/admin',
      app: 'admin',
      role: 'queuepass-admin',
      user: 'admin1',
      appName: 'QueuePass Admin',
    },
    {
      path: '/hello/customer',
      app: 'customer',
      role: 'customer',
      user: 'customer1',
      appName: 'QueuePass',
    },
    {
      path: '/hello/booth',
      app: 'booth',
      role: 'gate-agent',
      user: 'agent1',
      appName: 'QueuePass Ticket Booth',
    },
  ] as const;

  describe.each(APPS)('$path', ({ path, app, role, user, appName }) => {
    it(`greets a ${role} by username`, async () => {
      const res = await as(ctx, await tokenFor({ username: user, roles: [role] }))
        .get(path)
        .expect(200);
      expect(res.body).toEqual({
        app,
        appName,
        username: user,
        message: `Hello, ${user}! Welcome to ${appName}.`,
      });
    });

    it.each(APPS.filter((a) => a.role !== role))('refuses a $role with 403', async (other) => {
      const res = await as(ctx, await tokenFor({ username: other.user, roles: [other.role] }))
        .get(path)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.details.requiredRoles).toEqual([role]);
    });

    it('refuses no token with 401', async () => {
      await anon(ctx).get(path).expect(401);
    });
  });

  // Spec 028 FR-011 (research R10), changed by design from spec 001's "calls both greetings": a
  // token's realm grants only its own app's role, so of two roles only the realm's one counts.
  it("honours only the token's realm's role from a token holding two", async () => {
    const token = await tokenFor({ username: 'multi1', roles: ['customer', 'gate-agent'] });
    await as(ctx, token).get('/hello/customer').expect(200);
    await as(ctx, token).get('/hello/booth').expect(403);
    await as(ctx, token).get('/hello/admin').expect(403);
  });
});
