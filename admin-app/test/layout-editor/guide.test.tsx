import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { json, stubApi } from '../helpers/api-stub';
import { DRAWING, LOCKED } from './fixtures';
import {
  DRAWING_PATH,
  EDIT_PATH,
  NEW_PATH,
  panel,
  renderEditor,
  sectionOnMap,
} from './render-editor';

/**
 * Spec 039 US1 (walk feedback, 2026-11-14: "what am I supposed to do even"): the editor says how a
 * layout is made. A new layout opens with the steps, each ticked off as it is done; once there
 * is a section, the steps fold away and one line under the map says what can be done with what
 * is selected now. A locked layout, read-only, has neither.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const guide = () => screen.getByRole('group', { name: 'How to make a layout' });
const steps = () => within(guide()).getAllByRole('listitem');
const hint = () => screen.getByTestId('editor-hint');

describe('the steps', () => {
  it('open on a new layout, five of them, none done', async () => {
    stubApi({});
    renderEditor(NEW_PATH);
    await screen.findByRole('textbox', { name: 'Layout name' });
    expect(guide()).toHaveAttribute('open');
    expect(steps().map((s) => s.textContent)).toEqual([
      expect.stringMatching(/^Pick a floor object/),
      expect.stringMatching(/^Add a section: in Sections, press Add section/),
      expect.stringMatching(/^Drag the section into place/),
      expect.stringMatching(/^Give seats price levels/),
      expect.stringMatching(/^Name the layout at the top and press Save/),
    ]);
    expect(within(guide()).queryByText('Done:')).toBeNull();
  });

  it('tick off the floor, then fold away once a section is made', async () => {
    stubApi({});
    const user = userEvent.setup();
    renderEditor(NEW_PATH);
    await screen.findByRole('textbox', { name: 'Layout name' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Floor object' }), 'COURT');
    expect(steps()[0]).toHaveTextContent(/^Done: Pick a floor object/);
    await user.click(within(panel('Sections')).getByRole('button', { name: 'Add section' }));
    const form = screen.getByRole('form', { name: 'Add section' });
    await user.type(within(form).getByLabelText('Section name'), '101');
    await user.click(within(form).getByRole('button', { name: 'Generate' }));
    expect(guide()).not.toHaveAttribute('open');
    expect(steps()[1]).toHaveTextContent(/^Done: Add a section/);
    // The new section is selected: the line says how to place it.
    expect(hint()).toHaveTextContent(/Drag it to move it\. Drag the round handle above it/);
  });

  it('are folded away on a layout with sections, and open again on request', async () => {
    stubApi({ [`GET ${DRAWING_PATH}`]: json(DRAWING) });
    const user = userEvent.setup();
    renderEditor(EDIT_PATH);
    await screen.findByRole('textbox', { name: 'Layout name' });
    expect(guide()).not.toHaveAttribute('open');
    await user.click(within(guide()).getByText('How to make a layout'));
    expect(guide()).toHaveAttribute('open');
  });
});

describe('the line under the map', () => {
  it('follows what is selected: nothing, a section, the floor, a zoomed section', async () => {
    stubApi({ [`GET ${DRAWING_PATH}`]: json(DRAWING) });
    const user = userEvent.setup();
    renderEditor(EDIT_PATH);
    await screen.findByRole('textbox', { name: 'Layout name' });
    expect(hint()).toHaveTextContent(/^Click a section to select it/);
    await user.click(within(panel('Sections')).getByRole('button', { name: /^101 · / }));
    expect(hint()).toHaveTextContent(/Double-click it to see its seats/);
    await user.dblClick(sectionOnMap('101'));
    expect(hint()).toHaveTextContent(/Click seats .* or a row label/);
    expect(hint()).toHaveTextContent(/Selection: Price level/);
  });

  it('is not shown, nor the steps, on a locked layout', async () => {
    stubApi({ [`GET ${DRAWING_PATH}`]: json(LOCKED) });
    renderEditor(EDIT_PATH);
    await screen.findByText(/^Locked: seats are sold or held/);
    expect(screen.queryByRole('group', { name: 'How to make a layout' })).toBeNull();
    expect(screen.queryByTestId('editor-hint')).toBeNull();
  });
});
