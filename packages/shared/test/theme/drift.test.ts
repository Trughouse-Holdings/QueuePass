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

  it('define no look of their own in their stylesheets', () => {
    const found = APPS.flatMap((dir) => files(dir, ['.css'])).flatMap((f) =>
      cssViolations(f, read(f)),
    );
    expect(listing(found)).toEqual([]);
  });

  it('set no color, typeface, or shadow in inline styles', () => {
    const found = [...APPS, 'packages/shared/src/web']
      .flatMap((dir) => files(dir, ['.tsx']))
      .flatMap((f) => inlineStyleViolations(f, read(f)));
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
