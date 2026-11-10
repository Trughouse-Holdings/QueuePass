import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Availability, SeatMap } from '@queuepass/shared';
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
 * Spec 034 FR-008 to FR-012, FR-017 (research R4, R5): the "already started" notice at the top of
 * the Get tickets panel, the closed message once the event has ended, the confirmation's line for
 * an order placed after the start, and the event page's "This event has ended." line following
 * the panel's availability once it has loaded.
 */
const MINUTE = 60_000;
// Nov 20, 2026, 7:00 PM to 10:00 PM EST at the venue (New York).
const START = '2026-11-21T00:00:00.000Z';
const END = '2026-11-21T03:00:00.000Z';
const DURING = Date.parse(START) + 30 * MINUTE;

const STARTED = 'This event has already started (began at 7:00 PM EST).';
const BUY = `${STARTED} You can still buy tickets until it ends at 10:00 PM EST.`;
const ENDED_LINE = 'This event has ended.';

const show = (over = {}) =>
  event({
    startsAt: START,
    endsAt: END,
    doorsOpenAt: '2026-11-20T23:00:00.000Z',
    entryOpensAt: '2026-11-20T22:00:00.000Z',
    ...over,
  });

type Reply = Response | ((req: Request) => Response | Promise<Response>);
const routes = (
  left: Partial<Availability> | Reply,
  over: { event?: ReturnType<typeof show>; orderReply?: Reply } = {},
) => ({
  'GET /events/e1': json(over.event ?? show()),
  'GET /events/e1/tiers': json([]),
  'GET /events/e1/availability':
    left instanceof Response || typeof left === 'function' ? left : json(availability(left)),
  ...(over.orderReply ? { 'POST /events/e1/orders': over.orderReply } : {}),
});

const at = (ms: number) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ms);
};
beforeEach(() => at(DURING));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const panel = () => screen.findByRole('region', { name: 'Get tickets' });
/** The panel's first paragraph after its heading. */
const firstParagraph = async () => {
  const heading = within(await panel()).getByRole('heading', { name: 'Get tickets' });
  return heading.nextElementSibling as HTMLElement;
};

/** A promise and the function that settles it. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('the notice at the top of the panel (FR-008, FR-009)', () => {
  it('says the event started and until when tickets are on sale, and offers them', async () => {
    stubApi(routes({ inProgress: true }));
    renderCustomer({ at: '/events/e1' });

    expect(await screen.findByText(BUY)).toBeInTheDocument();
    const first = await firstParagraph();
    expect(first.tagName).toBe('P');
    expect(first).toHaveTextContent(BUY);
    expect(await screen.findByRole('button', { name: 'Confirm order' })).toBeInTheDocument();
    // Once on the page: not under the event's name (spec Clarifications).
    const all = screen.getAllByText(/already started/);
    expect(all).toHaveLength(1);
    expect(await panel()).toContainElement(all[0]);
  });

  it("dates an end past the venue's midnight", async () => {
    stubApi(routes({ inProgress: true }, { event: show({ endsAt: '2026-11-21T06:00:00.000Z' }) }));
    renderCustomer({ at: '/events/e1' });

    expect(
      await screen.findByText(
        `${STARTED} You can still buy tickets until it ends at Nov 21, 2026, 1:00 AM EST.`,
      ),
    ).toBeInTheDocument();
  });

  it('shows no notice for an event not yet started', async () => {
    at(Date.parse(START) - 60 * MINUTE);
    stubApi(routes({ inProgress: false }));
    renderCustomer({ at: '/events/e1' });

    await screen.findByRole('button', { name: 'Confirm order' });
    expect(screen.queryByText(/already started/)).toBeNull();
  });
});

describe('only the first sentence when the customer cannot buy (FR-010)', () => {
  it('sold out', async () => {
    stubApi(routes({ inProgress: true, ticketsLeft: 0 }));
    renderCustomer({ at: '/events/e1' });

    expect(
      await screen.findByText('Sold out: no tickets are left for this event.'),
    ).toBeInTheDocument();
    expect(await firstParagraph()).toHaveTextContent(STARTED);
    expect(screen.queryByText(/You can still buy tickets/)).toBeNull();
  });

  it('at the per-customer limit', async () => {
    stubApi(routes({ inProgress: true, customerLimit: { limit: 2, held: 2, remaining: 0 } }));
    renderCustomer({ at: '/events/e1' });

    expect(
      await screen.findByText('You have reached the limit of 2 tickets for this event.'),
    ).toBeInTheDocument();
    expect(await firstParagraph()).toHaveTextContent(STARTED);
    expect(screen.queryByText(/You can still buy tickets/)).toBeNull();
  });

  it('seated, with no section on sale', async () => {
    const general = tier({ id: 't-gen', name: 'General', price: '40.00' });
    const map: SeatMap = {
      eventId: 'e1',
      reservedSeating: true,
      sections: [
        {
          sectionId: 's-a',
          name: 'A',
          rows: 1,
          seatsPerRow: 2,
          tierId: null,
          sold: 0,
          taken: [],
          reserved: [],
        },
      ],
    };
    stubApi({
      ...routes(
        { inProgress: true, tiers: [{ tierId: 't-gen', ticketsLeft: 40 }] },
        { event: show({ reservedSeating: true }) },
      ),
      'GET /events/e1/tiers': json([general]),
      'GET /events/e1/seats': json(map),
    });
    renderCustomer({ at: '/events/e1' });

    expect(await screen.findByText('No seats are on sale for this event yet.')).toBeInTheDocument();
    expect(await firstParagraph()).toHaveTextContent(STARTED);
    expect(screen.queryByText(/You can still buy tickets/)).toBeNull();
  });

  it('a cancelled event in progress shows only that it is cancelled', async () => {
    stubApi(routes({ salesClosed: 'CANCELLED', inProgress: true }));
    renderCustomer({ at: '/events/e1' });

    expect(
      await screen.findByText('No tickets: this event has been cancelled.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/already started/)).toBeNull();
  });
});

describe('once the event has ended (FR-011)', () => {
  it('badges Sales closed and says the event has ended, with no started notice', async () => {
    stubApi(routes({ salesClosed: 'ENDED', inProgress: false }));
    renderCustomer({ at: '/events/e1' });

    expect(await screen.findByText('Sales closed: this event has ended.')).toBeInTheDocument();
    expect(within(await panel()).getByText('Sales closed', { selector: '.pill' })).toBeVisible();
    expect(within(await panel()).queryByText(/already started/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm order' })).toBeNull();
  });
});

describe('the confirmation (FR-012)', () => {
  const buy = async () => {
    await typeHolderName();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm order' }));
    await screen.findByRole('heading', { name: 'Order confirmed' });
  };

  it('says the tickets admit until the end for an order placed after the start', async () => {
    const placed = order({ createdAt: new Date(DURING).toISOString() });
    stubApi(routes({ inProgress: true }, { orderReply: json(placed, 201) }));
    renderCustomer({ at: '/events/e1' });

    await buy();
    expect(
      screen.getByText(`${STARTED} Your tickets admit you until it ends at 10:00 PM EST.`),
    ).toBeInTheDocument();
  });

  it('says nothing about a start for an order placed before it', async () => {
    at(Date.parse(START) - 10 * MINUTE);
    const placed = order({ createdAt: new Date(Date.parse(START) - 10 * MINUTE).toISOString() });
    stubApi(routes({ inProgress: false }, { orderReply: json(placed, 201) }));
    renderCustomer({ at: '/events/e1' });

    await buy();
    expect(screen.queryByText(/already started/)).toBeNull();
  });
});

describe('one clock on the page (FR-017)', () => {
  const AFTER_END = Date.parse(END) + 3 * MINUTE;
  const BEFORE_END = Date.parse(END) - 3 * MINUTE;

  it('a fast browser clock shows no ended line while the Backend says in progress', async () => {
    at(AFTER_END);
    stubApi(routes({ inProgress: true }));
    renderCustomer({ at: '/events/e1' });

    expect(
      await screen.findByText(
        'This event has already started (began at 7:00 PM EST). You can still buy tickets until it ends at 10:00 PM EST.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(ENDED_LINE)).toBeNull());
  });

  it('a slow browser clock still shows the ended line once the Backend says ENDED', async () => {
    at(BEFORE_END);
    stubApi(routes({ salesClosed: 'ENDED', inProgress: false }));
    renderCustomer({ at: '/events/e1' });

    expect(await screen.findByText(ENDED_LINE)).toBeInTheDocument();
  });

  it('a cancelled event past its end keeps the line, unless the Backend says in progress', async () => {
    at(AFTER_END);
    const cancelled = show({ status: 'CANCELLED', cancelledAt: START });
    stubApi(routes({ salesClosed: 'CANCELLED', inProgress: false }, { event: cancelled }));
    const first = renderCustomer({ at: '/events/e1' });
    await screen.findByText('No tickets: this event has been cancelled.');
    expect(screen.getByText(ENDED_LINE)).toBeInTheDocument();
    first.unmount();

    stubApi(routes({ salesClosed: 'CANCELLED', inProgress: true }, { event: cancelled }));
    renderCustomer({ at: '/events/e1' });
    await screen.findByText('No tickets: this event has been cancelled.');
    await waitFor(() => expect(screen.queryByText(ENDED_LINE)).toBeNull());
  });

  it("follows 030's browser clock before availability answers", async () => {
    at(AFTER_END);
    const never = deferred<Response>();
    stubApi(routes(() => never.promise));
    renderCustomer({ at: '/events/e1' });

    expect(await screen.findByText(ENDED_LINE)).toBeInTheDocument();
    expect(screen.getByText('Loading tickets…')).toBeInTheDocument();
  });

  it("treats an answer saying STARTED, without inProgress, as no answer (030's rule)", async () => {
    at(AFTER_END);
    const old = { ...availability(), salesClosed: 'STARTED' } as Record<string, unknown>;
    delete old.inProgress;
    stubApi(routes(json(old)));
    renderCustomer({ at: '/events/e1' });

    await screen.findByRole('region', { name: 'Get tickets' });
    expect(await screen.findByText(ENDED_LINE)).toBeInTheDocument();
  });

  it('keeps the last answer while availability loads again, then follows the new one', async () => {
    at(AFTER_END);
    const reload = deferred<Response>();
    let reads = 0;
    stubApi(
      routes(
        () => {
          reads += 1;
          return reads === 1 ? json(availability({ inProgress: true })) : reload.promise;
        },
        {
          orderReply: json(
            { error: { code: 'SOLD_OUT', message: 'Only 0 tickets are left for Early Show.' } },
            409,
          ),
        },
      ),
    );
    renderCustomer({ at: '/events/e1' });

    await screen.findByText(BUY);
    await waitFor(() => expect(screen.queryByText(ENDED_LINE)).toBeNull());
    await typeHolderName();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm order' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only 0 tickets are left');
    await waitFor(() => expect(reads).toBe(2));
    // The reload is pending: still the last answer, no fallback to the browser's clock.
    expect(screen.queryByText(ENDED_LINE)).toBeNull();

    reload.resolve(json(availability({ salesClosed: 'ENDED', inProgress: false })));
    expect(await screen.findByText(ENDED_LINE)).toBeInTheDocument();
    expect(screen.getByText('Sales closed: this event has ended.')).toBeInTheDocument();
  });
});
