/**
 * Spec 039: layouts as `getLayoutDrawing` serves them (contract 2.1.0), for the editor's tests.
 * "Riverside": two levels, two sections. 101 is 2 rows × 3 seats, its row B in Courtside and one
 * seat of row A accessible and in Courtside; 102 is 1 row × 2 seats. Ids are plain strings: the
 * stubs never check them.
 */
import type { LayoutDrawing } from '@queuepass/shared';

export const VENUE_ID = 'v1';
export const LAYOUT_ID = 'lay-1';

const seat = (id: string, label: string, x: number, y: number, extra = {}) => ({
  id,
  label,
  at: [x, y] as [number, number],
  ...extra,
});

export const DRAWING: LayoutDrawing = {
  id: LAYOUT_ID,
  locationId: VENUE_ID,
  name: 'Riverside',
  source: 'DRAWN',
  revision: 4,
  locked: false,
  lockedBy: [],
  floor: {
    kind: 'COURT',
    outline: [
      [40, 40],
      [80, 40],
      [80, 60],
      [40, 60],
    ],
  },
  size: { width: 130, height: 90 },
  levels: [
    { id: 'lv-court', name: 'Courtside', rank: 1, color: 'red' },
    { id: 'lv-std', name: 'Standard', rank: 2, color: 'violet' },
  ],
  sections: [
    {
      id: 's-101',
      name: '101',
      levelId: 'lv-std',
      origin: [20, 30],
      angle: 0,
      generator: {
        rows: 2,
        seatsPerRow: [3],
        rowLabels: 'LETTERS',
        firstRow: 'A',
        firstSeat: 1,
        direction: 'LEFT_TO_RIGHT',
        curve: 0,
      },
      outline: [
        [16.5, 31.5],
        [16.5, 26.5],
        [23.5, 26.5],
        [23.5, 31.5],
      ],
      rows: [
        {
          id: 'r-101-a',
          label: 'A',
          seats: [
            seat('st-a1', '1', 18, 30, { accessible: true, levelId: 'lv-court' }),
            seat('st-a2', '2', 20, 30),
            seat('st-a3', '3', 22, 30),
          ],
        },
        {
          id: 'r-101-b',
          label: 'B',
          levelId: 'lv-court',
          seats: [
            seat('st-b1', '1', 18, 28),
            seat('st-b2', '2', 20, 28),
            seat('st-b3', '3', 22, 28),
          ],
        },
      ],
    },
    {
      id: 's-102',
      name: '102',
      levelId: 'lv-court',
      origin: [100.04, 30],
      angle: 90,
      generator: null,
      outline: [
        [98.5, 28.5],
        [101.5, 28.5],
        [101.5, 33.5],
        [98.5, 33.5],
      ],
      rows: [
        {
          id: 'r-102-1',
          label: '1',
          seats: [seat('st-102-1', '1', 100.04, 30), seat('st-102-2', '2', 100, 32.0001)],
        },
      ],
    },
  ],
};

/** The same layout, locked by a sold seat. */
export const LOCKED: LayoutDrawing = {
  ...DRAWING,
  locked: true,
  lockedBy: [
    { id: 'e1', name: 'Cardinals vs. Duke' },
    { id: 'e2', name: 'Spring concert' },
  ],
};

/** `LayoutDetail` of a layout just saved or made: only its id is read. */
export const detailOf = (id: string, name = 'Riverside') => ({
  id,
  locationId: VENUE_ID,
  name,
  source: 'DRAWN',
  floorKind: 'COURT',
  seatCount: 8,
  sectionCount: 2,
  levelCount: 2,
  eventsUsing: 0,
  locked: false,
  size: { width: 130, height: 90 },
  floorOutline: null,
  levels: [],
  sections: [],
  latestPrices: null,
});
