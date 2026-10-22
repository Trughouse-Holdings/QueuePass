import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventDetail } from '../src/pages/EventDetail';
import { json, stubApi } from './helpers/api-stub';
import { EVENT } from './fixtures-005';

/** Spec 007 US4 (FR-002, FR-004, FR-012): the event page's Seating card and seat map. */
afterEach(() => vi.unstubAllGlobals());

const PATH = `/events/${EVENT.id}`;
const VIP = {
  id: 't-vip',
  eventId: EVENT.id,
  name: 'VIP',
  price: '120.00',
  quantity: 30,
  createdAt: EVENT.createdAt,
  updatedAt: EVENT.updatedAt,
};
const GEN = { ...VIP, id: 't-gen', name: 'General', price: '40.00', quantity: 40 };

const map = (reservedSeating: boolean, sold = 0) => ({
  eventId: EVENT.id,
  reservedSeating,
  sections: [
    {
      sectionId: 's-a',
      name: 'A',
      rows: 3,
      seatsPerRow: 10,
      tierId: reservedSeating ? 't-vip' : null,
      sold,
      taken: Array.from({ length: sold }, (_, i) => ({ row: 1, seat: i + 1 })),
      reserved: [],
    },
    {
      sectionId: 's-b',
      name: 'B',
      rows: 2,
      seatsPerRow: 20,
      tierId: null,
      sold: 0,
      taken: [],
      reserved: [],
    },
  ],
});

const routes = (opts: { seatMap?: object; ticketsLeft?: number; extra?: object } = {}) => ({
  [`GET ${PATH}`]: json(EVENT),
  [`GET ${PATH}/tiers`]: json([GEN, VIP]),
  [`GET ${PATH}/seats`]: json(opts.seatMap ?? map(false)),
  [`GET ${PATH}/availability`]: json({
    eventId: EVENT.id,
    ticketsLeft: opts.ticketsLeft ?? EVENT.totalTicketCapacity,
    salesClosed: null,
    tiers: [],
  }),
  ...(opts.extra ?? {}),
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[PATH]}>
      <Routes>
        <Route path="/events/:id" element={<EventDetail />} />
      </Routes>
    </MemoryRouter>,
  );

const card = () => screen.findByRole('region', { name: 'Seating' });
const checkbox = async () =>
  within(await card()).findByRole('checkbox', { name: 'Reserved seating' });

describe('Seating card', () => {
  it('turns reserved seating on and maps each section to a tier, or to nothing', async () => {
    const api = stubApi(routes({ extra: { [`PUT ${PATH}/seating`]: json(map(true)) } }));
    renderPage();

    fireEvent.click(await checkbox());
    const region = await card();
    fireEvent.change(within(region).getByRole('combobox', { name: 'Section A tier' }), {
      target: { value: 't-vip' },
    });
    expect(
      within(within(region).getByRole('combobox', { name: 'Section B tier' }))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Not for sale', 'General', 'VIP']);
    fireEvent.click(within(region).getByRole('button', { name: 'Save seating' }));

    await within(region).findByText('0 sold, 0 reserved, 30 open');
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({
      reservedSeating: true,
      sections: [{ sectionId: 's-a', tierId: 't-vip' }],
    });
  });

  it('disables the switch, saying why, when the venue has no layout', async () => {
    stubApi(routes({ seatMap: { eventId: EVENT.id, reservedSeating: false, sections: [] } }));
    renderPage();

    expect(await checkbox()).toBeDisabled();
    expect(within(await card()).getByText('This venue has no seating layout.')).toBeInTheDocument();
  });

  it('disables the switch, saying why, once tickets are sold', async () => {
    stubApi(routes({ ticketsLeft: EVENT.totalTicketCapacity - 1 }));
    renderPage();

    expect(await checkbox()).toBeDisabled();
    expect(
      within(await card()).getByText("Seats can't change after tickets are sold."),
    ).toBeInTheDocument();
  });

  it('warns which tiers have no section, so they sell nothing', async () => {
    stubApi(routes({ seatMap: map(true) }));
    renderPage();

    const region = await card();
    expect(
      await within(region).findByText(
        'General has no section, so it sells nothing. Choose a tier for a section above.',
      ),
    ).toBeInTheDocument();
    expect(within(region).queryByText(/VIP has no section/)).toBeNull();
  });

  it("shows a refusal in the Backend's words", async () => {
    const message = 'Section A has sold seats, so it stays in its tier.';
    stubApi(
      routes({
        seatMap: map(true, 2),
        ticketsLeft: EVENT.totalTicketCapacity - 2,
        extra: {
          [`PUT ${PATH}/seating`]: json({ error: { code: 'EVENT_HAS_ORDERS', message } }, 409),
        },
      }),
    );
    renderPage();

    const region = await card();
    fireEvent.change(await within(region).findByRole('combobox', { name: 'Section A tier' }), {
      target: { value: 't-gen' },
    });
    fireEvent.click(within(region).getByRole('button', { name: 'Save seating' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });
});

describe('Seating and tiers stay in step (revision R11)', () => {
  it('offers a newly added tier in the section dropdowns, and reloads tiers after saving seating', async () => {
    let tiers = [VIP];
    const api = stubApi({
      ...routes({ seatMap: map(true) }),
      // A seated event, as in the real flow: its tier form takes no quantity.
      [`GET ${PATH}`]: json({ ...EVENT, reservedSeating: true }),
      [`GET ${PATH}/tiers`]: () => json(tiers),
      [`POST ${PATH}/tiers`]: () => {
        tiers = [GEN, VIP];
        return json(GEN, 201);
      },
      [`PUT ${PATH}/seating`]: json(map(true)),
    });
    renderPage();

    const tierForm = await screen.findByRole('form', { name: 'Add a tier' });
    fireEvent.change(within(tierForm).getByLabelText('Tier name'), {
      target: { value: 'General' },
    });
    fireEvent.change(within(tierForm).getByLabelText('Price'), { target: { value: '40.00' } });
    fireEvent.click(within(tierForm).getByRole('button', { name: 'Add tier' }));

    // The card reloads (remounts) after a tier change, so look it up afresh each time.
    await vi.waitFor(async () =>
      expect(
        within(within(await card()).getByRole('combobox', { name: 'Section B tier' }))
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['Not for sale', 'General', 'VIP']),
    );

    const before = api.count('GET', `${PATH}/tiers`);
    fireEvent.click(within(await card()).getByRole('button', { name: 'Save seating' }));
    await vi.waitFor(() => expect(api.count('GET', `${PATH}/tiers`)).toBeGreaterThan(before));
  });
});

describe('Seat map', () => {
  it('shows one section at a time, each seat sold or open, with counts', async () => {
    stubApi(routes({ seatMap: map(true, 2), ticketsLeft: EVENT.totalTicketCapacity - 2 }));
    renderPage();

    const region = await card();
    expect(await within(region).findByText('2 sold, 0 reserved, 28 open')).toBeInTheDocument();
    const grid = within(region).getByRole('group', { name: 'Section A seat map' });
    expect(within(grid).getByLabelText('Row 1, Seat 1, sold')).toBeInTheDocument();
    expect(within(grid).getByLabelText('Row 1, Seat 3, open')).toBeInTheDocument();
    expect(within(grid).getAllByLabelText(/^Row \d+, Seat \d+, (sold|open)$/)).toHaveLength(30);

    fireEvent.change(within(region).getByRole('combobox', { name: 'Seat map section' }), {
      target: { value: 's-b' },
    });
    expect(within(region).getByText('0 sold, 0 reserved, 40 open')).toBeInTheDocument();
    expect(within(region).getByRole('group', { name: 'Section B seat map' })).toBeInTheDocument();
  });
});
