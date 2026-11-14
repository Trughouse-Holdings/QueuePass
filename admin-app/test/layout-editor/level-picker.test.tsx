import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { json, stubApi } from '../helpers/api-stub';
import { DRAWING } from './fixtures';
import { DRAWING_PATH, EDIT_PATH, panel, renderEditor, sectionOnMap } from './render-editor';

/**
 * Spec 039 US2 (FR-016; walk feedback, 2026-11-14: "the Paint: Standard makes no sense"): a
 * selection's level is chosen where the selection is shown. Select sections (or rows and seats),
 * then Selection's Price level shows the level they have ("Mixed" when they differ) and choosing
 * another gives it to them at once; for rows and seats, "Same as the section" or "Same as the row"
 * clears their own level. Undo takes it back.
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
const picker = () => within(panel('Selection')).getByRole('combobox', { name: 'Price level' });
const options = () =>
  within(picker())
    .getAllByRole('option')
    .map((o) => o.textContent);

describe('Price level under Selection', () => {
  it('is not there with nothing selected', async () => {
    await open();
    expect(within(panel('Selection')).queryByRole('combobox', { name: 'Price level' })).toBeNull();
  });

  it("shows a section's level and gives it another at once, Undo taking it back", async () => {
    const user = await open();
    await user.click(within(panel('Sections')).getByRole('button', { name: /^101 ·/ }));
    expect(picker()).toHaveDisplayValue('Standard');
    expect(options()).toEqual(['Courtside', 'Standard']);
    await user.selectOptions(picker(), 'Courtside');
    expect(sectionOnMap('101')).toHaveAccessibleName('Section 101, Courtside, 6 seats');
    expect(screen.getByRole('status')).toHaveTextContent('Section 101 painted Courtside');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(picker()).toHaveDisplayValue('Standard');
  });

  it('says Mixed for sections of different levels, and gives them all one', async () => {
    const user = await open();
    // 101 is Standard, 102 Courtside (the fixture).
    const sections = within(panel('Sections'));
    await user.click(sections.getByRole('button', { name: /^102 ·/ }));
    await user.keyboard('{Shift>}');
    await user.click(sections.getByRole('button', { name: /^101 ·/ }));
    await user.keyboard('{/Shift}');
    expect(picker()).toHaveDisplayValue('Mixed');
    await user.selectOptions(picker(), 'Standard');
    expect(sectionOnMap('101')).toHaveAccessibleName('Section 101, Standard, 6 seats');
    expect(sectionOnMap('102')).toHaveAccessibleName(/^Section 102, Standard, /);
  });

  it('offers "Same as the section" for rows, which clears their own level', async () => {
    const user = await open();
    await user.click(within(panel('Sections')).getByRole('button', { name: /^101 ·/ }));
    const rows = within(panel('Selection')).getByRole('group', { name: 'Rows of section 101' });
    await user.click(within(rows).getByRole('checkbox', { name: 'Row B' }));
    expect(options()[0]).toBe('Same as the section (Standard)');
    // Row B has its own level, Courtside, in the fixture.
    expect(picker()).toHaveDisplayValue('Courtside');
    await user.selectOptions(picker(), 'Same as the section (Standard)');
    expect(picker()).toHaveDisplayValue('Same as the section (Standard)');
    expect(screen.getByRole('status')).toHaveTextContent(/Row B/);
  });
});
