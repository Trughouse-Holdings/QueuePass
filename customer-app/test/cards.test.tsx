import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { usd, when } from '../src/format';
import { availability, event, json, renderCustomer, stubApi, tier, venue } from './helpers';

/** Spec 008 US2 (FR-005, FR-006; research R3, R4): events as cards, from the list's own data. */
afterEach(() => vi.unstubAllGlobals());

const early = event();
const gone = event({
  id: 'e9',
  name: 'Rained Out',
  status: 'CANCELLED',
  cancelledAt: '2026-11-20T12:00:00.000Z',
});

describe('event cards', () => {
  it('shows one card per event, in order, with every detail and links', async () => {
    stubApi({ 'GET /events': json([early, gone]), 'GET /locations': json([venue()]) });
    renderCustomer({ at: '/events' });

    const [first, second] = await screen.findAllByRole('article');
    expect(within(first).getByRole('heading', { name: 'Early Show' })).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: 'Early Show' })).toHaveAttribute(
      'href',
      '/events/e1',
    );
    expect(within(first).getByRole('link', { name: 'Alpha Arena' })).toHaveAttribute(
      'href',
      '/venues/v1',
    );
    expect(within(first).getByText(when(early.startsAt))).toBeInTheDocument();
    expect(within(first).getByText(usd(early.basePrice))).toBeInTheDocument();
    expect(within(first).queryByText('Cancelled')).toBeNull();
    expect(within(second).getByText('Cancelled')).toHaveClass('pill');
  });

  it("gives each card's links a 44-pixel tap area", async () => {
    stubApi({ 'GET /events': json([early]), 'GET /locations': json([venue()]) });
    renderCustomer({ at: '/events' });

    const [card] = await screen.findAllByRole('article');
    for (const link of within(card).getAllByRole('link')) expect(link).toHaveClass('tap');
  });

  it('needs no request per card', async () => {
    const { calls } = stubApi({
      'GET /events': json([early, gone]),
      'GET /locations': json([venue()]),
    });
    renderCustomer({ at: '/events' });

    await screen.findAllByRole('article');
    expect(calls.map((c) => c.path).sort()).toEqual(['/events', '/locations']);
  });

  it("uses the same cards on a venue's page", async () => {
    stubApi({ 'GET /locations/v1': json(venue()), 'GET /events': json([early, gone]) });
    renderCustomer({ at: '/venues/v1' });

    const cards = await screen.findAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(within(cards[1]).getByText('Cancelled')).toHaveClass('pill');
  });
});

describe('event page prices', () => {
  it('shows the lowest tier price as "from $X" for an event with tiers', async () => {
    stubApi({
      'GET /events/e1': json(early),
      'GET /events/e1/tiers': json([
        tier({ id: 't-vip', name: 'VIP', price: '120.00' }),
        tier({ id: 't-gen', name: 'General', price: '19.99' }),
      ]),
      'GET /events/e1/availability': json(availability()),
    });
    renderCustomer({ at: '/events/e1' });

    expect(await screen.findByText('From $19.99')).toBeInTheDocument();
  });
});
