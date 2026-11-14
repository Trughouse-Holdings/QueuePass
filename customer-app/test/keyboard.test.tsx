import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  availability,
  event,
  holdBackend,
  json,
  renderCustomer,
  seatedMap,
  stubApi,
  venue,
  fixTimeBeforeFixtures,
  findOnMap,
  mapDrawing,
} from './helpers';

// Spec 030 (T011): fixed-date fixtures, so the time is fixed before them.
fixTimeBeforeFixtures();

/** Spec 008 US3 (FR-009, SC-004): everything works from the keyboard alone. */
afterEach(() => vi.unstubAllGlobals());

describe('keyboard', () => {
  it('reaches every filter and then the first card, in order', async () => {
    const user = userEvent.setup();
    stubApi({ 'GET /events': json([event()]), 'GET /locations': json([venue()]) });
    renderCustomer({ at: '/events' });

    const search = await screen.findByRole('searchbox', { name: 'Search events' });
    await screen.findAllByRole('article');
    search.focus();

    await user.tab();
    expect(screen.getByRole('combobox', { name: 'Venue' })).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('From')).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('To')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('checkbox', { name: 'Hide cancelled' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Early Show' })).toHaveFocus();
  });

  it('opens the map, a section, and holds a seat by keyboard; taken seats do nothing', async () => {
    const user = userEvent.setup();
    const seats = seatedMap([
      { sectionId: 's-a', name: 'A', rows: 1, seatsPerRow: 3, sold: [[1, 2]] },
    ]);
    const { calls } = stubApi({
      'GET /events/e1': json(event({ reservedSeating: true, layoutId: 'lay-1' })),
      'GET /events/e1/tiers': json([]),
      'GET /events/e1/availability': json(availability({ ticketsLeft: 2 })),
      ...seats.routes,
      // Spec 033: a seat pressed is held at once.
      ...holdBackend().routes,
    });
    renderCustomer({ at: '/events/e1' });

    // Spec 038 (research R14): Choose seats, then a section by Enter, then a seat by Space.
    const choose = await screen.findByRole('button', { name: 'Choose seats' });
    choose.focus();
    await user.keyboard('{Enter}');
    const section = await findOnMap(/^Section A,/);
    section.focus();
    await user.keyboard('{Enter}');
    const first = await findOnMap('Row 1, Seat 1, Standard, $40, open');

    // A sold seat is reachable (aria-disabled) but pressing it does nothing.
    const sold = within(mapDrawing()).getByRole('button', {
      name: 'Row 1, Seat 2, Standard, $40, sold',
    });
    sold.focus();
    await user.keyboard(' ');
    await user.keyboard('{Enter}');
    expect(sold).toHaveAttribute('aria-disabled', 'true');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    // Spec 033 FR-013: a seated event asks for the name in the cart, not here.
    expect(screen.queryByRole('textbox', { name: 'Name on tickets' })).toBeNull();
    first.focus();
    await user.keyboard(' ');
    // Held, and the focus stays on the seat (spec 033 FR-016).
    await waitFor(() =>
      expect(first).toHaveAccessibleName('Row 1, Seat 1, Standard, $40, held by you'),
    );
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(first).toHaveFocus();
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      { seats: [{ sectionId: 's-a', row: 1, seat: 1 }] },
    ]);

    // Every seat is a tab stop, in drawing order.
    await user.tab();
    expect(sold).toHaveFocus();
    await user.tab();
    expect(
      within(mapDrawing()).getByRole('button', { name: 'Row 1, Seat 3, Standard, $40, open' }),
    ).toHaveFocus();
  });
});
