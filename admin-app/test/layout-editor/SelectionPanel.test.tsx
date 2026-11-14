import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { json, stubApi } from '../helpers/api-stub';
import { DRAWING } from './fixtures';
import {
  DRAWING_PATH,
  EDIT_PATH,
  installPointerEvents,
  map,
  panel,
  renderEditor,
  sectionOnMap,
} from './render-editor';

/**
 * Spec 039 US4 (FR-009, FR-010, FR-012, FR-013; research R7; T050): the Selection panel. For one
 * section: its name, place, angle and, when generated, its generator values with Regenerate,
 * which warns of the seats it removes and of labels changed by hand; Duplicate section; Delete
 * section after a confirm naming its seats. For seats: Delete, Mark accessible, a label box; for a
 * row, its label box.
 */
beforeAll(installPointerEvents);
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

async function choose(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(
    within(panel('Sections')).getByRole('button', { name: new RegExp(`^${name} ·`) }),
  );
  return panel('Selection');
}

const press = (el: Element, init = {}) => {
  fireEvent.pointerDown(el, { pointerId: 1, ...init });
  fireEvent.pointerUp(map(), { pointerId: 1, ...init });
};
const seat = (name: string) => within(map()).getByRole('button', { name: new RegExp(`^${name}`) });

describe('one section', () => {
  it('shows its name, place, angle and generator values', async () => {
    const user = await open();
    const sel = await choose(user, '101');
    expect(within(sel).getByRole('textbox', { name: 'Section name' })).toHaveValue('101');
    expect(within(sel).getByLabelText('x')).toHaveValue(20);
    expect(within(sel).getByLabelText('Rows')).toHaveValue(2);
    expect(within(sel).getByLabelText('Seats per row')).toHaveValue('3');
    expect(within(sel).getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
  });

  it('a section not generated in the editor has no Regenerate', async () => {
    const user = await open();
    const sel = await choose(user, '102');
    expect(within(sel).queryByRole('button', { name: 'Regenerate' })).toBeNull();
  });

  it('renames it, refusing a name another section has beside the box', async () => {
    const user = await open();
    const sel = await choose(user, '101');
    const box = within(sel).getByRole('textbox', { name: 'Section name' });
    await user.clear(box);
    await user.type(box, '102{Enter}');
    expect(box).toHaveAccessibleDescription('Another section is named 102');
    await user.clear(box);
    await user.type(box, '104{Enter}');
    expect(sectionOnMap('104')).toBeInTheDocument();
  });

  it('Regenerate warns before removing seats, and applies on OK', async () => {
    const user = await open();
    const sel = await choose(user, '101');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const rows = within(sel).getByLabelText('Rows');
    await user.clear(rows);
    await user.type(rows, '1');
    await user.clear(within(sel).getByLabelText('Seats per row'));
    await user.type(within(sel).getByLabelText('Seats per row'), '2');
    await user.click(within(sel).getByRole('button', { name: 'Regenerate' }));
    expect(confirm).toHaveBeenCalledWith('Regenerate removes 4 seats. Go on?');
    expect(sectionOnMap('101')).toHaveAccessibleName('Section 101, Standard, 6 seats');
    confirm.mockReturnValue(true);
    await user.click(within(sel).getByRole('button', { name: 'Regenerate' }));
    expect(sectionOnMap('101')).toHaveAccessibleName('Section 101, Standard, 2 seats');
    expect(screen.getByRole('status')).toHaveTextContent('Section 101 regenerated');
  });

  it('Regenerate that removes nothing asks nothing; a limit is refused beside its field', async () => {
    const user = await open();
    const sel = await choose(user, '101');
    const confirm = vi.spyOn(window, 'confirm');
    const rows = within(sel).getByLabelText('Rows');
    await user.clear(rows);
    await user.type(rows, '101');
    await user.click(within(sel).getByRole('button', { name: 'Regenerate' }));
    expect(rows).toHaveAccessibleDescription('At most 100 rows');
    await user.clear(rows);
    await user.type(rows, '3');
    await user.click(within(sel).getByRole('button', { name: 'Regenerate' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(sectionOnMap('101')).toHaveAccessibleName('Section 101, Standard, 9 seats');
  });

  it('Regenerate warns that labels changed by hand are replaced', async () => {
    const user = await open();
    await user.dblClick(sectionOnMap('101'));
    press(within(map()).getByRole('button', { name: 'Row B' }));
    const box = within(panel('Selection')).getByRole('textbox', { name: 'Row label' });
    await user.clear(box);
    await user.type(box, 'BB{Enter}');
    await user.click(screen.getByRole('button', { name: 'Back to layout' }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(within(panel('Selection')).getByRole('button', { name: 'Regenerate' }));
    expect(confirm).toHaveBeenCalledWith(
      'Regenerate removes 3 seats. Labels changed by hand are replaced. Go on?',
    );
  });

  it('Duplicate section copies it under a new name; Delete section asks, naming its seats', async () => {
    const user = await open();
    let sel = await choose(user, '101');
    await user.click(within(sel).getByRole('button', { name: 'Duplicate section' }));
    expect(sectionOnMap('101 \\(2\\)')).toHaveAttribute('aria-pressed', 'true');
    sel = await choose(user, '101');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(within(sel).getByRole('button', { name: 'Delete section' }));
    expect(confirm).toHaveBeenCalledWith('Delete section 101 and its 6 seats?');
    expect(sectionOnMap('101')).toBeInTheDocument();
    confirm.mockReturnValue(true);
    await user.click(within(sel).getByRole('button', { name: 'Delete section' }));
    expect(within(map()).queryByRole('button', { name: /^Section 101,/ })).toBeNull();
  });
});

describe('seats and rows', () => {
  it('marks selected seats accessible, deletes them, and relabels one', async () => {
    const user = await open();
    await user.dblClick(sectionOnMap('101'));
    press(seat('Row A, Seat 2'));
    press(seat('Row B, Seat 2'), { shiftKey: true });
    const sel = panel('Selection');
    await user.click(within(sel).getByRole('button', { name: 'Mark accessible' }));
    expect(seat('Row A, Seat 2')).toHaveAccessibleName('Row A, Seat 2, Standard, accessible');
    await user.click(within(sel).getByRole('button', { name: 'Mark not accessible' }));
    expect(seat('Row A, Seat 2')).toHaveAccessibleName('Row A, Seat 2, Standard');
    await user.click(within(sel).getByRole('button', { name: 'Delete seats' }));
    expect(within(map()).queryByRole('button', { name: /^Row A, Seat 2/ })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('2 seats deleted from section 101');

    press(seat('Row A, Seat 3'));
    const label = within(panel('Selection')).getByRole('textbox', { name: 'Seat label' });
    await user.clear(label);
    await user.type(label, '1{Enter}');
    expect(label).toHaveAccessibleDescription('Seat 1 is already in row A');
    await user.clear(label);
    await user.type(label, '2A{Enter}');
    expect(seat('Row A, Seat 2A')).toBeInTheDocument();
  });

  it('relabels a row', async () => {
    const user = await open();
    await user.dblClick(sectionOnMap('101'));
    press(within(map()).getByRole('button', { name: 'Row B' }));
    const box = within(panel('Selection')).getByRole('textbox', { name: 'Row label' });
    await user.clear(box);
    await user.type(box, 'A{Enter}');
    expect(box).toHaveAccessibleDescription('Row A is already in section 101');
    await user.clear(box);
    await user.type(box, 'A1{Enter}');
    expect(within(map()).getByRole('button', { name: 'Row A1' })).toBeInTheDocument();
  });

  it('deleting every seat of a section asks to delete the section', async () => {
    const user = await open();
    await user.dblClick(sectionOnMap('102'));
    press(within(map()).getByRole('button', { name: 'Row 1' }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(within(panel('Selection')).getByRole('button', { name: 'Delete seats' }));
    expect(confirm).toHaveBeenCalledWith('Delete section 102 and its 2 seats?');
    expect(within(map()).queryByRole('button', { name: /^Row 1, Seat/ })).toBeNull();
    expect(sectionOnMap('101')).toBeInTheDocument();
    expect(within(map()).queryByRole('button', { name: /^Section 102,/ })).toBeNull();
  });
});
