import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Spec 038 FR-019, found in spec 039's walk (2026-11-14): a zoomed section's row labels are drawn
 * in map units (a seat is 2 apart, a label 1.6 high). Their halo, the map's background drawn
 * round each letter so a label reads over anything, was 3 units wide: wider than the gap to the
 * next row, so each label painted over its neighbors and only the last row drawn read whole. The
 * halo is now a share of the label's own size. jsdom lays nothing out, so the rule is checked.
 */
const theme = readFileSync(resolve(process.cwd(), 'src/web/theme.css'), 'utf8');

const rule = (css: string, selector: string): string =>
  css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

// The React Admin app's layout editor, and its row-label rule, were removed (import-only layouts).
describe('row labels in a zoomed section', () => {
  it.each([['the shared venue map', theme, '.venue-map__row-label']])(
    'in %s, have a halo sized by the label, not 3 map units',
    (_where, css, selector) => {
      const body = rule(css, selector);
      expect(body).toMatch(/stroke-width:\s*0?\.\d+em/);
      expect(body).not.toMatch(/stroke-width:\s*3px/);
    },
  );
});
