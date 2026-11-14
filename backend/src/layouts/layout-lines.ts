/**
 * Spec 038 FR-005, research R6: where section lines go on the map. Sections sit on a grid of
 * ceil(√n) columns in line order, left to right and then down. Every grid cell is as large as the
 * largest section, with `GAP` units between cells; each section is a rectangle at its cell's top
 * left, `seatsPerRow × 2 + 4` units wide and `rows × 2 + 4` high, its seats `SEAT` units apart
 * and 3 units in from its edges, row 1 at the top. The map's size is the grid's bounds.
 *
 * The carry-over migration (`…_seat_maps`, R16) places `007`'s sections with the same arithmetic in
 * SQL; `migration.seat-maps.e2e-spec.ts` checks the two agree seat by seat.
 */
export const GRID = { seat: 2, padding: 4, gap: 8 } as const;

/** One section line's size. */
export interface LineSize {
  rows: number;
  seatsPerRow: number;
}

/** A section's rectangle on the grid, its outline and where its name is drawn. */
export interface GridSection {
  x: number;
  y: number;
  width: number;
  height: number;
  outline: [number, number][];
  labelAt: [number, number];
}

export interface GridLayout {
  size: { width: number; height: number };
  sections: GridSection[];
}

const sectionWidth = (l: LineSize): number => l.seatsPerRow * GRID.seat + GRID.padding;
const sectionHeight = (l: LineSize): number => l.rows * GRID.seat + GRID.padding;

/** Places `lines` (at least one) on the grid, in order. */
export function gridLayout(lines: LineSize[]): GridLayout {
  const columns = Math.ceil(Math.sqrt(lines.length));
  const cellWidth = Math.max(...lines.map(sectionWidth));
  const cellHeight = Math.max(...lines.map(sectionHeight));
  const sections = lines.map((line, i): GridSection => {
    const x = (i % columns) * (cellWidth + GRID.gap);
    const y = Math.floor(i / columns) * (cellHeight + GRID.gap);
    const width = sectionWidth(line);
    const height = sectionHeight(line);
    return {
      x,
      y,
      width,
      height,
      outline: [
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height],
      ],
      labelAt: [x + width / 2, y + height / 2],
    };
  });
  const usedColumns = Math.min(lines.length, columns);
  const gridRows = Math.ceil(lines.length / columns);
  return {
    size: {
      width: usedColumns * (cellWidth + GRID.gap) - GRID.gap,
      height: gridRows * (cellHeight + GRID.gap) - GRID.gap,
    },
    sections,
  };
}

/** Where seat `seat` of row `row` (both from 1) of a placed section is. */
export function seatPlace(section: GridSection, row: number, seat: number): [number, number] {
  return [section.x + seat * GRID.seat + 1, section.y + row * GRID.seat + 1];
}
