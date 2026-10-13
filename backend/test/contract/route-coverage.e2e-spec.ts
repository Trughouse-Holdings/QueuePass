import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../src/auth/public.decorator';
import { ROLES_KEY } from '../../src/auth/roles.decorator';
import { createTestApp, TestContext } from '../setup/test-app';
import { operations } from './expect-to-match-contract';

/**
 * Spec 001 FR-027, SC-009 — every route is in the contract and every contract operation is a
 * route, with identical role requirements. Catches an undocumented endpoint or a missing @Roles.
 */
describe('Contract route and role coverage', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  function routes(): Map<string, 'public' | string[]> {
    const discovery = ctx.app.get(DiscoveryService);
    const scanner = ctx.app.get(MetadataScanner);
    const reflector = ctx.app.get(Reflector);
    const found = new Map<string, 'public' | string[]>();

    for (const wrapper of discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, metatype) ?? '');
      for (const name of scanner.getAllMethodNames(Object.getPrototypeOf(instance))) {
        const handler = instance[name];
        const sub = Reflect.getMetadata(PATH_METADATA, handler);
        if (sub === undefined) continue;
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
        const path = `/${[base, String(sub)]
          .map((p) => p.replace(/^\/|\/$/g, ''))
          .filter(Boolean)
          .join('/')}`.replace(/:(\w+)/g, '{$1}');
        const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, metatype]);
        const roles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [handler, metatype]) ?? [];
        found.set(`${method} ${path}`, isPublic ? 'public' : [...roles].sort());
      }
    }
    return found;
  }

  /**
   * Spec 014 research R8: an operation marked `x-planned` is declared in its feature's spec and
   * plan PR, before the implementation, so `main` stays green between the two PRs. It is skipped
   * only while no route serves it; once served, its roles are checked like any other.
   */
  const awaitingRoute = (op: (typeof operations)[number], actual: Map<string, unknown>): boolean =>
    op.planned !== undefined && !actual.has(`${op.method} ${op.path}`);

  it('has exactly the operations the contract declares', () => {
    const found = routes();
    const actual = [...found.keys()].sort();
    const declared = operations.map((o) => `${o.method} ${o.path}`).sort();
    const planned = operations
      .filter((o) => awaitingRoute(o, found))
      .map((o) => `${o.method} ${o.path}`);
    expect({
      undocumented: actual.filter((r) => !declared.includes(r)),
      unimplemented: declared.filter((d) => !actual.includes(d) && !planned.includes(d)),
    }).toEqual({ undocumented: [], unimplemented: [] });
  });

  it('enforces exactly the roles the contract declares for each operation', () => {
    const actual = routes();
    for (const op of operations) {
      if (awaitingRoute(op, actual)) continue;
      const expected = op.requiredRoles === 'public' ? 'public' : [...op.requiredRoles].sort();
      expect({ op: op.operationId, roles: actual.get(`${op.method} ${op.path}`) }).toEqual({
        op: op.operationId,
        roles: expected,
      });
    }
  });
});
