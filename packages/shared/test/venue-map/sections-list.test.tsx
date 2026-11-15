import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SectionsList } from '../../src/web/venue-map/sections-list';
import { VenueMap, type MapSeat, type SeatView } from '../../src/web/venue-map/venue-map';
import type { VenueMap as Map, VenueMapSection } from '../../src/web/venue-map/map-state';

/**
 * Spec 038 US4 (T041; FR-020, SC-007; research R13): the Sections list, a second view of the venue
 * map's state that needs no map. Each section with its name, the price range of its open seats and
 * their count. Spec 039's walk (2026-11-14; 038 FR-020 amended): the
 * list always shows every section, never seats. A section chosen here zooms the map into it,
 * stays marked in the list, and the keyboard's focus moves to its first seat on the map, where
 * seats are chosen (each a button named "Row F, Seat 7, Courtside, $95, open").
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
 * The map and the list side by side, as an app gives them: one open section and one set of the customer's seats, which a choice in either view toggles.
 */
function Harness({ onSeat }: { onSeat?: (s: MapSeat) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [mine, setMine] = useState<string[]>([]);
  const key = (s: MapSeat) => `${s.sectionId}/${s.row}/${s.seat}`;
  const seatView = (s: MapSeat): SeatView =>
    mine.includes(key(s)) ? { shown: 'mine', disabled: false } : {};
  const choose = (s: MapSeat) => {
    onSeat?.(s);
    setMine((m) => (m.includes(key(s)) ? m.filter((k) => k !== key(s)) : [...m, key(s)]));
  };
  const section = open === 's-115' ? SECTION_115 : null;
  // A section chosen from the list sends the keyboard to its seats on the map.
  const [focusSeats, setFocusSeats] = useState(0);
  return (
    <>
      <VenueMap
        map={MAP}
        openSectionId={open}
        section={section}
        onOpenSection={setOpen}
        seatView={seatView}
        onSeat={choose}
        skipTo="sections-heading"
        focusSeats={focusSeats}
      />
      <SectionsList
        headingId="sections-heading"
        map={MAP}
        openSectionId={open}
        onOpenSection={(id) => {
          setOpen(id);
          if (id) setFocusSeats((n) => n + 1);
        }}
      />
    </>
  );
}

const list = () => screen.getByRole('region', { name: 'Sections' });
const drawing = () => screen.getByRole('group', { name: 'Basketball map' });
const listed = (name: string) =>
  within(list()).getByRole('button', { name: new RegExp(`^Section ${name}(,|$)`) });

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
      expect(b).toHaveAttribute('aria-pressed', 'false');
    }
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

describe('a section chosen (FR-020 as amended, SC-007)', () => {
  it('stays in the list with every other section, marked, with no seats; the map zooms into it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    listed('115').focus();
    await user.keyboard('{Enter}');
    expect(listed('115')).toHaveAttribute('aria-pressed', 'true');
    expect(listed('115')).toHaveTextContent('On the map');
    expect(listed('101')).toHaveAttribute('aria-pressed', 'false');
    // Every section still listed; no seat is.
    expect(within(list()).getAllByRole('button', { name: /^Section / })).toHaveLength(
      MAP.sections.length,
    );
    expect(within(list()).queryByRole('button', { name: /^Row / })).toBeNull();
    expect(within(list()).queryAllByRole('group')).toHaveLength(0);
    // One state: the map zoomed into the same section, its seats there.
    expect(screen.getByRole('button', { name: 'Back to map' })).toBeInTheDocument();
    expect(
      within(drawing()).getByRole('button', { name: 'Row F, Seat 7, Courtside, $95, open' }),
    ).toBeInTheDocument();
  });

  it("sends the keyboard to the section's first seat on the map", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    listed('115').focus();
    await user.keyboard('{Enter}');
    expect(
      within(drawing()).getByRole('button', { name: 'Row F, Seat 7, Courtside, $95, open' }),
    ).toHaveFocus();
  });

  it('closes when chosen again, and on the map’s Back to map', () => {
    render(<Harness />);
    fireEvent.click(listed('115'));
    fireEvent.click(listed('115'));
    expect(listed('115')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: 'Back to map' })).toBeNull();
    fireEvent.click(listed('115'));
    fireEvent.click(screen.getByRole('button', { name: 'Back to map' }));
    expect(listed('115')).toHaveAttribute('aria-pressed', 'false');
  });

  it('marks in the list the section opened on the map, without moving the focus', () => {
    render(<Harness />);
    const onMap = within(drawing()).getByRole('button', { name: /^Section 115,/ });
    onMap.focus();
    fireEvent.click(onMap);
    expect(listed('115')).toHaveAttribute('aria-pressed', 'true');
    expect(within(list()).queryByRole('button', { name: /^Row / })).toBeNull();
  });
});

describe('choosing a seat, on the map (FR-020 as amended, FR-021)', () => {
  it('after choosing a section in the list, holds and releases its seats by Enter or Space', async () => {
    const user = userEvent.setup();
    const onSeat = vi.fn();
    render(<Harness onSeat={onSeat} />);
    listed('115').focus();
    await user.keyboard('{Enter}');
    const seat = within(drawing()).getByRole('button', { name: /^Row P, Seat 7,/ });
    seat.focus();
    await user.keyboard('{Enter}');
    expect(onSeat).toHaveBeenCalledWith(
      expect.objectContaining({ sectionId: 's-115', row: 2, seat: 7, price: '60.00' }),
    );
    expect(seat).toHaveAccessibleName('Row P, Seat 7, Lower sideline, $60, held by you');
    await user.keyboard(' ');
    expect(seat).toHaveAccessibleName('Row P, Seat 7, Lower sideline, $60, open');
  });
});

describe('the skip to the Sections list (US4, SC-007; T060, M5)', () => {
  it('lets the keyboard pass the map’s sections to the list', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const skip = screen.getByRole('button', { name: 'Skip to the Sections list' });
    // Before the map's sections, after its filter and zoom controls.
    for (let i = 0; i < 10 && document.activeElement !== skip; i += 1) await user.tab();
    expect(skip).toHaveFocus();
    expect(skip).toHaveClass('skip-link');
    await user.keyboard('{Enter}');
    expect(within(list()).getByRole('heading', { name: 'Sections' })).toHaveFocus();
    await user.tab();
    expect(listed('115')).toHaveFocus();
  });
});
