import { describe, it, expect } from 'vitest';
import type { TestInfo } from '@playwright/test';
// Spec 040 (research R13, tasks T027): the browser tests' account ranges. The e2e folder has no
// unit runner of its own, so its pure fixture is checked here, beside realms.test.ts' check of
// its realm table copy.
import {
  APPS,
  CUSTOMER_RUST_PROJECT,
  adminFor,
  agentFor,
  customerFor,
} from '../../../e2e/fixtures/apps';

const info = (project: string, parallelIndex: number): TestInfo =>
  ({ project: { name: project }, parallelIndex }) as unknown as TestInfo;

const range = (project: string): string[] =>
  [0, 1, 2].flatMap((slot) =>
    Array.from({ length: 20 }, (_, n) => customerFor(info(project, slot), n)),
  );

describe("the browser tests' apps and accounts (spec 040)", () => {
  it('lists the Rust Customer app on 5177, a customer app named for its sign-in page', () => {
    expect(APPS['customer-rust']).toEqual({
      url: 'http://localhost:5177',
      name: 'QueuePass Tickets (Rust)',
      role: 'customer',
    });
    expect(CUSTOMER_RUST_PROJECT).toBe('customer-rust');
  });

  it('gives the chromium and admin-rust projects customer100 to customer159, as before', () => {
    for (const project of ['chromium', 'admin-rust']) {
      expect(range(project)).toEqual(Array.from({ length: 60 }, (_, i) => `customer${100 + i}`));
    }
  });

  it('gives the customer-rust project customer40 to customer99, disjoint from the others', () => {
    const rust = range('customer-rust');
    expect(rust).toEqual(Array.from({ length: 60 }, (_, i) => `customer${40 + i}`));
    expect(rust.filter((u) => range('chromium').includes(u))).toEqual([]);
  });

  it('keeps the admin and agent accounts per worker, whatever the project', () => {
    expect(adminFor(info('customer-rust', 1))).toBe(adminFor(info('chromium', 1)));
    expect(agentFor(info('customer-rust', 2), 4)).toBe(agentFor(info('chromium', 2), 4));
  });

  it('refuses a fourth worker and an index outside 0 to 19', () => {
    expect(() => customerFor(info('customer-rust', 3))).toThrow(/at most 3 workers/);
    expect(() => customerFor(info('customer-rust', 0), 20)).toThrow(/0 to 19/);
  });
});
