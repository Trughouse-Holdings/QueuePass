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
 * Spec 039 US2 (FR-012, FR-016; research R11; T040): a zoomed section. Enter or double-click
 * zooms in and draws its seats in their levels' colors with row labels at both ends; click selects
 * a seat, Shift-click adds; a row label selects its row, Shift on another the range; with Box
 * select on, a drag selects the seats inside (off, it pans); Paint applies the chosen level; Back
 * to layout returns to the overview.
 */
beforeAll(installPointerEvents);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function zoomInto101() {
  stubApi({ [`GET ${DRAWING_PATH}`]: json(DRAWING) });
  const view = renderEditor(EDIT_PATH);
  await screen.findByRole('textbox', { name: 'Layout name' });
  const user = userEvent.setup();
  await user.dblClick(sectionOnMap('101'));
  return { ...view, user };
}

const seat = (name: string) => within(map()).getByRole('button', { name: new RegExp(`^${name}`) });
const press = (el: Element, init = {}) => {
  fireEvent.pointerDown(el, { pointerId: 1, ...init });
  fireEvent.pointerUp(map(), { pointerId: 1, ...init });
};

describe('a zoomed section', () => {
  it('double-click zooms in: seats in their levels’ colors, row labels at both ends', async () => {
    const { container } = await zoomInto101();
    expect(seat('Row A, Seat 1')).toHaveAccessibleName('Row A, Seat 1, Courtside, accessible');
    expect(seat('Row A, Seat 2')).toHaveAccessibleName('Row A, Seat 2, Standard');
    expect(seat('Row B, Seat 3')).toHaveAccessibleName('Row B, Seat 3, Courtside');
    expect(seat('Row A, Seat 1').querySelector('.venue-map--red')).not.toBeNull();
    expect(seat('Row A, Seat 2').querySelector('.venue-map--violet')).not.toBeNull();
    expect(container.querySelectorAll('.editor-map__row-label')).toHaveLength(4);
    expect(within(map()).getByRole('button', { name: 'Row A' })).toBeInTheDocument();
    // The other sections are not buttons while zoomed.
    expect(within(map()).queryByRole('button', { name: /^Section 102/ })).toBeNull();
  });

  it('Enter on a section zooms in too, and Back to layout returns', async () => {
    stubApi({ [`GET ${DRAWING_PATH}`]: json(DRAWING) });
    renderEditor(EDIT_PATH);
    await screen.findByRole('textbox', { name: 'Layout name' });
    sectionOnMap('102').focus();
    fireEvent.keyDown(sectionOnMap('102'), { key: 'Enter' });
    expect(seat('Row 1, Seat 1')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Back to layout' }));
    expect(within(map()).queryByRole('button', { name: /^Row 1, Seat 1/ })).toBeNull();
    expect(sectionOnMap('101')).toBeInTheDocument();
  });

  it('click selects a seat, Shift-click adds one', async () => {
    await zoomInto101();
    press(seat('Row A, Seat 2'));
    expect(seat('Row A, Seat 2')).toHaveAttribute('aria-pressed', 'true');
    press(seat('Row A, Seat 3'), { shiftKey: true });
    expect(seat('Row A, Seat 3')).toHaveAttribute('aria-pressed', 'true');
    expect(
      within(panel('Selection')).getByText('2 seats selected in section 101'),
    ).toBeInTheDocument();
  });

  it('a row label selects its row; Shift on another selects the range', async () => {
    await zoomInto101();
    press(within(map()).getByRole('button', { name: 'Row A' }));
    expect(
      within(panel('Selection')).getByText('Row A selected in section 101'),
    ).toBeInTheDocument();
    press(within(map()).getByRole('button', { name: 'Row B' }), { shiftKey: true });
    expect(
      within(panel('Selection')).getByText('Rows A–B selected in section 101'),
    ).toBeInTheDocument();
    expect(seat('Row B, Seat 1')).toHaveAttribute('aria-pressed', 'true');
  });

  it('with Box select on, a drag selects the seats inside; off, it pans', async () => {
    const { user } = await zoomInto101();
    const toggle = screen.getByRole('button', { name: 'Box select' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    // Off: a drag over the seats selects nothing.
    const bg = map().querySelector('.editor-map__bg') as Element;
    fireEvent.pointerDown(bg, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(map(), { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(map(), { pointerId: 1, clientX: 20, clientY: 20 });
    expect(within(panel('Selection')).queryByText(/seats selected/)).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // The view is the section now: map places from the view's corner, 1 pixel = 1 unit at most.
    const vb = map().getAttribute('viewBox')!.split(' ').map(Number);
    const toClient = (x: number, y: number) => {
      const scale = Math.min(vb[2] / vb[2], vb[3] / vb[3]);
      return { clientX: (x - vb[0]) * scale, clientY: (y - vb[1]) * scale };
    };
    fireEvent.pointerDown(bg, { pointerId: 1, ...toClient(17, 27) });
    fireEvent.pointerMove(map(), { pointerId: 1, ...toClient(21, 31) });
    fireEvent.pointerUp(map(), { pointerId: 1, ...toClient(21, 31) });
    expect(
      within(panel('Selection')).getByText('4 seats selected in section 101'),
    ).toBeInTheDocument();
    expect(seat('Row A, Seat 3')).toHaveAttribute('aria-pressed', 'false');
  });

  it('Paint gives the selected seats the chosen level; Use section’s level clears it', async () => {
    const { user } = await zoomInto101();
    press(seat('Row B, Seat 1'));
    const levels = panel('Price levels');
    await user.click(within(levels).getByRole('radio', { name: 'Standard' }));
    await user.click(within(levels).getByRole('button', { name: 'Paint: Standard' }));
    expect(seat('Row B, Seat 1')).toHaveAccessibleName('Row B, Seat 1, Standard');
    expect(screen.getByRole('status')).toHaveTextContent('Row B, seat 1 painted Standard');
    await user.click(within(levels).getByRole('button', { name: "Use section's level" }));
    expect(seat('Row B, Seat 1')).toHaveAccessibleName('Row B, Seat 1, Courtside');
  });
});
