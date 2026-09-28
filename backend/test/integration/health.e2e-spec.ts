import { anon } from '../setup/authed-request';
import { createTestApp, TestContext } from '../setup/test-app';

describe('GET /health', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('reports ok with a live database round trip', async () => {
    const res = await anon(ctx).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });
});
