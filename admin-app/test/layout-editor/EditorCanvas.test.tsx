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
 * Spec 039 US1 (FR-005, FR-011; research R5, R11; T026): on the map, dragging a selected section
 * moves it by the pointer's offset in map units (one Undo step), several together; the turn handle
 * turns the selection in 1° steps, 15° with Shift; past the top or left edge everything moves so
 * no place is below 0; the floor object is picked, moved and resized by its corners.
 *
 * jsdom lays nothing out, so the map's box is its view: one pixel is one map unit (the view is
 * the 300 × 200 fit of the Riverside layout).
 */
beforeAll(installPointerEvents);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function open() {
  stubApi({ [`GET ${DRAWING_PATH}`]: json(DRAWING) });
  const view = renderEditor(EDIT_PATH);
  await screen.findByRole('textbox', { name: 'Layout name' });
  return view;
}

/** Presses on `el` at a client point, moves over the map to another, and lets go. */
function drag(el: Element, from: [number, number], to: [number, number], init = {}) {
  fireEvent.pointerDown(el, {
    clientX: from[0],
    clientY: from[1],
    pointerId: 1,
    button: 0,
    ...init,
  });
  fireEvent.pointerMove(map(), {
    clientX: (from[0] + to[0]) / 2,
    clientY: (from[1] + to[1]) / 2,
    pointerId: 1,
    ...init,
  });
  fireEvent.pointerMove(map(), { clientX: to[0], clientY: to[1], pointerId: 1, ...init });
  fireEvent.pointerUp(map(), { clientX: to[0], clientY: to[1], pointerId: 1, ...init });
}

const place = () => {
  const sel = panel('Selection');
  return [
    Number((within(sel).getByLabelText('x') as HTMLInputElement).value),
    Number((within(sel).getByLabelText('y') as HTMLInputElement).value),
    Number((within(sel).getByLabelText('Angle') as HTMLInputElement).value),
  ];
};

describe('dragging sections', () => {
  it('moves a section by the pointer’s offset in map units, as one Undo step', async () => {
    const user = userEvent.setup();
    await open();
    drag(sectionOnMap('101'), [20, 29], [30, 34]);
    expect(sectionOnMap('101')).toHaveAttribute('aria-pressed', 'true');
    expect(place()).toEqual([30, 35, 0]);
    expect(screen.getByRole('status')).toHaveTextContent('Section 101 moved');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(place()).toEqual([20, 30, 0]);
  });

  it('a press without a move only selects', async () => {
    await open();
    fireEvent.pointerDown(sectionOnMap('102'), { clientX: 100, clientY: 31, pointerId: 1 });
    fireEvent.pointerUp(map(), { clientX: 100, clientY: 31, pointerId: 1 });
    expect(sectionOnMap('102')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('Shift-click adds a section; dragging one of two selected moves both', async () => {
    await open();
    fireEvent.pointerDown(sectionOnMap('101'), { clientX: 20, clientY: 29, pointerId: 1 });
    fireEvent.pointerUp(map(), { clientX: 20, clientY: 29, pointerId: 1 });
    fireEvent.pointerDown(sectionOnMap('102'), {
      clientX: 100,
      clientY: 31,
      pointerId: 1,
      shiftKey: true,
    });
    fireEvent.pointerUp(map(), { clientX: 100, clientY: 31, pointerId: 1, shiftKey: true });
    expect(within(panel('Selection')).getByText('2 sections selected')).toBeInTheDocument();
    drag(sectionOnMap('102'), [100, 31], [105, 31]);
    expect(screen.getByRole('status')).toHaveTextContent('2 sections moved');
    // Select 101 alone again to read its place.
    await userEvent
      .setup()
      .click(within(panel('Sections')).getByRole('button', { name: /^101 ·/ }));
    expect(place()).toEqual([25, 30, 0]);
  });

  it('dragging past the top edge moves everything down so no place is below 0', async () => {
    await open();
    drag(sectionOnMap('101'), [20, 29], [20, -11]);
    // 101's outline reached −13.5: everything moved down 15.
    expect(place()).toEqual([20, 5, 0]);
  });

  it('Shift-click on a selected section takes it out of the selection', async () => {
    await open();
    fireEvent.pointerDown(sectionOnMap('101'), { clientX: 20, clientY: 29, pointerId: 1 });
    fireEvent.pointerUp(map(), { clientX: 20, clientY: 29, pointerId: 1 });
    fireEvent.pointerDown(sectionOnMap('101'), {
      clientX: 20,
      clientY: 29,
      pointerId: 1,
      shiftKey: true,
    });
    fireEvent.pointerUp(map(), { clientX: 20, clientY: 29, pointerId: 1, shiftKey: true });
    expect(sectionOnMap('101')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('the turn handle', () => {
  /** The handle's place and the selection's middle, from the drawing. */
  function handle(container: HTMLElement) {
    const h = container.querySelector('.editor-map__turn') as SVGCircleElement;
    const box = container.querySelector('.editor-map__selection') as SVGRectElement;
    const n = (el: Element, a: string) => Number(el.getAttribute(a));
    const center: [number, number] = [
      n(box, 'x') + n(box, 'width') / 2,
      n(box, 'y') + n(box, 'height') / 2,
    ];
    return { el: h, at: [n(h, 'cx'), n(h, 'cy')] as [number, number], center };
  }

  it('turns the selection in 1° steps about its origin, and the angle shows', async () => {
    const { container } = await open();
    await userEvent
      .setup()
      .click(within(panel('Sections')).getByRole('button', { name: /^101 ·/ }));
    const h = handle(container);
    // From straight above the middle to 50 right and 20 below it: 90° + atan(20/50) ≈ 111.8°.
    drag(h.el, h.at, [h.center[0] + 50, h.center[1] + 20]);
    expect(place()).toEqual([20, 30, 112]);
    expect(screen.getByRole('status')).toHaveTextContent('Section 101 turned to 112°');
  });

  it('turns in 15° steps with Shift', async () => {
    const { container } = await open();
    await userEvent
      .setup()
      .click(within(panel('Sections')).getByRole('button', { name: /^101 ·/ }));
    const h = handle(container);
    drag(h.el, h.at, [h.center[0] + 50, h.center[1] + 20], { shiftKey: true });
    expect(place()[2]).toBe(105);
  });
});

describe('the floor object', () => {
  it('is picked from the list: Court, End stage, Center stage, Ring, None', async () => {
    const user = userEvent.setup();
    const { container } = await open();
    const floor = screen.getByRole('combobox', { name: 'Floor object' });
    expect(
      within(floor)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['None', 'Court', 'End stage', 'Center stage', 'Ring']);
    await user.selectOptions(floor, 'END_STAGE');
    expect(screen.getByRole('status')).toHaveTextContent('Floor object set to End stage');
    await user.selectOptions(floor, 'NONE');
    expect(container.querySelector('.editor-map__floor')).toBeNull();
  });

  it('is moved by dragging and resized by a corner handle', async () => {
    const { container } = await open();
    const floor = () => container.querySelector('.editor-map__floor') as SVGPathElement;
    drag(floor(), [60, 50], [70, 50]);
    expect(floor().getAttribute('d')).toBe('M50 40L90 40L90 60L50 60Z');
    expect(screen.getByRole('status')).toHaveTextContent('Floor object moved');
    // Selected now: four corner handles.
    const corners = container.querySelectorAll('.editor-map__corner');
    expect(corners).toHaveLength(4);
    const se = container.querySelector('.editor-map__corner[data-corner="se"]') as Element;
    drag(se, [90, 60], [100, 70]);
    expect(floor().getAttribute('d')).toBe('M50 40L100 40L100 70L50 70Z');
    expect(screen.getByRole('status')).toHaveTextContent('Floor object resized');
  });
});
