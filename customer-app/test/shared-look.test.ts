import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Spec 008 US4 (FR-014–FR-016; research R7): both apps share one block of detail-layout rules, so
 * their detail pages match the top bar and cannot drift apart.
 */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const START = '/* >>> shared detail layout';
const END = '/* <<< shared detail layout */';

function block(css: string): string {
  const from = css.indexOf(START);
  const to = css.indexOf(END);
  return from === -1 || to === -1 ? '' : css.slice(from, to + END.length);
}

// Vitest runs each workspace from its own folder (customer-app/).
const customer = block(read('src/styles.css'));
const admin = block(read('../admin-app/src/styles.css'));

describe('shared detail layout', () => {
  it('exists in both apps and is identical', () => {
    expect(customer).not.toBe('');
    expect(admin).toBe(customer);
  });

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
    expect(customer).toMatch(rule);
  });
});
