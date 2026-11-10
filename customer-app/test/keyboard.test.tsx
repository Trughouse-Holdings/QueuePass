import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SeatMap } from '@queuepass/shared';
import {
  availability,
  event,
  holdBackend,
  json,
  renderCustomer,
  stubApi,
  tier,
  venue,
  fixTimeBeforeFixtures,
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

  it('chooses a tier, a section, and a seat, skipping taken seats', async () => {
    const user = userEvent.setup();
    const map: SeatMap = {
      eventId: 'e1',
      reservedSeating: true,
      sections: [
        {
          sectionId: 's-a',
          name: 'A',
          rows: 1,
          seatsPerRow: 3,
          tierId: 't-vip',
          sold: 1,
          taken: [{ row: 1, seat: 2 }],
          reserved: [],
        },
      ],
    };
    stubApi({
      'GET /events/e1': json(event({ reservedSeating: true })),
      'GET /events/e1/tiers': json([tier({ id: 't-vip', name: 'VIP', price: '120.00' })]),
      'GET /events/e1/availability': json(
        availability({ ticketsLeft: 2, tiers: [{ tierId: 't-vip', ticketsLeft: 2 }] }),
      ),
      'GET /events/e1/seats': json(map),
      // Spec 033: a seat pressed is held at once.
      ...holdBackend().routes,
    });
    renderCustomer({ at: '/events/e1' });

    const vip = await screen.findByRole('radio', { name: /VIP/ });
    vip.focus();
    await user.keyboard(' ');
    expect(vip).toBeChecked();

    await user.tab();
    // Spec 033 FR-013: a seated event asks for the name in the cart, not here.
    expect(screen.getByRole('combobox', { name: 'Section' })).toHaveFocus();
    await user.tab();
    const first = screen.getByRole('button', { name: 'Row 1, Seat 1' });
    expect(first).toHaveFocus();
    await user.keyboard(' ');
    expect(first).toHaveAttribute('aria-pressed', 'true');
    // Held, and the focus stays on the seat (spec 033 FR-016).
    await waitFor(() => expect(first).toHaveAccessibleName('Row 1, Seat 1, reserved by you'));
    expect(first).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Row 1, Seat 3' })).toHaveFocus();
  });
});
