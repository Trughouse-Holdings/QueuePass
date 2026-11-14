import { SeatMark, type MarkKind } from './legend.js';
import {
  formatPrice,
  inRange,
  type PriceRange,
  type SeatState,
  type VenueMap,
  type VenueMapSection,
} from './map-state.js';

/**
 * A seat as the map hands it to `onSeat`: the API's `{sectionId, row, seat}` (numbers, research
 * R2) with the labels people read, its level and price for this event, and its state as loaded.
 */
export interface MapSeat {
  sectionId: string;
  /** The section's name. */
  section: string;
  row: number;
  rowLabel: string;
  seat: number;
  seatLabel: string;
  levelId: string;
  levelName: string;
  /** This event's price for the seat's level; `null` when the level has nothing on sale. */
  price: string | null;
  state: SeatState;
  accessible: boolean;
}

/**
 * How a seat is shown: its state, or the customer's own view of it (`mine` once held, `holding`
 * and `releasing` while a click is answered), and whether it can be chosen.
 */
export type ShownState = SeatState | 'mine' | 'holding' | 'releasing';
export interface SeatView {
  shown?: ShownState;
  disabled?: boolean;
}

const STATE_TEXT: Record<ShownState, string> = {
  open: 'open',
  reserved: 'held',
  sold: 'sold',
  offSale: 'off sale',
  mine: 'held by you',
  holding: 'holding',
  releasing: 'releasing',
};

const MARK: Record<ShownState, MarkKind> = {
  open: 'open',
  releasing: 'open',
  reserved: 'held',
  sold: 'sold',
  offSale: 'off',
  mine: 'mine',
  holding: 'mine',
};

/** Spec 038 FR-019: "Sec 115, Row F, Seat 7 · Courtside · $95", shown on hover and focus. */
export const seatTip = (s: MapSeat): string =>
  `Sec ${s.section}, Row ${s.rowLabel}, Seat ${s.seatLabel} · ${s.levelName} · ${
    s.price === null ? 'not on sale' : formatPrice(s.price)
  }`;

type LoadedRow = VenueMapSection['rows'][number];

/** A loaded seat as the map and the Sections list hand it to `onSeat`. */
export function mapSeatOf(
  map: VenueMap,
  section: VenueMapSection,
  row: LoadedRow,
  s: LoadedRow['seats'][number],
): MapSeat {
  const level = map.levels.find((l) => l.levelId === s.levelId);
  return {
    sectionId: section.sectionId,
    section: section.name,
    row: row.number,
    rowLabel: row.label,
    seat: s.number,
    seatLabel: s.label,
    levelId: s.levelId,
    levelName: level?.name ?? '',
    price: level?.price ?? null,
    state: s.state,
    accessible: s.accessible,
  };
}

/** How a seat is drawn and named, the same in the map and in the Sections list (FR-020). */
export interface SeatLook {
  shown: ShownState;
  disabled: boolean;
  /** Its mark (SC-007: states differ by shape, not color alone). */
  kind: MarkKind;
  /** Its fill: its level's color while open, else the unavailable gray. */
  color: string;
  /** Outside the price filter: faded, still choosable (FR-017). */
  faded: boolean;
  /** "Row F, Seat 7, Courtside, $95, open". */
  name: string;
}

export function seatLook(
  map: VenueMap,
  seat: MapSeat,
  range: PriceRange | null,
  seatView?: (seat: MapSeat) => SeatView,
): SeatLook {
  const view = seatView?.(seat) ?? {};
  const shown = view.shown ?? seat.state;
  const disabled = view.disabled ?? !['open', 'mine', 'holding', 'releasing'].includes(shown);
  const kind = MARK[shown];
  const level = map.levels.find((l) => l.levelId === seat.levelId);
  return {
    shown,
    disabled,
    kind,
    color: kind === 'open' && level ? `venue-map--${level.color}` : 'venue-map--unavailable',
    faded: range !== null && !inRange(seat.price, range),
    name: `Row ${seat.rowLabel}, Seat ${seat.seatLabel}, ${seat.levelName}, ${
      seat.price === null ? 'not on sale' : formatPrice(seat.price)
    }, ${STATE_TEXT[shown]}`,
  };
}

/** The distance between neighbouring seats, for their size and their row labels' place. */
function seatSpacing(section: VenueMapSection): number {
  let best = Infinity;
  for (const row of section.rows) {
    for (let i = 1; i < row.seats.length; i += 1) {
      const [a, b] = [row.seats[i - 1].at, row.seats[i].at];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d > 0 && d < best) best = d;
    }
  }
  return Number.isFinite(best) ? best : 2;
}

/**
 * Spec 038 FR-018, FR-019 (research R13, T039): the seats of the one section zoomed into, each in
 * its place, row labels at both ends of each row. Every seat is a focusable button named "Row F,
 * Seat 7, Courtside, $95, open"; a seat that can't be chosen stays focusable, `aria-disabled`.
 * Seats outside the price filter are faded and still choosable (FR-017).
 */
export function SectionView({
  map,
  section,
  range,
  seatView,
  onSeat,
  onTip,
  dragged,
}: {
  map: VenueMap;
  section: VenueMapSection;
  range: PriceRange | null;
  seatView?: (seat: MapSeat) => SeatView;
  onSeat?: (seat: MapSeat) => void;
  onTip(text: string | null): void;
  /** Whether the press that ends in this click was a drag of the map. */
  dragged(): boolean;
}): React.ReactElement {
  const spacing = seatSpacing(section);
  const r = spacing * 0.4;
  return (
    <g className="venue-map__seats">
      {section.rows.map((row) => {
        const first = row.seats[0];
        const last = row.seats[row.seats.length - 1];
        // Row labels beyond each end of the row, along it.
        let dir: [number, number] = [1, 0];
        if (first && last && row.seats.length > 1) {
          const dx = last.at[0] - first.at[0];
          const dy = last.at[1] - first.at[1];
          const len = Math.hypot(dx, dy) || 1;
          dir = [dx / len, dy / len];
        }
        const ends: [number, number][] =
          first && last
            ? [
                [first.at[0] - dir[0] * spacing * 1.2, first.at[1] - dir[1] * spacing * 1.2],
                [last.at[0] + dir[0] * spacing * 1.2, last.at[1] + dir[1] * spacing * 1.2],
              ]
            : [];
        return (
          <g key={row.number} className="venue-map__row">
            {ends.map(([x, y], i) => (
              <text
                key={i}
                className="venue-map__row-label"
                x={x}
                y={y}
                fontSize={spacing * 0.8}
                textAnchor="middle"
                dominantBaseline="central"
                aria-hidden="true"
              >
                {row.label}
              </text>
            ))}
            {row.seats.map((s) => {
              const seat = mapSeatOf(map, section, row, s);
              const { shown, disabled, kind, color, faded, name } = seatLook(
                map,
                seat,
                range,
                seatView,
              );
              const choose = (): void => {
                if (!disabled) onSeat?.(seat);
              };
              const tip = seatTip(seat);
              return (
                <g
                  key={s.number}
                  role="button"
                  tabIndex={0}
                  aria-label={name}
                  aria-pressed={shown === 'mine' || shown === 'holding'}
                  aria-disabled={disabled || undefined}
                  className={`venue-map__seat venue-map__seat--${kind} ${color}${
                    faded ? ' venue-map__seat--faded' : ''
                  }`}
                  onClick={() => {
                    if (!dragged()) choose();
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    e.stopPropagation();
                    choose();
                  }}
                  onMouseEnter={() => onTip(tip)}
                  onMouseLeave={() => onTip(null)}
                  onFocus={() => onTip(tip)}
                  onBlur={() => onTip(null)}
                >
                  <SeatMark kind={kind} x={s.at[0]} y={s.at[1]} r={r} />
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}
