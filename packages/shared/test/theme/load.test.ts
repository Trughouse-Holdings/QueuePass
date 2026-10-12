import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Spec 012 FR-003, FR-014, FR-015 (research R1, R10): the shared package exports one theme, and
 * the Admin and Customer apps resolve and load that same file, before their own stylesheet. The
 * Booth app does not load it.
 */
// Vitest runs each workspace from its own folder (packages/shared/).
const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

const THEME_IMPORT = "import '@queuepass/shared/theme.css';";
const OWN_IMPORT = "import './styles.css';";

describe('the shared package', () => {
  it('exports the theme file, and the file exists', () => {
    const pkg = JSON.parse(read('package.json')) as { exports: Record<string, unknown> };
    expect(pkg.exports['./theme.css']).toBe('./src/web/theme.css');
    expect(existsSync(resolve(process.cwd(), 'src/web/theme.css'))).toBe(true);
  });
});

describe.each(['admin-app', 'customer-app'])('%s', (app) => {
  it.each(['vite.config.ts', 'vitest.config.ts'])(
    'aliases the theme to the shared file in %s',
    (config) => {
      const text = read(`../../${app}/${config}`);
      expect(text).toContain(
        "{ find: /^@queuepass\\/shared\\/theme\\.css$/, replacement: shared('web/theme.css') }",
      );
    },
  );

  it('imports the theme before its own stylesheet', () => {
    const main = read(`../../${app}/src/main.tsx`);
    const theme = main.indexOf(THEME_IMPORT);
    const own = main.indexOf(OWN_IMPORT);
    expect(theme, `${app}/src/main.tsx imports the theme`).toBeGreaterThan(-1);
    expect(own, `${app}/src/main.tsx imports its own stylesheet`).toBeGreaterThan(-1);
    expect(theme).toBeLessThan(own);
  });
});

it('the Booth app does not load the theme (FR-015)', () => {
  expect(read('../../booth-app/src/main.tsx')).not.toContain('@queuepass/shared/theme.css');
});

// SC-003 (research R10): with both apps resolving the same file and no app defining a token
// (drift.test.ts, C1), a change to the accent is one edit, in the theme.
it('defines --accent in the theme file only', () => {
  const root = resolve(process.cwd(), '../..');
  const defining = ['admin-app/src', 'customer-app/src', 'booth-app/src', 'packages/shared/src']
    .flatMap((dir) =>
      (readdirSync(resolve(root, dir), { recursive: true }) as string[])
        .filter((f) => f.endsWith('.css'))
        .map((f) => relative(root, resolve(root, dir, f)).replace(/\\/g, '/')),
    )
    .filter((f) => /--accent\s*:/.test(readFileSync(resolve(root, f), 'utf8')));
  expect(defining).toEqual(['packages/shared/src/web/theme.css']);
});
