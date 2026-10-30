import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Spec 012 FR-008 (research R7), moved from the Customer app (spec 008 FR-007): every text and
 * state color the shared theme uses meets WCAG 2.1 AA, in light and dark. Computed from the theme
 * itself, so a token change that breaks contrast fails here instead of being eyeballed.
 */
// Vitest runs each workspace from its own folder (packages/shared/).
const css = readFileSync(resolve(process.cwd(), 'src/web/theme.css'), 'utf8');

/** The custom properties in the first block matching `selector`. */
function tokens(selector: RegExp): Record<string, string> {
  const block = css.match(selector)?.[1] ?? '';
  return Object.fromEntries(
    [...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2]]),
  );
}

const light = tokens(/(?:^|\n):root\s*\{([^}]*)\}/);
// The dark set is `@media (prefers-color-scheme: dark) { :root { ... } }`, with no guard (R5).
const dark = {
  ...light,
  ...tokens(/prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/),
};

/** WCAG relative luminance of a #rrggbb color. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = ['text', 'text-muted', 'accent', 'danger', 'warn', 'ok'];
const BACKGROUNDS = ['surface', 'bg'];

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme', (_, t) => {
  it('defines every token the checks need', () => {
    for (const name of [
      ...TEXT,
      ...BACKGROUNDS,
      'accent-text',
      'border-strong',
      'accent-soft',
      'danger-bg',
      'warn-bg',
      'ok-bg',
      'surface-alt',
      'accent-hover',
    ]) {
      expect(t[name], name).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it.each(TEXT.flatMap((fg) => BACKGROUNDS.map((bg) => [fg, bg])))(
    'shows --%s text on --%s at 4.5:1 or more',
    (fg, bg) => {
      expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('shows button text on the accent color at 4.5:1 or more', () => {
    expect(contrast(t['accent-text'], t['accent'])).toBeGreaterThanOrEqual(4.5);
  });

  // Research R7: the pairs the shared controls show, each on its own background.
  it.each([
    ['accent', 'accent-soft'],
    ['danger', 'danger-bg'],
    ['warn', 'warn-bg'],
    ['ok', 'ok-bg'],
    ['text-muted', 'surface-alt'],
    // Links inside a warning or error banner, and primary button text on hover.
    ['accent', 'warn-bg'],
    ['accent', 'danger-bg'],
    ['accent-text', 'accent-hover'],
  ])('shows --%s text on --%s at 4.5:1 or more', (fg, bg) => {
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['border-strong', 'accent'])(
    'draws --%s control boundaries and states at 3:1 or more on --surface',
    (token) => {
      expect(contrast(t[token], t['surface'])).toBeGreaterThanOrEqual(3);
    },
  );

  it('draws --border-strong control boundaries at 3:1 or more on --bg', () => {
    expect(contrast(t['border-strong'], t['bg'])).toBeGreaterThanOrEqual(3);
  });
});

// Spec 021 research R5 (FR-006, FR-012): each sign-in accent set meets the rules the shared accent
// meets, in light and dark. The brand mark's "Q" is large bold decoration, so 3:1.
describe.each([
  ['light', light],
  ['dark', dark],
])('%s sign-in accents (spec 021)', (_, t) => {
  describe.each(['tickets', 'booth'])('%s', (app) => {
    /** The app's token for a shared role: --accent-hover → --accent-booth-hover, and so on. */
    const name = (role: string): string =>
      role.startsWith('accent') ? role.replace(/^accent/, `accent-${app}`) : `${role}-${app}`;
    const tok = (role: string): string => t[name(role)] ?? '';

    it('defines all six roles', () => {
      for (const role of [
        'accent',
        'accent-hover',
        'accent-soft',
        'accent-text',
        'brand-mark-end',
        'brand-mark-text',
      ]) {
        expect(tok(role), `--${name(role)}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    });

    it.each([
      ['accent-text', 'accent'],
      ['accent-text', 'accent-hover'],
      ['accent', 'accent-soft'],
    ])('shows --%s text on --%s at 4.5:1 or more', (fg, bg) => {
      expect(contrast(tok(fg), tok(bg))).toBeGreaterThanOrEqual(4.5);
    });

    it.each(['surface', 'bg'])('shows the accent as text on --%s at 4.5:1 or more', (bg) => {
      expect(contrast(tok('accent'), t[bg])).toBeGreaterThanOrEqual(4.5);
    });

    it.each(['accent', 'brand-mark-end'])(
      'shows the brand mark letter on --%s at 3:1 or more',
      (bg) => {
        expect(contrast(tok('brand-mark-text'), tok(bg))).toBeGreaterThanOrEqual(3);
      },
    );
  });
});

it('never uses --text-faint for text, since it is below 4.5:1', () => {
  expect(css).not.toMatch(/(^|[^-])color:\s*var\(--text-faint\)/m);
});

// Spec 014 research R13: the full-screen position label (--scrim-text) on the backdrop (--scrim,
// partly transparent), composited over the lightest and the darkest page behind it.
describe('the image scrim', () => {
  const start = css.indexOf(':root {');
  const root = css.slice(start, css.indexOf('}', start));
  /** A token of the light set, whatever its notation. */
  const value = (name: string) => root.split(`--${name}:`)[1]?.split(';')[0]?.trim() ?? '';
  const hex = (r: number, g: number, b: number) =>
    `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
  /** `rgb(r g b / a%)` over an opaque `#rrggbb`. */
  function over(rgba: string, under: string): string {
    const m = rgba.match(/^rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)$/);
    if (!m) throw new Error(`not rgb(r g b / a%): ${rgba}`);
    const a = Number(m[4]) / 100;
    const base = [1, 3, 5].map((i) => parseInt(under.slice(i, i + 2), 16));
    const top = [m[1], m[2], m[3]].map(Number);
    return hex(...(top.map((c, i) => a * c + (1 - a) * base[i]!) as [number, number, number]));
  }

  it.each(['#ffffff', '#000000'])(
    'shows --scrim-text on --scrim over %s at 4.5:1 or more',
    (under) => {
      expect(contrast(value('scrim-text'), over(value('scrim'), under))).toBeGreaterThanOrEqual(
        4.5,
      );
    },
  );
});
