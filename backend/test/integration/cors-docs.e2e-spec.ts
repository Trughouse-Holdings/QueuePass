import { readFileSync } from 'node:fs';
import request from 'supertest';
import { CONTRACT_PATH, operations } from '../contract/expect-to-match-contract';
import { createTestApp, TestContext } from '../setup/test-app';

/** Spec 001 FR-024 (CORS only for the three front ends) and FR-027 (contract served at /docs). */
describe('CORS and API documentation', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it.each(['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'])(
    'allows the front-end origin %s',
    async (origin) => {
      const res = await request(ctx.app.getHttpServer())
        .get('/health')
        .set('Origin', origin)
        .expect(200);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
    },
  );

  it('does not grant any other origin', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/health')
      .set('Origin', 'http://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows a preflight that sends the Authorization header', async () => {
    const res = await request(ctx.app.getHttpServer())
      .options('/me')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-headers']?.toLowerCase()).toContain('authorization');
  });

  // Spec 007 found this gap: replaceLayout and updateSeating are the first PUTs, and a browser
  // refuses any method the preflight does not list, so the request never reaches the Backend.
  it.each([...new Set(operations.map((op) => op.method))])(
    'allows a preflight for %s, a method the contract uses',
    async (method) => {
      const res = await request(ctx.app.getHttpServer())
        .options('/me')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', method)
        .set('Access-Control-Request-Headers', 'authorization,content-type');
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-methods']?.split(',')).toContain(method);
    },
  );

  it('serves the API documentation at /docs without a token', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/docs/').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('serves the committed contract byte for byte', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/docs/openapi.yaml').expect(200);
    expect(res.text).toBe(readFileSync(CONTRACT_PATH, 'utf8'));
  });
});
