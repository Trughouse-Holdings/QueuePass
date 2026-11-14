import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { json, stubApi } from '../helpers/api-stub';
import { DRAWING } from './fixtures';
import { DRAWING_PATH, EDIT_PATH, map, panel, renderEditor } from './render-editor';

/**
 * Spec 039 US5 (FR-026, FR-027; research R11; T052): the editor by keyboard alone. Tab reaches
 * every control; the Sections list selects a section; typed place and angle move and turn it;
 * with the map focused, the arrow keys move the selection (Shift 10), `[` and `]` turn it (Shift
 * 15°), Delete asks then deletes, Escape clears; Cmd/Ctrl+Z undoes, Shift+Cmd/Ctrl+Z and Ctrl+Y
 * redo; rows and seats of the chosen section are checkbox lists painted, deleted, relabelled and
 * marked from the panels; the status line announces each change.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function open() {
  stubApi({ [`GET ${DRAWING_PATH}`]: json(DRAWING) });
  renderEditor(EDIT_PATH);
  await screen.findByRole('textbox', { name: 'Layout name' });
  return userEvent.setup();
}

const status = () => screen.getByRole('status');
const sel = () => panel('Selection');
const value = (label: string) =>
  Number((within(sel()).getByLabelText(label) as HTMLInputElement).value);

/** Focuses `el` and presses Enter or Space on it, as a keyboard user would. */
async function activate(
  user: ReturnType<typeof userEvent.setup>,
  el: HTMLElement,
  key = '{Enter}',
) {
  el.focus();
  await user.keyboard(key);
}

async function chooseByList(user: ReturnType<typeof userEvent.setup>, name: string) {
  await activate(
    user,
    within(panel('Sections')).getByRole('button', { name: new RegExp(`^${name} ·`) }),
  );
}

describe('keyboard only', () => {
  it('Tab reaches every control, and the editor’s focus marks come from the theme', async () => {
    const user = await open();
    document.body.focus();
    const reached = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      await user.tab();
      const el = document.activeElement as HTMLElement;
      reached.add(el.getAttribute('aria-label') ?? el.textContent ?? '');
      if (el.id) {
        const label = document.querySelector(`label[for="${el.id}"]`);
        if (label) reached.add(label.textContent ?? '');
      }
    }
    for (const name of [
      'Layout name',
      'Save',
      'Zoom in',
      'Layout map: 2 sections',
      'Floor object',
      'Name of Courtside',
      'Add level',
      '101 · 6 seats',
      'Add section',
    ]) {
      expect(reached).toContain(name);
    }
    // Every editor control keeps the theme's :focus-visible outline, or draws its own mark.
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
    expect(css).toMatch(
      /\.editor-map__section:focus-visible path\s*\{[^}]*stroke: var\(--accent\)/,
    );
    expect(css).not.toMatch(/\.editor-(?!map__section)[\w-]*:focus-visible\s*\{[^}]*outline: none/);
  });

  it('selects from the Sections list, and types an angle and a place', async () => {
    const user = await open();
    await chooseByList(user, '101');
    expect(within(sel()).getByRole('heading', { name: 'Section 101' })).toBeInTheDocument();
    await user.clear(within(sel()).getByLabelText('Angle'));
    await user.keyboard('30');
    expect(status()).toHaveTextContent('Section 101 turned to 30°');
    await user.clear(within(sel()).getByLabelText('x'));
    await user.keyboard('50');
    expect(status()).toHaveTextContent('Section 101 moved');
    expect(value('x')).toBe(50);
  });

  it('moves and turns the selection with the map focused; Escape clears it', async () => {
    const user = await open();
    await chooseByList(user, '101');
    map().focus();
    await user.keyboard('{ArrowRight}');
    expect(value('x')).toBe(21);
    expect(status()).toHaveTextContent('Section 101 moved');
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(value('x')).toBe(31);
    await user.keyboard('{ArrowDown}');
    expect(value('y')).toBe(31);
    await user.keyboard(']');
    expect(value('Angle')).toBe(1);
    await user.keyboard('{Shift>}]{/Shift}');
    expect(value('Angle')).toBe(16);
    await user.keyboard('[[');
    expect(value('Angle')).toBe(15);
    await user.keyboard('{Escape}');
    expect(within(sel()).getByText('Nothing selected.')).toBeInTheDocument();
  });

  it('Cmd/Ctrl+Z undoes; Shift+Cmd/Ctrl+Z and Ctrl+Y redo; each is announced', async () => {
    const user = await open();
    await chooseByList(user, '101');
    map().focus();
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{Control>}z{/Control}');
    expect(value('x')).toBe(20);
    expect(status()).toHaveTextContent('Undone: section 101 moved');
    await user.keyboard('{Meta>}{Shift>}z{/Shift}{/Meta}');
    expect(value('x')).toBe(21);
    expect(status()).toHaveTextContent('Redone: section 101 moved');
    await user.keyboard('{Meta>}z{/Meta}');
    await user.keyboard('{Control>}y{/Control}');
    expect(value('x')).toBe(21);
  });

  it('typing in a text box keeps the box’s own undo', async () => {
    const user = await open();
    const name = screen.getByRole('textbox', { name: 'Layout name' });
    name.focus();
    await user.keyboard('!');
    await user.keyboard('{Control>}z{/Control}');
    expect(name).toHaveValue('Riverside!');
  });

  it('Delete on the map asks, then deletes the selected section', async () => {
    const user = await open();
    await chooseByList(user, '102');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    map().focus();
    await user.keyboard('{Delete}');
    expect(confirm).toHaveBeenCalledWith('Delete section 102 and its 2 seats?');
    confirm.mockReturnValue(true);
    await user.keyboard('{Delete}');
    expect(status()).toHaveTextContent('Section 102 deleted');
    expect(within(panel('Sections')).queryByRole('button', { name: /^102 ·/ })).toBeNull();
  });

  it('paints rows, and marks, relabels and deletes seats, from the lists', async () => {
    const user = await open();
    await chooseByList(user, '101');
    const rows = within(sel()).getByRole('group', { name: 'Rows of section 101' });
    await activate(user, within(rows).getByRole('checkbox', { name: 'Row A' }), ' ');
    await activate(user, within(rows).getByRole('checkbox', { name: 'Row B' }), ' ');
    expect(within(sel()).getByText('Rows A–B selected in section 101')).toBeInTheDocument();
    const levels = panel('Price levels');
    await activate(user, within(levels).getByRole('radio', { name: 'Courtside' }), ' ');
    await activate(user, within(levels).getByRole('button', { name: 'Paint: Courtside' }));
    expect(status()).toHaveTextContent('Rows A–B painted Courtside');

    // Row A's seats open under it.
    const seatsToggle = within(rows).getByRole('button', { name: 'Seats of row A' });
    expect(seatsToggle).toHaveAttribute('aria-expanded', 'false');
    await activate(user, seatsToggle);
    expect(seatsToggle).toHaveAttribute('aria-expanded', 'true');
    // Row A and B are still checked: uncheck them, then check seat 2 of row A.
    await activate(user, within(rows).getByRole('checkbox', { name: 'Row A' }), ' ');
    await activate(user, within(rows).getByRole('checkbox', { name: 'Row B' }), ' ');
    const seats = within(rows).getByRole('group', { name: 'Seats of row A' });
    await activate(user, within(seats).getByRole('checkbox', { name: 'Seat 2' }), ' ');
    expect(within(sel()).getByText('Row A, seat 2 selected in section 101')).toBeInTheDocument();
    await activate(user, within(sel()).getByRole('button', { name: 'Mark accessible' }));
    expect(status()).toHaveTextContent('Row A, seat 2 marked accessible');
    const label = within(sel()).getByRole('textbox', { name: 'Seat label' });
    label.focus();
    await user.keyboard('{Backspace}B{Enter}');
    expect(status()).toHaveTextContent('Row A, seat 2 relabelled B');
    await activate(user, within(sel()).getByRole('button', { name: 'Delete seats' }));
    expect(status()).toHaveTextContent('1 seat deleted from section 101');
  });
});
