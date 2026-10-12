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

it('has no hook to force a light or dark set (FR-007)', () => {
  expect(css).not.toContain('data-theme');
});

it('never uses --text-faint for text (FR-008)', () => {
  expect(css).not.toMatch(/(^|[^-])color:\s*var\(--text-faint\)/m);
});
