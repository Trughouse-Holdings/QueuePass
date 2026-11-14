import { formatPrice, inRange, type PriceRange, type VenueMap } from './map-state.js';

/**
 * Spec 038 FR-016, FR-019 (research R13, T039): the map's legend. Each level by name, its color
 * beside it and its price ("Courtside $95", "Upper: not on sale"), a level outside the price
 * filter marked so in words; then each seat state with the mark the map draws for it, so neither
 * levels nor states are told by color alone (Constitution VII).
 */
export function Legend({
  map,
  colorBy,
  range,
}: {
  map: VenueMap;
  colorBy: 'price' | 'state';
  range: PriceRange | null;
}): React.ReactElement {
  const states: [string, string][] = [
    ['open', 'Open'],
    ['held', 'Held'],
    ['sold', 'Sold'],
    ['off', 'Off sale'],
    ...(colorBy === 'price' ? ([['mine', 'Your seats']] as [string, string][]) : []),
  ];
  return (
    <div className="venue-map-legend">
      {colorBy === 'price' && (
        <ul aria-label="Price levels" className="venue-map-legend__list">
          {map.levels.map((l) => {
            const out = l.price !== null && range !== null && !inRange(l.price, range);
            return (
              <li
                key={l.levelId}
                className={`venue-map-legend__item${out ? ' venue-map-legend__item--out' : ''}`}
              >
                <span className={`level-swatch level-swatch--${l.color}`} aria-hidden="true" />
                {l.price === null
                  ? `${l.name}: not on sale`
                  : `${l.name} ${formatPrice(l.price)}${out ? ', outside your price range' : ''}`}
              </li>
            );
          })}
        </ul>
      )}
      {colorBy === 'state' && (
        <p className="venue-map-legend__note">Sections show sold / open seats.</p>
      )}
      <ul aria-label="Seat states" className="venue-map-legend__list">
        {states.map(([kind, name]) => (
          <li key={kind} className="venue-map-legend__item">
            <svg
              className="venue-map-legend__mark"
              viewBox="-1 -1 2 2"
              width="16"
              height="16"
              aria-hidden="true"
            >
              <g className={`venue-map__seat--${kind}`}>
                <SeatMark kind={kind as MarkKind} x={0} y={0} r={0.8} />
              </g>
            </svg>
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}

export type MarkKind = 'open' | 'held' | 'sold' | 'off' | 'mine';

/**
 * Research R13: a seat's look by state. Open, a filled circle (its level's color, from the
 * seat's class); held by someone else, a hollow circle; sold, a small gray circle with a cross;
 * off sale, a small gray dash (over a clear circle that still takes the pointer); the customer's
 * own, the accent with a check mark.
 */
export function SeatMark({
  kind,
  x,
  y,
  r,
}: {
  kind: MarkKind;
  x: number;
  y: number;
  r: number;
}): React.ReactElement {
  switch (kind) {
    case 'held':
      return <circle className="venue-map__dot venue-map__dot--hollow" cx={x} cy={y} r={r * 0.8} />;
    case 'sold': {
      const d = r * 0.45;
      return (
        <>
          <circle className="venue-map__dot venue-map__dot--small" cx={x} cy={y} r={r * 0.75} />
          <path
            className="venue-map__mark venue-map__mark--cross"
            d={`M${x - d} ${y - d}L${x + d} ${y + d}M${x - d} ${y + d}L${x + d} ${y - d}`}
          />
        </>
      );
    }
    case 'off':
      return (
        <>
          <circle className="venue-map__hit" cx={x} cy={y} r={r} />
          <path
            className="venue-map__mark venue-map__mark--dash"
            d={`M${x - r * 0.6} ${y}H${x + r * 0.6}`}
          />
        </>
      );
    case 'mine':
      return (
        <>
          <circle className="venue-map__dot" cx={x} cy={y} r={r} />
          <path
            className="venue-map__mark venue-map__mark--check"
            d={`M${x - r * 0.45} ${y}L${x - r * 0.1} ${y + r * 0.35}L${x + r * 0.5} ${y - r * 0.35}`}
          />
        </>
      );
    default:
      return <circle className="venue-map__dot" cx={x} cy={y} r={r} />;
  }
}
