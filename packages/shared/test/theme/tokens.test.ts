import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Spec 012 FR-001, FR-007, FR-008 (research R3, R5, R10; data-model.md): the theme holds one
 * light and one dark set of every token, with the documented values, and the shared rules that
 * spec 008's "shared detail layout" test used to compare between the two apps.
 */
// Vitest runs each workspace from its own folder (packages/shared/).
const css = readFileSync(resolve(process.cwd(), 'src/web/theme.css'), 'utf8');

/** `--name: value` pairs inside the first `{ ... }` body matched by `selector`. */
function tokens(selector: RegExp): Record<string, string> {
  const body = css.match(selector)?.[1] ?? '';
  return Object.fromEntries(
    [...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/gi)].map((m) => [
      m[1],
      m[2].replace(/\s+/g, ' ').trim(),
    ]),
  );
}

const light = tokens(/(?:^|\n):root\s*\{([^}]*)\}/);
const dark = tokens(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/);

// data-model.md: colors, light and dark.
const COLORS: Record<string, [string, string]> = {
  bg: ['#f6f7f9', '#0f1115'],
  surface: ['#ffffff', '#171a21'],
  'surface-alt': ['#fafbfc', '#1c2029'],
  border: ['#e3e6ea', '#272c36'],
  'border-strong': ['#868e99', '#6f7887'],
  text: ['#16191d', '#e8eaed'],
  'text-muted': ['#656d78', '#9aa3b0'],
  'text-faint': ['#8b939d', '#6f7887'],
  accent: ['#4f46e5', '#8b85f5'],
  'accent-hover': ['#4338ca', '#a29bff'],
  'accent-soft': ['#eef2ff', '#1e1b4b'],
  'accent-text': ['#ffffff', '#0f1115'],
  danger: ['#b42318', '#fda29b'],
  'danger-bg': ['#fef3f2', '#2a1513'],
  'danger-border': ['#fda29b', '#7a271a'],
  warn: ['#b54708', '#fdb022'],
  'warn-bg': ['#fffaeb', '#2b1c0b'],
  'warn-border': ['#fdb022', '#93370d'],
  ok: ['#067647', '#75e0a7'],
  'ok-bg': ['#ecfdf3', '#0d2a1c'],
  'ok-border': ['#75e0a7', '#085d3a'],
  'brand-mark-end': ['#7c6cf7', '#7c6cf7'],
  'brand-mark-text': ['#ffffff', '#ffffff'],
};

// data-model.md: typefaces, shape, and spacing, the same in light and dark (shadows aside).
const FIXED: Record<string, string> = {
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
  radius: '10px',
  'radius-sm': '7px',
  'radius-pill': '99px',
  'space-1': '4px',
  'space-2': '8px',
  'space-3': '12px',
  'space-4': '16px',
  'space-5': '20px',
  'space-6': '24px',
  'space-8': '32px',
};

// Today's shadows, unchanged.
const SHADOWS: Record<string, [string, string]> = {
  shadow: [
    '0 1px 2px rgb(16 24 40 / 6%), 0 1px 3px rgb(16 24 40 / 8%)',
    '0 1px 3px rgb(0 0 0 / 40%)',
  ],
  'shadow-lg': [
    '0 4px 8px -2px rgb(16 24 40 / 8%), 0 2px 4px -2px rgb(16 24 40 / 6%)',
    '0 6px 16px -4px rgb(0 0 0 / 50%)',
  ],
};

describe('the light set', () => {
  it.each(Object.entries(COLORS))('defines --%s', (name, [value]) => {
    expect(light[name]).toBe(value);
  });
  it.each(Object.entries(FIXED))('defines --%s', (name, value) => {
    expect(light[name]).toBe(value);
  });
  it.each(Object.entries(SHADOWS))('defines --%s', (name, [value]) => {
    expect(light[name]).toBe(value);
  });
});

describe('the dark set', () => {
  it('redefines every color token of the light set', () => {
    const lightColors = Object.entries(light)
      .filter(([, v]) => /^#[0-9a-f]{3,8}$/i.test(v))
      .map(([k]) => k);
    expect(lightColors.length).toBeGreaterThan(0);
    for (const name of lightColors) expect(dark[name], name).toBeDefined();
  });
  it.each(Object.entries(COLORS))('defines --%s', (name, [, value]) => {
    expect(dark[name]).toBe(value);
  });
  it.each(Object.entries(SHADOWS))('defines --%s', (name, [, value]) => {
    expect(dark[name]).toBe(value);
  });
});

// Moved from customer-app/test/shared-look.test.ts (spec 008 US4): the block now exists once.
describe('shared detail layout', () => {
  it.each([
    ['links in the accent color', /:where\(a[^{]*\{[^}]*color:\s*var\(--accent\)/],
    ['buttons with a background by default', /\.btn:not[^{]*\{[^}]*background:/],
    ['the top bar button', /\.topbar button/],
    ['label/value lists as a grid', /(^|\n)dl\s*\{[^}]*display:\s*grid/],
    ['muted labels', /(^|\n)dt\s*\{[^}]*color:\s*var\(--text-muted\)/],
    ['spacing inside cards', /\.card[^{,]*> :/],
    ['spacing between cards', /\.card \+ \.card/],
    ['page-head actions without the form rule', /\.page-head \.form__actions/],
  ])('has %s', (_, rule) => {
    expect(css).toMatch(rule);
  });
});

it('keeps a small gap above a button inside a banner body (FR-012)', () => {
  expect(css).toMatch(/\.banner__body > \.btn\s*\{[^}]*margin-top:\s*var\(--space-2\)/);
});

it('gives no single child of a button row its own top margin, so the buttons line up', () => {
  // Any selector reaching into .form__actions for one child (> :first-child, > .btn, + ...).
  const offsets = [...css.matchAll(/([^{}]*\.form__actions[^{}]*[>+~:][^{}]*)\{([^}]*)\}/g)]
    .filter(([, , body]) => /margin(-top)?\s*:/.test(body))
    .map(([, selector]) => selector.trim());
  expect(offsets).toEqual([]);
});

it('has no hook to force a light or dark set (FR-007)', () => {
  expect(css).not.toContain('data-theme');
});

it('never uses --text-faint for text (FR-008)', () => {
  expect(css).not.toMatch(/(^|[^-])color:\s*var\(--text-faint\)/m);
});

// Spec 014 research R13: the full-screen backdrop and its text, dark in both sets.
describe('the image scrim tokens (spec 014)', () => {
  it.each(['scrim', 'scrim-text'])('defines --%s in both sets with the same value', (name) => {
    expect(light[name]).toBeDefined();
    expect(dark[name]).toBe(light[name]);
  });

  it("writes --scrim in the theme's rgb(… / %) style", () => {
    expect(light['scrim']).toMatch(/^rgb\(\d+ \d+ \d+ \/ \d+%\)$/);
  });
});

/** The bodies of every innermost rule in `source` whose selector is exactly `selector`. */
function bodiesOf(source: string, selector: string): string[] {
  return [...source.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .filter(([, sel]) => sel!.replace(/\/\*[\s\S]*?\*\//g, '').trim() === selector)
    .map(([, , body]) => body!);
}

/** The contents of every `@media (max-width: 640px)` block. */
function narrowBlocks(): string {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf('@media (max-width: 640px)', from);
    if (at < 0) break;
    const open = css.indexOf('{', at);
    let depth = 1;
    let i = open + 1;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
    }
    out.push(css.slice(open + 1, i - 1));
    from = i;
  }
  return out.join('\n');
}

/** The top-level rules, outside any at-rule. */
function topLevel(): string {
  let depth = 0;
  let inAt = 0;
  let out = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i]!;
    if (c === '@' && depth === 0) inAt = 1;
    if (c === '{') depth++;
    if (inAt === 0) out += c;
    if (c === '}') {
      depth--;
      if (depth === 0 && inAt) inAt = 0;
    }
  }
  return out;
}

describe('the event page band (spec 014 research R13)', () => {
  it('sets overflow on .app only where a page band is shown', () => {
    const rules = [...css.matchAll(/([^{}]*\.app\b[^{}]*)\{([^}]*)\}/g)]
      .filter(([, , body]) => /overflow/.test(body!))
      .map(([, selector]) => selector!.replace(/\/\*[\s\S]*?\*\//g, '').trim());
    expect(rules).toEqual(['.app:has(.page-band)']);
    expect(bodiesOf(css, '.app:has(.page-band)')[0]).toMatch(/overflow-x:\s*clip/);
  });

  const topPadding = (body: string) => body.match(/padding:\s*(\d+)px/)?.[1];
  const bandMargin = (body: string) => body.match(/margin-top:\s*-(\d+)px/)?.[1];

  it.each([
    ['outside the 640-pixel breakpoint', () => topLevel(), '32'],
    ['inside the 640-pixel breakpoint', () => narrowBlocks(), '22'],
  ])('pulls the band up by exactly .main top padding %s', (_, source, today) => {
    const main = bodiesOf(source(), '.main');
    const band = bodiesOf(source(), '.page-band').filter((b) => /margin-top/.test(b));
    expect(main).toHaveLength(1);
    expect(band).toHaveLength(1);
    expect(bandMargin(band[0]!)).toBe(topPadding(main[0]!));
    expect(topPadding(main[0]!)).toBe(today);
  });
});

// Spec 014 FR-040 (research R11): the 400 ms slide between images, as transforms only, and none
// under reduced motion.
describe('the gallery slide (spec 014 FR-040)', () => {
  const SLIDES = ['out-left', 'in-left', 'out-right', 'in-right'];

  /** The `@keyframes name { … }` block, nested braces included. */
  function keyframes(name: string): string | undefined {
    const at = css.search(new RegExp(`@keyframes\\s+${name}\\s*\\{`));
    return at < 0 ? undefined : atRuleBody(at);
  }

  /** The body of the at-rule starting at `at`, nested braces included. */
  function atRuleBody(at: number): string {
    const open = css.indexOf('{', at);
    let depth = 1;
    let i = open + 1;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
    }
    return css.slice(open + 1, i - 1);
  }

  it.each(SLIDES)(
    'animates .gallery__slide--%s over 400 ms with keyframes that move it by transform only',
    (slide) => {
      const body = bodiesOf(topLevel(), `.gallery__slide--${slide}`).join('\n');
      const animation = body.match(/animation:\s*([a-z-]+)\s+([^;]+);/i);
      expect(animation, `.gallery__slide--${slide} sets an animation`).not.toBeNull();
      expect(animation![2]).toMatch(/\b400ms\b/);
      const frames = keyframes(animation![1]!);
      expect(frames, `@keyframes ${animation![1]}`).toBeDefined();
      const properties = [...frames!.matchAll(/([a-z-]+)\s*:/gi)].map((m) => m[1]);
      expect(properties.length).toBeGreaterThan(0);
      expect(new Set(properties)).toEqual(new Set(['transform']));
    },
  );

  it('uses four different keyframes', () => {
    const names = SLIDES.map(
      (slide) =>
        bodiesOf(topLevel(), `.gallery__slide--${slide}`)
          .join('\n')
          .match(/animation:\s*([a-z-]+)/i)?.[1],
    );
    expect(new Set(names).size).toBe(4);
  });

  it('turns every slide off under reduced motion', () => {
    const at = css.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(at).toBeGreaterThanOrEqual(0);
    const block = atRuleBody(at);
    const rule = [...block.matchAll(/([^{}]*)\{([^{}]*)\}/g)].find(([, sel]) =>
      SLIDES.every((slide) => sel!.includes(`.gallery__slide--${slide}`)),
    );
    expect(rule, 'one rule naming the four slide classes').toBeDefined();
    expect(rule![2]).toMatch(/animation:\s*none/);
  });
});

// Spec 014 FR-028 (spec 008 FR-009): the gallery clips what lies outside it, and the full-screen
// image button fills it, so that button draws its focus ring inside its own box.
describe('the gallery focus ring (spec 014 FR-028)', () => {
  it('draws the full-screen image button ring inside the clipped gallery', () => {
    const ring = bodiesOf(topLevel(), ':focus-visible')[0]?.match(/outline:\s*(\d+)px/)?.[1];
    const width = Number(ring);
    expect(width).toBeGreaterThan(0);
    const offset = bodiesOf(topLevel(), '.gallery__open:focus-visible')
      .join('\n')
      .match(/outline-offset:\s*(-?\d+)px/)?.[1];
    expect(offset, '.gallery__open:focus-visible sets outline-offset').toBeDefined();
    expect(Number(offset)).toBeLessThanOrEqual(-width);
  });
});

// Spec 014 FR-029 (research R12, R13): the full-screen view covers the window on the scrim, and
// the page behind does not scroll while it is open.
describe('the full-screen view (spec 014 FR-029)', () => {
  it('covers the whole window on --scrim, above the top bar', () => {
    const body = bodiesOf(topLevel(), '.viewer').join('\n');
    expect(body).toMatch(/position:\s*fixed/);
    expect(body).toMatch(/inset:\s*0/);
    expect(body).toMatch(/background:\s*var\(--scrim\)/);
    expect(body).toMatch(/z-index:\s*\d+/);
  });

  it('shows the whole picture', () => {
    expect(bodiesOf(topLevel(), '.viewer__image').join('\n')).toMatch(/object-fit:\s*contain/);
  });

  it('keeps the page behind from scrolling', () => {
    expect(bodiesOf(topLevel(), '.viewer-open').join('\n')).toMatch(/overflow:\s*hidden/);
  });

  it('writes the position in --scrim-text', () => {
    expect(bodiesOf(topLevel(), '.viewer__count').join('\n')).toMatch(
      /color:\s*var\(--scrim-text\)/,
    );
  });
});

// Spec 014 FR-041, FR-042 (research R18, issue #73): every picture whole, never cropped, and the
// gallery's box changing height with the slide, at once under reduced motion.
describe('whole pictures (spec 014 FR-041, FR-042)', () => {
  /** The bodies of every top-level rule whose selector list names `selector`. */
  const rulesNaming = (selector: string): string[] =>
    [...topLevel().matchAll(/([^{}]*)\{([^{}]*)\}/g)]
      .filter(([, sel]) =>
        sel!
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .split(',')
          .some((s) => s.trim() === selector),
      )
      .map(([, , body]) => body!);

  it.each(['.gallery__image', '.viewer__image'])(
    'shows %s whole with object-fit: contain',
    (sel) => {
      expect(rulesNaming(sel).join('\n')).toMatch(/object-fit:\s*contain/);
    },
  );

  it('crops nothing anywhere: no object-fit: cover in the theme', () => {
    expect(css).not.toMatch(/object-fit:\s*cover/);
  });

  it('changes the height over 0.4 seconds with the slide, only on a change of shape (review I8)', () => {
    const slideCurve = bodiesOf(topLevel(), '.gallery__slide--in-left')
      .join('\n')
      .match(/animation:\s*[a-z-]+\s+400ms\s+([a-z-]+)/i)?.[1];
    expect(slideCurve).toBeDefined();
    const transition = bodiesOf(topLevel(), '.gallery--reshaping')
      .join('\n')
      .match(/transition:\s*([^;]+);/)?.[1];
    expect(transition, '.gallery--reshaping sets a transition').toBeDefined();
    const [property, duration, curve] = transition!.trim().split(/\s+/);
    expect(property).toBe('height');
    expect(['0.4s', '400ms']).toContain(duration);
    expect(curve).toBe(slideCurve);
    // A resize alone follows the window at once.
    expect(bodiesOf(topLevel(), '.gallery').join('\n')).not.toMatch(/transition/);
  });

  it('changes the height at once under reduced motion', () => {
    const at = css.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(at).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', at);
    let depth = 1;
    let i = open + 1;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
    }
    expect(bodiesOf(css.slice(open + 1, i - 1), '.gallery--reshaping').join('\n')).toMatch(
      /transition:\s*none/,
    );
  });

  it('keeps the card at 4:3 only until it has measured itself (review I1)', () => {
    const ratios = [...topLevel().matchAll(/([^{}]*)\{([^{}]*)\}/g)]
      .filter(([sel, , body]) => /\.gallery/.test(sel!) && /aspect-ratio/.test(body!))
      .map(([sel, , body]) => [
        sel!.replace(/\/\*[\s\S]*?\*\//g, '').trim(),
        body!.match(/aspect-ratio:\s*([^;]+);/)![1]!.trim(),
      ]);
    expect(ratios).toEqual([['.gallery--card:not(.gallery--measured)', '4 / 3']]);
  });

  it('never makes a card shorter than 160 pixels, so its controls never overlap (review S1)', () => {
    expect(bodiesOf(topLevel(), '.gallery--card').join('\n')).toMatch(/min-height:\s*160px/);
  });

  it('has a hidden probe of the small viewport height (review S4)', () => {
    const body = bodiesOf(topLevel(), '.viewport-probe').join('\n');
    expect(body).toMatch(/height:\s*100svh/);
    expect(body).toMatch(/position:\s*fixed/);
    expect(body).toMatch(/visibility:\s*hidden/);
  });
});
