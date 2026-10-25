import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { event, json, renderCustomer, stubApi, venue } from './helpers';

/**
 * Spec 008 US1 (FR-001–FR-004; research R1): find events by name, venue, dates, and status, with
 * the filters kept in the page address. TZ is America/New_York (vitest.config.ts).
 */
afterEach(() => vi.unstubAllGlobals());

const alpha = venue();
const zeta = venue({ id: 'v2', name: 'Zeta Hall' });
const opener = event({ name: 'Season Opener' });
const gone = event({
  id: 'e3',
  name: 'Gone Gala',
  status: 'CANCELLED',
  cancelledAt: '2026-11-20T12:00:00.000Z',
});

const eventCalls = (calls: { method: string; path: string; search: string }[]) =>
  calls.filter((c) => c.method === 'GET' && c.path === '/events');
const lastQuery = (calls: { method: string; path: string; search: string }[]) =>
  new URLSearchParams(eventCalls(calls).at(-1)?.search ?? '');

const routes = (events = [opener, gone]) => ({
  'GET /events': json(events),
  'GET /locations': json([alpha, zeta]),
});

describe('filters (US1-1 to US1-4)', () => {
  it('searches by name after a pause in typing', async () => {
    const { calls } = stubApi(routes());
    renderCustomer({ at: '/events' });
    // Loaded first, so the wait below times only the search pause, not a cold first render.
    await screen.findByText('Season Opener', {}, { timeout: 3000 });

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search events' }), {
      target: { value: '  open ' },
    });
    // The search waits for a 300 ms pause; allow for a busy test run.
    await vi.waitFor(() => expect(lastQuery(calls).get('q')).toBe('open'), { timeout: 3000 });
  });

  it('filters by venue', async () => {
    const { calls } = stubApi(routes());
    renderCustomer({ at: '/events' });

    await screen.findByRole('option', { name: 'Zeta Hall' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Venue' }), {
      target: { value: 'v2' },
    });
    await vi.waitFor(() => expect(lastQuery(calls).get('locationId')).toBe('v2'));
  });

  // Spec 020 FR-020 (research R15): the days as chosen; the Backend matches each event's start
  // date in its venue's zone, both days included, whatever the customer's own zone.
  it("filters by whole days at each event's venue, the end day included", async () => {
    const { calls } = stubApi(routes());
    renderCustomer({ at: '/events' });

    fireEvent.change(await screen.findByLabelText('From'), { target: { value: '2026-12-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-12-31' } });

    await vi.waitFor(() => {
      const q = lastQuery(calls);
      expect(q.get('fromDate')).toBe('2026-12-01');
      expect(q.get('toDate')).toBe('2026-12-31');
      expect(q.has('from')).toBe(false);
      expect(q.has('to')).toBe(false);
    });
  });

  it('hides cancelled events in the app, without a new request', async () => {
    const { calls } = stubApi(routes());
    renderCustomer({ at: '/events' });

    expect(await screen.findByRole('link', { name: 'Gone Gala' })).toBeInTheDocument();
    const before = eventCalls(calls).length;
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hide cancelled' }));

    expect(screen.queryByRole('link', { name: 'Gone Gala' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Season Opener' })).toBeInTheDocument();
    expect(eventCalls(calls).length).toBe(before);
  });
});

describe('the page address (US1-5; FR-003)', () => {
  it('fills the controls from the address and sends every filter in one request', async () => {
    const { calls } = stubApi(routes());
    renderCustomer({
      at: '/events?q=open&venue=v1&from=2026-12-01&to=2026-12-31&hideCancelled=1',
    });

    expect(await screen.findByRole('searchbox', { name: 'Search events' })).toHaveValue('open');
    await vi.waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Venue' })).toHaveValue('v1'),
    );
    expect(screen.getByLabelText('From')).toHaveValue('2026-12-01');
    expect(screen.getByLabelText('To')).toHaveValue('2026-12-31');
    expect(screen.getByRole('checkbox', { name: 'Hide cancelled' })).toBeChecked();
    await vi.waitFor(() => {
      const q = lastQuery(calls);
      expect(Object.fromEntries(q)).toEqual({
        q: 'open',
        locationId: 'v1',
        fromDate: '2026-12-01',
        toDate: '2026-12-31',
      });
    });
  });

  it.each([
    ['an unknown venue', '/events?venue=nope', 'locationId'],
    ['an impossible date', '/events?from=2026-13-45', 'from'],
    ['an end before the start', '/events?from=2026-12-31&to=2026-12-01', 'to'],
  ])('drops %s instead of failing', async (_, at, dropped) => {
    const { calls } = stubApi(routes());
    renderCustomer({ at });

    expect(await screen.findByRole('link', { name: 'Season Opener' })).toBeInTheDocument();
    expect(lastQuery(calls).has(dropped)).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('empty states (US1-6; FR-004)', () => {
  it('says nothing matches and clears every filter', async () => {
    let filtered = true;
    stubApi({
      'GET /events': () => json(filtered ? [] : [opener]),
      'GET /locations': json([alpha, zeta]),
    });
    renderCustomer({ at: '/events?q=zzz&hideCancelled=1' });

    expect(await screen.findByText('No events match your filters.')).toBeInTheDocument();
    filtered = false;
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(await screen.findByRole('link', { name: 'Season Opener' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search events' })).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: 'Hide cancelled' })).not.toBeChecked();
  });

  it("keeps 003's message when there are no events at all", async () => {
    stubApi(routes([]));
    renderCustomer({ at: '/events' });
    expect(await screen.findByText('Nothing is scheduled yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('treats hiding every event as no match', async () => {
    stubApi(routes([gone]));
    renderCustomer({ at: '/events?hideCancelled=1' });
    const main = await screen.findByRole('main');
    expect(await within(main).findByText('No events match your filters.')).toBeInTheDocument();
  });
});
