import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { json, stubApi } from '../helpers/api-stub';
import { DRAWING } from './fixtures';
import {
  DRAWING_PATH,
  EDIT_PATH,
  NEW_PATH,
  map,
  panel,
  renderEditor,
  sectionOnMap,
} from './render-editor';

/**
 * Spec 039 US1 (FR-006, FR-007, FR-017; research R7; T025): Add section. Its fields; Generate
 * adds the section, selected, in the middle of the visible map, in the chosen level; a value over a
 * limit is refused beside its field naming the limit; the seats left are shown; a name another
 * section has is refused beside the name.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type User = ReturnType<typeof userEvent.setup>;

async function openForm(user: User) {
  await user.click(within(panel('Sections')).getByRole('button', { name: 'Add section' }));
  return screen.getByRole('form', { name: 'Add section' });
}

async function fill(user: User, form: HTMLElement, label: string, value: string) {
  const box = within(form).getByLabelText(label);
  await user.clear(box);
  await user.type(box, value);
}

describe('Add section', () => {
  it('has every generator field, with the defaults of a 10 × 20 straight block', async () => {
    stubApi({});
    const user = userEvent.setup();
    renderEditor(NEW_PATH);
    await screen.findByRole('heading', { name: 'New layout' });
    const form = await openForm(user);
    expect(within(form).getByLabelText('Section name')).toHaveValue('');
    expect(within(form).getByLabelText('Rows')).toHaveValue(10);
    expect(within(form).getByLabelText('Seats per row')).toHaveValue('20');
    expect(within(form).getByLabelText('Row labels')).toHaveValue('LETTERS');
    expect(within(form).getByLabelText('First row')).toHaveValue('A');
    expect(within(form).getByLabelText('First seat')).toHaveValue(1);
    expect(within(form).getByLabelText('Seat numbers')).toHaveValue('LEFT_TO_RIGHT');
    const curve = within(form).getByLabelText('Curve');
    expect(
      within(curve)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['None', 'Slight', 'Medium', 'Strong', 'Degrees…']);
    expect(within(form).getByLabelText('Price level')).toHaveValue('new:0');
    expect(within(form).getByText('30,000 seats left in this layout')).toBeInTheDocument();
  });

  it('generates a curved 12 × 20 block, selected, in the middle of the visible map', async () => {
    stubApi({});
    const user = userEvent.setup();
    renderEditor(NEW_PATH);
    await screen.findByRole('heading', { name: 'New layout' });
    const form = await openForm(user);
    await fill(user, form, 'Section name', '101');
    await fill(user, form, 'Rows', '12');
    await user.selectOptions(within(form).getByLabelText('Curve'), 'Medium');
    await user.click(within(form).getByRole('button', { name: 'Generate' }));

    expect(screen.queryByRole('form', { name: 'Add section' })).toBeNull();
    expect(sectionOnMap('101')).toHaveAccessibleName('Section 101, Standard, 240 seats');
    expect(sectionOnMap('101')).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel('Sections')).getByText('1 section · 240 seats')).toBeInTheDocument();
    expect(within(panel('Sections')).getByText('29,760 seats left of 30,000')).toBeInTheDocument();
    // The empty map is 300 × 200: its middle.
    const sel = panel('Selection');
    expect(within(sel).getByLabelText('x')).toHaveValue(150);
    expect(within(sel).getByLabelText('y')).toHaveValue(100);
    expect(within(sel).getByLabelText('Angle')).toHaveValue(0);
    expect(screen.getByRole('status')).toHaveTextContent('Section 101 added');
  });

  it('takes seats per row as a list, one a row, and a curve in degrees', async () => {
    stubApi({});
    const user = userEvent.setup();
    renderEditor(NEW_PATH);
    await screen.findByRole('heading', { name: 'New layout' });
    const form = await openForm(user);
    await fill(user, form, 'Section name', '102');
    await fill(user, form, 'Rows', '6');
    await fill(user, form, 'Seats per row', '16, 16, 18, 18, 20, 20');
    await user.selectOptions(within(form).getByLabelText('Curve'), 'Degrees…');
    await fill(user, form, 'Curve in degrees', '25');
    await user.click(within(form).getByRole('button', { name: 'Generate' }));
    expect(sectionOnMap('102')).toHaveAccessibleName('Section 102, Standard, 108 seats');
  });

  it('puts the section in the chosen level', async () => {
    stubApi({ [`GET ${DRAWING_PATH}`]: json(DRAWING) });
    const user = userEvent.setup();
    renderEditor(EDIT_PATH);
    await screen.findByRole('textbox', { name: 'Layout name' });
    const form = await openForm(user);
    await fill(user, form, 'Section name', '103');
    await fill(user, form, 'Rows', '1');
    await fill(user, form, 'Seats per row', '4');
    await user.selectOptions(within(form).getByLabelText('Price level'), 'Courtside');
    await user.click(within(form).getByRole('button', { name: 'Generate' }));
    expect(sectionOnMap('103')).toHaveAccessibleName('Section 103, Courtside, 4 seats');
  });

  it.each([
    ['Rows', '101', 'At most 100 rows'],
    ['Seats per row', '201', 'At most 200 seats in a row'],
    ['Seats per row', '20, x', 'Seats per row: whole numbers, such as 20 or 16, 16, 18'],
    ['First row', 'AB', 'The first row is a letter, or one letter repeated (A, AA, AAA)'],
  ])('refuses %s "%s" beside the field: %s', async (label, value, message) => {
    stubApi({});
    const user = userEvent.setup();
    renderEditor(NEW_PATH);
    await screen.findByRole('heading', { name: 'New layout' });
    const form = await openForm(user);
    await fill(user, form, 'Section name', '101');
    await fill(user, form, label, value);
    await user.click(within(form).getByRole('button', { name: 'Generate' }));
    expect(within(form).getByLabelText(label)).toHaveAccessibleDescription(
      expect.stringContaining(message),
    );
    expect(within(form).getByLabelText(label)).toHaveAttribute('aria-invalid', 'true');
    expect(within(map()).queryAllByRole('button', { name: /^Section / })).toHaveLength(0);
  });

  it('refuses a block that would take the layout over 30,000 seats, naming the limit', async () => {
    stubApi({});
    const user = userEvent.setup();
    renderEditor(NEW_PATH);
    await screen.findByRole('heading', { name: 'New layout' });
    for (const name of ['A', 'B']) {
      const form = await openForm(user);
      await fill(user, form, 'Section name', name);
      await fill(user, form, 'Rows', '100');
      await fill(user, form, 'Seats per row', '200');
      await user.click(within(form).getByRole('button', { name: 'Generate' }));
    }
    const form = screen.getByRole('form', { name: 'Add section' });
    expect(within(form).getByLabelText('Seats per row')).toHaveAccessibleDescription(
      expect.stringContaining('The layout would have 40,000 seats; at most 30,000'),
    );
    expect(within(form).getByText('10,000 seats left in this layout')).toBeInTheDocument();
  });

  it('refuses a name another section has, ignoring case, beside the name', async () => {
    stubApi({ [`GET ${DRAWING_PATH}`]: json(DRAWING) });
    const user = userEvent.setup();
    renderEditor(EDIT_PATH);
    await screen.findByRole('textbox', { name: 'Layout name' });
    const form = await openForm(user);
    await fill(user, form, 'Section name', '101');
    await user.click(within(form).getByRole('button', { name: 'Generate' }));
    expect(within(form).getByLabelText('Section name')).toHaveAccessibleDescription(
      'Another section is named 101',
    );
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Add section' })).toBeNull();
  });

  it('switching row labels to numbers starts them at 1', async () => {
    stubApi({});
    const user = userEvent.setup();
    renderEditor(NEW_PATH);
    await screen.findByRole('heading', { name: 'New layout' });
    const form = await openForm(user);
    await user.selectOptions(within(form).getByLabelText('Row labels'), 'NUMBERS');
    expect(within(form).getByLabelText('First row')).toHaveValue('1');
    await user.selectOptions(within(form).getByLabelText('Row labels'), 'LETTERS');
    expect(within(form).getByLabelText('First row')).toHaveValue('A');
  });
});
