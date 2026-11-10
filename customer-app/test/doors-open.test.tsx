import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { Event, MyOrder, OrderEvent } from '@queuepass/shared';
import {
  event,
  json,
  myOrder,
  renderCustomer,
  stubApi,
  venue,
  fixTimeBeforeFixtures,
} from './helpers';

// Spec 030 (T011): fixed-date fixtures, so the time is fixed before them.
fixTimeBeforeFixtures();

/**
 * Spec 025 US4 (FR-019, FR-021, FR-023; research R9) (T021): the doors-open time next to the
 * start, as a "Doors open" term just before "Starts", in the venue's zone: the time alone on the
 * start's local date, the date and time otherwise, nothing when the Backend sends none. Exact
 * values in the venue's zone, so it holds whatever the device's zone is.
 */
afterEach(() => vi.unstubAllGlobals());

const EAST = venue({ timeZone: 'America/New_York' });
// 7:00 PM EST on Nov 20, doors 5:30 PM EST.
const SAME_DAY = { startsAt: '2026-11-21T00:00:00.000Z', doorsOpenAt: '2026-11-20T22:30:00.000Z' };
// 1:00 AM EST on Nov 20, doors 11:30 PM EST on Nov 19.
const DAY_BEFORE = {
  startsAt: '2026-11-20T06:00:00.000Z',
  endsAt: '2026-11-20T09:00:00.000Z',
  doorsOpenAt: '2026-11-20T04:30:00.000Z',
};

const withDoors = (over: Partial<Event>): Event =>
  event({ location: EAST, endsAt: '2026-11-21T03:00:00.000Z', ...over });

const orderFor = (e: Event): MyOrder =>
  myOrder({
    event: {
      id: e.id,
      name: e.name,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      ...(e.doorsOpenAt ? { doorsOpenAt: e.doorsOpenAt } : {}),
      status: e.status,
      location: {
        id: EAST.id,
        name: EAST.name,
        address: EAST.address,
        timeZone: 'America/New_York',
      },
    } as OrderEvent,
  });

/** The terms of a `dl` in order, and the value after "Doors open". */
function terms(scope: HTMLElement): { names: string[]; doors: string | null } {
  const dts = Array.from(scope.querySelectorAll('dt'));
  const doors = dts.find((dt) => dt.textContent === 'Doors open');
  return {
    names: dts.map((dt) => dt.textContent ?? ''),
    doors: doors?.nextElementSibling?.textContent ?? null,
  };
}

function expectDoorsBeforeStarts(scope: HTMLElement, value: string) {
  const { names, doors } = terms(scope);
  expect(names.indexOf('Doors open')).toBeGreaterThanOrEqual(0);
  expect(names.indexOf('Doors open')).toBe(names.indexOf('Starts') - 1);
  expect(doors).toBe(value);
}

const places = [
  {
    where: 'the event card',
    show: async (e: Event) => {
      stubApi({ 'GET /events': json([e]), 'GET /locations': json([EAST]) });
      renderCustomer({ at: '/events' });
      return (await screen.findAllByRole('article'))[0] as HTMLElement;
    },
  },
  {
    where: 'the event page',
    show: async (e: Event) => {
      stubApi({ [`GET /events/${e.id}`]: json(e) });
      renderCustomer({ at: `/events/${e.id}` });
      await screen.findByRole('heading', { name: e.name, level: 1 });
      return document.body;
    },
  },
  {
    where: 'My tickets',
    show: async (e: Event) => {
      stubApi({ 'GET /me/orders': json([orderFor(e)]) });
      renderCustomer({ at: '/my-tickets' });
      return (await screen.findAllByRole('article'))[0] as HTMLElement;
    },
  },
  {
    where: 'the printed ticket',
    show: async (e: Event) => {
      stubApi({ 'GET /me/orders': json([orderFor(e)]) });
      renderCustomer({ at: '/my-tickets/k1/print' });
      await screen.findByRole('button', { name: 'Print' });
      return document.body;
    },
  },
];

describe.each(places)('Doors open on $where (FR-019, FR-021)', ({ show }) => {
  it('shows the time alone on the start’s local date, just before Starts', async () => {
    expectDoorsBeforeStarts(await show(withDoors(SAME_DAY)), '5:30 PM EST');
  });

  it('shows the date and time when doors open the day before', async () => {
    expectDoorsBeforeStarts(await show(withDoors(DAY_BEFORE)), 'Nov 19, 2026, 11:30 PM EST');
  });

  it('shows nothing for an event without doorsOpenAt (a Backend before 025)', async () => {
    // Required from contract 1.17.1; an older Backend leaves it out.
    const { doorsOpenAt: _doors, ...old } = withDoors({ startsAt: SAME_DAY.startsAt });
    const scope = await show(old as Event);
    expect(terms(scope).names).not.toContain('Doors open');
    expect(terms(scope).names).toContain('Starts');
  });
});

describe('a cancelled event (FR-023)', () => {
  it('still shows its doors-open time on its page', async () => {
    const e = withDoors({ ...SAME_DAY, status: 'CANCELLED', cancelledAt: '2026-11-01T12:00:00Z' });
    stubApi({ [`GET /events/${e.id}`]: json(e) });
    renderCustomer({ at: `/events/${e.id}` });
    await screen.findByText('This event has been cancelled.');
    expectDoorsBeforeStarts(document.body, '5:30 PM EST');
  });

  it('still shows it on its card', async () => {
    const e = withDoors({ ...SAME_DAY, status: 'CANCELLED', cancelledAt: '2026-11-01T12:00:00Z' });
    stubApi({ 'GET /events': json([e]), 'GET /locations': json([EAST]) });
    renderCustomer({ at: '/events' });
    const [card] = await screen.findAllByRole('article');
    expect(within(card as HTMLElement).getByText('Cancelled')).toBeInTheDocument();
    expectDoorsBeforeStarts(card as HTMLElement, '5:30 PM EST');
  });
});
