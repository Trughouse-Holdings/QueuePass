import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventDetail } from '../src/pages/EventDetail';
import { json, seatStream, stubApi } from './helpers/api-stub';
import { EVENT } from './fixtures-005';
import { arenaVenueMap } from './fixtures-038';
import { fixTimeBeforeFixtures } from './helpers/fixed-time';

// Spec 030 (T011): fixed-date fixtures, so the time is fixed before them.
fixTimeBeforeFixtures();

/**
 * Spec 038 US6 (T048; FR-027, FR-028; research R15): the Admin event page shows a seated event on
 * the shared venue map colored by seat state, with a legend of the states and each section's
 * "sold / open"; a section zooms in to its seats, each with its state; live `seats` messages change
 * a seat and its section's counts. Who bought a seat is only on the attendee list.
 */
afterEach(() => vi.unstubAllGlobals());

const PATH = `/events/${EVENT.id}`;
const SEATED = { ...EVENT, reservedSeating: true, layoutId: 'l-arena', priceMax: '90.00' };
// Floor A: row 1 seat 1 sold, seat 2 held; Balcony: row 1 seat 1 off sale.
const STATES = { 's-a/1/1': 'sold', 's-a/1/2': 'reserved', 's-bal/1/1': 'offSale' } as const;

function setup(over: { event?: object; extra?: Record<string, unknown> } = {}) {
  const stream = seatStream();
  const arena = arenaVenueMap(EVENT.id, { states: STATES });
  const api = stubApi({
    [`GET ${PATH}`]: json(over.event ?? SEATED),
    [`GET ${PATH}/tiers`]: json([]),
    [`GET ${PATH}/availability`]: json({
      eventId: EVENT.id,
      ticketsLeft: 68,
      salesClosed: null,
      tiers: [],
    }),
    ...arena.routes,
    [`GET ${PATH}/seats/stream`]: stream.reply,
    ...(over.extra as Record<string, Response>),
  });
  render(
    <MemoryRouter initialEntries={[PATH]}>
      <Routes>
        <Route path="/events/:id" element={<EventDetail />} />
      </Routes>
    </MemoryRouter>,
  );
  return { stream, arena, api };
}

const card = () => screen.findByRole('region', { name: 'Seating' });
const drawing = () => screen.getByRole('group', { name: 'Arena map' });
const section = (name: string) =>
  within(drawing()).getByRole('button', { name: new RegExp(`^Section ${name},`) });

describe('the event page’s map by seat state (FR-027)', () => {
  it('shows every section with its counts by state, and a legend of the states', async () => {
    setup();
    const region = await card();
    await within(region).findByRole('group', { name: 'Arena map' });

    expect(section('Floor A')).toHaveAccessibleName(
      'Section Floor A, 28 open, 1 held, 1 sold, 0 off sale',
    );
    expect(section('Floor B')).toHaveAccessibleName(
      'Section Floor B, 30 open, 0 held, 0 sold, 0 off sale',
    );
    expect(section('Balcony')).toHaveAccessibleName(
      'Section Balcony, 9 open, 0 held, 0 sold, 1 off sale',
    );
    // Each section shows "sold / open" on the map, said in the legend.
    expect(within(drawing()).getByText('1 / 28')).toBeInTheDocument();
    expect(within(drawing()).getByText('0 / 30')).toBeInTheDocument();
    expect(within(region).getByText('Sections show sold / open seats.')).toBeInTheDocument();
    const states = within(region).getByRole('list', { name: 'Seat states' });
    expect(
      within(states)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Open', 'Held', 'Sold', 'Off sale']);
    // Each section filled by its make-up of seat states, the fills named in the legend (T060, S3).
    expect(section('Floor A')).toHaveClass('venue-map__section--state-open');
    const fills = within(region).getByRole('list', { name: 'Sections' });
    expect(
      within(fills)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Seats open', 'None open, some held', 'Sold out', 'Off sale']);
    // No price filter or price legend: the admin's map is by state.
    expect(within(region).queryByRole('slider')).toBeNull();
    expect(within(region).queryByRole('list', { name: 'Price levels' })).toBeNull();
    // The event's totals.
    expect(within(region).getByText('1 sold, 1 held, 67 open, 1 off sale')).toBeInTheDocument();
  });

  it('zooms into a section, each seat with its state by name and mark', async () => {
    setup();
    const region = await card();
    await within(region).findByRole('group', { name: 'Arena map' });
    fireEvent.click(section('Floor A'));

    const sold = await within(drawing()).findByRole('button', {
      name: 'Row 1, Seat 1, Front, $90, sold',
    });
    expect(sold.querySelector('.venue-map__mark--cross')).not.toBeNull();
    const held = within(drawing()).getByRole('button', { name: 'Row 1, Seat 2, Front, $90, held' });
    expect(held.querySelector('.venue-map__dot--hollow')).not.toBeNull();
    expect(
      within(drawing()).getByRole('button', { name: 'Row 1, Seat 3, Front, $90, open' }),
    ).toBeInTheDocument();
    expect(within(drawing()).getAllByRole('button', { name: /^Row / })).toHaveLength(30);
    // The admin's map only shows: no seat is chosen from it.
    expect(sold).toHaveAttribute('aria-disabled', 'true');
    expect(
      within(drawing()).getByRole('button', { name: 'Row 1, Seat 3, Front, $90, open' }),
    ).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(within(region).getByRole('button', { name: 'Back to map' }));
    expect(within(drawing()).queryAllByRole('button', { name: /^Row / })).toHaveLength(0);
  });

  it('changes a seat and its section’s counts on a live seats message', async () => {
    const { stream } = setup();
    const region = await card();
    await within(region).findByRole('group', { name: 'Arena map' });
    fireEvent.click(section('Floor A'));
    await within(drawing()).findByRole('button', { name: 'Row 1, Seat 3, Front, $90, open' });

    await waitFor(() => stream.send('venueMap', arenaVenueMap(EVENT.id, { states: STATES }).map));
    act(() =>
      stream.send('seats', {
        eventId: EVENT.id,
        seq: 2,
        changes: [
          { sectionId: 's-a', row: 1, seat: 3, state: 'sold', from: 'open', levelId: 'l-front' },
          {
            sectionId: 's-a',
            row: 1,
            seat: 2,
            state: 'sold',
            from: 'reserved',
            levelId: 'l-front',
          },
        ],
      }),
    );

    await waitFor(() =>
      expect(section('Floor A')).toHaveAccessibleName(
        'Section Floor A, 27 open, 0 held, 3 sold, 0 off sale',
      ),
    );
    expect(
      await within(drawing()).findByRole('button', { name: 'Row 1, Seat 3, Front, $90, sold' }),
    ).toBeInTheDocument();
    expect(
      within(drawing()).getByRole('button', { name: 'Row 1, Seat 2, Front, $90, sold' }),
    ).toBeInTheDocument();
    expect(within(region).getByText('3 sold, 0 held, 66 open, 1 off sale')).toBeInTheDocument();
    // The section zoomed into hides its label; back on the whole map it shows the new counts.
    fireEvent.click(within(region).getByRole('button', { name: 'Back to map' }));
    expect(within(drawing()).getByText('3 / 27')).toBeInTheDocument();
  });
});

describe('who bought a seat (FR-028)', () => {
  it('is never on the map; the attendee list link stays', async () => {
    setup();
    const region = await card();
    await within(region).findByRole('group', { name: 'Arena map' });
    fireEvent.click(section('Floor A'));
    await within(drawing()).findByRole('button', { name: /^Row 1, Seat 1,/ });
    // Each seat says only where it is, its level, price and state.
    for (const seat of within(drawing()).getAllByRole('button', { name: /^Row / })) {
      expect(seat.getAttribute('aria-label')).toMatch(
        /^Row \d+, Seat \d+, Front, \$90, (open|held|sold|off sale)$/,
      );
    }
    expect(screen.getByRole('link', { name: 'Attendees' })).toHaveAttribute(
      'href',
      `${PATH}/attendees`,
    );
    expect(within(region).getByRole('link', { name: 'attendee list' })).toHaveAttribute(
      'href',
      `${PATH}/attendees`,
    );
  });
});

describe('the Seating card', () => {
  it('says a general-admission event is one, and reads no map', async () => {
    const { api } = setup({ event: EVENT });
    const region = await card();
    expect(within(region).getByText('General admission.')).toBeInTheDocument();
    expect(within(region).queryByRole('group', { name: 'Arena map' })).toBeNull();
    expect(api.calls.some((c) => c.path.includes('venue-map'))).toBe(false);
    expect(api.calls.some((c) => c.path.endsWith('/seats'))).toBe(false);
  });

  it('says when the map can’t be read', async () => {
    setup({
      extra: {
        [`GET ${PATH}/venue-map`]: json({ error: { code: 'NOT_FOUND', message: 'gone' } }, 404),
      },
    });
    const region = await card();
    expect(
      await within(region).findByText('The seat map is unavailable right now.'),
    ).toBeInTheDocument();
  });
});
