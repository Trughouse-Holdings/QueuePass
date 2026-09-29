import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { usd, when } from '../src/format';
import { event, json, renderCustomer, stubApi, venue } from './helpers';

/** Spec 003 US1 and US2: every event and venue, in the Backend's order, read-only. */
afterEach(() => vi.unstubAllGlobals());

const bodyRows = (): HTMLElement[] => screen.getAllByRole('row').slice(1);

const zeta = venue({ id: 'v2', name: 'Zeta Hall', address: '9 Last St', seatingCapacity: 800 });
const early = event();
const late = event({
  id: 'e2',
  name: 'Late Show',
  location: zeta,
  locationId: zeta.id,
  startsAt: '2026-12-09T03:00:00.000Z', // Dec 8, 10:00 PM in New York
  endsAt: '2026-12-09T07:00:00.000Z', //   Dec 9,  2:00 AM
  basePrice: '1200.00',
});

describe('event list (US1; FR-001, FR-002, FR-006, FR-007)', () => {
  it.each(['/', '/events'])('lists every event at %s in the Backend order', async (at) => {
    const { calls } = stubApi({ 'GET /events': json([early, late]) });
    renderCustomer({ at });

    expect(await screen.findByRole('heading', { name: 'Events' })).toBeInTheDocument();
    const rows = await screen.findAllByRole('row');
    expect(rows).toHaveLength(3);

    const [first, second] = bodyRows();
    expect(within(first).getByRole('link', { name: 'Early Show' })).toHaveAttribute(
      'href',
      '/events/e1',
    );
    expect(within(first).getByRole('link', { name: 'Alpha Arena' })).toHaveAttribute(
      'href',
      '/venues/v1',
    );
    expect(within(first).getByText(when(early.startsAt))).toBeInTheDocument();
    expect(within(first).getByText(when(early.endsAt))).toBeInTheDocument();
    expect(within(first).getByText('$45.50')).toBeInTheDocument();
    expect(within(second).getByRole('link', { name: 'Late Show' })).toBeInTheDocument();
    expect(within(second).getByText(usd('1200.00'))).toBeInTheDocument();

    expect(calls).toEqual([
      expect.objectContaining({
        method: 'GET',
        path: '/events',
        authorization: expect.stringMatching(/^Bearer /),
      }),
    ]);
  });

  it('gives an event that crosses midnight both of its dates', async () => {
    stubApi({ 'GET /events': json([late]) });
    renderCustomer();

    const [row] = await screen.findAllByRole('row').then(() => bodyRows());
    expect(within(row).getByText(/Dec 8, 2026/)).toBeInTheDocument();
    expect(within(row).getByText(/Dec 9, 2026/)).toBeInTheDocument();
  });

  it('says so when nothing is scheduled', async () => {
    stubApi({ 'GET /events': json([]) });
    renderCustomer();
    expect(await screen.findByText('Nothing is scheduled yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says the service cannot be reached instead of showing a blank list', async () => {
    stubApi({ 'GET /events': 'network-error' });
    renderCustomer();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Can't reach the QueuePass service.",
    );
  });

  it('sends an expired session back through sign-in', async () => {
    stubApi({ 'GET /events': json({ error: { code: 'UNAUTHENTICATED', message: 'x' } }, 401) });
    const { um } = renderCustomer();
    await vi.waitFor(() => expect(um.signinRedirect).toHaveBeenCalled());
  });
});

describe('event page (US1, US2-4; FR-005)', () => {
  it('shows the event and links to its venue', async () => {
    stubApi({ 'GET /events/e1': json(early) });
    renderCustomer({ at: '/events/e1' });

    expect(await screen.findByRole('heading', { name: 'Early Show' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alpha Arena' })).toHaveAttribute('href', '/venues/v1');
    expect(screen.getByText(when(early.startsAt))).toBeInTheDocument();
    expect(screen.getByText(when(early.endsAt))).toBeInTheDocument();
    expect(screen.getByText('18,000')).toBeInTheDocument();
    expect(screen.getByText('$45.50')).toBeInTheDocument();
  });

  it('says an event that is gone is no longer available', async () => {
    stubApi();
    renderCustomer({ at: '/events/gone' });
    expect(await screen.findByText('This event is no longer available.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to events' })).toHaveAttribute('href', '/events');
  });
});

describe('venue list (US2; FR-003)', () => {
  it('lists every venue in the Backend order', async () => {
    stubApi({ 'GET /locations': json([venue(), zeta]) });
    renderCustomer({ at: '/venues' });

    expect(await screen.findByRole('heading', { name: 'Venues' })).toBeInTheDocument();
    await screen.findAllByRole('row');
    const [first, second] = bodyRows();
    expect(within(first).getByRole('link', { name: 'Alpha Arena' })).toHaveAttribute(
      'href',
      '/venues/v1',
    );
    expect(within(first).getByText('1 Arena Plaza, Louisville, KY')).toBeInTheDocument();
    expect(within(first).getByText('22,090')).toBeInTheDocument();
    expect(within(second).getByRole('link', { name: 'Zeta Hall' })).toBeInTheDocument();
  });

  it('says so when there are no venues', async () => {
    stubApi({ 'GET /locations': json([]) });
    renderCustomer({ at: '/venues' });
    expect(await screen.findByText('No venues yet.')).toBeInTheDocument();
  });
});

describe('venue page (US2; FR-004)', () => {
  it("shows the venue and its events, asking the Backend for that venue's events", async () => {
    const matinee = event({ id: 'e3', name: 'Matinee', startsAt: '2026-12-01T17:00:00.000Z' });
    const { calls } = stubApi({
      'GET /locations/v1': json(venue()),
      'GET /events': json([matinee, early]),
    });
    renderCustomer({ at: '/venues/v1' });

    expect(await screen.findByRole('heading', { name: 'Alpha Arena' })).toBeInTheDocument();
    expect(screen.getByText('1 Arena Plaza, Louisville, KY')).toBeInTheDocument();
    expect(screen.getByText('22,090')).toBeInTheDocument();
    await screen.findAllByRole('row');
    const [first, second] = bodyRows();
    expect(within(first).getByRole('link', { name: 'Matinee' })).toHaveAttribute(
      'href',
      '/events/e3',
    );
    expect(within(second).getByRole('link', { name: 'Early Show' })).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/events')?.search).toBe('?locationId=v1');
  });

  it('says nothing is scheduled at a venue with no events', async () => {
    stubApi({ 'GET /locations/v2': json(zeta), 'GET /events': json([]) });
    renderCustomer({ at: '/venues/v2' });
    expect(await screen.findByText('Nothing is scheduled here.')).toBeInTheDocument();
  });

  it('says a venue that is gone is no longer available', async () => {
    stubApi({ 'GET /events': json([]) });
    renderCustomer({ at: '/venues/gone' });
    expect(await screen.findByText('This venue is no longer available.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to venues' })).toHaveAttribute('href', '/venues');
  });
});
