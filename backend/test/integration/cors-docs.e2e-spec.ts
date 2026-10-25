import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
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

  // Spec 014 research R4: a rotating gallery reads an image every few seconds, so browsers may
  // cache each preflight for 10 minutes instead of about 5 seconds.
  it('lets an allowed origin cache a preflight for 600 seconds', async () => {
    const res = await request(ctx.app.getHttpServer())
      .options(
        '/events/7c2f1b5e-1f3a-4f9e-9a2d-0c9b1d2e3f40/images/0f8f7a8e-5a39-4c1e-9b7e-2d3c4b5a6f70',
      )
      .set('Origin', 'http://localhost:5174')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-max-age']).toBe('600');
  });

  it('still grants a preflight from any other origin nothing', async () => {
    const res = await request(ctx.app.getHttpServer())
      .options('/me')
      .set('Origin', 'http://evil.example')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization');
    // The grant is Access-Control-Allow-Origin; without it a browser refuses the request. (The
    // `cors` middleware still lists its methods and headers, as it did before this feature.)
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
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
    // Issue #86: fetched over a kept-alive connection. Supertest asks for Connection: close, and
    // Node's HTTP server on Windows sometimes resets the socket when it closes right after this
    // ~140 KB body (about 4 in 100 under repeated runs); fetch keeps the connection open.
    const { port } = ctx.app.getHttpServer().address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/docs/openapi.yaml`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/yaml/);
    expect(Buffer.from(await res.arrayBuffer()).equals(readFileSync(CONTRACT_PATH))).toBe(true);
  });
});
