import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { json, stubApi } from '../helpers/api-stub';
import { DRAWING } from './fixtures';
import {
  DRAWING_PATH,
  EDIT_PATH,
  NEW_PATH,
  panel,
  renderEditor,
  sectionOnMap,
} from './render-editor';

/**
 * Spec 039 US2 (FR-015–FR-018; research R12; T039): the Levels panel. Levels best first, each
 * named beside its swatch with its seats; Add level; rename in place (a name another level has is
 * refused beside it); recolor from the 12 colors; Move up and Move down; Delete asks which level
 * its seats take, and the last level can't be deleted; Paint with the chosen level.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function open() {
  stubApi({ [`GET ${DRAWING_PATH}`]: json(DRAWING) });
  renderEditor(EDIT_PATH);
  await screen.findByRole('textbox', { name: 'Layout name' });
  return { levels: () => panel('Price levels'), user: userEvent.setup() };
}

const names = (levels: HTMLElement) =>
  within(levels)
    .getAllByRole('radio')
    .map((r) => r.getAttribute('aria-label') ?? r.closest('label')?.textContent ?? '');

describe('the Levels panel', () => {
  it('lists the levels best first, each name beside its color, with its seats', async () => {
    const { levels } = await open();
    const items = within(levels()).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByRole('radio', { name: 'Courtside' })).toBeInTheDocument();
    expect(items[0].querySelector('.level-swatch--red')).not.toBeNull();
    expect(within(items[0]).getByText('6 seats')).toBeInTheDocument();
    expect(within(items[1]).getByRole('radio', { name: 'Standard' })).toBeInTheDocument();
    expect(items[1].querySelector('.level-swatch--violet')).not.toBeNull();
    expect(within(items[1]).getByText('2 seats')).toBeInTheDocument();
    expect(within(levels()).getByText('Total: 8 seats')).toBeInTheDocument();
  });

  it('adds a level with the next unused color', async () => {
    const { levels, user } = await open();
    await user.click(within(levels()).getByRole('button', { name: 'Add level' }));
    const item = within(levels()).getAllByRole('listitem')[2];
    expect(within(item).getByRole('radio', { name: 'Level 3' })).toBeInTheDocument();
    expect(item.querySelector('.level-swatch--blue')).not.toBeNull();
    expect(within(item).getByText('0 seats')).toBeInTheDocument();
  });

  it('renames a level in place, refusing a name another level has beside the box', async () => {
    const { levels, user } = await open();
    const box = within(levels()).getByRole('textbox', { name: 'Name of Standard' });
    await user.clear(box);
    await user.type(box, 'courtside{Enter}');
    expect(box).toHaveAccessibleDescription('Another level is named courtside');
    await user.clear(box);
    await user.type(box, 'Lower sideline{Enter}');
    expect(within(levels()).getByRole('radio', { name: 'Lower sideline' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Standard renamed Lower sideline');
  });

  it('recolors a level from the 12 colors', async () => {
    const { levels, user } = await open();
    const color = within(levels()).getByRole('combobox', { name: 'Color of Standard' });
    expect(within(color).getAllByRole('option')).toHaveLength(12);
    await user.selectOptions(color, 'teal');
    expect(
      within(levels()).getAllByRole('listitem')[1].querySelector('.level-swatch--teal'),
    ).not.toBeNull();
  });

  it('moves a level up and down', async () => {
    const { levels, user } = await open();
    expect(within(levels()).getByRole('button', { name: 'Move Courtside up' })).toBeDisabled();
    await user.click(within(levels()).getByRole('button', { name: 'Move Standard up' }));
    expect(names(levels())).toEqual(['Standard', 'Courtside']);
    await user.click(within(levels()).getByRole('button', { name: 'Move Standard down' }));
    expect(names(levels())).toEqual(['Courtside', 'Standard']);
  });

  it('asks which level the seats of a deleted level take', async () => {
    const { levels, user } = await open();
    await user.click(within(levels()).getByRole('button', { name: 'Delete Courtside' }));
    const form = within(levels()).getByRole('group', { name: 'Delete Courtside' });
    expect(within(form).getByRole('combobox', { name: 'Its 6 seats take' })).toHaveValue('lv-std');
    await user.click(within(form).getByRole('button', { name: 'Delete level' }));
    expect(names(levels())).toEqual(['Standard']);
    expect(within(levels()).getByText('8 seats')).toBeInTheDocument();
    expect(sectionOnMap('102')).toHaveAccessibleName('Section 102, Standard, 2 seats');
  });

  it("the last level's Delete is disabled, saying why", async () => {
    stubApi({});
    renderEditor(NEW_PATH);
    const levels = await screen.findByRole('region', { name: 'Price levels' });
    const del = within(levels).getByRole('button', { name: 'Delete Standard' });
    expect(del).toBeDisabled();
    expect(del).toHaveAccessibleDescription("The last level can't be deleted");
  });

  it('paints the selected section with the chosen level', async () => {
    const { levels, user } = await open();
    const paint = () => within(levels()).getByRole('button', { name: /^Paint: / });
    expect(paint()).toBeDisabled();
    await user.click(within(panel('Sections')).getByRole('button', { name: /^101 ·/ }));
    await user.click(within(levels()).getByRole('radio', { name: 'Courtside' }));
    expect(paint()).toHaveAccessibleName('Paint: Courtside');
    await user.click(paint());
    expect(sectionOnMap('101')).toHaveAccessibleName('Section 101, Courtside, 6 seats');
    expect(within(levels()).getByText('8 seats')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Section 101 painted Courtside');
  });
});
