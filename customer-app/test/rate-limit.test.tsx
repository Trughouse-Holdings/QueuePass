import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { MyReservation as Reservation } from '@queuepass/shared/web';
import {
  availability,
  event,
  fakeClock,
  json,
  openSection,
  order,
  renderCustomer,
  seatedMap,
  stubApi,
  typeHolderName,
  fixTimeBeforeFixtures,
} from './helpers';

// Spec 030 (T011): fixed-date fixtures, so the time is fixed before them.
fixTimeBeforeFixtures();

/**
 * Spec 026 US2 (FR-011 to FR-014; research R6, R10): a buy or hold attempt refused as too many
 * tries shows the message above the control it explains, counting down each second from the
 * Backend's N; that kind's controls wait it out (aria-disabled, still focusable); nothing is lost.
 * Spec 033 (FR-009, FR-014): the hold wait is on a seat click, above the seat map; the buy wait on
 * Confirm order and on the cart's Buy tickets. Spec 038: the seats are on the venue map.
 */
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Reply = Response | (() => Response);

/** Spec 038: section A, 2 rows of 6 seats, all open, at $40. */
const arena = seatedMap([{ sectionId: 's-a', name: 'A', rows: 2, seatsPerRow: 6 }]);

const reservation = (seats: [number, number][], over: Partial<Reservation> = {}): Reservation => ({
  eventId: 'e1',
  tierId: null,
  seats: seats.map(([row, seat]) => ({
    sectionId: 's-a',
    section: 'A',
    row,
    seat,
    rowLabel: String(row),
    seatLabel: String(seat),
    levelName: 'Standard',
    price: '40.00',
  })),
  createdAt: '2026-10-20T19:00:00.000Z',
  expiresAt: '2026-10-20T19:05:00.000Z',
  secondsLeft: 300,
  ...over,
});

const seatedRoutes = (extra: Record<string, Reply> = {}) => ({
  'GET /events/e1': json(
    event({ reservedSeating: true, layoutId: 'lay-1', basePrice: '40.00', priceMax: '40.00' }),
  ),
  'GET /events/e1/tiers': json([]),
  'GET /events/e1/availability': json(availability({ ticketsLeft: 12 })),
  ...arena.routes,
  'GET /me/reservations': json([]),
  ...extra,
});

const generalRoutes = (orderReply: Reply) => ({
  'GET /events/e1': json(event({ basePrice: '45.50' })),
  'GET /events/e1/tiers': json([]),
  'GET /events/e1/availability': json(availability({ ticketsLeft: 7 })),
  'POST /events/e1/orders': orderReply,
});

const limited = (action: 'BUY' | 'HOLD', seconds: number) =>
  json(
    {
      error: {
        code: 'RATE_LIMITED',
        message: `Too many tries. You can try again in ${seconds} seconds.`,
        details: { action, retryAfterSeconds: seconds },
      },
    },
    429,
  );

/** A browser moves focus off a button that becomes natively disabled; jsdom does not. */
const losingFocus = (reply: Response): (() => Response) => {
  return () => {
    (document.activeElement as HTMLElement | null)?.blur();
    return reply;
  };
};

const advance = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));
const button = (name: string) => screen.getByRole('button', { name });
const seatButton = (row: number, seat: number) =>
  screen.getByRole('button', { name: new RegExp(`^Row ${row}, Seat ${seat}, `) });
const heldSeats = () =>
  within(screen.getByRole('region', { name: 'Your seats' }))
    .queryAllByRole('listitem')
    .map((li) => li.textContent);
const posts = (calls: { method: string; path: string; body: unknown }[], path: string) =>
  calls.filter((c) => c.method === 'POST' && c.path === path);
const message = (seconds: number) =>
  `Too many tries. You can try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`;
/** The visible countdown, which is not a live region (aria-live off). */
const countdown = () =>
  screen.getByText(
    (_, el) =>
      el?.tagName === 'P' &&
      /^Too many tries/.test(el.textContent ?? '') &&
      el.getAttribute('aria-live') === 'off',
  );
/** FR-013 (review M2, M3): the one live region that announces a refusal for the limit. */
const announcer = (): HTMLElement => {
  const all = document.querySelectorAll<HTMLElement>('[data-announces="rate-limit"]');
  expect(all).toHaveLength(1);
  return all[0];
};
/**
 * Every text the live region is given while the test runs: each is one announcement. Attached once
 * the page has loaded, as the region stays mounted from then on.
 */
const watchAnnouncements = (): string[] => {
  const said: string[] = [];
  const region = announcer();
  new MutationObserver(() => {
    const text = region.textContent ?? '';
    if (text !== '' && text !== said.at(-1)) said.push(text);
  }).observe(region, { childList: true, characterData: true, subtree: true });
  return said;
};
/** No alert anywhere else says it: the banners' own alerts never carry it (review M2). */
const otherAlerts = () =>
  screen.queryAllByRole('alert').filter((a) => /Too many tries/.test(a.textContent ?? ''));

describe('a hold refused as too many tries (US2-1, US2-2; FR-011 to FR-013; spec 033 FR-009)', () => {
  it('counts down above the seat map, keeps everything, then lets the customer click again', async () => {
    fakeClock();
    let holds = 0;
    const { calls } = stubApi(
      seatedRoutes({
        'POST /events/e1/reservation': () => {
          holds += 1;
          if (holds === 1) return json(reservation([[1, 1]]), 201);
          if (holds === 2) return limited('HOLD', 3);
          return json(
            reservation([
              [1, 1],
              [1, 2],
            ]),
            200,
          );
        },
      }),
    );
    renderCustomer({ at: '/events/e1' });

    await openSection('A');
    const said = watchAnnouncements();
    fireEvent.click(seatButton(1, 1));
    await screen.findByRole('timer');

    const second = seatButton(1, 2);
    second.focus();
    fireEvent.click(second);

    await waitFor(() => expect(countdown()).toHaveTextContent(message(3)));
    // Directly above the seat map it explains.
    expect(countdown().nextElementSibling).toBe(
      screen.getByRole('group', { name: 'Arena map' }).closest('.venue-map'),
    );
    // Open seats wait it out, still focusable; the clicked one keeps the focus.
    expect(seatButton(1, 2)).toHaveAttribute('aria-disabled', 'true');
    expect(seatButton(1, 2)).toBeEnabled();
    expect(document.activeElement).toBe(seatButton(1, 2));
    // Nothing lost: the held seat, the countdown, and Add to cart; the held seat still releases.
    expect(heldSeats()).toEqual(['Section A, Row 1, Seat 1, Standard, $40.00']);
    expect(button('Add to cart')).toBeEnabled();
    expect(seatButton(1, 1)).not.toHaveAttribute('aria-disabled');

    // Clicking an open seat, or Enter on it, sends nothing while it waits.
    fireEvent.click(seatButton(1, 2));
    fireEvent.keyDown(seatButton(1, 3), { key: 'Enter' });
    fireEvent.click(seatButton(1, 3));
    expect(posts(calls, '/events/e1/reservation')).toHaveLength(2);

    // Announced once, by the one live region, which keeps the first N; the countdown is not live.
    expect(announcer()).toHaveTextContent(message(3));
    expect(otherAlerts()).toHaveLength(0);
    expect(countdown().closest('[aria-live]')).toHaveAttribute('aria-live', 'off');

    await advance(1_000);
    expect(countdown()).toHaveTextContent(message(2));
    await advance(1_000);
    expect(countdown()).toHaveTextContent(message(1));
    expect(announcer()).toHaveTextContent(message(3));
    expect(said).toEqual([message(3)]);
    await advance(1_000);
    expect(screen.queryByText(/^Too many tries/)).toBeNull();
    expect(announcer()).toBeEmptyDOMElement();
    expect(seatButton(1, 2)).not.toHaveAttribute('aria-disabled');

    // The refused click is not sent again by itself; the next click holds the seat.
    expect(posts(calls, '/events/e1/reservation')).toHaveLength(2);
    fireEvent.click(seatButton(1, 2));
    await waitFor(() =>
      expect(heldSeats()).toEqual([
        'Section A, Row 1, Seat 1, Standard, $40.00',
        'Section A, Row 1, Seat 2, Standard, $40.00',
      ]),
    );
    expect(posts(calls, '/events/e1/reservation').map((c) => c.body)).toEqual([
      { seats: [{ sectionId: 's-a', row: 1, seat: 1 }] },
      { seats: [{ sectionId: 's-a', row: 1, seat: 2 }] },
      { seats: [{ sectionId: 's-a', row: 1, seat: 2 }] },
    ]);
  });
});

describe('a buy refused as too many tries (US2-3, US2-4; FR-011, FR-012)', () => {
  it('counts down above Confirm order, keeping the quantity, the name, and the focus', async () => {
    fakeClock();
    let n = 0;
    const { calls } = stubApi(
      generalRoutes(() => {
        n += 1;
        return n === 1 ? losingFocus(limited('BUY', 2))() : json(order(), 201);
      }),
    );
    renderCustomer({ at: '/events/e1' });

    fireEvent.change(await screen.findByRole('combobox', { name: 'Quantity' }), {
      target: { value: '2' },
    });
    await typeHolderName();
    const confirm = button('Confirm order');
    confirm.focus();
    fireEvent.click(confirm);

    await waitFor(() => expect(countdown()).toHaveTextContent(message(2)));
    const again = button('Confirm order');
    expect(again.previousElementSibling).toBe(countdown());
    expect(again).toHaveAttribute('aria-disabled', 'true');
    expect(document.activeElement).toBe(again);
    expect(screen.getByRole('combobox', { name: 'Quantity' })).toHaveValue('2');
    expect(screen.getByRole('textbox', { name: 'Name on tickets' })).toHaveValue('Jordan Lee');
    // Nothing was recorded, so what is left is not loaded again.
    expect(calls.filter((c) => c.path === '/events/e1/availability')).toHaveLength(1);

    fireEvent.click(again);
    expect(posts(calls, '/events/e1/orders')).toHaveLength(1);

    await advance(1_000);
    expect(countdown()).toHaveTextContent(message(1));
    await advance(1_000);
    expect(again).not.toHaveAttribute('aria-disabled');
    fireEvent.click(again);
    await screen.findByRole('region', { name: 'Order confirmed' });
    const [first, second] = posts(calls, '/events/e1/orders').map(
      (c) => (c.body as { requestId: string }).requestId,
    );
    // Nothing was recorded for the refused one, and it is still this confirmation.
    expect(second).toBe(first);
  });

  it("on the cart's Buy tickets, waits the buying buttons only; the hold countdown carries on (spec 033 FR-014)", async () => {
    fakeClock();
    let n = 0;
    const { calls } = stubApi(
      seatedRoutes({
        'GET /me/reservations': json([reservation([[1, 1]], { secondsLeft: 200 })]),
        'POST /events/e1/orders': () => (n++ === 0 ? limited('BUY', 3) : json(order(), 201)),
      }),
    );
    renderCustomer({ at: '/cart' });

    expect(await screen.findByRole('timer')).toHaveTextContent('3:20');
    await typeHolderName();
    const buy = button('Buy tickets');
    buy.focus();
    fireEvent.click(buy);

    await waitFor(() => expect(countdown()).toHaveTextContent(message(3)));
    expect(button('Buy tickets')).toHaveAttribute('aria-disabled', 'true');
    // Directly above the button it explains.
    expect(button('Buy tickets').previousElementSibling).toBe(countdown());
    expect(document.activeElement).toBe(button('Buy tickets'));
    expect(screen.getByRole('textbox', { name: 'Name on tickets' })).toHaveValue('Jordan Lee');

    fireEvent.click(button('Buy tickets'));
    expect(posts(calls, '/events/e1/orders')).toHaveLength(1);

    await advance(2_000);
    expect(screen.getByRole('timer')).toHaveTextContent('3:18');
    expect(countdown()).toHaveTextContent(message(1));

    await advance(1_000);
    expect(button('Buy tickets')).not.toHaveAttribute('aria-disabled');
    fireEvent.click(button('Buy tickets'));
    await screen.findByRole('region', { name: 'Order confirmed' });
    const [first, second] = posts(calls, '/events/e1/orders').map(
      (c) => (c.body as { requestId: string }).requestId,
    );
    // Nothing was recorded for the refused one, and it is still this purchase.
    expect(second).toBe(first);
  });

  it('announces a wait once though the cart shows it above each Buy tickets (review M3)', async () => {
    fakeClock();
    stubApi(
      seatedRoutes({
        'GET /me/reservations': json([
          reservation([[1, 1]], { secondsLeft: 200 }),
          reservation([[1, 1]], { eventId: 'e2', secondsLeft: 250 }),
        ]),
        'GET /events/e2': json(event({ id: 'e2', name: 'Late Play', reservedSeating: true })),
        'GET /events/e2/tiers': json([]),
        'POST /events/e1/orders': limited('BUY', 5),
      }),
    );
    renderCustomer({ at: '/cart' });

    await screen.findByRole('region', { name: 'Late Play' });
    const said = watchAnnouncements();
    await typeHolderName();
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Early Show' })).getByRole('button', {
        name: 'Buy tickets',
      }),
    );

    await waitFor(() =>
      expect(
        screen.getAllByText(message(5)).filter((p) => p.getAttribute('aria-live') === 'off'),
      ).toHaveLength(2),
    );
    for (const b of screen.getAllByRole('button', { name: 'Buy tickets' })) {
      expect(b).toHaveAttribute('aria-disabled', 'true');
    }
    await advance(1_000);
    expect(said).toEqual([message(5)]);
    expect(announcer()).toHaveTextContent(message(5));
    expect(otherAlerts()).toHaveLength(0);
  });

  it('stops counting down when the page goes away (review M4)', async () => {
    fakeClock();
    const set = vi.spyOn(globalThis, 'setInterval');
    const clear = vi.spyOn(globalThis, 'clearInterval');
    stubApi(generalRoutes(limited('BUY', 3)));
    const { unmount } = renderCustomer({ at: '/events/e1' });

    await typeHolderName();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm order' }));
    await waitFor(() => expect(countdown()).toHaveTextContent(message(3)));
    const started = () =>
      set.mock.results
        .filter((_, i) => set.mock.calls[i][1] === 250)
        .map((r) => r.value as unknown);
    // The interval starts in a passive effect, which may run just after the commit waitFor saw.
    await waitFor(() => expect(started()).toHaveLength(1));
    const ticks = started();
    expect(clear.mock.calls.map(([id]) => id)).not.toContain(ticks[0]);

    unmount();
    expect(clear.mock.calls.map(([id]) => id)).toContain(ticks[0]);
  });
});

describe('Check again refused as too many tries (US2-5; FR-014)', () => {
  it('stays unknown with the countdown, then repeats the same confirmation', async () => {
    fakeClock();
    let n = 0;
    const { calls } = stubApi(
      generalRoutes(() => {
        n += 1;
        if (n === 1) return json({ error: { code: 'NOT_FOUND', message: 'x' } }, 500);
        if (n === 2) return limited('BUY', 2);
        return json(order(), 200);
      }),
    );
    renderCustomer({ at: '/events/e1' });

    await typeHolderName();
    const said = watchAnnouncements();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm order' }));
    const unknown = "We couldn't confirm whether your order went through.";
    await screen.findByText(unknown);
    const banner = screen.getByText(unknown).closest('[role="alert"]');
    fireEvent.click(button('Check again'));

    await waitFor(() => expect(countdown()).toHaveTextContent(message(2)));
    expect(screen.getByText(unknown)).toBeInTheDocument();
    // Review M2: the banner stays mounted through Check again, so it is not announced again, and
    // the refusal is said once, by the one live region, never by an alert of its own.
    expect(screen.getByText(unknown).closest('[role="alert"]')).toBe(banner);
    expect(said).toEqual([message(2)]);
    expect(
      screen.queryAllByRole('alert').filter((a) => /^Too many tries/.test(a.textContent ?? '')),
    ).toHaveLength(0);
    const again = button('Check again');
    expect(again.previousElementSibling).toBe(countdown());
    expect(again).toHaveAttribute('aria-disabled', 'true');
    expect(document.activeElement).toBe(again);
    fireEvent.click(again);
    expect(posts(calls, '/events/e1/orders')).toHaveLength(2);

    await advance(2_000);
    expect(again).not.toHaveAttribute('aria-disabled');
    fireEvent.click(again);
    await screen.findByRole('region', { name: 'Order confirmed' });
    const ids = posts(calls, '/events/e1/orders').map(
      (c) => (c.body as { requestId: string }).requestId,
    );
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(1);
  });
});

describe('a 429 that is not a refusal for the limit', () => {
  it.each([
    ['no retryAfterSeconds', { code: 'RATE_LIMITED', message: 'Slow down.' }],
    [
      'a retryAfterSeconds that is not a number',
      { code: 'RATE_LIMITED', message: 'Slow down.', details: { retryAfterSeconds: '3' } },
    ],
    ['another code', { code: 'VALIDATION_FAILED', message: 'Slow down.' }],
  ])('with %s is shown as any refusal, with nothing waiting', async (_, error) => {
    stubApi(
      seatedRoutes({
        'POST /events/e1/reservation': json({ error }, 429),
      }),
    );
    renderCustomer({ at: '/events/e1' });

    await openSection('A');
    fireEvent.click(seatButton(1, 1));

    expect(await screen.findByRole('alert')).toHaveTextContent('Slow down.');
    expect(seatButton(1, 2)).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText(/^Too many tries/)).toBeNull();
  });
});
