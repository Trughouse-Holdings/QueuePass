import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventDetail } from '../src/pages/EventDetail';
import { json, stubApi } from './helpers/api-stub';

/** Spec 004 US1 (FR-001–FR-005): the Ticket tiers section of the event page. */
const VENUE = {
  id: '6ad046d4-2ca4-4cc4-8cc8-f5a167814e3e',
  name: 'Yum Center',
  address: '1 Arena Plaza',
  seatingCapacity: 22090,
  createdAt: '2026-09-20T18:57:51.352Z',
  updatedAt: '2026-09-20T18:57:51.352Z',
};
const EVENT = {
  id: 'b92fc02c-6013-470d-a3bf-bf53648b0ebc',
  name: 'Season Opener',
  locationId: VENUE.id,
  location: VENUE,
  startsAt: '2026-10-01T22:00:00.000Z',
  endsAt: '2026-10-02T01:00:00.000Z',
  totalTicketCapacity: 1000,
  basePrice: '45.00',
  createdAt: VENUE.createdAt,
  updatedAt: VENUE.updatedAt,
};
const tier = (id: string, name: string, price: string, quantity: number) => ({
  id,
  eventId: EVENT.id,
  name,
  price,
  quantity,
  createdAt: VENUE.createdAt,
  updatedAt: VENUE.updatedAt,
});
const GENERAL = tier('11111111-1111-4111-8111-111111111111', 'General', '45.00', 800);
const VIP = tier('22222222-2222-4222-8222-222222222222', 'VIP', '120.00', 100);

const PATH = `/events/${EVENT.id}`;
const TIERS = `${PATH}/tiers`;

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[PATH]}>
      <Routes>
        <Route path="/events/:id" element={<EventDetail />} />
      </Routes>
    </MemoryRouter>,
  );

const section = async () => within(await screen.findByRole('region', { name: 'Ticket tiers' }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Ticket tiers on the event page', () => {
  it('lists tiers with price and quantity, and how much capacity is allocated', async () => {
    stubApi({ [`GET ${PATH}`]: json(EVENT), [`GET ${TIERS}`]: json([GENERAL, VIP]) });
    renderPage();

    const s = await section();
    expect(await s.findByText('General')).toBeInTheDocument();
    expect(s.getByText('$120.00')).toBeInTheDocument();
    expect(s.getByText('800')).toBeInTheDocument();
    expect(s.getByText('Allocated 900 of 1,000 tickets')).toBeInTheDocument();
  });

  it('says when an event has no tiers', async () => {
    stubApi({ [`GET ${PATH}`]: json(EVENT), [`GET ${TIERS}`]: json([]) });
    renderPage();
    const s = await section();
    expect(await s.findByText(/No tiers yet/)).toBeInTheDocument();
  });

  it('adds a tier with the typed values and shows it', async () => {
    const posted: unknown[] = [];
    let list = [GENERAL];
    stubApi({
      [`GET ${PATH}`]: json(EVENT),
      [`GET ${TIERS}`]: () => json(list),
      [`POST ${TIERS}`]: async () => {
        list = [GENERAL, VIP];
        return json(VIP, 201);
      },
    });
    const fetchMock = vi.mocked(fetch);
    renderPage();
    const s = await section();
    await s.findByText('General');

    await userEvent.type(s.getByLabelText('Tier name'), 'VIP');
    await userEvent.type(s.getByLabelText('Price'), '120');
    await userEvent.type(s.getByLabelText('Quantity'), '100');
    await userEvent.click(s.getByRole('button', { name: 'Add tier' }));

    expect(await s.findByText('VIP')).toBeInTheDocument();
    for (const [input] of fetchMock.mock.calls) {
      const req = input as Request;
      if (req.method === 'POST') posted.push(await req.clone().json());
    }
    expect(posted).toEqual([{ name: 'VIP', price: '120', quantity: 100 }]);
    // The form is cleared for the next tier.
    expect(s.getByLabelText('Tier name')).toHaveValue('');
  });

  it('shows a capacity refusal and keeps what was typed', async () => {
    stubApi({
      [`GET ${PATH}`]: json(EVENT),
      [`GET ${TIERS}`]: json([GENERAL]),
      [`POST ${TIERS}`]: json(
        {
          error: {
            code: 'CAPACITY_EXCEEDED',
            message:
              'Season Opener has 1000 tickets and 800 are already in tiers; only 200 remain, so 500 cannot be added.',
            details: { totalTicketCapacity: 1000, allocated: 800, requested: 500, remaining: 200 },
          },
        },
        409,
      ),
    });
    renderPage();
    const s = await section();
    await s.findByText('General');

    await userEvent.type(s.getByLabelText('Tier name'), 'VIP');
    await userEvent.type(s.getByLabelText('Price'), '120');
    await userEvent.type(s.getByLabelText('Quantity'), '500');
    await userEvent.click(s.getByRole('button', { name: 'Add tier' }));

    expect(await s.findByRole('alert')).toHaveTextContent('only 200 remain');
    expect(s.getByLabelText('Tier name')).toHaveValue('VIP');
    expect(s.getByLabelText('Quantity')).toHaveValue(500);
  });

  it('edits a tier through PATCH', async () => {
    let current = VIP;
    const { calls } = stubApi({
      [`GET ${PATH}`]: json(EVENT),
      [`GET ${TIERS}`]: () => json([GENERAL, current]),
      [`PATCH ${TIERS}/${VIP.id}`]: () => {
        current = { ...VIP, quantity: 150 };
        return json(current);
      },
    });
    renderPage();
    const s = await section();
    const row = (await s.findByText('VIP')).closest('tr') as HTMLElement;

    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    const qty = within(row).getByLabelText('Quantity for VIP');
    await userEvent.clear(qty);
    await userEvent.type(qty, '150');
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }));

    expect(await s.findByText('150')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it('removes a tier only after the admin confirms', async () => {
    let list = [GENERAL, VIP];
    const { calls } = stubApi({
      [`GET ${PATH}`]: json(EVENT),
      [`GET ${TIERS}`]: () => json(list),
      [`DELETE ${TIERS}/${VIP.id}`]: () => {
        list = [GENERAL];
        return new Response(null, { status: 204 });
      },
    });
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    renderPage();
    const s = await section();
    const row = (await s.findByText('VIP')).closest('tr') as HTMLElement;

    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('VIP'));
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);

    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    await vi.waitFor(() => expect(s.queryByText('VIP')).toBeNull());
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });
});
