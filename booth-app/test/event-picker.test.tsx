import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../src/App';
import { fakeUserManager, makeUser } from '../../packages/shared/test/web/fake-user-manager';

/**
 * Spec 025 US3 (FR-014 to FR-018; research R8) (T017): the Ticket Booth lists every scheduled
 * event that has not ended, and lets the agent choose only those whose check-in window has
 * opened (`entryOpensAt`, from the Backend). The others are greyed with when they open, and the
 * list is fetched again every 30 seconds. A fake clock; every expected time is stated in the
 * venue's zone, so it holds whatever the device's zone is.
 */

type Reply = Response | (() => Response | Promise<Response>) | 'network-error';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubApi(routes: Record<string, Reply>) {
  const calls: { method: string; path: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo) => {
      const req = input instanceof Request ? input : new Request(input);
      const url = new URL(req.url);
      calls.push({ method: req.method, path: url.pathname });
      const reply = routes[`${req.method} ${url.pathname}`];
      if (reply === undefined)
        return json({ error: { code: 'NOT_FOUND', message: 'unstubbed' } }, 404);
      if (reply === 'network-error') throw new TypeError('Failed to fetch');
      return (typeof reply === 'function' ? await reply() : reply).clone();
    }),
  );
  return { calls, lists: () => calls.filter((c) => c.method === 'GET' && c.path === '/events') };
}

const EAST = { id: 'l1', name: 'Freedom Hall', timeZone: 'America/New_York' };

/** An event as GET /events lists it, with the Backend's `entryOpensAt` (or none). */
const evt = (id: string, name: string, startsAt: string, entryOpensAt?: string) => ({
  id,
  name,
  locationId: EAST.id,
  location: EAST,
  startsAt,
  endsAt: new Date(Date.parse(startsAt) + 3 * 3_600_000).toISOString(),
  ...(entryOpensAt
    ? {
        doorsOpenAt: new Date(Date.parse(entryOpensAt) + 3_600_000).toISOString(),
        entryOpensAt,
      }
    : {}),
  totalTicketCapacity: 100,
  basePrice: '45.00',
  status: 'SCHEDULED',
  cancelledAt: null,
  reservedSeating: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

// 3:00 PM EST on Nov 20, 2026.
const NOW = '2026-11-20T20:00:00.000Z';
// Open since 2:00 PM EST; starts 4:00 PM EST.
const MATINEE = evt(
  'e-open',
  'Afternoon Show',
  '2026-11-20T21:00:00.000Z',
  '2026-11-20T19:00:00.000Z',
);
// Doors 5:30 PM EST, so entry opens 4:30 PM EST; starts 7:00 PM EST.
const CONCERT = evt(
  'e-concert',
  'Fall Concert',
  '2026-11-21T00:00:00.000Z',
  '2026-11-20T21:30:00.000Z',
);
// Tomorrow: entry opens 11:00 AM EST on Nov 21.
const TOMORROW = evt(
  'e-tomorrow',
  'Sunday Matinee',
  '2026-11-21T18:00:00.000Z',
  '2026-11-21T16:00:00.000Z',
);

const KEY = 'queuepass.booth.eventId';

function renderApp() {
  const um = fakeUserManager(makeUser({ username: 'agent1', roles: ['gate-agent'] }));
  return render(<App userManager={um} />);
}

/** Lets pending promises (fetch, React updates) settle under the fake clock. */
const settle = () => act(() => vi.advanceTimersByTimeAsync(0));
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

const item = (name: string): HTMLElement => {
  const li = screen
    .getAllByRole('listitem')
    .find((l) => l.textContent?.startsWith(name)) as HTMLElement;
  expect(li).toBeDefined();
  return li;
};
const choosable = (name: string) =>
  screen.queryByRole('button', { name: new RegExp(`^${name}`) }) !== null;

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers({
    toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
  });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the list (FR-014, FR-015)', () => {
  it('makes an open event a button and shows the others greyed with when they open', async () => {
    stubApi({ 'GET /events': json([TOMORROW, CONCERT, MATINEE]) });
    renderApp();
    await settle();

    expect(screen.getByRole('button', { name: 'Afternoon Show · Nov 20, 2026, 4:00 PM EST' }));
    expect(choosable('Fall Concert')).toBe(false);
    expect(choosable('Sunday Matinee')).toBe(false);

    const concert = item('Fall Concert');
    expect(concert).toHaveTextContent('Fall Concert · Nov 20, 2026, 7:00 PM EST');
    expect(concert).toHaveTextContent('Not open yet');
    expect(concert).toHaveTextContent('Opens 4:30 PM EST');
    expect(item('Sunday Matinee')).toHaveTextContent('Opens Nov 21, 2026, 11:00 AM EST');
    // Soonest start first, greyed or not.
    expect(screen.getAllByRole('listitem').map((l) => l.textContent?.split(' · ')[0])).toEqual([
      'Afternoon Show',
      'Fall Concert',
      'Sunday Matinee',
    ]);
    expect(screen.queryByText('No event is open for entry yet.')).toBeNull();
  });

  it('gives a waiting event nothing to focus or press', async () => {
    stubApi({ 'GET /events': json([CONCERT, MATINEE]) });
    renderApp();
    await settle();
    const concert = item('Fall Concert');
    expect(within(concert).queryByRole('button')).toBeNull();
    expect(concert.querySelector('[tabindex], a, button, input')).toBeNull();
    fireEvent.click(concert);
    expect(screen.queryByLabelText('Ticket code')).toBeNull();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Log out',
      'Afternoon Show · Nov 20, 2026, 4:00 PM EST',
    ]);
  });

  it('treats an event without entryOpensAt as open (a Backend before 025)', async () => {
    stubApi({ 'GET /events': json([evt('e-old', 'Old Show', '2026-11-21T00:00:00.000Z')]) });
    renderApp();
    await settle();
    expect(choosable('Old Show')).toBe(true);
  });
});

describe('every 30 seconds (FR-016)', () => {
  it('becomes a button within 30 seconds of its window opening, after fetching again', async () => {
    vi.setSystemTime(new Date('2026-11-20T21:29:50.000Z')); // 4:29:50 PM EST
    const api = stubApi({ 'GET /events': json([CONCERT]) });
    renderApp();
    await settle();
    expect(choosable('Fall Concert')).toBe(false);
    const before = api.lists().length;

    await tick(30_000);
    expect(choosable('Fall Concert')).toBe(true);
    expect(api.lists().length).toBeGreaterThan(before);
  });

  it('picks up doors an admin moved earlier at the next tick', async () => {
    let calls = 0;
    stubApi({
      'GET /events': () =>
        json([
          (calls += 1) === 1 ? CONCERT : { ...CONCERT, entryOpensAt: '2026-11-20T19:30:00.000Z' }, // now open
        ]),
    });
    renderApp();
    await settle();
    expect(choosable('Fall Concert')).toBe(false);
    await tick(30_000);
    expect(choosable('Fall Concert')).toBe(true);
  });

  it('keeps the list when a refetch fails, and tries again at the next tick', async () => {
    let calls = 0;
    const api = stubApi({
      'GET /events': () => {
        calls += 1;
        if (calls === 2) throw new TypeError('Failed to fetch');
        return json([CONCERT, MATINEE]);
      },
    });
    renderApp();
    await settle();
    await tick(30_000);
    expect(item('Fall Concert')).toHaveTextContent('Not open yet');
    expect(choosable('Afternoon Show')).toBe(true);
    expect(screen.queryByText(/Can't reach QueuePass/)).toBeNull();
    await tick(30_000);
    expect(api.lists().length).toBeGreaterThanOrEqual(3);
    expect(choosable('Afternoon Show')).toBe(true);
  });

  it('stops fetching once an event is chosen, and fetches again after Change event', async () => {
    const api = stubApi({ 'GET /events': json([CONCERT, MATINEE]) });
    renderApp();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /^Afternoon Show/ }));
    await settle();
    expect(screen.getByLabelText('Ticket code')).toBeInTheDocument();
    const chosen = api.lists().length;
    await tick(60_000);
    expect(api.lists().length).toBe(chosen);

    fireEvent.click(screen.getByRole('button', { name: 'Change event' }));
    await settle();
    expect(api.lists().length).toBe(chosen + 1);
    expect(item('Fall Concert')).toHaveTextContent('Not open yet');
  });
});

describe('the remembered choice (FR-017)', () => {
  it('is not restored for an event not open yet, and is forgotten', async () => {
    sessionStorage.setItem(KEY, CONCERT.id);
    stubApi({ 'GET /events': json([CONCERT, MATINEE]) });
    renderApp();
    await settle();
    expect(screen.queryByLabelText('Ticket code')).toBeNull();
    expect(item('Fall Concert')).toHaveTextContent('Not open yet');
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('is restored for an open event, as before', async () => {
    sessionStorage.setItem(KEY, MATINEE.id);
    stubApi({ 'GET /events': json([CONCERT, MATINEE]) });
    renderApp();
    await settle();
    expect(screen.getByLabelText('Ticket code')).toBeInTheDocument();
    expect(sessionStorage.getItem(KEY)).toBe(MATINEE.id);
  });
});

describe('the messages (FR-018)', () => {
  it('says no event is open yet above a list of waiting events', async () => {
    stubApi({ 'GET /events': json([CONCERT, TOMORROW]) });
    renderApp();
    await settle();
    expect(screen.getByText('No event is open for entry yet.')).toBeInTheDocument();
    expect(item('Fall Concert')).toHaveTextContent('Opens 4:30 PM EST');
    expect(screen.queryByText('No event is open for entry.')).toBeNull();
  });

  it('says no event is open when none is listed', async () => {
    stubApi({ 'GET /events': json([]) });
    renderApp();
    await settle();
    expect(screen.getByText('No event is open for entry.')).toBeInTheDocument();
    expect(screen.queryByText('No event is open for entry yet.')).toBeNull();
  });
});
