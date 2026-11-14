import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SectionsList } from '../../src/web/venue-map/sections-list';
import { usePriceFilter } from '../../src/web/venue-map/price-filter';
import { VenueMap, type MapSeat, type SeatView } from '../../src/web/venue-map/venue-map';
import type { VenueMap as Map, VenueMapSection } from '../../src/web/venue-map/map-state';

/**
 * Spec 038 US4 (T041; FR-020, SC-007; research R13): the Sections list, a second view of the venue
 * map's state that needs no map. Each section with its name, the price range of its open seats and
 * their count, under the same price filter; a section chosen lists its rows as groups of seat
 * buttons named as the map names them; a seat pressed here is the same choice as a click on the
 * map, and a seat held in either view shows in the other at once.
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
      ],
    },
    { number: 2, label: 'P', seats: [seat(7, L2, 'open', 430, 420)] },
  ],
};

/**
 * The map and the list side by side, as an app gives them: one open section, one price filter,
 * and one set of the customer's seats, which a choice in either view toggles.
 */
function Harness({ onSeat }: { onSeat?: (s: MapSeat) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [range, setRange] = usePriceFilter(MAP.levels);
  const [mine, setMine] = useState<string[]>([]);
  const key = (s: MapSeat) => `${s.sectionId}/${s.row}/${s.seat}`;
  const seatView = (s: MapSeat): SeatView =>
    mine.includes(key(s)) ? { shown: 'mine', disabled: false } : {};
  const choose = (s: MapSeat) => {
    onSeat?.(s);
    setMine((m) => (m.includes(key(s)) ? m.filter((k) => k !== key(s)) : [...m, key(s)]));
  };
  const section = open === 's-115' ? SECTION_115 : null;
  return (
    <>
      <VenueMap
        map={MAP}
        openSectionId={open}
        section={section}
        onOpenSection={setOpen}
        range={range}
        onRange={setRange}
        seatView={seatView}
        onSeat={choose}
      />
      <SectionsList
        map={MAP}
        range={range}
        openSectionId={open}
        section={section}
        onOpenSection={setOpen}
        seatView={seatView}
        onSeat={choose}
      />
    </>
  );
}

const list = () => screen.getByRole('region', { name: 'Sections' });
const drawing = () => screen.getByRole('group', { name: 'Basketball map' });
const listed = (name: string) =>
  within(list()).getByRole('button', { name: new RegExp(`^Section ${name}(,|$)`) });
const setRange = (low: number, high: number) => {
  fireEvent.change(screen.getByRole('slider', { name: 'Lowest price' }), {
    target: { value: String(low) },
  });
  fireEvent.change(screen.getByRole('slider', { name: 'Highest price' }), {
    target: { value: String(high) },
  });
};

describe('the sections (FR-020)', () => {
  it('lists each section with the price range of its open seats and their count', () => {
    render(<Harness />);
    expect(
      within(list())
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual([
      'Section 115, $60–$95, 2 open seats',
      'Section 101, $35, 3 open seats',
      'Section 301, no open seats',
    ]);
    // The same facts are shown, not only spoken.
    expect(listed('115')).toHaveTextContent('115');
    expect(listed('115')).toHaveTextContent('$60–$95');
    expect(listed('115')).toHaveTextContent('2 open seats');
    for (const b of within(list()).getAllByRole('button')) {
      expect(b).toHaveAttribute('aria-expanded', 'false');
    }
  });

  it('follows the price filter the map shows', () => {
    render(<Harness />);
    setRange(70, 95);
    expect(listed('115')).toHaveAccessibleName('Section 115, $95, 1 open seat');
    expect(listed('101')).toHaveAccessibleName('Section 101, no open seats between $70 and $95');
    expect(listed('101')).toHaveClass('sections-list__section--faded');
    expect(listed('301')).toHaveAccessibleName('Section 301, no open seats');
  });

  it('is reachable by keyboard: every section is a tab stop', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const first = listed('115');
    // Tab from the start of the page until the list is reached (the map comes first).
    for (let i = 0; i < 30 && document.activeElement !== first; i += 1) await user.tab();
    expect(first).toHaveFocus();
    await user.tab();
    expect(listed('101')).toHaveFocus();
  });
});

describe('a section chosen (FR-020, SC-007)', () => {
  it('lists its rows as groups of seat buttons, named as on the map, and opens it on the map', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    listed('115').focus();
    await user.keyboard('{Enter}');
    expect(listed('115')).toHaveAttribute('aria-expanded', 'true');
    // One state: the map zoomed into the same section.
    expect(screen.getByRole('button', { name: 'Back to map' })).toBeInTheDocument();

    const rowF = within(list()).getByRole('group', { name: 'Row F' });
    expect(
      within(rowF)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual([
      'Row F, Seat 7, Courtside, $95, open',
      'Row F, Seat 8, Courtside, $95, held',
      'Row F, Seat 9, Courtside, $95, sold',
      'Row F, Seat 10, Courtside, $95, off sale',
    ]);
    const rowP = within(list()).getByRole('group', { name: 'Row P' });
    expect(within(rowP).getByRole('button')).toHaveAccessibleName(
      'Row P, Seat 7, Lower sideline, $60, open',
    );
    // Each seat's number is shown, beside the mark its state has on the map.
    const [open, held, sold, off] = within(rowF).getAllByRole('button');
    expect(open).toHaveTextContent('7');
    expect(open.querySelector('.venue-map__seat--open.venue-map--violet')).not.toBeNull();
    expect(held.querySelector('.venue-map__dot--hollow')).not.toBeNull();
    expect(sold.querySelector('.venue-map__mark--cross')).not.toBeNull();
    expect(off.querySelector('.venue-map__mark--dash')).not.toBeNull();
    // Unavailable seats stay reachable, marked aria-disabled.
    for (const b of [held, sold, off]) {
      expect(b).toHaveAttribute('aria-disabled', 'true');
      expect(b).not.toBeDisabled();
    }
    expect(open).not.toHaveAttribute('aria-disabled');
    expect(open).toHaveAttribute('aria-pressed', 'false');
  });

  it('closes when chosen again, and on the map’s Back to map', async () => {
    render(<Harness />);
    fireEvent.click(listed('115'));
    expect(within(list()).getAllByRole('group')).toHaveLength(2);
    fireEvent.click(listed('115'));
    expect(within(list()).queryAllByRole('group')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Back to map' })).toBeNull();
    fireEvent.click(listed('115'));
    fireEvent.click(screen.getByRole('button', { name: 'Back to map' }));
    expect(listed('115')).toHaveAttribute('aria-expanded', 'false');
    expect(within(list()).queryAllByRole('group')).toHaveLength(0);
  });

  it('opens on the list the section opened on the map', () => {
    render(<Harness />);
    fireEvent.click(within(drawing()).getByRole('button', { name: /^Section 115,/ }));
    expect(listed('115')).toHaveAttribute('aria-expanded', 'true');
    expect(within(list()).getByRole('group', { name: 'Row F' })).toBeInTheDocument();
  });

  it('says the seats are loading until they come', () => {
    render(
      <SectionsList
        map={MAP}
        range={null}
        openSectionId="s-101"
        section={null}
        onOpenSection={() => undefined}
      />,
    );
    expect(within(list()).getByText('Loading the seats…')).toBeInTheDocument();
  });
});

describe('choosing a seat (FR-020, FR-021)', () => {
  it('holds and releases by Enter or Space exactly as a click on the map', async () => {
    const user = userEvent.setup();
    const onSeat = vi.fn();
    render(<Harness onSeat={onSeat} />);
    fireEvent.click(listed('115'));
    const inList = within(list()).getByRole('button', { name: /^Row P, Seat 7,/ });
    inList.focus();
    await user.keyboard('{Enter}');
    expect(onSeat).toHaveBeenCalledTimes(1);
    const fromList = onSeat.mock.calls[0][0] as MapSeat;
    expect(fromList).toEqual(
      expect.objectContaining({
        sectionId: 's-115',
        section: '115',
        row: 2,
        rowLabel: 'P',
        seat: 7,
        seatLabel: '7',
        levelId: L2,
        levelName: 'Lower sideline',
        price: '60.00',
        state: 'open',
      }),
    );
    // Held, in both views, and the focus stays on the seat.
    expect(inList).toHaveAccessibleName('Row P, Seat 7, Lower sideline, $60, held by you');
    expect(inList).toHaveAttribute('aria-pressed', 'true');
    expect(inList).toHaveFocus();
    const onMap = within(drawing()).getByRole('button', { name: /^Row P, Seat 7,/ });
    expect(onMap).toHaveAccessibleName('Row P, Seat 7, Lower sideline, $60, held by you');

    // Space releases it; the map's click gives the same seat as the list's key.
    await user.keyboard(' ');
    expect(onMap).toHaveAccessibleName('Row P, Seat 7, Lower sideline, $60, open');
    fireEvent.click(onMap);
    expect(onSeat).toHaveBeenCalledTimes(3);
    expect(onSeat.mock.calls[2][0]).toEqual(fromList);
    expect(inList).toHaveAccessibleName('Row P, Seat 7, Lower sideline, $60, held by you');
  });

  it('does nothing for a seat that can’t be chosen', async () => {
    const user = userEvent.setup();
    const onSeat = vi.fn();
    render(<Harness onSeat={onSeat} />);
    fireEvent.click(listed('115'));
    const sold = within(list()).getByRole('button', {
      name: 'Row F, Seat 9, Courtside, $95, sold',
    });
    sold.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    fireEvent.click(sold);
    expect(onSeat).not.toHaveBeenCalled();
  });

  it('fades a seat outside the price filter, which stays choosable', () => {
    const onSeat = vi.fn();
    render(<Harness onSeat={onSeat} />);
    setRange(70, 95);
    fireEvent.click(listed('115'));
    const cheap = within(list()).getByRole('button', { name: /^Row P, Seat 7,/ });
    expect(cheap.querySelector('.venue-map__seat--faded')).not.toBeNull();
    fireEvent.click(cheap);
    expect(onSeat).toHaveBeenCalledWith(expect.objectContaining({ row: 2, seat: 7 }));
  });
});

describe('usePriceFilter (FR-017)', () => {
  it('starts at the levels’ full range and is shared by the map and the list', () => {
    render(<Harness />);
    expect(screen.getByRole('slider', { name: 'Lowest price' })).toHaveValue('35');
    expect(screen.getByRole('slider', { name: 'Highest price' })).toHaveValue('95');
    setRange(50, 95);
    expect(listed('101')).toHaveAccessibleName('Section 101, no open seats between $50 and $95');
    expect(within(drawing()).getByRole('button', { name: /^Section 101,/ })).toHaveAccessibleName(
      'Section 101, no open seats between $50 and $95',
    );
  });
});
