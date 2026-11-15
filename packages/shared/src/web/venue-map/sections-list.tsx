import { useId } from 'react';
import {
  formatPrice,
  openSeatsIn,
  priceCents,
  type MapSectionSummary,
  type VenueMap,
} from './map-state.js';

export interface SectionsListProps {
  map: VenueMap;
  /** The section chosen, the same one the map is zoomed into. */
  openSectionId: string | null;
  /** Opens a section on the map (its seats are chosen there), or `null` for the whole map. */
  onOpenSection(sectionId: string | null): void;
  /** Its heading's id, focusable by script: the map's "Skip to the Sections list" moves there. */
  headingId?: string;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "$60–$95" (or "$35"): the prices of a section's open seats; `null` if none. */
function openPrices(map: VenueMap, s: MapSectionSummary): string | null {
  const prices = s.counts.flatMap((c) => {
    if (c.open <= 0) return [];
    const price = map.levels.find((l) => l.levelId === c.levelId)?.price ?? null;
    return price !== null ? [price] : [];
  });
  if (prices.length === 0) return null;
  prices.sort((a, b) => priceCents(a) - priceCents(b));
  const [low, high] = [formatPrice(prices[0]), formatPrice(prices[prices.length - 1])];
  return low === high ? low : `${low}–${high}`;
}

/**
 * Spec 038 US4 (FR-020, SC-007; research R13, T042): the Sections list, the map's sections without
 * the map. It reads the same state as the map: the same venue map and the same open section.
 * Each section is a button with its name, the price range of its open seats and their count. Spec 039's walk (2026-11-14; FR-020 amended): the list always
 * shows every section and never their seats. Choosing one opens it on the map, where its seats
 * are chosen; it stays marked here ("On the map", pressed), and choosing it again shows the
 * whole map. The app moves the keyboard to the section's seats on the map (`VenueMap`'s
 * `focusSeats`).
 */
export function SectionsList({
  map,
  openSectionId,
  onOpenSection,
  headingId,
}: SectionsListProps): React.ReactElement {
  const id = useId();
  const heading = headingId ?? `${id}-heading`;
  const open = map.sections.find((s) => s.sectionId === openSectionId) ?? null;

  const summary = (s: MapSectionSummary): { name: string; prices: string | null; open: string } => {
    const n = openSeatsIn(map, s);
    const prices = openPrices(map, s);
    if (n > 0 && prices) {
      const count = plural(n, 'open seat', 'open seats');
      return { name: `Section ${s.name}, ${prices}, ${count}`, prices, open: count };
    }
    const none = 'no open seats';
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
                aria-pressed={chosen}
                className={`sections-list__section${
                  prices === null ? ' sections-list__section--faded' : ''
                }${chosen ? ' sections-list__section--chosen' : ''}`}
                onClick={() => onOpenSection(chosen ? null : s.sectionId)}
              >
                <span className="sections-list__name">{`Section ${s.name}`}</span>
                {prices && <span className="sections-list__prices">{prices}</span>}
                <span className="sections-list__count">{count}</span>
                {chosen && (
                  <span className="sections-list__shown" aria-hidden="true">
                    On the map
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
