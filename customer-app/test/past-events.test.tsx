import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { event, json, renderCustomer, stubApi, venue } from './helpers';

/**
 * Spec 030 US1, US2 (FR-014; research R6, R7, R11): the Customer app never asks for past events
 * and offers no control to show them; a past event's own page opens and says it has ended.
 */
const NOW = Date.parse('2026-11-09T17:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const iso = (ms: number) => new Date(ms).toISOString();

const alpha = venue();
const zeta = venue({ id: 'v2', name: 'Zeta Hall' });
const timed = (id: string, name: string, startsAt: number, endsAt: number, over = {}) =>
  event({
    id,
    name,
    startsAt: iso(startsAt),
    endsAt: iso(endsAt),
    doorsOpenAt: iso(startsAt - HOUR),
    entryOpensAt: iso(startsAt - 2 * HOUR),
    ...over,
  });
const ENDED = timed('e9', 'Ended Show', NOW - 4 * HOUR, NOW - MINUTE);
const NOW_PLAYING = timed('e1', 'Now Playing', NOW - 30 * MINUTE, NOW + 2 * HOUR);
const GONE = timed('e8', 'Rained Out', NOW - 8 * HOUR, NOW - 6 * HOUR, {
  status: 'CANCELLED',
  cancelledAt: iso(NOW - 24 * HOUR),
});

type Call = { method: string; path: string; search: string };
const eventCalls = (calls: Call[]) =>
  calls.filter((c) => c.method === 'GET' && c.path === '/events');
const noneAskForPast = (calls: Call[]) => {
  expect(eventCalls(calls).length).toBeGreaterThan(0);
  for (const c of eventCalls(calls))
    expect(new URLSearchParams(c.search).has('includePast')).toBe(false);
};
const noPastControl = () => {
  for (const role of ['checkbox', 'button', 'link', 'switch'] as const)
    expect(screen.queryAllByRole(role, { name: /past/i })).toHaveLength(0);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const routes = () => ({
  'GET /events': json([NOW_PLAYING]),
  'GET /locations': json([alpha, zeta]),
  'GET /locations/v1': json(alpha),
});

describe('the lists never ask for past events (FR-014)', () => {
  it('the Events page', async () => {
    const { calls } = stubApi(routes());
    renderCustomer({ at: '/events' });

    await screen.findByText('Now Playing');
    noneAskForPast(calls);
    noPastControl();
  });

  it('a search by name', async () => {
    const { calls } = stubApi(routes());
    renderCustomer({ at: '/events' });
    await screen.findByText('Now Playing');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search events' }), {
      target: { value: 'show' },
    });
    await vi.waitFor(
      () => expect(new URLSearchParams(eventCalls(calls).at(-1)?.search).get('q')).toBe('show'),
      { timeout: 3000 },
    );
    noneAskForPast(calls);
    noPastControl();
  });

  it('a venue filter', async () => {
    const { calls } = stubApi(routes());
    renderCustomer({ at: '/events' });

    await screen.findByRole('option', { name: 'Zeta Hall' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Venue' }), {
      target: { value: 'v2' },
    });
    await vi.waitFor(() =>
      expect(new URLSearchParams(eventCalls(calls).at(-1)?.search).get('locationId')).toBe('v2'),
    );
    noneAskForPast(calls);
  });

  it('a date filter', async () => {
    const { calls } = stubApi(routes());
    renderCustomer({ at: '/events' });

    fireEvent.change(await screen.findByLabelText('From'), { target: { value: '2026-11-01' } });
    await vi.waitFor(() =>
      expect(new URLSearchParams(eventCalls(calls).at(-1)?.search).get('fromDate')).toBe(
        '2026-11-01',
      ),
    );
    noneAskForPast(calls);
  });

  it("a venue's page", async () => {
    const { calls } = stubApi(routes());
    renderCustomer({ at: '/venues/v1' });

    await screen.findByText('Now Playing');
    expect(eventCalls(calls).map((c) => c.search)).toEqual(['?locationId=v1']);
    noneAskForPast(calls);
    noPastControl();
  });
});

describe("a past event's own page (FR-014; research R7)", () => {
  const ENDED_TEXT = 'This event has ended.';

  it('opens and says the event has ended, under its name', async () => {
    stubApi({ 'GET /events/e9': json(ENDED) });
    renderCustomer({ at: '/events/e9' });

    const heading = await screen.findByRole('heading', { level: 1, name: 'Ended Show' });
    const notice = screen.getByText(ENDED_TEXT);
    expect(notice.closest('p')?.previousElementSibling).toBe(heading);
  });

  it('says nothing of the kind for an event in progress', async () => {
    stubApi({ 'GET /events/e1': json(NOW_PLAYING) });
    renderCustomer({ at: '/events/e1' });

    await screen.findByRole('heading', { level: 1, name: 'Now Playing' });
    expect(screen.queryByText(ENDED_TEXT)).not.toBeInTheDocument();
  });

  it('a cancelled event that has ended says both, cancelled first', async () => {
    stubApi({ 'GET /events/e8': json(GONE) });
    renderCustomer({ at: '/events/e8' });

    await screen.findByRole('heading', { level: 1, name: 'Rained Out' });
    const cancelled = screen.getByText('This event has been cancelled.').closest('p');
    const ended = screen.getByText(ENDED_TEXT).closest('p');
    expect(cancelled?.nextElementSibling).toBe(ended);
  });
});
