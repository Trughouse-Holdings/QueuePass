import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { fakeUserManager, makeUser } from '../../packages/shared/test/web/fake-user-manager';

/**
 * Spec 017 US1 (FR-007, FR-008, FR-010, FR-014, FR-015a, FR-023, FR-024): the Ticket Booth app's
 * check-in flow with a stubbed fetch. Refusal reasons are tested below (US3, T025).
 */

type Reply = Response | (() => Response | Promise<Response>) | 'network-error';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Stubs fetch with routes keyed by "METHOD /path", recording every request and its body. */
function stubApi(routes: Record<string, Reply>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo) => {
      const req = input instanceof Request ? input : new Request(input);
      const url = new URL(req.url);
      const body =
        req.method === 'GET'
          ? null
          : await req
              .clone()
              .text()
              .then((t) => (t ? JSON.parse(t) : null));
      calls.push({ method: req.method, path: url.pathname, body });
      const reply = routes[`${req.method} ${url.pathname}`];
      if (reply === undefined)
        return json({ error: { code: 'NOT_FOUND', message: 'unstubbed' } }, 404);
      if (reply === 'network-error') throw new TypeError('Failed to fetch');
      return (typeof reply === 'function' ? await reply() : reply).clone();
    }),
  );
  return { calls };
}

const hour = 3_600_000;
const iso = (inHours: number): string => new Date(Date.now() + inHours * hour).toISOString();

/** An event as GET /events lists it; starts `startsInH` hours from now and lasts 3. */
const evt = (id: string, name: string, startsInH: number, status = 'SCHEDULED') => ({
  id,
  name,
  locationId: 'l1',
  location: { id: 'l1', name: 'Demo Hall' },
  startsAt: iso(startsInH),
  endsAt: iso(startsInH + 3),
  totalTicketCapacity: 100,
  basePrice: '45.00',
  status,
  cancelledAt: status === 'CANCELLED' ? iso(-1) : null,
  reservedSeating: false,
  createdAt: iso(-24),
  updatedAt: iso(-24),
});

const EVENT_ID = '7c2f1b5e-1f3a-4f9e-9a2d-0c9b1d2e3f40';
const TICKET_ID = '3b8e0000-0000-4000-8000-000000000001';

/** A lookup answer (contract EntryTicket), ADMITTABLE unless overridden. */
const ticket = (over: Record<string, unknown> = {}) => ({
  ticketId: TICKET_ID,
  code: '7KQ2M9XWAB4C',
  orderId: 'a1f00000-0000-4000-8000-000000000002',
  state: 'ADMITTABLE',
  event: { id: EVENT_ID, name: 'Demo Tonight', startsAt: iso(1), endsAt: iso(4) },
  tierName: 'General',
  seat: null,
  holderName: 'Jordan Lee',
  usedAt: null,
  entryOpensAt: iso(-1),
  unusedOnOrder: 1,
  ...over,
});

const EVENTS = `GET /events`;
const LOOKUP = `POST /events/${EVENT_ID}/entry/lookup`;
const ADMIT = `POST /events/${EVENT_ID}/entry/admit`;

const threeEvents = () =>
  json([
    evt('e-later', 'Holiday Gala', 48),
    evt(EVENT_ID, 'Demo Tonight', 1),
    evt('e-cancelled', 'Cancelled Gala', 24, 'CANCELLED'),
    evt('e-ended', 'Last Week', -50),
  ]);

function renderApp() {
  const um = fakeUserManager(makeUser({ username: 'agent1', roles: ['gate-agent'] }));
  return { um, ...render(<App userManager={um} />) };
}

/** Signs in, waits for the event list, and chooses Demo Tonight. */
async function chooseEvent(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Demo Tonight/ }));
  return screen.findByLabelText('Ticket code');
}

async function lookUp(user: ReturnType<typeof userEvent.setup>, code = '7KQ2M9XWAB4C') {
  const field = await chooseEvent(user);
  await user.type(field, code);
  await user.click(screen.getByRole('button', { name: 'Look up' }));
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('Choosing an event (FR-007)', () => {
  it('lists only scheduled events that have not ended, soonest first', async () => {
    stubApi({ [EVENTS]: threeEvents() });
    renderApp();
    const buttons = await screen.findAllByRole('button', { name: /Demo Tonight|Gala|Last Week/ });
    expect(buttons.map((b) => b.textContent)).toEqual([
      expect.stringContaining('Demo Tonight'),
      expect.stringContaining('Holiday Gala'),
    ]);
  });

  it('keeps the choice in sessionStorage and restores it after a remount', async () => {
    stubApi({ [EVENTS]: threeEvents() });
    const user = userEvent.setup();
    const first = renderApp();
    await chooseEvent(user);
    expect(sessionStorage.getItem('queuepass.booth.eventId')).toBe(EVENT_ID);
    first.unmount();

    renderApp();
    expect(await screen.findByLabelText('Ticket code')).toBeInTheDocument();
    expect(screen.getByText(/Demo Tonight/)).toBeInTheDocument();
  });

  it('still lets the agent choose when sessionStorage throws', async () => {
    stubApi({ [EVENTS]: threeEvents() });
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    vi.stubGlobal('sessionStorage', throwing);
    const user = userEvent.setup();
    renderApp();
    expect(await chooseEvent(user)).toBeInTheDocument();
  });
});

describe('Typed lookup and the ID check (FR-008, FR-010, FR-014)', () => {
  it('shows the event, ticket type, seat, name, and the ID-check prompt', async () => {
    stubApi({
      [EVENTS]: threeEvents(),
      [LOOKUP]: json(ticket({ seat: { section: 'A', row: 2, seat: 7 }, unusedOnOrder: 1 })),
    });
    const user = userEvent.setup();
    renderApp();
    await lookUp(user);

    const result = await screen.findByRole('status');
    expect(within(result).getByText(/Demo Tonight/)).toBeInTheDocument();
    expect(within(result).getByText(/General/)).toBeInTheDocument();
    expect(within(result).getByText(/Section A, Row 2, Seat 7/)).toBeInTheDocument();
    expect(within(result).getByText('Jordan Lee')).toBeInTheDocument();
    expect(
      within(result).getByText('Check a government-issued photo ID that shows: Jordan Lee'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Admit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refuse' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Admit all/ })).not.toBeInTheDocument();
  });

  it('prompts for a valid ID only when the ticket has no name (FR-005)', async () => {
    stubApi({ [EVENTS]: threeEvents(), [LOOKUP]: json(ticket({ holderName: null })) });
    const user = userEvent.setup();
    renderApp();
    await lookUp(user);
    const result = await screen.findByRole('status');
    expect(within(result).getByText('No name on ticket')).toBeInTheDocument();
    expect(
      within(result).getByText('Check that the person shows a valid photo ID'),
    ).toBeInTheDocument();
  });
});

describe('Admit, Admit all, and Refuse (FR-015, FR-015a, FR-017)', () => {
  it('Admit posts wholeOrder: false and shows ✓ Admitted, staying until the next lookup', async () => {
    const { calls } = stubApi({
      [EVENTS]: threeEvents(),
      [LOOKUP]: json(ticket()),
      [ADMIT]: json({
        admitted: [{ ticketId: TICKET_ID, code: '7KQ2M9XWAB4C', usedAt: iso(0) }],
        alreadyUsed: [],
      }),
    });
    const user = userEvent.setup();
    renderApp();
    await lookUp(user);
    await user.click(await screen.findByRole('button', { name: 'Admit' }));

    const result = await screen.findByRole('status');
    expect(await within(result).findByText(/✓ Admitted/)).toBeInTheDocument();
    const admit = calls.find((c) => c.path.endsWith('/entry/admit'));
    expect(admit?.body).toEqual({ ticketId: TICKET_ID, wholeOrder: false });
    // FR-024: the result stays on screen until the agent starts the next lookup.
    expect(within(result).getByText(/✓ Admitted/)).toBeInTheDocument();
  });

  it('offers Admit all 4 only when unusedOnOrder > 1, posts wholeOrder: true, says ✓ 4 admitted', async () => {
    const { calls } = stubApi({
      [EVENTS]: threeEvents(),
      [LOOKUP]: json(ticket({ unusedOnOrder: 4 })),
      [ADMIT]: json({
        admitted: [1, 2, 3, 4].map((n) => ({
          ticketId: `t-${n}`,
          code: `CODE${n}`,
          usedAt: iso(0),
        })),
        alreadyUsed: [],
      }),
    });
    const user = userEvent.setup();
    renderApp();
    await lookUp(user);
    await user.click(await screen.findByRole('button', { name: 'Admit all 4' }));
    expect(await screen.findByText(/✓ 4 admitted/)).toBeInTheDocument();
    const admit = calls.find((c) => c.path.endsWith('/entry/admit'));
    expect(admit?.body).toEqual({ ticketId: TICKET_ID, wholeOrder: true });
  });

  it('reports a partial Admit all: ✓ 3 admitted · 1 already used at a time', async () => {
    stubApi({
      [EVENTS]: threeEvents(),
      [LOOKUP]: json(ticket({ unusedOnOrder: 4 })),
      [ADMIT]: json({
        admitted: [1, 2, 3].map((n) => ({ ticketId: `t-${n}`, code: `CODE${n}`, usedAt: iso(0) })),
        alreadyUsed: [{ ticketId: 't-4', code: 'CODE4', usedAt: iso(-0.2) }],
      }),
    });
    const user = userEvent.setup();
    renderApp();
    await lookUp(user);
    await user.click(await screen.findByRole('button', { name: 'Admit all 4' }));
    expect(await screen.findByText(/✓ 3 admitted · 1 already used at/)).toBeInTheDocument();
  });

  it('Refuse posts nothing and shows ✕ Not admitted; the ticket stays admittable (FR-017)', async () => {
    const { calls } = stubApi({ [EVENTS]: threeEvents(), [LOOKUP]: json(ticket()) });
    const user = userEvent.setup();
    renderApp();
    await lookUp(user);
    await user.click(await screen.findByRole('button', { name: 'Refuse' }));
    expect(await screen.findByText(/✕ Not admitted/)).toBeInTheDocument();
    expect(calls.filter((c) => c.path.endsWith('/entry/admit'))).toHaveLength(0);
  });

  it('disables the buttons while a request is in flight', async () => {
    let release: (r: Response) => void = () => undefined;
    stubApi({
      [EVENTS]: threeEvents(),
      [LOOKUP]: json(ticket({ unusedOnOrder: 2 })),
      [ADMIT]: () => new Promise<Response>((resolve) => (release = resolve)),
    });
    const user = userEvent.setup();
    renderApp();
    await lookUp(user);
    const admit = await screen.findByRole('button', { name: 'Admit' });
    await user.click(admit);
    expect(admit).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Admit all 2' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refuse' })).toBeDisabled();
    release(
      json({
        admitted: [{ ticketId: TICKET_ID, code: '7KQ2M9XWAB4C', usedAt: iso(0) }],
        alreadyUsed: [],
      }),
    );
    expect(await screen.findByText(/✓ Admitted/)).toBeInTheDocument();
  });

  it('shows a 409 ENTRY_REFUSED from Admit as a refusal with its reason', async () => {
    stubApi({
      [EVENTS]: threeEvents(),
      [LOOKUP]: json(ticket()),
      [ADMIT]: json(
        {
          error: {
            code: 'ENTRY_REFUSED',
            message: 'Already used.',
            details: { reason: 'USED', usedAt: iso(-0.1) },
          },
        },
        409,
      ),
    });
    const user = userEvent.setup();
    renderApp();
    await lookUp(user);
    await user.click(await screen.findByRole('button', { name: 'Admit' }));
    expect(await screen.findByText(/Already used at/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Admit' })).not.toBeInTheDocument();
  });
});

describe('Failures are explicit states (Constitution IV, Edge Cases)', () => {
  it('a network error on a lookup shows a plain error and re-enables the controls', async () => {
    stubApi({ [EVENTS]: threeEvents(), [LOOKUP]: 'network-error' });
    const user = userEvent.setup();
    renderApp();
    await lookUp(user);
    expect(await screen.findByText(/Can't reach QueuePass/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Look up' })).toBeEnabled();
  });

  it('a network error on an admit shows a plain error and re-enables the controls', async () => {
    stubApi({ [EVENTS]: threeEvents(), [LOOKUP]: json(ticket()), [ADMIT]: 'network-error' });
    const user = userEvent.setup();
    renderApp();
    await lookUp(user);
    await user.click(await screen.findByRole('button', { name: 'Admit' }));
    expect(await screen.findByText(/Can't reach QueuePass/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Admit' })).toBeEnabled();
  });

  it('a 401 on an admit sends the agent to sign in, keeping the chosen event', async () => {
    const { um } = (() => {
      stubApi({
        [EVENTS]: threeEvents(),
        [LOOKUP]: json(ticket()),
        [ADMIT]: json({ error: { code: 'UNAUTHENTICATED', message: 'expired' } }, 401),
      });
      const um = fakeUserManager(makeUser({ username: 'agent1', roles: ['gate-agent'] }));
      render(<App userManager={um} />);
      return { um };
    })();
    const user = userEvent.setup();
    await lookUp(user);
    await user.click(await screen.findByRole('button', { name: 'Admit' }));
    await vi.waitFor(() => expect(um.signinRedirect).toHaveBeenCalled());
    expect(sessionStorage.getItem('queuepass.booth.eventId')).toBe(EVENT_ID);
  });
});
