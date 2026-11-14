import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { MyReservation as Reservation } from '@queuepass/shared/web';
import {
  availability,
  event,
  json,
  order,
  renderCustomer,
  seatedMap,
  stubApi,
  fixTimeBeforeFixtures,
} from './helpers';

// Spec 030 (T011): fixed-date fixtures, so the time is fixed before them.
fixTimeBeforeFixtures();

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

  it('links the shown error to the field for screen readers, and unlinks it once fixed', async () => {
    stubApi(tierlessRoutes());
    renderCustomer({ at: '/events/e1' });

    const field = await nameField();
    expect(field).not.toHaveAttribute('aria-invalid');
    expect(field).toHaveAccessibleDescription(HINT);

    fireEvent.change(field, { target: { value: '1234' } });
    fireEvent.blur(field);
    const message = 'The name on the tickets must contain at least one letter.';
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(expect.stringContaining(message));

    fireEvent.change(field, { target: { value: 'Jordan Lee' } });
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    expect(field).not.toHaveAttribute('aria-invalid');
    expect(field).toHaveAccessibleDescription(HINT);
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
  // Spec 038: section A of a venue map, 2 rows of 6 seats at $40.
  const arena = seatedMap([{ sectionId: 's-a', name: 'A', rows: 2, seatsPerRow: 6 }]);
  const reservation: Reservation = {
    eventId: 'e1',
    tierId: null,
    seats: [
      {
        sectionId: 's-a',
        section: 'A',
        row: 1,
        seat: 1,
        rowLabel: '1',
        seatLabel: '1',
        levelName: 'Standard',
        price: '40.00',
      },
    ],
    createdAt: '2026-10-20T19:00:00.000Z',
    expiresAt: '2026-10-20T19:05:00.000Z',
    secondsLeft: 300,
  };

  const seatedRoutes = (extra: Record<string, Response> = {}) => ({
    'GET /events/e1': json(
      event({ reservedSeating: true, layoutId: 'lay-1', basePrice: '40.00', priceMax: '40.00' }),
    ),
    'GET /events/e1/tiers': json([]),
    'GET /events/e1/availability': json(availability({ ticketsLeft: 12 })),
    ...arena.routes,
    'GET /me/reservations': json([reservation]),
    ...extra,
  });

  it('asks for no name on the event page of a seated event (spec 033 FR-013)', async () => {
    stubApi(seatedRoutes());
    renderCustomer({ at: '/events/e1' });

    await screen.findByRole('timer');
    expect(screen.queryByRole('textbox', { name: /Name on tickets/ })).toBeNull();
  });

  it('sends holderName with a seated order too, from the cart (spec 033 FR-013)', async () => {
    const { calls } = stubApi(
      seatedRoutes({
        'POST /events/e1/orders': json(order({ quantity: 1, holderName: 'Jordan Lee' }), 201),
      }),
    );
    renderCustomer({ at: '/cart' });

    expect(await nameField()).toHaveAccessibleDescription(HINT);
    fireEvent.change(await nameField(), { target: { value: 'Jordan Lee' } });
    const buy = await screen.findByRole('button', { name: 'Buy tickets' });
    expect(buy).toBeEnabled();
    fireEvent.click(buy);

    expect(await screen.findByRole('heading', { name: 'Order confirmed' })).toBeInTheDocument();
    const orderPost = calls.find((c) => c.method === 'POST' && c.path === '/events/e1/orders');
    expect(orderPost?.body).toMatchObject({
      holderName: 'Jordan Lee',
      quantity: 1,
      seats: [{ sectionId: 's-a', row: 1, seat: 1 }],
    });
  });

  it('keeps Buy tickets disabled without a name', async () => {
    stubApi(seatedRoutes());
    renderCustomer({ at: '/cart' });

    expect(await screen.findByRole('button', { name: 'Buy tickets' })).toBeDisabled();
  });

  it("shows the Backend's HOLDER_NAME_INVALID in the cart, with the name kept", async () => {
    stubApi(
      seatedRoutes({
        'POST /events/e1/orders': json(
          {
            error: {
              code: 'HOLDER_NAME_INVALID',
              message: 'The name on tickets must be 2 to 100 characters.',
            },
          },
          400,
        ),
      }),
    );
    renderCustomer({ at: '/cart' });

    fireEvent.change(await nameField(), { target: { value: 'Jordan Lee' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Buy tickets' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The name on tickets must be 2 to 100 characters.',
    );
    expect(await nameField()).toHaveValue('Jordan Lee');
  });
});
