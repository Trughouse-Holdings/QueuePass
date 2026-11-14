import { useEffect, useMemo, useState } from 'react';
import { priceRangeOf, type MapLevel, type PriceRange } from './map-state.js';

/** A filter end as people read it: "$50". */
export const wholeDollars = (n: number): string => `$${n.toLocaleString('en-US')}`;

/**
 * Spec 038 FR-017, FR-020: the price filter's state, for a page that shows it in the map and
 * filters the Sections list by it too. It starts at the levels' full range, and starts over there
 * when the prices change (a reconnect after a price change); `null` when no level has a price.
 */
export function usePriceFilter(
  levels: readonly MapLevel[],
): [PriceRange | null, (range: PriceRange) => void] {
  const full = useMemo(() => priceRangeOf(levels), [levels]);
  const [range, setRange] = useState<PriceRange | null>(full);
  useEffect(() => setRange(full), [full?.low, full?.high]);
  return [range, setRange];
}

/**
 * Spec 038 FR-017 (research R14, T039): the price filter, a low and a high price in whole dollars
 * over the event's level prices, as two range inputs. The low end never passes the high end: moving
 * one past the other brings the other with it.
 */
export function PriceFilter({
  full,
  range,
  onChange,
}: {
  /** The levels' prices, from `priceRangeOf`. */
  full: PriceRange;
  range: PriceRange;
  onChange(range: PriceRange): void;
}): React.ReactElement {
  return (
    <fieldset className="price-filter">
      <legend>Price</legend>
      <label className="price-filter__end">
        Lowest price
        <input
          type="range"
          min={full.low}
          max={full.high}
          step={1}
          value={range.low}
          onChange={(e) => {
            const low = Number(e.target.value);
            onChange({ low, high: Math.max(low, range.high) });
          }}
        />
      </label>
      <label className="price-filter__end">
        Highest price
        <input
          type="range"
          min={full.low}
          max={full.high}
          step={1}
          value={range.high}
          onChange={(e) => {
            const high = Number(e.target.value);
            onChange({ low: Math.min(high, range.low), high });
          }}
        />
      </label>
      <output className="price-filter__range">
        {`${wholeDollars(range.low)}–${wholeDollars(range.high)}`}
      </output>
    </fieldset>
  );
}
