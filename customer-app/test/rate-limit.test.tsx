import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Reservation, SeatMap } from '@queuepass/shared';
import {
  availability,
  event,
  json,
  order,
  renderCustomer,
  stubApi,
  tier,
  typeHolderName,
} from './helpers';

/**
 * Spec 026 US2 (FR-011 to FR-014; research R6, R10): a buy or hold attempt refused as too many
 * tries shows the message above the button it explains, counting down each second from the
 * Backend's N; that kind's buttons wait it out (aria-disabled, still focusable); nothing is lost.
 */
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Reply = Response | (() => Response);
const vip = tier({ id: 't-vip', name: 'VIP', price: '120.00', quantity: 30 });

const seatMap = (): SeatMap => ({
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
});

const reservation = (seats: [number, number][], over: Partial<Reservation> = {}): Reservation => ({
  eventId: 'e1',
  tierId: 't-vip',
  seats: seats.map(([row, seat]) => ({ sectionId: 's-a', section: 'A', row, seat })),
  createdAt: '2026-10-20T19:00:00.000Z',
  expiresAt: '2026-10-20T19:05:00.000Z',
  secondsLeft: 300,
  ...over,
});

const seatedRoutes = (extra: Record<string, Reply> = {}) => ({
  'GET /events/e1': json(event({ reservedSeating: true })),
  'GET /events/e1/tiers': json([vip]),
  'GET /events/e1/availability': json(
    availability({ ticketsLeft: 12, tiers: [{ tierId: 't-vip', ticketsLeft: 12 }] }),
  ),
  'GET /events/e1/seats': json(seatMap()),
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

const fakeClock = () =>
  vi.useFakeTimers({
    shouldAdvanceTime: true,
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
  });
const advance = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));
const button = (name: string) => screen.getByRole('button', { name });
const seatButton = (row: number, seat: number) =>
  screen.getByRole('button', { name: new RegExp(`^Row ${row}, Seat ${seat}(,|$)`) });
const picks = () =>
  within(screen.getByRole('list', { name: 'Chosen seats' }))
    .queryAllByRole('listitem')
    .map((li) => li.firstChild?.textContent);
const reservedSeats = () =>
  within(screen.getByRole('list', { name: 'Reserved seats' }))
    .queryAllByRole('listitem')
    .map((li) => li.firstChild?.textContent);
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

describe('a hold refused as too many tries (US2-1, US2-2; FR-011 to FR-013)', () => {
  it('counts down above Reserve seats, keeps everything, then lets the customer try again', async () => {
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

    fireEvent.click(await screen.findByRole('radio', { name: /VIP/ }));
    const said = watchAnnouncements();
    await typeHolderName();
    fireEvent.click(seatButton(1, 1));
    fireEvent.click(button('Reserve seats'));
    await screen.findByRole('timer');

    fireEvent.click(seatButton(1, 2));
    const reserve = button('Reserve seats');
    reserve.focus();
    fireEvent.click(reserve);

    await waitFor(() => expect(countdown()).toHaveTextContent(message(3)));
    // Directly above the button it explains.
    expect(reserve.previousElementSibling).toBe(countdown());
    expect(reserve).toHaveAttribute('aria-disabled', 'true');
    expect(reserve).toBeEnabled();
    expect(document.activeElement).toBe(reserve);
    // Nothing lost: the pick, the held seat, and the buying controls.
    expect(picks()).toEqual(['Section A, Row 1, Seat 2']);
    expect(reservedSeats()).toEqual(['Section A, Row 1, Seat 1']);
    expect(button('Confirm purchase')).toBeEnabled();
    expect(button('Confirm purchase')).not.toHaveAttribute('aria-disabled');
    expect(button('Release Section A, Row 1, Seat 1')).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'Name on tickets' })).toHaveValue('Jordan Lee');

    // Pressing it, or Enter on it, sends nothing while it waits.
    fireEvent.click(reserve);
    fireEvent.keyDown(reserve, { key: 'Enter' });
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
    expect(reserve).not.toHaveAttribute('aria-disabled');
    expect(document.activeElement).toBe(reserve);

    fireEvent.click(reserve);
    await waitFor(() =>
      expect(reservedSeats()).toEqual(['Section A, Row 1, Seat 1', 'Section A, Row 1, Seat 2']),
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

  it('on Confirm purchase, waits the buying buttons only; holds and the hold countdown carry on', async () => {
    fakeClock();
    const { calls } = stubApi(
      seatedRoutes({
        'GET /me/reservations': json([reservation([[1, 1]], { secondsLeft: 200 })]),
        'POST /events/e1/orders': limited('BUY', 3),
        'POST /events/e1/reservation': json(
          reservation(
            [
              [1, 1],
              [1, 3],
            ],
            { secondsLeft: 198 },
          ),
          200,
        ),
      }),
    );
    renderCustomer({ at: '/events/e1' });

    expect(await screen.findByRole('timer')).toHaveTextContent('3:20');
    await typeHolderName();
    fireEvent.click(button('Confirm purchase'));

    await waitFor(() => expect(countdown()).toHaveTextContent(message(3)));
    const purchase = button('Confirm purchase');
    expect(purchase).toHaveAttribute('aria-disabled', 'true');
    // Inside Reserved for you, directly above the buttons' row.
    expect(purchase.parentElement?.previousElementSibling).toBe(countdown());
    expect(reservedSeats()).toEqual(['Section A, Row 1, Seat 1']);
    expect(button('Release seats')).toBeEnabled();

    await advance(2_000);
    expect(screen.getByRole('timer')).toHaveTextContent('3:18');
    expect(countdown()).toHaveTextContent(message(1));

    // Holding still works while buying waits.
    fireEvent.click(seatButton(1, 3));
    expect(button('Reserve seats')).not.toHaveAttribute('aria-disabled');
    fireEvent.click(button('Reserve seats'));
    await waitFor(() =>
      expect(reservedSeats()).toEqual(['Section A, Row 1, Seat 1', 'Section A, Row 1, Seat 3']),
    );
    expect(posts(calls, '/events/e1/reservation')).toHaveLength(1);

    await advance(1_000);
    expect(button('Confirm purchase')).not.toHaveAttribute('aria-disabled');
  });

  it('does not announce a wait again when its button comes back during it (review M3)', async () => {
    fakeClock();
    stubApi(
      seatedRoutes({
        'GET /me/reservations': json([reservation([[1, 1]], { secondsLeft: 200 })]),
        'POST /events/e1/orders': limited('BUY', 5),
        'POST /events/e1/reservation/release': json({ reservation: null }),
        'POST /events/e1/reservation': json(reservation([[1, 4]], { secondsLeft: 300 }), 201),
      }),
    );
    renderCustomer({ at: '/events/e1' });

    await screen.findByRole('timer');
    const said = watchAnnouncements();
    await typeHolderName();
    fireEvent.click(button('Confirm purchase'));
    await waitFor(() => expect(countdown()).toHaveTextContent(message(5)));

    // Release everything: Confirm purchase and its countdown go; the wait goes on.
    fireEvent.click(button('Release seats'));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Confirm purchase' })).toBeNull(),
    );
    expect(document.querySelector('p[aria-live="off"].banner')).toBeNull();

    // Hold again within the wait: Confirm purchase comes back waiting, shown but not said again.
    await advance(1_000);
    fireEvent.click(seatButton(1, 4));
    fireEvent.click(button('Reserve seats'));
    await waitFor(() =>
      expect(button('Confirm purchase')).toHaveAttribute('aria-disabled', 'true'),
    );
    expect(countdown()).toHaveTextContent(message(4));
    expect(said).toEqual([message(5)]);
    expect(announcer()).toHaveTextContent(message(5));
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

    fireEvent.click(await screen.findByRole('radio', { name: /VIP/ }));
    fireEvent.click(seatButton(1, 1));
    fireEvent.click(button('Reserve seats'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Slow down.');
    expect(button('Reserve seats')).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText(/^Too many tries/)).toBeNull();
  });
});
