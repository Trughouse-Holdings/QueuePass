import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorResponse } from 'oidc-client-ts';
import {
  keyToBase64url,
  liveCode,
  parseLiveCode,
  windowAt,
  windowStartMs,
  windowStatus,
} from '@queuepass/shared';
import { qrPath } from '../src/components/TicketQr';
import { json, myOrder, renderCustomer, stubApi } from './helpers';

/**
 * Spec 018 US1 (FR-001, FR-002, FR-004, FR-009, FR-010; SC-006; research R8, R12): Show entry
 * code draws the ticket's live code, changing every 30 seconds on the Backend's clock, with no
 * signal once loaded, and keeps the key in memory only.
 */
const TICKET = '3b8e5f0a-6c1d-4b7e-9a2f-1d0c3e4b5a69';
const CODE = 'AAAA2222BBBB';
const KEY = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff);
const KEY_TEXT = keyToBase64url(KEY);
/**
 * A window in late October 2026; the server starts 10.37 seconds into it, so the page's clock
 * checks don't line up with the window boundaries by luck.
 */
const W = 59762702;
const SERVER0 = windowStartMs(W) + 10_370;
const LABEL = 'Live entry code, changes every 30 seconds';
const NO_CONNECTION =
  "Can't show the live code without a connection. Use your printed ticket with photo ID.";

const orders = (over: Parameters<typeof myOrder>[0] = {}) => [
  myOrder({
    tickets: [
      { id: TICKET, code: CODE, status: 'VALID', checkedInAt: null, seat: null },
      {
        id: 'k-used',
        code: 'CCCC3333DDDD',
        status: 'VALID',
        checkedInAt: '2026-12-01T23:10:00.000Z',
        seat: null,
      },
      { id: 'k-void', code: 'GGGG5555HHHH', status: 'VOID', checkedInAt: null, seat: null },
    ],
    ...over,
  }),
];

/** The device's clock is `skew` ms off the Backend's; the Backend answers with its own. */
let skew = 0;
const serverNow = () => Date.now() - skew;
const keyReply = () =>
  json({ ticketId: TICKET, key: KEY_TEXT, serverTime: new Date(serverNow()).toISOString() });

beforeEach(() => {
  vi.useFakeTimers({
    shouldAdvanceTime: true,
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
  });
  skew = 0;
  vi.setSystemTime(SERVER0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const drawnPath = () =>
  screen.getByRole('img', { name: LABEL }).querySelector('path')?.getAttribute('d');

/** The window of the code on screen, found among the windows around the server's. */
async function drawnWindow(): Promise<number | undefined> {
  const d = drawnPath();
  const around = windowAt(serverNow());
  for (const w of [around - 1, around, around + 1]) {
    if (qrPath(await liveCode(KEY, TICKET, w)) === d) return w;
  }
  return undefined;
}

/** Waits until the code on screen is the one for the Backend's current window. */
async function expectCurrentCode() {
  await waitFor(async () => {
    const w = await drawnWindow();
    expect(w).toBe(windowAt(serverNow()));
    expect(windowStatus(w as number, serverNow())).toBe('CURRENT');
  });
}

/**
 * FR-002, SC-006: moves to 600 ms after the next window starts, then gives the page until 1 second
 * after it, on the Backend's clock, to draw that window's code. Once the second is up the check
 * can never pass, so waiting longer doesn't help a slow page.
 */
async function expectNewCodeWithin1s() {
  const boundary = windowStartMs(windowAt(serverNow()) + 1);
  await advance(boundary + 600 - serverNow());
  await waitFor(async () => {
    expect(serverNow()).toBeLessThan(boundary + 1000);
    expect(await drawnWindow()).toBe(windowAt(boundary));
  });
}

async function openEntryCode(routes: NonNullable<Parameters<typeof stubApi>[0]> = {}) {
  const api = stubApi({
    'GET /me/orders': json(orders()),
    [`GET /me/tickets/${TICKET}/entry-key`]: keyReply,
    ...routes,
  });
  const view = renderCustomer({ at: `/my-tickets/${TICKET}/entry-code` });
  return { ...api, ...view };
}

describe('Show entry code on My tickets (FR-001, US1-6)', () => {
  it('is offered beside Print ticket on valid, unused tickets only', async () => {
    stubApi({ 'GET /me/orders': json(orders()) });
    renderCustomer({ at: '/my-tickets' });
    await screen.findByRole('heading', { name: 'My tickets', level: 1 });
    const links = screen.getAllByRole('link', { name: /^Show entry code/ });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName(`Show entry code for ticket ${CODE}`);
    expect(links[0]).toHaveAttribute('href', `/my-tickets/${TICKET}/entry-code`);
    expect(links[0].closest('li')).toContainElement(
      screen.getByRole('link', { name: `Print ticket ${CODE}` }),
    );
  });
});

describe('the live-code screen', () => {
  it('asks for the key once, then shows the code, countdown, name, event, and seat', async () => {
    let answer!: () => void;
    const gate = new Promise<void>((r) => (answer = r));
    const seated = orders();
    seated[0].tickets[0].seat = { section: 'A', row: 3, seat: 7 };
    const { calls } = await openEntryCode({
      'GET /me/orders': json(seated),
      [`GET /me/tickets/${TICKET}/entry-key`]: async () => {
        await gate;
        return keyReply();
      },
    });
    expect(await screen.findByText('Getting your entry code…')).toBeInTheDocument();
    answer();

    expect(await screen.findByRole('img', { name: LABEL })).toBeInTheDocument();
    expect(screen.getByText('Changes in 20 s')).toBeInTheDocument();
    expect(screen.getByText('Show this at the gate. It changes every 30 seconds.')).toBeVisible();
    expect(screen.getByText('Jordan Lee')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Early Show' })).toBeInTheDocument();
    expect(screen.getByText(/Dec 1, 2026/)).toBeInTheDocument();
    expect(screen.getByText('Section A, Row 3, Seat 7')).toBeInTheDocument();
    expect(calls.filter((c) => c.path.endsWith('/entry-key'))).toHaveLength(1);
  });

  it('says No name on ticket for an order from before 017', async () => {
    await openEntryCode({ 'GET /me/orders': json(orders({ holderName: null })) });
    expect(await screen.findByText('No name on ticket')).toBeInTheDocument();
  });

  it("draws the current window's live code for this ticket", async () => {
    await openEntryCode();
    await screen.findByRole('img', { name: LABEL });
    const expected = await liveCode(KEY, TICKET, windowAt(serverNow()));
    expect(parseLiveCode(expected)).toMatchObject({ ticketId: TICKET, window: W });
    await waitFor(() => expect(drawnPath()).toBe(qrPath(expected)));
  });

  it('draws a new code within 1 second of the window ending, and restarts the countdown', async () => {
    await openEntryCode();
    await screen.findByRole('img', { name: LABEL });
    await expectCurrentCode();
    await expectNewCodeWithin1s();
    expect(await drawnWindow()).toBe(W + 1);
    expect(screen.getByText(/^Changes in (30|29) s$/)).toBeInTheDocument();
  });

  it("keeps the Backend's time when the device's clock jumps while the page is open", async () => {
    await openEntryCode();
    await screen.findByRole('img', { name: LABEL });
    await expectCurrentCode();
    // An automatic time sync when the signal returns, or a manual change: an hour ahead.
    skew += 3_600_000;
    vi.setSystemTime(Date.now() + 3_600_000);
    await expectNewCodeWithin1s();
    await expectNewCodeWithin1s();
  });

  it.each([5 * 60_000, -5 * 60_000])(
    "follows the Backend's clock with the device %d ms off (FR-009, SC-006)",
    async (off) => {
      skew = off;
      vi.setSystemTime(SERVER0 + off);
      await openEntryCode();
      await screen.findByRole('img', { name: LABEL });
      await expectCurrentCode();
      for (let i = 0; i < 3; i++) await expectNewCodeWithin1s();
    },
  );

  it.each([
    ['accessTokenExpired alone (a network that hangs)', false],
    ['a network error, then accessTokenExpired', true],
  ])('keeps drawing codes for 10 minutes with no signal: %s (FR-010, SC-006)', async (_, err) => {
    const { fetchMock, um } = await openEntryCode();
    await screen.findByRole('img', { name: LABEL });
    await expectCurrentCode();

    const fetched = fetchMock.mock.calls.length;
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    um.signinSilent.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    if (err) await act(async () => um.emit('silentRenewError', new TypeError('Failed to fetch')));
    await act(async () => um.emit('accessTokenExpired'));

    for (let i = 0; i < 20; i++) await expectNewCodeWithin1s();
    expect(fetchMock.mock.calls.length).toBe(fetched);
    expect(um.signinRedirect).not.toHaveBeenCalled();
    expect(um.signinSilent).toHaveBeenCalled();
  });

  it('a Keycloak refusal still ends the session (the one way out, R12)', async () => {
    const { um } = await openEntryCode();
    await screen.findByRole('img', { name: LABEL });
    await act(async () =>
      um.emit('silentRenewError', new ErrorResponse({ error: 'invalid_grant' })),
    );
    await waitFor(() => expect(um.signinRedirect).toHaveBeenCalled());
  });

  it('writes the key to no storage, cookie, or URL (FR-010)', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const cookie = vi.spyOn(Document.prototype, 'cookie', 'set');
    await openEntryCode();
    await screen.findByRole('img', { name: LABEL });
    await advance(60_000);
    const written = [...setItem.mock.calls, ...cookie.mock.calls].flat().map(String);
    expect(written.filter((v) => v.includes(KEY_TEXT))).toEqual([]);
    expect(window.location.href).not.toContain(KEY_TEXT);
    expect(document.body.innerHTML).not.toContain(KEY_TEXT);
  });

  it('keeps the countdown out of every live region (FR-004)', async () => {
    await openEntryCode();
    const countdown = await screen.findByText(/^Changes in \d+ s$/);
    expect(countdown.closest('[aria-live], [role="status"], [role="alert"]')).toBeNull();
  });
});

describe('the live-code screen when it cannot show a code', () => {
  it('says to use the printed ticket when the key request gets no answer', async () => {
    await openEntryCode({ [`GET /me/tickets/${TICKET}/entry-key`]: 'network-error' });
    expect(await screen.findByRole('alert')).toHaveTextContent(NO_CONNECTION);
    expect(screen.queryByRole('img', { name: LABEL })).toBeNull();
  });

  it('says the same when My tickets gets no answer (a reload with no signal)', async () => {
    await openEntryCode({ 'GET /me/orders': 'network-error' });
    expect(await screen.findByText(NO_CONNECTION)).toBeInTheDocument();
  });

  it('says a used ticket was already used, with no code', async () => {
    await openEntryCode({
      [`GET /me/tickets/${TICKET}/entry-key`]: json(
        {
          error: {
            code: 'ENTRY_REFUSED',
            message: 'This ticket was already used.',
            details: { reason: 'USED', usedAt: '2026-12-01T23:10:00.000Z' },
          },
        },
        409,
      ),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('This ticket was already used.');
    expect(screen.queryByRole('img', { name: LABEL })).toBeNull();
  });

  it('says Ticket not found for a 404', async () => {
    await openEntryCode({
      [`GET /me/tickets/${TICKET}/entry-key`]: json(
        { error: { code: 'NOT_FOUND', message: `No ticket exists with id ${TICKET}.` } },
        404,
      ),
    });
    expect(await screen.findByText('Ticket not found.')).toBeInTheDocument();
  });

  it('shows the standard error with Try again for anything else, which retries', async () => {
    let fail = true;
    const { calls } = await openEntryCode({
      [`GET /me/tickets/${TICKET}/entry-key`]: () =>
        fail ? json({ error: { code: 'INTERNAL', message: 'boom' } }, 500) : keyReply(),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Can't reach the QueuePass service.",
    );
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('img', { name: LABEL })).toBeInTheDocument();
    expect(calls.filter((c) => c.path.endsWith('/entry-key'))).toHaveLength(2);
  });

  it('shows the standard error, not "no connection", when My tickets answers 500; Try again retries both', async () => {
    let fail = true;
    const { calls } = await openEntryCode({
      'GET /me/orders': () =>
        fail ? json({ error: { code: 'INTERNAL', message: 'boom' } }, 500) : json(orders()),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Can't reach the QueuePass service.",
    );
    expect(screen.queryByText(NO_CONNECTION)).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('img', { name: LABEL })).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/me/orders')).toHaveLength(2);
    expect(calls.filter((c) => c.path.endsWith('/entry-key'))).toHaveLength(2);
  });

  it("says so, instead of waiting forever, when this browser can't make the code", async () => {
    // No Web Crypto, as on a page that isn't a secure context.
    vi.spyOn(crypto.subtle, 'importKey').mockRejectedValue(new Error('no crypto.subtle'));
    await openEntryCode();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Can't show the live code in this browser. Use your printed ticket with photo ID.",
    );
    expect(screen.queryByText('Getting your entry code…')).toBeNull();
  });
});
