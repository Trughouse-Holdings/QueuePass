import { useState } from 'react';
import type {
  LayoutDetail,
  LayoutSectionSeats,
  LayoutSummary,
  OffSaleSelector,
} from '@queuepass/shared';
import { LayoutPreview, outlinePath, sectionViewBox } from '@queuepass/shared/web';
import { offSeatsOf, seatKey, withSectionOff, type OffSaleCounts } from './off-sale';

/** Spec 038 (research R8): what the event form sends of its seating. */
export interface SeatingDraft {
  /** `null` for general admission. */
  layoutId: string | null;
  /** The typed price of each level, by level id. */
  prices: Record<string, string>;
  offSale: OffSaleSelector[];
}

/** A seat the event has sold or a customer holds, which can't be taken off sale (FR-013). */
export type TakenSeats = Map<string, 'sold' | 'reserved'>;

export interface SeatingSectionProps {
  layouts: LayoutSummary[];
  draft: SeatingDraft;
  /** The chosen layout, once loaded. */
  detail: LayoutDetail | null;
  /** Each loaded section's seats, by section id. */
  sections: Readonly<Record<string, LayoutSectionSeats | undefined>>;
  /** Each loaded section's sold and held seats, by section id (an edit only). */
  taken: Readonly<Record<string, TakenSeats | undefined>>;
  counts: OffSaleCounts | null;
  /** Why the layout can't change, when it can't (FR-010). */
  lockedReason: string | null;
  /** The event the prices were started from (FR-015), when they were. */
  pricesFrom: string | null;
  onLayout: (layoutId: string | null) => void;
  onPrice: (levelId: string, price: string) => void;
  onOffSale: (selectors: OffSaleSelector[]) => void;
  /** Loads a section's seats (and its sold and held seats) for the zoomed view. */
  onOpenSection: (sectionId: string) => void;
  onBlur: (key: string) => void;
  /** The messages beside `layoutId`, `levelPrices`, `levelPrices.<id>` and `offSale`. */
  hints: (key: string) => string[];
}

const hint = (id: string, messages: string[]): React.ReactElement | null =>
  messages.length > 0 ? (
    <span className="field__hint" role="alert" id={id} data-testid={id}>
      {messages.join(' ')}
    </span>
  ) : null;

const described = (id: string, messages: string[]) =>
  messages.length > 0 ? { 'aria-invalid': true as const, 'aria-describedby': id } : {};

/**
 * Spec 038 US2 (FR-010, FR-011, FR-013, FR-015; research R15): the event form's Seating section.
 * General admission or one of the venue's layouts, with its preview; a price table of the layout's
 * levels (name and color, seats on sale, a price box, none for a level whose seats are all off
 * sale); the seats off sale, chosen in one section at a time (the whole section, a row, a seat),
 * and the line "N seats on sale · M off sale". Sold and held seats can't be taken off sale. Every
 * refusal is shown beside its field. Styles are the shared theme's (Constitution VII).
 */
export function SeatingSection(props: SeatingSectionProps): React.ReactElement {
  const { layouts, draft, detail, counts, lockedReason, hints } = props;
  const layoutHints = hints('layoutId');
  return (
    <>
      <div className="field">
        <label htmlFor="layoutId">Seating</label>
        <select
          id="layoutId"
          value={draft.layoutId ?? ''}
          disabled={lockedReason !== null}
          onBlur={() => props.onBlur('layoutId')}
          onChange={(e) => props.onLayout(e.target.value || null)}
          {...described('layoutId-error', layoutHints)}
        >
          <option value="">General admission</option>
          {layouts.map((l) => (
            <option key={l.id} value={l.id}>
              {`${l.name} (${l.seatCount.toLocaleString()} seats)`}
            </option>
          ))}
        </select>
        {lockedReason && <span className="field__hint">{lockedReason}</span>}
        {hint('layoutId-error', layoutHints)}
      </div>
      {draft.layoutId !== null &&
        (detail && detail.id === draft.layoutId ? (
          <LayoutSeating {...props} detail={detail} counts={counts} />
        ) : (
          <p className="loading">Loading the layout…</p>
        ))}
    </>
  );
}

function LayoutSeating(props: SeatingSectionProps & { detail: LayoutDetail }): React.ReactElement {
  const { detail, draft, counts, hints } = props;
  const offByLevel = counts?.offByLevel ?? new Map<string, number>();
  const tableHints = hints('levelPrices');
  return (
    <>
      <LayoutPreview layout={detail} />
      <div id="levelPrices" tabIndex={-1} className="table-wrap">
        <table>
          <caption>Prices by level</caption>
          <thead>
            <tr>
              <th scope="col">Level</th>
              <th scope="col">Seats on sale</th>
              <th scope="col">Price</th>
            </tr>
          </thead>
          <tbody>
            {detail.levels.map((level) => {
              const onSale = level.seatCount - (offByLevel.get(level.id) ?? 0);
              const key = `levelPrices.${level.id}`;
              const id = `price-${level.id}`;
              const messages = hints(key);
              return (
                <tr key={level.id}>
                  <td>
                    {/* The name is always beside the color (Constitution VII). */}
                    <span
                      className={`level-swatch level-swatch--${level.color}`}
                      aria-hidden="true"
                    />
                    {level.name}
                  </td>
                  <td>{onSale.toLocaleString()}</td>
                  <td>
                    {onSale === 0 ? (
                      <span className="note">All seats off sale</span>
                    ) : (
                      <>
                        <input
                          id={id}
                          aria-label={`${level.name} price`}
                          inputMode="decimal"
                          placeholder="60.00"
                          value={draft.prices[level.id] ?? ''}
                          onBlur={() => props.onBlur(key)}
                          onChange={(e) => props.onPrice(level.id, e.target.value)}
                          {...described(`${id}-error`, messages)}
                        />
                        {hint(`${id}-error`, messages)}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {props.pricesFrom && (
        <p className="note">{`Prices from ${props.pricesFrom}, the event most recently scheduled on ${detail.name}.`}</p>
      )}
      {hint('levelPrices-error', tableHints)}
      <p className="note" data-testid="seat-line">
        {`${(counts?.seatsOnSale ?? detail.seatCount).toLocaleString()} seats on sale · ${(
          counts?.seatsOffSale ?? 0
        ).toLocaleString()} off sale`}
      </p>
      <OffSaleTool {...props} />
    </>
  );
}

/**
 * The off-sale tool: the sections to choose from, then one section zoomed, its seats drawn at their
 * places on the layout's map. Its state is `draft.offSale`, compacted after every change.
 */
function OffSaleTool(props: SeatingSectionProps & { detail: LayoutDetail }): React.ReactElement {
  const { detail, draft, hints } = props;
  const [open, setOpen] = useState<string | null>(null);
  const messages = hints('offSale');
  const order = detail.sections.map((s) => s.id);
  const summary = detail.sections.find((s) => s.id === open);
  const seats = open ? props.sections[open] : undefined;

  const choose = (sectionId: string) => {
    props.onOpenSection(sectionId);
    setOpen(sectionId);
  };

  return (
    <fieldset
      className="field"
      id="offSale"
      tabIndex={-1}
      {...(messages.length > 0 ? { 'aria-describedby': 'offSale-error' } : {})}
    >
      <legend>Seats off sale</legend>
      {hint('offSale-error', messages)}
      {!summary ? (
        <>
          <p className="note">Choose a section to take its seats off sale or put them back.</p>
          <div className="form__row">
            {detail.sections.map((s) => (
              <button key={s.id} type="button" className="btn" onClick={() => choose(s.id)}>
                {`Section ${s.name}`}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <h3>{`Section ${summary.name}`}</h3>
          <div className="form__row">
            <button type="button" className="btn btn--ghost" onClick={() => setOpen(null)}>
              Back to all sections
            </button>
          </div>
          {!seats ? (
            <p className="loading">Loading the seats…</p>
          ) : (
            <SectionSeats
              outline={summary.outline}
              seats={seats}
              taken={props.taken[seats.sectionId] ?? new Map()}
              selectors={draft.offSale}
              onChange={(off) => props.onOffSale(withSectionOff(draft.offSale, seats, off, order))}
            />
          )}
        </>
      )}
    </fieldset>
  );
}

function SectionSeats({
  outline,
  seats,
  taken,
  selectors,
  onChange,
}: {
  outline: LayoutDetail['sections'][number]['outline'];
  seats: LayoutSectionSeats;
  taken: TakenSeats;
  selectors: OffSaleSelector[];
  onChange: (off: Set<string>) => void;
}): React.ReactElement {
  const off = offSeatsOf(selectors, seats);
  const all = seats.rows.flatMap((r) => r.seats.map((s) => seatKey(r.number, s.number)));
  const wholeOff = all.length > 0 && all.every((k) => off.has(k));
  const anyTaken = taken.size > 0;
  const toggle = (keys: string[], to: boolean) => {
    const next = new Set(off);
    for (const k of keys) {
      if (to && taken.has(k)) continue;
      if (to) next.add(k);
      else next.delete(k);
    }
    onChange(next);
  };
  // Seats are drawn a little smaller than the gap between neighbors, in map units.
  const first = seats.rows.find((r) => r.seats.length > 1)?.seats;
  const gap = first
    ? Math.hypot(first[1]!.at[0] - first[0]!.at[0], first[1]!.at[1] - first[0]!.at[1])
    : 2;
  const radius = Math.max(0.2, gap * 0.4);
  const state = (k: string) => taken.get(k);

  return (
    <>
      <div className="form__row">
        <button
          type="button"
          className="btn"
          disabled={!wholeOff && anyTaken}
          onClick={() => toggle(all, !wholeOff)}
        >
          {wholeOff ? 'Whole section on sale' : 'Whole section off sale'}
        </button>
      </div>
      {anyTaken && <p className="note">Sold and held seats can&apos;t be taken off sale.</p>}
      <div className="form__row">
        {seats.rows.map((row) => {
          const keys = row.seats.map((s) => seatKey(row.number, s.number));
          const rowOff = keys.every((k) => off.has(k));
          const rowTaken = keys.some((k) => taken.has(k));
          return (
            <label key={row.number} className="choice">
              <input
                type="checkbox"
                checked={rowOff}
                disabled={!rowOff && rowTaken}
                onChange={() => toggle(keys, !rowOff)}
              />
              {`Row ${row.label} off sale`}
            </label>
          );
        })}
      </div>
      <svg
        className="off-sale-section"
        viewBox={sectionViewBox(outline, radius * 2)}
        preserveAspectRatio="xMidYMid meet"
        aria-label={`Section ${seats.name} seats`}
        role="group"
      >
        <path className="layout-preview__section" d={outlinePath(outline)} />
        {seats.rows.map((row) =>
          row.seats.map((seat) => {
            const k = seatKey(row.number, seat.number);
            const why = state(k);
            const isOff = off.has(k);
            const label = `Row ${row.label}, Seat ${seat.label}${
              why === 'sold' ? ', sold' : why === 'reserved' ? ', held' : ''
            }`;
            const press = () => {
              if (why) return;
              toggle([k], !isOff);
            };
            return (
              <g
                key={k}
                role="button"
                tabIndex={why ? -1 : 0}
                aria-label={label}
                aria-pressed={isOff}
                aria-disabled={why ? true : undefined}
                className={`off-sale-section__seat${
                  why
                    ? ' off-sale-section__seat--taken'
                    : isOff
                      ? ' off-sale-section__seat--off'
                      : ''
                }`}
                onClick={press}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    press();
                  }
                }}
              >
                <title>{label}</title>
                <circle cx={seat.at[0]} cy={seat.at[1]} r={radius} />
              </g>
            );
          }),
        )}
      </svg>
    </>
  );
}
