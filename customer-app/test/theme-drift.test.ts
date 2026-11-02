import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { appDrift } from '../../packages/shared/test/theme/scan';

/**
 * Issue #37 (spec 012 FR-005; research R13): `npm test -w customer-app` on its own runs the shared
 * theme's drift scan over this app's stylesheets and screen code, as the root `npm test` does.
 */
it('defines no look of its own (spec 012 FR-005)', () => {
  // Vitest runs each workspace from its own folder (customer-app/).
  const scan = appDrift(resolve(process.cwd(), '..'), 'customer-app');
  expect(scan.stylesheets).toContain('customer-app/src/styles.css');
  expect(scan.screens.length).toBeGreaterThan(0);
  expect(scan.violations.map((v) => `${v.path}:${v.line} ${v.rule} ${v.text}`)).toEqual([]);
});
