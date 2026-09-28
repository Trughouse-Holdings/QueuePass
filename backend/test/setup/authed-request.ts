import request from 'supertest';
import type { Test } from 'supertest';
import { expectToMatchContract, operations } from '../contract/expect-to-match-contract';
import type { TestContext } from './test-app';

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete' | 'options';

/** Finds the contract operation for a concrete request, e.g. PATCH /events/<uuid>. */
export function operationIdFor(method: string, url: string): string | undefined {
  const path = url.split('?')[0];
  return operations.find((op) => {
    if (op.method !== method.toUpperCase()) return false;
    const pattern = new RegExp(`^${op.path.replace(/\{[^}]+\}/g, '[^/]+')}$`);
    return pattern.test(path);
  })?.operationId;
}

export interface Client {
  get(url: string): Test;
  post(url: string): Test;
  patch(url: string): Test;
  put(url: string): Test;
  delete(url: string): Test;
  options(url: string): Test;
}

/**
 * Supertest with an optional bearer token, where EVERY response is also validated against
 * contracts/openapi.yaml (spec 001 FR-031). A request that matches no contract operation is
 * not validated: only /docs is outside the contract.
 */
function client(ctx: TestContext, token: string | undefined): Client {
  const server = ctx.app.getHttpServer();
  const make =
    (method: Method) =>
    (url: string): Test => {
      let t = request(server)[method](url);
      if (token !== undefined) t = t.set('Authorization', `Bearer ${token}`);
      const operationId = method === 'options' ? undefined : operationIdFor(method, url);
      if (operationId) t = t.expect((res) => expectToMatchContract(res, operationId));
      return t;
    };
  return {
    get: make('get'),
    post: make('post'),
    patch: make('patch'),
    put: make('put'),
    delete: make('delete'),
    options: make('options'),
  };
}

/** Requests as `admin1`. */
export const asAdmin = (ctx: TestContext): Client => client(ctx, ctx.adminToken);
/** Requests with the given raw token (sent as `Bearer <token>`). */
export const as = (ctx: TestContext, token: string): Client => client(ctx, token);
/** Requests with no Authorization header. */
export const anon = (ctx: TestContext): Client => client(ctx, undefined);
