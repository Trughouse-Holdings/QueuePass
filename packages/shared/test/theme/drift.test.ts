import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  colorLiteralViolations,
  cssViolations,
  inlineStyleViolations,
  type Violation,
} from './check-theme';

/**
 * Spec 012 US2 (FR-005, FR-006, FR-015, SC-001, SC-005; research R6): no app defines its own
 * look. The checker is proved rule by rule on small inputs, then run over every app stylesheet
 * and every inline style, and over the theme outside its token blocks.
 */
// Vitest runs each workspace from its own folder (packages/shared/).
const ROOT = resolve(process.cwd(), '../..');

/** `rule line text` for each violation, so a failure reads like the scan's output. */
const brief = (vs: Violation[]): string[] => vs.map((v) => `${v.rule} ${v.line} ${v.text}`);
const css = (body: string): string[] => brief(cssViolations('test.css', body));
const tsx = (body: string): string[] => brief(inlineStyleViolations('test.tsx', body));

describe('the checker (FR-006)', () => {
  it('C1: reports a theme value defined in an app', () => {
    expect(css('.a {\n  --accent: #000;\n}')).toEqual(['C1 2 --accent: #000']);
  });

  it.each([
    ['#abc'],
    ['#a1b2c3'],
    ['rgb(0 0 0)'],
    ['rgba(0,0,0,.5)'],
    ['hsl(0 0% 0%)'],
    ['oklch(0.5 0.1 200)'],
    ['red'],
  ])('C2: reports a color written out: %s', (value) => {
    expect(css(`.a {\n  color: ${value};\n}`)).toEqual([`C2 2 color: ${value}`]);
  });

  it('C2: reports a color written out inside @media', () => {
    expect(css('@media (max-width: 640px) {\n  .a {\n    background: #fff;\n  }\n}')).toEqual([
      'C2 3 background: #fff',
    ]);
  });

  it.each([['font-family: serif'], ['font: 14px serif']])('C3: reports %s', (decl) => {
    expect(css(`.a {\n  ${decl};\n}`)).toEqual([`C3 2 ${decl}`]);
  });

  it.each([
    ['border-radius: 6px'],
    ['box-shadow: 0 1px 2px var(--border)'],
    ['border-radius: 0 6px 6px 0'],
  ])('C4: reports %s', (decl) => {
    expect(css(`.a {\n  ${decl};\n}`)).toEqual([`C4 2 ${decl}`]);
  });

  it.each([['padding: 18px'], ['margin: 4px 0 0'], ['gap: 6px']])('C5: reports %s', (decl) => {
    expect(css(`.a {\n  ${decl};\n}`)).toEqual([`C5 2 ${decl}`]);
  });

  it('C6: reports the faintest gray used for text', () => {
    expect(css('.a {\n  color: var(--text-faint);\n}')).toEqual(['C6 2 color: var(--text-faint)']);
  });

  it.each([
    ["style={{ color: 'red' }}", "color: 'red'"],
    ["style={{ fontFamily: 'serif' }}", "fontFamily: 'serif'"],
  ])('inline: reports %s', (code, text) => {
    expect(tsx(`export const A = () => (\n  <p ${code}>x</p>\n);`)).toEqual([`inline 2 ${text}`]);
  });

  it('accepts theme values and properties it does not check', () => {
    const allowed = [
      '.a {',
      '  color: var(--accent);',
      '  border-color: transparent;',
      '  outline-color: currentcolor;',
      '  background: inherit;',
      '  background-color: color-mix(in srgb, var(--accent) 18%, transparent);',
      '  padding: 0 var(--space-4);',
      '  margin: calc(-1 * var(--space-2)) 0 var(--space-5);',
      '  gap: var(--space-1);',
      '  border-radius: var(--radius-sm);',
      '}',
      '.b {',
      '  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;',
      '  font-family: var(--mono);',
      '  font: inherit;',
      '  width: 44px;',
      '  font-size: 13px;',
      '  white-space: nowrap;',
      '  content: "red";',
      '  grid-template-areas: "tan";',
      '}',
      '/* a comment with #fff is ignored */',
    ].join('\n');
    expect(css(allowed)).toEqual([]);
    expect(tsx("export const A = () => <span style={{ width: '40%' }} />;")).toEqual([]);
  });

  it('keeps line numbers past a comment', () => {
    expect(css('/* one\n   two #fff */\n.a {\n  color: #000;\n}')).toEqual(['C2 4 color: #000']);
  });
});

// Review round 1: declarations at any depth, the full property families, and defined tokens only.
describe('the checker, wider coverage (FR-005, FR-006)', () => {
  it('reads declarations in a rule that also holds a nested rule', () => {
    expect(css('.a {\n  color: #fff;\n  &:hover {\n    color: var(--accent);\n  }\n}')).toEqual([
      'C2 2 color: #fff',
    ]);
    expect(css('.a {\n  &:hover {\n    color: red;\n  }\n  margin: 6px;\n}')).toEqual([
      'C2 3 color: red',
      'C5 5 margin: 6px',
    ]);
  });

  it.each([
    ['background-image: linear-gradient(red, var(--surface))'],
    ['text-shadow: 0 0 2px red'],
    ['filter: drop-shadow(0 0 2px red)'],
    ['scrollbar-color: red var(--surface)'],
    ['-webkit-tap-highlight-color: red'],
  ])('C2: reports a named color in %s', (decl) => {
    expect(css(`.a {\n  ${decl};\n}`)).toEqual([`C2 2 ${decl}`]);
  });

  it.each([
    ['border-top-left-radius: 6px'],
    ['text-shadow: 0 1px 2px var(--border)'],
    ['border-radius: var(--radius-xl)'],
    ['box-shadow: var(--accent)'],
  ])('C4: reports %s', (decl) => {
    expect(css(`.a {\n  ${decl};\n}`)).toEqual([`C4 2 ${decl}`]);
  });

  it.each([
    ['grid-gap: 6px'],
    ['grid-row-gap: 6px'],
    ['grid-column-gap: 6px'],
    ['row-gap: 6px'],
    ['scroll-margin-top: 6px'],
    ['scroll-padding: 6px'],
    ['padding: var(--space-7)'],
    ['margin: calc(-1 * var(--space-99))'],
  ])('C5: reports %s', (decl) => {
    expect(css(`.a {\n  ${decl};\n}`)).toEqual([`C5 2 ${decl}`]);
  });

  it('C3: reports a typeface token the theme does not define', () => {
    expect(css('.a {\n  font-family: var(--serif);\n}')).toEqual([
      'C3 2 font-family: var(--serif)',
    ]);
  });

  it('accepts every defined step, radius, and shadow token', () => {
    const ok = [
      '.a {',
      '  padding: var(--space-1) var(--space-2) var(--space-3) var(--space-4);',
      '  margin: var(--space-5) var(--space-6) var(--space-8) calc(-1 * var(--space-8));',
      '  grid-gap: var(--space-2);',
      '  scroll-margin-top: var(--space-4);',
      '  border-radius: var(--radius) var(--radius-sm) var(--radius-pill) 0;',
      '  border-top-left-radius: var(--radius-sm);',
      '  box-shadow: var(--shadow), var(--shadow-lg);',
      '  text-shadow: none;',
      '  font-family: var(--font);',
      '  background-image: linear-gradient(var(--accent-soft), var(--surface) 70%);',
      '}',
    ].join('\n');
    expect(css(ok)).toEqual([]);
  });

  it.each([
    ["style={{ border: '1px solid red' }}", ["inline 2 border: '1px solid red'"]],
    [
      "style={{ outline: '2px solid #f00', font: '14px serif' }}",
      ["inline 2 outline: '2px solid #f00'", "inline 2 font: '14px serif'"],
    ],
    [
      'style={{ borderRadius: 6, padding: 18 }}',
      ['inline 2 borderRadius: 6', 'inline 2 padding: 18'],
    ],
    ["style={{ '--accent': '#f00' }}", ["inline 2 '--accent': '#f00'"]],
    ["style={{ 'color': 'red' }}", ["inline 2 'color': 'red'"]],
    [
      "style={{ boxShadow: '0 1px 2px var(--border)' }}",
      ["inline 2 boxShadow: '0 1px 2px var(--border)'"],
    ],
    ["style={{ marginTop: '6px', gap: 4 }}", ["inline 2 marginTop: '6px'", 'inline 2 gap: 4']],
    ["style={{ content: '#abc' }}", ["inline 2 content: '#abc'"]],
  ])('inline: reports %s', (code, expected) => {
    expect(tsx(`export const A = () => (\n  <p ${code}>x</p>\n);`)).toEqual(expected);
  });

  it('inline: accepts theme values, zero, and lengths it does not check', () => {
    const code = [
      'export const A = ({ pct }: { pct: number }) => (',
      "  <p style={{ width: `${pct}%`, padding: 0, margin: 'var(--space-2) 0',",
      "    borderRadius: 'var(--radius-sm)', color: 'var(--accent)', height: 6 }}>x</p>",
      ');',
    ].join('\n');
    expect(tsx(code)).toEqual([]);
  });
});

// Review round 2: quoted parentheses, values that can't be judged, spaced and spread styles,
// drop-shadow filters, and masks.
describe('the checker, round 2 (FR-005, FR-006)', () => {
  it.each([['"("'], ['")"'], ["'('"], ['"\\"("']])('keeps reading after content: %s', (quoted) => {
    expect(
      css(`.a {\n  content: ${quoted};\n}\n.b {\n  color: #fff;\n  padding: 18px;\n}`),
    ).toEqual(['C2 5 color: #fff', 'C5 6 padding: 18px']);
  });

  it.each([
    ['filter: drop-shadow(0 0 2px var(--border))', 'C4'],
    ['mask-image: linear-gradient(red, transparent)', 'C2'],
    ['mask: url(a.svg) black', 'C2'],
  ])('reports %s', (decl, rule) => {
    expect(css(`.a {\n  ${decl};\n}`)).toEqual([`${rule} 2 ${decl}`]);
  });

  it('accepts a drop-shadow filter made of a shadow token', () => {
    expect(css('.a {\n  filter: drop-shadow(var(--shadow));\n}')).toEqual([]);
  });

  it.each([
    ['style={{ color: myColor }}', 'color: myColor'],
    ["style={{ color: c ? 'red' : 'blue' }}", "color: c ? 'red' : 'blue'"],
    ["style={{ color: 'red' as const }}", "color: 'red' as const"],
    ['style={{ background: `${a} red` }}', 'background: `${a} red`'],
    ['style={{ padding: `${n}px` }}', 'padding: `${n}px`'],
    ['style={{ borderRadius: r }}', 'borderRadius: r'],
    ['style={{ boxShadow: s }}', 'boxShadow: s'],
    ['style={{ color }}', 'color'],
    ["style={ { color: 'red' } }", "color: 'red'"],
    ["style={{ ...{ color: 'red' } }}", "color: 'red'"],
    ['style={{ ...custom }}', '...custom'],
    ["style={{ content: c ? '#abc' : '' }}", "content: c ? '#abc' : ''"],
  ])('inline: reports %s', (code, text) => {
    expect(tsx(`export const A = () => (\n  <p ${code}>x</p>\n);`)).toEqual([`inline 2 ${text}`]);
  });

  it('inline: accepts an expression for a size the theme does not hold', () => {
    expect(
      tsx(
        'export const A = () => <span style={{ width: `${pct}%`, height: h, ...{ width: 1 } }} />;',
      ),
    ).toEqual([]);
  });
});

/** Every file under `dir` (relative to the repository root) ending in one of `exts`. */
function files(dir: string, exts: string[]): string[] {
  const abs = resolve(ROOT, dir);
  return (readdirSync(abs, { recursive: true }) as string[])
    .filter((f) => exts.some((e) => f.endsWith(e)))
    .map((f) => relative(ROOT, resolve(abs, f)).replace(/\\/g, '/'))
    .sort();
}

const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8');
const listing = (vs: Violation[]): string[] =>
  vs.map((v) => `${v.path}:${v.line} ${v.rule} ${v.text}`);

describe('the apps (FR-005, FR-015, SC-001)', () => {
  const APPS = ['admin-app/src', 'customer-app/src', 'booth-app/src'];

  const stylesheets = APPS.flatMap((dir) => files(dir, ['.css']));
  const screens = [...APPS, 'packages/shared/src/web'].flatMap((dir) => files(dir, ['.tsx']));

  it('scans both app stylesheets and the screen code, so a move cannot pass unseen', () => {
    expect(stylesheets).toEqual(
      expect.arrayContaining(['admin-app/src/styles.css', 'customer-app/src/styles.css']),
    );
    for (const dir of [...APPS, 'packages/shared/src/web']) {
      expect(screens.filter((f) => f.startsWith(`${dir}/`)).length, dir).toBeGreaterThan(0);
    }
  });

  it('define no look of their own in their stylesheets', () => {
    const found = stylesheets.flatMap((f) => cssViolations(f, read(f)));
    expect(listing(found)).toEqual([]);
  });

  it('set no look of their own in inline styles', () => {
    const found = screens.flatMap((f) => inlineStyleViolations(f, read(f)));
    expect(listing(found)).toEqual([]);
  });
});

it('the theme writes colors out only in its two token blocks (research R3)', () => {
  const path = 'packages/shared/src/web/theme.css';
  const theme = read(path);
  // Blank the token blocks, keeping their newlines so line numbers still point at the file.
  const blank = (s: string): string => s.replace(/[^\n]/g, ' ');
  const outside = theme
    .replace(/(^|\n):root\s*\{[^}]*\}/, blank)
    .replace(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{[^}]*\}\s*\}/, blank);
  expect(outside).not.toMatch(/--bg:/);
  expect(listing(colorLiteralViolations(path, outside))).toEqual([]);
});
