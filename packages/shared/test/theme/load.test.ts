import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Spec 012 FR-003, FR-014 (research R1, R10): the shared package exports one theme, and every
 * app resolves and loads that same file, before its own stylesheet. Spec 017 FR-022: the Booth
 * app, a stub when spec 012 kept it bare (its FR-015), now has functionality and adopts the
 * theme (Constitution VII).
 */
// Vitest runs each workspace from its own folder (packages/shared/).
const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

// Whole lines only, so a commented-out import does not count.
const THEME_IMPORT = /^import '@queuepass\/shared\/theme\.css';$/m;
const OWN_IMPORT = /^import '\.\/styles\.css';$/m;

describe('the shared package', () => {
  it('exports the theme file, and the file exists', () => {
    const pkg = JSON.parse(read('package.json')) as { exports: Record<string, unknown> };
    expect(pkg.exports['./theme.css']).toBe('./src/web/theme.css');
    expect(existsSync(resolve(process.cwd(), 'src/web/theme.css'))).toBe(true);
  });
});

describe.each(['admin-app', 'customer-app', 'booth-app'])('%s', (app) => {
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
    const theme = main.search(THEME_IMPORT);
    const own = main.search(OWN_IMPORT);
    expect(theme, `${app}/src/main.tsx imports the theme`).toBeGreaterThan(-1);
    expect(own, `${app}/src/main.tsx imports its own stylesheet`).toBeGreaterThan(-1);
    expect(theme).toBeLessThan(own);
  });
});

it('ignores a commented-out import', () => {
  expect("// import '@queuepass/shared/theme.css';".search(THEME_IMPORT)).toBe(-1);
  expect("// import './styles.css';".search(OWN_IMPORT)).toBe(-1);
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
