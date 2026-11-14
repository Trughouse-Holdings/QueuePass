import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { VenueMap, type MapSeat, type SeatView } from '../../src/web/venue-map/venue-map';
import type { VenueMap as Map, VenueMapSection } from '../../src/web/venue-map/map-state';

/**
 * Spec 038 US3 (T032; FR-016 to FR-019, FR-029, SC-007; research R13): the shared venue map. The
 * overview draws sections only, colored by their cheapest open level inside the price filter; a
 * section zoomed into draws its rows and seats, each with an accessible name and a mark for its
 * state, so no state is told by color alone.
 */
const L1 = 'l-court';
const L2 = 'l-side';
const L3 = 'l-end';
const L4 = 'l-upper';
const box = (x: number, y: number, w = 60, h = 40): [number, number][] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
const counts = (levelId: string, open: number, reserved = 0, sold = 0, offSale = 0) => ({
  levelId,
  open,
  reserved,
  sold,
  offSale,
});

const MAP: Map = {
  eventId: 'e1',
  seq: 10,
  layoutId: 'lay-1',
  layoutName: 'Basketball',
  size: { width: 1000, height: 640 },
  floorKind: 'COURT',
  floorOutline: box(400, 260, 200, 120),
  levels: [
    { levelId: L1, name: 'Courtside', rank: 1, color: 'violet', price: '95.00' },
    { levelId: L2, name: 'Lower sideline', rank: 2, color: 'blue', price: '60.00' },
    { levelId: L3, name: 'Lower end', rank: 3, color: 'teal', price: '35.00' },
    { levelId: L4, name: 'Upper', rank: 4, color: 'green', price: null },
  ],
  sections: [
    {
      sectionId: 's-115',
      name: '115',
      outline: box(420, 400),
      labelAt: [450, 420],
      counts: [counts(L1, 1, 2, 1, 1), counts(L2, 1)],
    },
    {
      sectionId: 's-101',
      name: '101',
      outline: box(100, 300),
      labelAt: [130, 320],
      counts: [counts(L3, 3)],
    },
    {
      sectionId: 's-301',
      name: '301',
      outline: box(420, 40),
      labelAt: [450, 60],
      counts: [counts(L4, 0, 0, 0, 4)],
    },
  ],
};

const seat = (
  number: number,
  levelId: string,
  state: 'open' | 'reserved' | 'sold' | 'offSale',
  x: number,
  y: number,
) => ({
  number,
  label: String(number),
  at: [x, y] as [number, number],
  levelId,
  state,
  accessible: false,
});

const SECTION_115: VenueMapSection = {
  eventId: 'e1',
  seq: 10,
  sectionId: 's-115',
  name: '115',
  rows: [
    {
      number: 1,
      label: 'F',
      seats: [
        seat(7, L1, 'open', 430, 410),
        seat(8, L1, 'reserved', 432, 410),
        seat(9, L1, 'sold', 434, 410),
        seat(10, L1, 'offSale', 436, 410),
        seat(11, L1, 'reserved', 438, 410),
      ],
    },
    { number: 2, label: 'P', seats: [seat(7, L2, 'open', 430, 420)] },
  ],
};

/** The map with the open section's seats loaded, as an app would give them. */
function Harness({
  onSeat = () => undefined,
  seatView,
  colorBy = 'price',
  start = null,
}: {
  onSeat?: (s: MapSeat) => void;
  seatView?: (s: MapSeat) => SeatView;
  colorBy?: 'price' | 'state';
  start?: string | null;
}) {
  const [open, setOpen] = useState<string | null>(start);
  return (
    <VenueMap
      map={MAP}
      colorBy={colorBy}
      openSectionId={open}
      section={open === 's-115' ? SECTION_115 : null}
      onOpenSection={setOpen}
      onSeat={onSeat}
      seatView={seatView}
    />
  );
}

const section = (name: string) =>
  screen.getByRole('button', { name: new RegExp(`^Section ${name}(,|$)`) });
const seatButton = (name: string) => screen.getByRole('button', { name });
const drawing = () => screen.getByRole('group', { name: 'Basketball map' });
const setRange = (low: number, high: number) => {
  fireEvent.change(screen.getByRole('slider', { name: 'Lowest price' }), {
    target: { value: String(low) },
  });
  fireEvent.change(screen.getByRole('slider', { name: 'Highest price' }), {
    target: { value: String(high) },
  });
};

describe('the overview (FR-016, FR-029)', () => {
  it('draws every section with its name, filled by its cheapest open level, and the floor', () => {
    const { container } = render(<Harness />);
    expect(screen.getByRole('group', { name: 'Basketball map' })).toBeInTheDocument();
    // 115: Courtside $95 and Lower sideline $60 open; the cheaper one colors it.
    expect(section('115')).toHaveClass('venue-map__section', 'venue-map--blue');
    expect(section('115')).toHaveAccessibleName('Section 115, 2 open seats from $60');
    expect(section('101')).toHaveClass('venue-map--teal');
    // 301: nothing on sale, gray.
    expect(section('301')).toHaveClass('venue-map--unavailable');
    expect(section('301')).toHaveAccessibleName('Section 301, no open seats');
    for (const name of ['115', '101', '301']) {
      expect(within(drawing()).getByText(name)).toBeInTheDocument();
    }
    expect(container.querySelector('.venue-map__floor')).not.toBeNull();
  });

  it('never draws a seat', () => {
    const { container } = render(<Harness />);
    expect(container.querySelectorAll('.venue-map__seat')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^Row / })).toBeNull();
  });

  it('has a legend naming each level with its color and price, and each seat state', () => {
    render(<Harness />);
    const levels = within(screen.getByRole('list', { name: 'Price levels' })).getAllByRole(
      'listitem',
    );
    expect(levels.map((li) => li.textContent)).toEqual([
      'Courtside $95',
      'Lower sideline $60',
      'Lower end $35',
      'Upper: not on sale',
    ]);
    expect(levels[0].querySelector('.level-swatch--violet')).not.toBeNull();
    expect(levels[2].querySelector('.level-swatch--teal')).not.toBeNull();
    const states = within(screen.getByRole('list', { name: 'Seat states' })).getAllByRole(
      'listitem',
    );
    expect(states.map((li) => li.textContent)).toEqual([
      'Open',
      'Held',
      'Sold',
      'Off sale',
      'Your seats',
    ]);
  });
});

describe('the price filter (FR-017)', () => {
  it('starts at the full range of the levels’ prices, in whole dollars', () => {
    render(<Harness />);
    const low = screen.getByRole('slider', { name: 'Lowest price' });
    const high = screen.getByRole('slider', { name: 'Highest price' });
    expect(low).toHaveValue('35');
    expect(high).toHaveValue('95');
    expect(low).toHaveAttribute('min', '35');
    expect(high).toHaveAttribute('max', '95');
    expect(screen.getByText('$35–$95')).toBeInTheDocument();
  });

  it('fades sections with no open seat inside it and marks the levels outside it', () => {
    render(<Harness />);
    setRange(50, 95);
    expect(screen.getByText('$50–$95')).toBeInTheDocument();
    // 101 has only $35 seats.
    expect(section('101')).toHaveClass('venue-map__section--faded', 'venue-map--unavailable');
    expect(section('101')).toHaveAccessibleName('Section 101, no open seats between $50 and $95');
    // 115 keeps its open $60 seat, and is still drawn by its color.
    expect(section('115')).not.toHaveClass('venue-map__section--faded');
    const items = within(screen.getByRole('list', { name: 'Price levels' })).getAllByRole(
      'listitem',
    );
    expect(items[2]).toHaveTextContent('Lower end $35, outside your price range');
    expect(items[2]).toHaveClass('venue-map-legend__item--out');
    expect(items[0]).not.toHaveTextContent(/outside/);
    // Every section is still drawn.
    expect(screen.getAllByRole('button', { name: /^Section / })).toHaveLength(3);
  });

  it('says when nothing matches, with Reset', () => {
    render(<Harness />);
    setRange(70, 80);
    expect(screen.getByText('No open seats between $70 and $80.')).toBeInTheDocument();
    for (const name of ['115', '101', '301']) {
      expect(section(name)).toHaveClass('venue-map__section--faded');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Reset price filter' }));
    expect(screen.getByRole('slider', { name: 'Lowest price' })).toHaveValue('35');
    expect(screen.getByRole('slider', { name: 'Highest price' })).toHaveValue('95');
    expect(screen.queryByText(/No open seats between/)).toBeNull();
  });

  it('keeps the low end at or below the high end', () => {
    render(<Harness />);
    setRange(80, 60);
    expect(screen.getByRole('slider', { name: 'Lowest price' })).toHaveValue('60');
    expect(screen.getByRole('slider', { name: 'Highest price' })).toHaveValue('60');
  });
});

describe('a section zoomed into (FR-018, FR-019)', () => {
  it('opens on a click, and on Enter, with Back to map', () => {
    render(<Harness />);
    fireEvent.click(section('115'));
    expect(screen.getByRole('button', { name: 'Back to map' })).toBeInTheDocument();
    expect(seatButton('Row F, Seat 7, Courtside, $95, open')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to map' }));
    expect(screen.queryByRole('button', { name: /^Row / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back to map' })).toBeNull();
    fireEvent.keyDown(section('115'), { key: 'Enter' });
    expect(seatButton('Row F, Seat 7, Courtside, $95, open')).toBeInTheDocument();
  });

  it('draws only that section’s seats, with its row labels at both ends', () => {
    const { container } = render(<Harness start="s-115" />);
    expect(container.querySelectorAll('.venue-map__seat')).toHaveLength(6);
    const labels = [...container.querySelectorAll('.venue-map__row-label')].map(
      (t) => t.textContent,
    );
    expect(labels).toEqual(['F', 'F', 'P', 'P']);
  });

  it('gives each state a mark and a name, not only a color (SC-007)', () => {
    const mine = (s: MapSeat): SeatView =>
      s.row === 1 && s.seat === 11 ? { shown: 'mine', disabled: false } : {};
    render(<Harness start="s-115" seatView={mine} />);
    const open = seatButton('Row F, Seat 7, Courtside, $95, open');
    expect(open).toHaveClass('venue-map__seat--open', 'venue-map--violet');
    expect(open).not.toHaveAttribute('aria-disabled');
    const held = seatButton('Row F, Seat 8, Courtside, $95, held');
    expect(held).toHaveClass('venue-map__seat--held');
    expect(held.querySelector('.venue-map__dot--hollow')).not.toBeNull();
    expect(held).toHaveAttribute('aria-disabled', 'true');
    const sold = seatButton('Row F, Seat 9, Courtside, $95, sold');
    expect(sold).toHaveClass('venue-map__seat--sold');
    expect(sold.querySelector('.venue-map__mark--cross')).not.toBeNull();
    const off = seatButton('Row F, Seat 10, Courtside, $95, off sale');
    expect(off).toHaveClass('venue-map__seat--off');
    expect(off.querySelector('.venue-map__mark--dash')).not.toBeNull();
    const yours = seatButton('Row F, Seat 11, Courtside, $95, held by you');
    expect(yours).toHaveClass('venue-map__seat--mine');
    expect(yours.querySelector('.venue-map__mark--check')).not.toBeNull();
    expect(yours).toHaveAttribute('aria-pressed', 'true');
    expect(open).toHaveAttribute('aria-pressed', 'false');
    // Every seat can be reached by keyboard, unavailable ones too (marked aria-disabled).
    for (const s of [open, held, sold, off, yours]) expect(s).toHaveAttribute('tabindex', '0');
  });

  it('shows a seat’s section, row, seat, level and price on hover and on focus', () => {
    render(<Harness start="s-115" />);
    fireEvent.mouseEnter(seatButton('Row F, Seat 7, Courtside, $95, open'));
    expect(screen.getByText('Sec 115, Row F, Seat 7 · Courtside · $95')).toBeInTheDocument();
    fireEvent.focus(seatButton('Row P, Seat 7, Lower sideline, $60, open'));
    expect(screen.getByText('Sec 115, Row P, Seat 7 · Lower sideline · $60')).toBeInTheDocument();
  });

  it('chooses a seat by click, Enter or Space; unavailable seats do nothing', () => {
    const onSeat = vi.fn();
    render(<Harness start="s-115" onSeat={onSeat} />);
    fireEvent.click(seatButton('Row F, Seat 7, Courtside, $95, open'));
    expect(onSeat).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sectionId: 's-115',
        section: '115',
        row: 1,
        rowLabel: 'F',
        seat: 7,
        seatLabel: '7',
        levelId: L1,
        levelName: 'Courtside',
        price: '95.00',
        state: 'open',
      }),
    );
    fireEvent.keyDown(seatButton('Row P, Seat 7, Lower sideline, $60, open'), { key: ' ' });
    expect(onSeat).toHaveBeenLastCalledWith(expect.objectContaining({ row: 2, seat: 7 }));
    fireEvent.keyDown(seatButton('Row P, Seat 7, Lower sideline, $60, open'), { key: 'Enter' });
    expect(onSeat).toHaveBeenCalledTimes(3);
    fireEvent.click(seatButton('Row F, Seat 9, Courtside, $95, sold'));
    fireEvent.click(seatButton('Row F, Seat 8, Courtside, $95, held'));
    expect(onSeat).toHaveBeenCalledTimes(3);
  });

  it('fades seats outside the price filter, which stay choosable', () => {
    const onSeat = vi.fn();
    render(<Harness start="s-115" onSeat={onSeat} />);
    setRange(70, 95);
    const cheap = seatButton('Row P, Seat 7, Lower sideline, $60, open');
    expect(cheap).toHaveClass('venue-map__seat--faded');
    expect(seatButton('Row F, Seat 7, Courtside, $95, open')).not.toHaveClass(
      'venue-map__seat--faded',
    );
    fireEvent.click(cheap);
    expect(onSeat).toHaveBeenCalledWith(expect.objectContaining({ row: 2, seat: 7 }));
  });

  it('says the seats are loading until they come', () => {
    render(
      <VenueMap map={MAP} openSectionId="s-101" section={null} onOpenSection={() => undefined} />,
    );
    expect(screen.getByText('Loading the seats of section 101…')).toBeInTheDocument();
  });
});

describe('zoom controls (FR-018)', () => {
  it('offers Zoom in, Zoom out and Fit map buttons', () => {
    render(<Harness />);
    const svg = drawing();
    expect(svg).toHaveAttribute('viewBox', '0 0 1000 640');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(svg.getAttribute('viewBox')).not.toBe('0 0 1000 640');
    fireEvent.click(screen.getByRole('button', { name: 'Fit map' }));
    expect(svg).toHaveAttribute('viewBox', '0 0 1000 640');
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument();
  });
});

describe('colored by state (FR-027)', () => {
  it('names each section’s counts by state, with no price filter', () => {
    render(<Harness colorBy="state" />);
    expect(section('115')).toHaveAccessibleName('Section 115, 2 open, 2 held, 1 sold, 1 off sale');
    expect(section('115')).toHaveClass('venue-map__section--state');
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Price levels' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Seat states' })).toBeInTheDocument();
  });

  it('fills each section by its make-up of seat states, as the legend names them (US6, S17)', () => {
    const made = (name: string, c: ReturnType<typeof counts>[]) => ({
      ...MAP.sections[1],
      sectionId: `s-${name}`,
      name,
      counts: c,
    });
    const map: Map = {
      ...MAP,
      sections: [
        // Some open: open.
        made('A', [counts(L1, 1, 2, 1, 1)]),
        // None open, some held: held.
        made('B', [counts(L1, 0, 1, 3)]),
        // None open or held, some sold: sold out.
        made('C', [counts(L1, 0, 0, 3, 1)]),
        // Every seat off sale: off sale.
        made('D', [counts(L4, 0, 0, 0, 4)]),
      ],
    };
    render(
      <VenueMap
        map={map}
        colorBy="state"
        openSectionId={null}
        section={null}
        onOpenSection={() => undefined}
      />,
    );
    expect(section('A')).toHaveClass('venue-map__section--state-open');
    expect(section('B')).toHaveClass('venue-map__section--state-held');
    expect(section('C')).toHaveClass('venue-map__section--state-sold');
    expect(section('D')).toHaveClass('venue-map__section--state-off');
    const legend = screen.getByRole('list', { name: 'Sections' });
    const items = within(legend).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'Seats open',
      'None open, some held',
      'Sold out',
      'Off sale',
    ]);
    for (const [i, kind] of ['open', 'held', 'sold', 'off'].entries()) {
      expect(items[i].querySelector(`.state-swatch--${kind}`)).not.toBeNull();
    }
    // Not on the customer's map, which has its price levels instead.
    cleanup();
    render(<Harness />);
    expect(screen.queryByRole('list', { name: 'Sections' })).toBeNull();
  });

  it('shows each section’s sold / open under its name, as the legend says (T049)', () => {
    render(<Harness colorBy="state" />);
    expect(within(drawing()).getByText('1 / 2')).toBeInTheDocument();
    expect(within(drawing()).getByText('0 / 3')).toBeInTheDocument();
    expect(within(drawing()).getByText('0 / 0')).toBeInTheDocument();
    expect(screen.getByText('Sections show sold / open seats.')).toBeInTheDocument();
    // Not on the customer's map.
    cleanup();
    render(<Harness />);
    expect(within(drawing()).queryByText('1 / 2')).toBeNull();
    expect(screen.queryByText('Sections show sold / open seats.')).toBeNull();
  });
});
