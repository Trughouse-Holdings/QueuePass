import { useId } from 'react';
import { SeatMark } from './legend.js';
import {
  formatPrice,
  inRange,
  openSeatsIn,
  priceCents,
  type MapSectionSummary,
  type PriceRange,
  type VenueMap,
  type VenueMapSection,
} from './map-state.js';
import { wholeDollars } from './price-filter.js';
import { mapSeatOf, seatLook, type MapSeat, type SeatView } from './section-view.js';

export interface SectionsListProps {
  map: VenueMap;
  /** The price filter the map shows (`usePriceFilter`); `null` for none. */
  range: PriceRange | null;
  /** The section chosen, the same one the map is zoomed into. */
  openSectionId: string | null;
  /** That section's seats once loaded (`useSeatStream`'s `section`). */
  section: VenueMapSection | null;
  onOpenSection(sectionId: string | null): void;
  /** How each seat is shown and whether it can be chosen; the map's own. */
  seatView?(seat: MapSeat): SeatView;
  onSeat?(seat: MapSeat): void;
  /** Its heading's id, focusable by script: the map's "Skip to the Sections list" moves there. */
  headingId?: string;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "$60–$95" (or "$35"): the prices of a section's open seats inside the filter; `null` if none. */
function openPrices(map: VenueMap, s: MapSectionSummary, range: PriceRange | null): string | null {
  const prices = s.counts.flatMap((c) => {
    if (c.open <= 0) return [];
    const price = map.levels.find((l) => l.levelId === c.levelId)?.price ?? null;
    return price !== null && inRange(price, range) ? [price] : [];
  });
  if (prices.length === 0) return null;
  prices.sort((a, b) => priceCents(a) - priceCents(b));
  const [low, high] = [formatPrice(prices[0]), formatPrice(prices[prices.length - 1])];
  return low === high ? low : `${low}–${high}`;
}

/**
 * Spec 038 US4 (FR-020, SC-007; research R13, T042): the Sections list, the map's choices without
 * the map, for the keyboard and screen readers. It reads the same state as the map: the same
 * venue map and price filter, the same open section (choosing one here zooms the map into it, and
 * opening one on the map opens it here), and the same `seatView` and `onSeat`, so a seat held in
 * either view shows in the other at once and goes through the same hold queue (FR-021). Each
 * section is a button with its name, the price range of its open seats and their count under the
 * filter; the chosen one's seats are native buttons grouped by row, named as the map names them
 * ("Row F, Seat 7, Courtside, $95, open"), each with its state's mark beside its number.
 */
export function SectionsList({
  map,
  range,
  openSectionId,
  section,
  onOpenSection,
  seatView,
  onSeat,
  headingId,
}: SectionsListProps): React.ReactElement {
  const id = useId();
  const heading = headingId ?? `${id}-heading`;
  const open = map.sections.find((s) => s.sectionId === openSectionId) ?? null;
  const seats = open && section?.sectionId === open.sectionId ? section : null;

  const summary = (s: MapSectionSummary): { name: string; prices: string | null; open: string } => {
    const n = openSeatsIn(map, s, range);
    const prices = openPrices(map, s, range);
    if (n > 0 && prices) {
      const count = plural(n, 'open seat', 'open seats');
      return { name: `Section ${s.name}, ${prices}, ${count}`, prices, open: count };
    }
    const outside = range !== null && openSeatsIn(map, s, null) > 0;
    const none = outside
      ? `no open seats between ${wholeDollars(range.low)} and ${wholeDollars(range.high)}`
      : 'no open seats';
    return { name: `Section ${s.name}, ${none}`, prices: null, open: none };
  };

  return (
    <section className="sections-list" aria-labelledby={heading}>
      <h3 id={heading} tabIndex={-1}>
        Sections
      </h3>
      <ul className="sections-list__sections">
        {map.sections.map((s) => {
          const { name, prices, open: count } = summary(s);
          const chosen = s.sectionId === open?.sectionId;
          return (
            <li key={s.sectionId}>
              <button
                type="button"
                aria-label={name}
                aria-expanded={chosen}
                aria-controls={chosen ? `${id}-seats` : undefined}
                className={`sections-list__section${
                  prices === null ? ' sections-list__section--faded' : ''
                }`}
                onClick={() => onOpenSection(chosen ? null : s.sectionId)}
              >
                <span className="sections-list__name">{`Section ${s.name}`}</span>
                {prices && <span className="sections-list__prices">{prices}</span>}
                <span className="sections-list__count">{count}</span>
              </button>
              {chosen && (
                <div id={`${id}-seats`} className="sections-list__seats">
                  {seats ? (
                    seats.rows.map((row) => (
                      <div
                        key={row.number}
                        role="group"
                        aria-label={`Row ${row.label}`}
                        className="sections-list__row"
                      >
                        <span className="sections-list__row-label" aria-hidden="true">
                          {`Row ${row.label}`}
                        </span>
                        {row.seats.map((s) => {
                          const seat = mapSeatOf(map, seats, row, s);
                          const look = seatLook(map, seat, range, seatView);
                          const mine = look.shown === 'mine' || look.shown === 'holding';
                          return (
                            <button
                              key={s.number}
                              type="button"
                              aria-label={look.name}
                              aria-pressed={mine}
                              aria-disabled={look.disabled || undefined}
                              className="sections-list__seat"
                              onClick={() => {
                                if (!look.disabled) onSeat?.(seat);
                              }}
                            >
                              <svg
                                className="sections-list__mark"
                                viewBox="-1 -1 2 2"
                                width="16"
                                height="16"
                                aria-hidden="true"
                              >
                                <g
                                  className={`venue-map__seat--${look.kind} ${look.color}${
                                    look.faded ? ' venue-map__seat--faded' : ''
                                  }`}
                                >
                                  <SeatMark kind={look.kind} x={0} y={0} r={0.8} />
                                </g>
                              </svg>
                              {s.label}
                            </button>
                          );
                        })}
                      </div>
                    ))
                  ) : (
                    <p className="note">Loading the seats…</p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
