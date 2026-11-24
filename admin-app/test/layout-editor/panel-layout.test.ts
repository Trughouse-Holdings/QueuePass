import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Spec 039 (Nate's walk, 2026-11-14: "Mark accessible", "Mark not accessible" and "Delete seats"
 * cut off in the Selection panel): in the editor's side panels a row of buttons wraps onto
 * another line rather than squeezing them, and a button keeps its whole label. jsdom lays nothing
 * out, so the stylesheet's rules are checked.
 */
const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

describe('the editor panels’ button rows', () => {
  it('wrap rather than squeeze', () => {
    expect(css).toMatch(/\.editor-panel \.form__actions\s*\{[^}]*flex-wrap: wrap/);
  });

  it('keep each button its whole label', () => {
    expect(css).toMatch(/\.editor-panel \.form__actions > \.btn\s*\{[^}]*flex-shrink: 0/);
  });
});
