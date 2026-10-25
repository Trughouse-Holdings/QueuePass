import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { fakeUserManager, makeUser } from '../../packages/shared/test/web/fake-user-manager';

/**
 * Spec 020 US6 (FR-021, FR-022; research R12, R16): every time the Ticket Booth shows is the
 * event's venue's local time with its abbreviation, identical under any device zone (`npm run
 * test:tz`). Only `Date` is faked, at 4:00 PM EDT on Oct 1, 2026, so the gate event is open.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubApi(routes: Record<string, () => Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo) => {
      const req = input instanceof Request ? input : new Request(input);
      const reply = routes[`${req.method} ${new URL(req.url).pathname}`];
      return reply ? reply() : json({ error: { code: 'NOT_FOUND', message: 'unstubbed' } }, 404);
    }),
  );
}

const NOW = new Date('2026-10-01T20:00:00.000Z'); // 4:00 PM EDT
const EAST = { id: 'l-east', name: 'Riverside', timeZone: 'America/New_York' };
const PHX = { id: 'l-phx', name: 'Phoenix Hall', timeZone: 'America/Phoenix' };
const GATE = '7c2f1b5e-1f3a-4f9e-9a2d-0c9b1d2e3f40';

const evt = (
  id: string,
  name: string,
  location: typeof EAST,
  startsAt: string,
  endsAt: string,
) => ({
  id,
  name,
  locationId: location.id,
  location,
  startsAt,
  endsAt,
  totalTicketCapacity: 100,
  basePrice: '45.00',
  status: 'SCHEDULED',
  cancelledAt: null,
  reservedSeating: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
});
// 7:00 PM EDT and 7:00 PM MST on Oct 1.
const EVENTS = [
  evt(GATE, 'Demo Tonight', EAST, '2026-10-01T23:00:00.000Z', '2026-10-02T02:00:00.000Z'),
  evt('e-phx', 'Desert Show', PHX, '2026-10-02T02:00:00.000Z', '2026-10-02T05:00:00.000Z'),
];

const ticket = (over: Record<string, unknown> = {}) => ({
  ticketId: '3b8e0000-0000-4000-8000-000000000001',
  code: '7KQ2M9XWAB4C',
  orderId: 'a1f00000-0000-4000-8000-000000000002',
  state: 'ADMITTABLE',
  event: {
    id: GATE,
    name: 'Demo Tonight',
    startsAt: EVENTS[0].startsAt,
    endsAt: EVENTS[0].endsAt,
    timeZone: 'America/New_York',
  },
  tierName: 'General',
  seat: null,
  holderName: 'Jordan Lee',
  usedAt: null,
  entryOpensAt: '2026-10-01T21:00:00.000Z', // 5:00 PM EDT
  unusedOnOrder: 2,
  verifiedBy: 'TICKET_CODE',
  ...over,
});

const LOOKUP = `POST /events/${GATE}/entry/lookup`;
const ADMIT = `POST /events/${GATE}/entry/admit`;

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function lookUp(
  routes: Record<string, () => Response>,
  events = EVENTS,
  gate = /Demo Tonight/,
) {
  stubApi({ 'GET /events': () => json(events), ...routes });
  const user = userEvent.setup();
  render(
    <App userManager={fakeUserManager(makeUser({ username: 'agent1', roles: ['gate-agent'] }))} />,
  );
  await user.click(await screen.findByRole('button', { name: gate }));
  await user.type(await screen.findByLabelText('Ticket code'), '7KQ2M9XWAB4C');
  await user.click(screen.getByRole('button', { name: 'Look up' }));
  return user;
}

describe('the event picker', () => {
  it("shows each event's start in its venue's zone", async () => {
    stubApi({ 'GET /events': () => json(EVENTS) });
    render(
      <App
        userManager={fakeUserManager(makeUser({ username: 'agent1', roles: ['gate-agent'] }))}
      />,
    );
    expect(
      await screen.findByRole('button', { name: 'Demo Tonight · Oct 1, 2026, 7:00 PM EDT' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Desert Show · Oct 1, 2026, 7:00 PM MST' }),
    ).toBeInTheDocument();
  });
});

describe('lookup results', () => {
  it("says when a used ticket was used, in the gate event's zone", async () => {
    await lookUp({
      [LOOKUP]: () => json(ticket({ state: 'USED', usedAt: '2026-10-01T23:12:00.000Z' })),
    });
    expect(
      await screen.findByText('✕ Already used at Oct 1, 2026, 7:12 PM EDT'),
    ).toBeInTheDocument();
  });

  it('says when entry opens', async () => {
    await lookUp({ [LOOKUP]: () => json(ticket({ state: 'NOT_OPEN' })) });
    expect(
      await screen.findByText('✕ Entry opens at Oct 1, 2026, 5:00 PM EDT'),
    ).toBeInTheDocument();
  });

  it("names another event's time in its own venue's zone (EntryTicket.event.timeZone)", async () => {
    await lookUp({
      [LOOKUP]: () =>
        json(
          ticket({
            state: 'OTHER_EVENT',
            event: {
              id: 'e-phx',
              name: 'Desert Show',
              startsAt: EVENTS[1].startsAt,
              endsAt: EVENTS[1].endsAt,
              timeZone: 'America/Phoenix',
            },
          }),
        ),
    });
    expect(
      await screen.findByText('✕ For Desert Show on Oct 1, 2026, 7:00 PM MST, not this event'),
    ).toBeInTheDocument();
  });
});

describe('admit results', () => {
  it("names another event's time from ENTRY_REFUSED's details.event.timeZone", async () => {
    const user = await lookUp({
      [LOOKUP]: () => json(ticket()),
      [ADMIT]: () =>
        json(
          {
            error: {
              code: 'ENTRY_REFUSED',
              message: 'This ticket is for another event.',
              details: {
                reason: 'OTHER_EVENT',
                event: {
                  id: 'e-phx',
                  name: 'Desert Show',
                  startsAt: EVENTS[1].startsAt,
                  timeZone: 'America/Phoenix',
                },
              },
            },
          },
          409,
        ),
    });
    await user.click(await screen.findByRole('button', { name: 'Admit' }));
    expect(
      await screen.findByText('✕ For Desert Show on Oct 1, 2026, 7:00 PM MST, not this event'),
    ).toBeInTheDocument();
  });

  it("says when the order's other tickets were used, in the gate event's zone", async () => {
    const user = await lookUp({
      [LOOKUP]: () => json(ticket()),
      [ADMIT]: () =>
        json({
          admitted: [{ ticketId: 't1', code: '7KQ2M9XWAB4C', usedAt: '2026-10-01T22:30:00.000Z' }],
          alreadyUsed: [
            { ticketId: 't2', code: 'AAAA2222BBBB', usedAt: '2026-10-01T22:05:00.000Z' },
          ],
        }),
    });
    await user.click(await screen.findByRole('button', { name: 'Admit all 2' }));
    expect(
      await screen.findByText('✓ 1 admitted · 1 already used at Oct 1, 2026, 6:05 PM EDT'),
    ).toBeInTheDocument();
  });
});

/**
 * Review round 2, S1: the gate event's own zone, not the Eastern fallback, for the times of a
 * ticket of this event: at a Phoenix gate every time reads MST (US6 scenario 3).
 */
describe('at a Phoenix gate', () => {
  // The gate event is at Phoenix Hall, 7:00 PM MST on Oct 1 (02:00Z on Oct 2).
  const PHX_GATE = [
    evt(GATE, 'Desert Gate', PHX, '2026-10-02T02:00:00.000Z', '2026-10-02T05:00:00.000Z'),
  ];
  const gateTicket = (over: Record<string, unknown>) =>
    ticket({
      event: {
        id: GATE,
        name: 'Desert Gate',
        startsAt: PHX_GATE[0].startsAt,
        endsAt: PHX_GATE[0].endsAt,
        timeZone: 'America/Phoenix',
      },
      entryOpensAt: '2026-10-02T00:00:00.000Z', // 5:00 PM MST
      ...over,
    });

  it('says when a used ticket was used, in MST', async () => {
    await lookUp(
      { [LOOKUP]: () => json(gateTicket({ state: 'USED', usedAt: '2026-10-01T23:12:00.000Z' })) },
      PHX_GATE,
      /Desert Gate/,
    );
    expect(
      await screen.findByText('✕ Already used at Oct 1, 2026, 4:12 PM MST'),
    ).toBeInTheDocument();
  });

  it('says when entry opens, in MST', async () => {
    await lookUp(
      { [LOOKUP]: () => json(gateTicket({ state: 'NOT_OPEN' })) },
      PHX_GATE,
      /Desert Gate/,
    );
    expect(
      await screen.findByText('✕ Entry opens at Oct 1, 2026, 5:00 PM MST'),
    ).toBeInTheDocument();
  });

  it("says when the order's other tickets were used, in MST", async () => {
    const user = await lookUp(
      {
        [LOOKUP]: () => json(gateTicket({})),
        [ADMIT]: () =>
          json({
            admitted: [
              { ticketId: 't1', code: '7KQ2M9XWAB4C', usedAt: '2026-10-01T22:30:00.000Z' },
            ],
            alreadyUsed: [
              { ticketId: 't2', code: 'AAAA2222BBBB', usedAt: '2026-10-01T22:05:00.000Z' },
            ],
          }),
      },
      PHX_GATE,
      /Desert Gate/,
    );
    await user.click(await screen.findByRole('button', { name: 'Admit all 2' }));
    expect(
      await screen.findByText('✓ 1 admitted · 1 already used at Oct 1, 2026, 3:05 PM MST'),
    ).toBeInTheDocument();
  });
});
