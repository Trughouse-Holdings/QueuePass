import { useEffect, useMemo, useState } from 'react';
import { bounds, outlinePath } from './map-geometry.js';
import { Legend, type SectionState } from './legend.js';
import {
  formatPrice,
  openSeatsIn,
  priceRangeOf,
  sectionLevel,
  type MapSectionSummary,
  type PriceRange,
  type VenueMap as VenueMapData,
  type VenueMapSection,
} from './map-state.js';
import { PriceFilter, usePriceFilter, wholeDollars } from './price-filter.js';
import { SectionView, type MapSeat, type SeatView } from './section-view.js';
import { usePanZoom } from './use-pan-zoom.js';

export type { MapSeat, SeatView, ShownState } from './section-view.js';

export interface VenueMapProps {
  map: VenueMapData;
  /**
   * `price` (the customer): sections in their cheapest open level's color, the price filter and
   * the level legend. `state` (the admin, FR-027): sections named by their counts by state.
   */
  colorBy?: 'price' | 'state';
  /** The section zoomed into, or `null` for the overview. */
  openSectionId: string | null;
  /** That section's seats once loaded (`getVenueMapSection`, kept current). */
  section: VenueMapSection | null;
  onOpenSection(sectionId: string | null): void;
  /** The price filter, when the page shares it (the Sections list); kept here otherwise. */
  range?: PriceRange | null;
  onRange?(range: PriceRange): void;
  /** How each seat is shown and whether it can be chosen; by its state otherwise. */
  seatView?(seat: MapSeat): SeatView;
  onSeat?(seat: MapSeat): void;
  /**
   * Spec 038 US4 (FR-020, SC-007): the id of the Sections list's heading beside the map. A "Skip
   * to the Sections list" button before the map's sections, shown when focused, moves the focus
   * there, so the keyboard need not pass every section of the map.
   */
  skipTo?: string;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function stateCounts(section: MapSectionSummary) {
  const sum = (k: 'open' | 'reserved' | 'sold' | 'offSale'): number =>
    section.counts.reduce((n, c) => n + Math.max(0, c[k]), 0);
  return { open: sum('open'), held: sum('reserved'), sold: sum('sold'), offSale: sum('offSale') };
}

/**
 * FR-027 (US6): what the admin's map fills a section with, by its seats' states: some open; none
 * open but some held (they may open again); sold out (none open or held, some sold); or none on
 * sale. The legend's Sections list names each (`SECTION_STATES`).
 */
export function sectionState(section: MapSectionSummary): SectionState {
  const c = stateCounts(section);
  if (c.open > 0) return 'open';
  if (c.held > 0) return 'held';
  if (c.sold > 0) return 'sold';
  return 'off';
}

/**
 * Spec 038 US3 (FR-016 to FR-019, FR-027, FR-029; research R13, T039): an event's venue map, one
 * component for both apps, drawn as SVG in the shared theme's classes (Constitution VII). The
 * overview draws the floor object and every section with its name, never a seat; a section is a
 * button that zooms into it, where its seats are drawn one by one ("Back to map" returns). Pan and
 * zoom by drag, pinch, wheel, the zoom buttons and `+`, `−` and the arrow keys (`usePanZoom`).
 */
export function VenueMap({
  map,
  colorBy = 'price',
  openSectionId,
  section,
  onOpenSection,
  range: givenRange,
  onRange,
  seatView,
  onSeat,
  skipTo,
}: VenueMapProps): React.ReactElement {
  const full = useMemo(() => priceRangeOf(map.levels), [map.levels]);
  const [ownRange, setOwnRange] = usePriceFilter(map.levels);
  const priced = colorBy === 'price';
  const range = priced ? (givenRange !== undefined ? givenRange : ownRange) : null;
  const setRange = (r: PriceRange): void => {
    setOwnRange(r);
    onRange?.(r);
  };
  const [tip, setTip] = useState<string | null>(null);

  const { width, height } = map.size;
  const fit = useMemo(() => ({ x: 0, y: 0, width, height }), [width, height]);
  const pz = usePanZoom(fit);
  const open = map.sections.find((s) => s.sectionId === openSectionId) ?? null;
  const openOutline = open?.outline;
  const { zoomTo, fit: fitAll } = pz;
  useEffect(() => {
    if (openOutline) zoomTo(bounds(openOutline));
    else fitAll();
    setTip(null);
    // Only when another section is opened, not when its counts change.
  }, [openSectionId]);

  const seats = open && section?.sectionId === open.sectionId ? section : null;
  const anyOpen = map.sections.some((s) => openSeatsIn(map, s, range) > 0);
  // Section names are drawn at a steady size on screen as the map zooms.
  const fontSize = Math.max(width, height) / 50 / Math.max(1, pz.zoom ** 0.75);

  const sectionName = (s: MapSectionSummary): string => {
    if (!priced) {
      const c = stateCounts(s);
      return `Section ${s.name}, ${c.open} open, ${c.held} held, ${c.sold} sold, ${c.offSale} off sale`;
    }
    const n = openSeatsIn(map, s, range);
    const level = sectionLevel(map, s, range);
    if (n > 0 && level?.price) {
      return `Section ${s.name}, ${plural(n, 'open seat', 'open seats')} from ${formatPrice(level.price)}`;
    }
    const outside = openSeatsIn(map, s, null) > 0 && range !== null;
    return outside
      ? `Section ${s.name}, no open seats between ${wholeDollars(range.low)} and ${wholeDollars(range.high)}`
      : `Section ${s.name}, no open seats`;
  };

  const sectionClass = (s: MapSectionSummary): string => {
    const classes = ['venue-map__section'];
    if (priced) {
      const level = sectionLevel(map, s, range);
      classes.push(level ? `venue-map--${level.color}` : 'venue-map--unavailable');
      if (openSeatsIn(map, s, range) === 0) classes.push('venue-map__section--faded');
    } else {
      classes.push('venue-map__section--state', `venue-map__section--state-${sectionState(s)}`);
    }
    if (s.sectionId === open?.sectionId) classes.push('venue-map__section--current');
    return classes.join(' ');
  };

  return (
    <div className="venue-map">
      {priced && full && range && <PriceFilter full={full} range={range} onChange={setRange} />}
      <Legend map={map} colorBy={colorBy} range={range} />
      {priced && range && !anyOpen && (
        <div className="note venue-map__none">
          <p>{`No open seats between ${wholeDollars(range.low)} and ${wholeDollars(range.high)}.`}</p>
          {full && (
            <button type="button" className="btn btn--ghost" onClick={() => setRange(full)}>
              Reset price filter
            </button>
          )}
        </div>
      )}
      <div className="venue-map__toolbar">
        {open && (
          <button type="button" className="btn" onClick={() => onOpenSection(null)}>
            Back to map
          </button>
        )}
        <button type="button" className="btn btn--ghost" aria-label="Zoom in" onClick={pz.zoomIn}>
          +
        </button>
        <button type="button" className="btn btn--ghost" aria-label="Zoom out" onClick={pz.zoomOut}>
          −
        </button>
        <button type="button" className="btn btn--ghost" onClick={pz.fit}>
          Fit map
        </button>
      </div>
      {open && !seats && <p className="note">{`Loading the seats of section ${open.name}…`}</p>}
      {skipTo && (
        <button
          type="button"
          className="btn skip-link"
          onClick={() => document.getElementById(skipTo)?.focus()}
        >
          Skip to the Sections list
        </button>
      )}
      {/* FR-019: a seat's section, row, seat, level and price, on hover and focus; its
          accessible name already says it, so this is for the eyes only. */}
      <p className="venue-map__tip" aria-hidden="true">
        {tip ?? ' '}
      </p>
      <svg
        ref={pz.ref}
        className="venue-map__svg"
        role="group"
        aria-label={`${map.layoutName} map`}
        viewBox={pz.viewBox}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={pz.onPointerDown}
        onPointerMove={pz.onPointerMove}
        onPointerUp={pz.onPointerUp}
        onPointerCancel={pz.onPointerUp}
        onKeyDown={pz.onKeyDown}
      >
        <rect className="venue-map__bg" x={0} y={0} width={width} height={height} />
        {map.floorKind !== 'NONE' && map.floorOutline && (
          <path className="venue-map__floor" d={outlinePath(map.floorOutline)} />
        )}
        {map.sections.map((s) => (
          <path
            key={s.sectionId}
            role="button"
            tabIndex={0}
            aria-label={sectionName(s)}
            aria-current={s.sectionId === open?.sectionId ? true : undefined}
            className={sectionClass(s)}
            d={outlinePath(s.outline)}
            onClick={() => {
              if (!pz.dragged()) onOpenSection(s.sectionId);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              e.stopPropagation();
              onOpenSection(s.sectionId);
            }}
          />
        ))}
        {map.sections.map((s) => {
          if (s.sectionId === open?.sectionId) return null;
          // FR-027: the admin's map shows "sold / open" under each section's name.
          const c = priced ? null : stateCounts(s);
          return (
            <text
              key={s.sectionId}
              className="venue-map__label"
              x={s.labelAt[0]}
              y={c ? s.labelAt[1] - fontSize * 0.6 : s.labelAt[1]}
              fontSize={fontSize}
              textAnchor="middle"
              dominantBaseline="central"
              aria-hidden="true"
            >
              {c ? (
                <>
                  <tspan x={s.labelAt[0]}>{s.name}</tspan>
                  <tspan
                    className="venue-map__label-counts"
                    x={s.labelAt[0]}
                    dy={fontSize * 1.2}
                  >{`${c.sold} / ${c.open}`}</tspan>
                </>
              ) : (
                s.name
              )}
            </text>
          );
        })}
        {seats && (
          <SectionView
            map={map}
            section={seats}
            range={range}
            seatView={seatView}
            onSeat={onSeat}
            onTip={setTip}
            dragged={pz.dragged}
          />
        )}
      </svg>
    </div>
  );
}
