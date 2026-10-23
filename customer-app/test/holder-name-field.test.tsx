import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { Reservation, SeatMap } from '@queuepass/shared';
import { availability, event, json, order, renderCustomer, stubApi, tier } from './helpers';

/**
 * Spec 017 US4 (FR-001–FR-003; research R2, R12): the Name on tickets field, validated with the
 * shared rule as a preview, with every Backend refusal shown and the choices kept
 * (Constitution IV).
 */
afterEach(() => vi.unstubAllGlobals());

const HINT = "Your name, as on the photo ID you'll show at the gate. It goes on every ticket.";

const tierlessRoutes = (orderReply: Response = json(order({ holderName: 'Jordan Lee' }), 201)) => ({
  'GET /events/e1': json(event({ basePrice: '45.50' })),
  'GET /events/e1/tiers': json([]),
  'GET /events/e1/availability': json(availability({ ticketsLeft: 7 })),
  'POST /events/e1/orders': orderReply,
});

const nameField = () => screen.findByRole('textbox', { name: /Name on tickets/ });
const confirmButton = () => screen.findByRole('button', { name: 'Confirm order' });

describe('the Name on tickets field (US4-1)', () => {
  it('shows the hint, and Confirm stays disabled until a valid name is typed', async () => {
    stubApi(tierlessRoutes());
    renderCustomer({ at: '/events/e1' });

    const field = await nameField();
    expect(screen.getByText(HINT)).toBeInTheDocument();
    expect(await confirmButton()).toBeDisabled();

    fireEvent.change(field, { target: { value: '   ' } });
    expect(await confirmButton()).toBeDisabled();

    fireEvent.change(field, { target: { value: 'Jordan Lee' } });
    expect(await confirmButton()).toBeEnabled();
  });

  it('shows the shared message for each problem once the field was touched', async () => {
    stubApi(tierlessRoutes());
    renderCustomer({ at: '/events/e1' });

    const field = await nameField();
    fireEvent.change(field, { target: { value: '1234' } });
    fireEvent.blur(field);
    expect(
      await screen.findByText('The name on the tickets must contain at least one letter.'),
    ).toBeInTheDocument();

    fireEvent.change(field, { target: { value: '' } });
    expect(await screen.findByText('Enter the name on your photo ID.')).toBeInTheDocument();
  });

  it('sends the name as holderName', async () => {
    const { calls } = stubApi(tierlessRoutes());
    renderCustomer({ at: '/events/e1' });

    fireEvent.change(await nameField(), { target: { value: 'Jordan Lee' } });
    fireEvent.click(await confirmButton());

    expect(await screen.findByRole('heading', { name: 'Order confirmed' })).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toMatchObject({ quantity: 1, holderName: 'Jordan Lee' });
  });

  it('shows a Backend HOLDER_NAME_INVALID with the quantity and name kept (Constitution IV)', async () => {
    stubApi(
      tierlessRoutes(
        json(
          {
            error: {
              code: 'HOLDER_NAME_INVALID',
              message: 'The name can be at most 100 characters.',
              details: { reason: 'TOO_LONG' },
            },
          },
          400,
        ),
      ),
    );
    renderCustomer({ at: '/events/e1' });

    const field = await nameField();
    fireEvent.change(screen.getByRole('combobox', { name: 'Quantity' }), {
      target: { value: '3' },
    });
    fireEvent.change(field, { target: { value: 'Jordan Lee' } });
    fireEvent.click(await confirmButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The name can be at most 100 characters.',
    );
    expect(screen.getByRole('combobox', { name: 'Quantity' })).toHaveValue('3');
    expect(field).toHaveValue('Jordan Lee');
  });
});

describe('the seated flow (US4-4)', () => {
  const vip = tier({ id: 't-vip', name: 'VIP', price: '120.00', quantity: 30 });
  const seatMap: SeatMap = {
    eventId: 'e1',
    reservedSeating: true,
    sections: [
      {
        sectionId: 's-a',
        name: 'A',
        rows: 2,
        seatsPerRow: 6,
        tierId: 't-vip',
        sold: 0,
        taken: [],
        reserved: [],
      },
    ],
  };
  const reservation: Reservation = {
    eventId: 'e1',
    tierId: 't-vip',
    seats: [{ sectionId: 's-a', section: 'A', row: 1, seat: 1 }],
    createdAt: '2026-10-20T19:00:00.000Z',
    expiresAt: '2026-10-20T19:05:00.000Z',
    secondsLeft: 300,
  };

  it('sends holderName with a seated order too', async () => {
    const { calls } = stubApi({
      'GET /events/e1': json(event({ reservedSeating: true })),
      'GET /events/e1/tiers': json([vip]),
      'GET /events/e1/availability': json(
        availability({ ticketsLeft: 12, tiers: [{ tierId: 't-vip', ticketsLeft: 12 }] }),
      ),
      'GET /events/e1/seats': json(seatMap),
      'GET /me/reservations': json([]),
      'POST /events/e1/reservation': json(reservation, 201),
      'POST /events/e1/orders': json(
        order({ tierId: 't-vip', tierName: 'VIP', quantity: 1, holderName: 'Jordan Lee' }),
        201,
      ),
    });
    renderCustomer({ at: '/events/e1' });

    fireEvent.click(await screen.findByRole('radio', { name: /VIP/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Row 1, Seat 1(,|$)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Reserve seats' }));
    await screen.findByRole('timer');

    fireEvent.change(await nameField(), { target: { value: 'Jordan Lee' } });
    const confirm = screen.getByRole('button', { name: 'Confirm purchase' });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(await screen.findByRole('heading', { name: 'Order confirmed' })).toBeInTheDocument();
    const orderPost = calls.find((c) => c.method === 'POST' && c.path === '/events/e1/orders');
    expect(orderPost?.body).toMatchObject({
      holderName: 'Jordan Lee',
      quantity: 1,
      seats: [{ sectionId: 's-a', row: 1, seat: 1 }],
    });
  });

  it('keeps Confirm purchase disabled without a name', async () => {
    stubApi({
      'GET /events/e1': json(event({ reservedSeating: true })),
      'GET /events/e1/tiers': json([vip]),
      'GET /events/e1/availability': json(
        availability({ ticketsLeft: 12, tiers: [{ tierId: 't-vip', ticketsLeft: 12 }] }),
      ),
      'GET /events/e1/seats': json(seatMap),
      'GET /me/reservations': json([]),
      'POST /events/e1/reservation': json(reservation, 201),
    });
    renderCustomer({ at: '/events/e1' });

    fireEvent.click(await screen.findByRole('radio', { name: /VIP/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Row 1, Seat 1(,|$)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Reserve seats' }));
    await screen.findByRole('timer');

    expect(screen.getByRole('button', { name: 'Confirm purchase' })).toBeDisabled();
  });
});
