import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventForm } from '../src/pages/EventForm';
import { json, stubApi } from './helpers/api-stub';
import { EVENT, VENUE } from './fixtures-005';
import { layoutRoutes, SECTIONS } from './fixtures-038';
import { setLocalDateTime } from './helpers/event-times';

/**
 * Spec 038 US2 (FR-010–FR-015; research R8, R15; `035`'s rules): the event form's Seating section.
 * Reserved seating is a layout of the venue, with a preview; a price table of its levels started
 * from the layout's latest prices; an off-sale tool in a zoomed section with the running line
 * "N seats on sale · M off sale"; refusals beside their fields, focused, every value kept; one
 * request with `layoutId`, `levelPrices` and `offSale`.
 */
afterEach(() => vi.unstubAllGlobals());

const PATH = `/events/${EVENT.id}`;
const SEATED_VENUE = { ...VENUE, seatingCapacity: 70 };
const SEATED_EVENT = {
  ...EVENT,
  reservedSeating: true,
  layoutId: 'l-arena',
  priceMax: '95.00',
  totalTicketCapacity: 60,
};

const at = (path: string, route: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={<EventForm />} />
        <Route path="/events/:id" element={<p>Event page</p>} />
      </Routes>
    </MemoryRouter>,
  );

const writes = (api: ReturnType<typeof stubApi>) => api.calls.filter((c) => c.method !== 'GET');
const line = () => screen.getByTestId('seat-line');
const seatingSelect = () => screen.getByRole('combobox', { name: 'Seating' });
const priceBox = (level: string) => screen.queryByRole('textbox', { name: `${level} price` });
const tool = () => screen.getByRole('group', { name: 'Seats off sale' });

async function newForm(extra: Record<string, Response> = {}) {
  const api = stubApi({
    'GET /locations': json([SEATED_VENUE]),
    ...layoutRoutes(),
    ...extra,
  });
  at('/events/new', '/events/new');
  fireEvent.change(await screen.findByLabelText('Event name'), {
    target: { value: 'Cardinals vs. Duke' },
  });
  await screen.findByRole('option', { name: /Yum Center/ });
  fireEvent.change(screen.getByLabelText('Venue'), { target: { value: VENUE.id } });
  setLocalDateTime('Starts', '2030-05-01T18:00');
  setLocalDateTime('Ends', '2030-05-01T21:00');
  await screen.findByRole('option', { name: 'Arena (70 seats)' });
  return api;
}

async function chooseLayout(name: 'Arena' | 'Club') {
  fireEvent.change(seatingSelect(), { target: { value: name === 'Arena' ? 'l-arena' : 'l-club' } });
  await screen.findByRole('img', {
    name: name === 'Arena' ? 'Arena: 3 sections' : 'Club: 1 section',
  });
  await screen.findByRole('table', { name: 'Prices by level' });
}

async function openSection(name: string) {
  fireEvent.click(within(tool()).getByRole('button', { name: `Section ${name}` }));
  return within(tool()).findByRole('heading', { name: `Section ${name}` });
}

describe('Schedule a seated event', () => {
  it("offers the venue's layouts and general admission, with a preview of the chosen one", async () => {
    await newForm();
    const options = within(seatingSelect())
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['General admission', 'Arena (70 seats)', 'Club (12 seats)']);
    expect(seatingSelect()).toHaveValue('');
    // General admission keeps its ticket types and total.
    expect(screen.getByLabelText('Ticket type 1 quantity')).toBeInTheDocument();

    await chooseLayout('Arena');
    expect(screen.queryByLabelText('Ticket type 1 name')).toBeNull();
    expect(screen.queryByLabelText('Total tickets')).toBeNull();
  });

  it('shows each level with its color, seats on sale and a price box started from the latest prices', async () => {
    await newForm();
    await chooseLayout('Arena');
    const table = screen.getByRole('table', { name: 'Prices by level' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[0]?.textContent)).toEqual([
      'Front',
      'Back',
      'Upper',
    ]);
    expect(rows[0]!.querySelector('.level-swatch--violet')).not.toBeNull();
    expect(within(rows[0]!).getByText('30')).toBeInTheDocument();
    expect(priceBox('Front')).toHaveValue('90.00');
    expect(priceBox('Back')).toHaveValue('55.00');
    expect(priceBox('Upper')).toHaveValue('');
    expect(screen.getByText(/Prices from Earlier game/)).toBeInTheDocument();
    expect(line()).toHaveTextContent('70 seats on sale · 0 off sale');

    await chooseLayout('Club');
    expect(priceBox('Club seats')).toHaveValue('');
  });

  it('takes a section, a row and a seat off sale in a zoomed section, updating the line at once', async () => {
    await newForm();
    await chooseLayout('Arena');

    await openSection('Balcony');
    fireEvent.click(within(tool()).getByRole('button', { name: 'Whole section off sale' }));
    expect(line()).toHaveTextContent('60 seats on sale · 10 off sale');
    // Upper sells nothing now, so it asks no price.
    expect(priceBox('Upper')).toBeNull();
    expect(screen.getByText('All seats off sale')).toBeInTheDocument();
    expect(
      within(tool()).getByRole('button', { name: 'Whole section on sale' }),
    ).toBeInTheDocument();

    fireEvent.click(within(tool()).getByRole('button', { name: 'Back to all sections' }));
    await openSection('Floor A');
    fireEvent.click(await within(tool()).findByRole('checkbox', { name: 'Row 1 off sale' }));
    expect(line()).toHaveTextContent('50 seats on sale · 20 off sale');
    const seat = within(tool()).getByRole('button', { name: 'Row 2, Seat 3' });
    fireEvent.click(seat);
    expect(seat).toHaveAttribute('aria-pressed', 'true');
    expect(line()).toHaveTextContent('49 seats on sale · 21 off sale');
    fireEvent.click(within(tool()).getByRole('checkbox', { name: 'Row 1 off sale' }));
    expect(line()).toHaveTextContent('59 seats on sale · 11 off sale');
  });

  it('sends layoutId, levelPrices and offSale in one request, with no reservedSeating, tiers or total', async () => {
    const api = await newForm({ 'POST /events': json({ ...SEATED_EVENT }, 201) });
    await chooseLayout('Arena');
    await openSection('Balcony');
    fireEvent.click(within(tool()).getByRole('button', { name: 'Whole section off sale' }));
    fireEvent.click(within(tool()).getByRole('button', { name: 'Back to all sections' }));
    await openSection('Floor A');
    fireEvent.click(await within(tool()).findByRole('button', { name: 'Row 2, Seat 3' }));
    fireEvent.change(priceBox('Front')!, { target: { value: '95.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));

    expect(await screen.findByText('Event page', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(writes(api).map((c) => `${c.method} ${c.path}`)).toEqual(['POST /events']);
    const body = writes(api)[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      layoutId: 'l-arena',
      levelPrices: [
        { levelId: 'l-front', price: '95.00' },
        { levelId: 'l-back', price: '55.00' },
      ],
      offSale: [{ sectionId: 's-bal' }, { sectionId: 's-a', row: 2, seat: 3 }],
      basePrice: '55.00',
    });
    for (const field of ['reservedSeating', 'tiers', 'totalTicketCapacity']) {
      expect(body).not.toHaveProperty(field);
    }
  });

  it('shows an empty on-sale price box beside it, focuses it, and sends nothing', async () => {
    const api = await newForm();
    await chooseLayout('Club');
    fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));

    expect(await screen.findByTestId('price-l-club-error')).toHaveTextContent(
      'Give Club seats a price.',
    );
    await vi.waitFor(() => expect(priceBox('Club seats')).toHaveFocus());
    expect(priceBox('Club seats')).toHaveAttribute('aria-invalid', 'true');
    expect(writes(api)).toEqual([]);
  });

  it("places the Backend's 400 levelPrices beside the level's box and focuses it, keeping every value", async () => {
    await newForm({
      'POST /events': json(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Give Back a price: it has seats on sale.',
            details: {
              field: 'levelPrices',
              fields: ['levelPrices needs a price for Back, which has seats on sale'],
              levels: [{ levelId: 'l-back', name: 'Back' }],
            },
          },
        },
        400,
      ),
    });
    await chooseLayout('Arena');
    fireEvent.change(priceBox('Upper')!, { target: { value: '35.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));

    const hint = await screen.findByTestId('price-l-back-error');
    expect(hint).toHaveTextContent('Give Back a price: it has seats on sale.');
    await vi.waitFor(() => expect(priceBox('Back')).toHaveFocus());
    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(priceBox('Upper')).toHaveValue('35.00');
    expect(seatingSelect()).toHaveValue('l-arena');
  });

  it('places a 409 SEAT_TAKEN beside the seats off sale and focuses them', async () => {
    await newForm({
      'POST /events': json(
        {
          error: {
            code: 'SEAT_TAKEN',
            message:
              "Section Floor A, Row 1, Seat 4 is sold or held, so it can't be taken off sale.",
            details: { field: 'offSale', seats: [{ section: 'Floor A', row: 1, seat: 4 }] },
          },
        },
        409,
      ),
    });
    await chooseLayout('Arena');
    await openSection('Floor A');
    fireEvent.click(await within(tool()).findByRole('checkbox', { name: 'Row 1 off sale' }));
    fireEvent.change(priceBox('Upper')!, { target: { value: '35.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule event' }));

    expect(await within(tool()).findByText(/Row 1, Seat 4 is sold or held/)).toBeInTheDocument();
    await vi.waitFor(() => expect(tool()).toHaveFocus());
    expect(line()).toHaveTextContent('60 seats on sale · 10 off sale');
  });
});

describe('Edit a seated event', () => {
  const seating = {
    eventId: EVENT.id,
    layoutId: 'l-arena',
    levels: [
      {
        levelId: 'l-front',
        name: 'Front',
        rank: 1,
        color: 'violet',
        seatCount: 30,
        seatsOnSale: 30,
        price: '95.00',
      },
      {
        levelId: 'l-back',
        name: 'Back',
        rank: 2,
        color: 'teal',
        seatCount: 30,
        seatsOnSale: 30,
        price: '60.00',
      },
      {
        levelId: 'l-upper',
        name: 'Upper',
        rank: 3,
        color: 'blue',
        seatCount: 10,
        seatsOnSale: 0,
        price: null,
      },
    ],
    offSale: [{ sectionId: 's-bal' }],
    seatsOnSale: 60,
    seatsOffSale: 10,
  };
  const mapSection = {
    eventId: EVENT.id,
    seq: 3,
    sectionId: 's-a',
    name: 'Floor A',
    rows: SECTIONS['s-a'].rows.map((r) => ({
      ...r,
      seats: r.seats.map((s) => ({
        ...s,
        state:
          r.number === 1 && s.number === 4
            ? 'sold'
            : r.number === 1 && s.number === 5
              ? 'reserved'
              : 'open',
      })),
    })),
  };
  const editRoutes = (ticketsLeft: number, extra: Record<string, Response> = {}) => ({
    'GET /locations': json([SEATED_VENUE]),
    ...layoutRoutes(),
    [`GET ${PATH}`]: json(SEATED_EVENT),
    [`GET ${PATH}/tiers`]: json([]),
    [`GET ${PATH}/seating`]: json(seating),
    [`GET ${PATH}/availability`]: json({
      eventId: EVENT.id,
      ticketsLeft,
      salesClosed: null,
      tiers: [],
    }),
    [`GET ${PATH}/venue-map/sections/s-a`]: json(mapSection),
    ...extra,
  });

  it('loads its seating: the layout, its prices and its seats off sale', async () => {
    stubApi(editRoutes(60));
    at(`${PATH}/edit`, '/events/:id/edit');
    await vi.waitFor(() => expect(priceBox('Front')).toHaveValue('95.00'));
    expect(seatingSelect()).toHaveValue('l-arena');
    expect(seatingSelect()).not.toBeDisabled();
    expect(priceBox('Back')).toHaveValue('60.00');
    expect(priceBox('Upper')).toBeNull();
    expect(line()).toHaveTextContent('60 seats on sale · 10 off sale');
  });

  it('locks the layout once seats are sold, saying why, and disables sold and held seats', async () => {
    stubApi(editRoutes(58));
    at(`${PATH}/edit`, '/events/:id/edit');
    await vi.waitFor(() => expect(seatingSelect()).toBeDisabled());
    expect(screen.getByText("Can't be changed: seats have been sold.")).toBeInTheDocument();

    await openSection('Floor A');
    const sold = await within(tool()).findByRole('button', { name: 'Row 1, Seat 4, sold' });
    expect(sold).toHaveAttribute('aria-disabled', 'true');
    expect(within(tool()).getByRole('button', { name: 'Row 1, Seat 5, held' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(
      within(tool()).getByText("Sold and held seats can't be taken off sale."),
    ).toBeInTheDocument();
    expect(within(tool()).getByRole('checkbox', { name: 'Row 1 off sale' })).toBeDisabled();
    expect(within(tool()).getByRole('button', { name: 'Whole section off sale' })).toBeDisabled();
    expect(within(tool()).getByRole('button', { name: 'Row 2, Seat 4' })).not.toHaveAttribute(
      'aria-disabled',
    );
  });

  it('sends the seating in one PATCH and places a 409 EVENT_HAS_ORDERS beside the layout', async () => {
    const api = stubApi(
      editRoutes(60, {
        [`PATCH ${PATH}`]: json(
          {
            error: {
              code: 'EVENT_HAS_ORDERS',
              message: 'Season Opener has sold or held seats, so its layout can no longer change.',
              details: { field: 'layoutId', ticketsSold: 0, seatsHeld: 1 },
            },
          },
          409,
        ),
      }),
    );
    at(`${PATH}/edit`, '/events/:id/edit');
    await vi.waitFor(() => expect(priceBox('Front')).toHaveValue('95.00'));
    fireEvent.change(seatingSelect(), { target: { value: 'l-club' } });
    await vi.waitFor(() => expect(priceBox('Club seats')).toBeInTheDocument());
    fireEvent.change(priceBox('Club seats')!, { target: { value: '20.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByTestId('layoutId-error')).toHaveTextContent(
      'Season Opener has sold or held seats',
    );
    await vi.waitFor(() => expect(seatingSelect()).toHaveFocus());
    expect(writes(api)[0]!.body).toMatchObject({
      layoutId: 'l-club',
      levelPrices: [{ levelId: 'l-club', price: '20.00' }],
      offSale: [],
    });
    expect(writes(api)[0]!.body).not.toHaveProperty('tiers');
    expect(seatingSelect()).toHaveValue('l-club');
    expect(priceBox('Club seats')).toHaveValue('20.00');
  });
});
