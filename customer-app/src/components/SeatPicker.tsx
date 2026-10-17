import type { SeatMapSection, SeatPosition } from '@queuepass/shared';

/** A seat the customer has chosen, with its section's name for display. */
export interface ChosenSeat {
  sectionId: string;
  section: string;
  row: number;
  seat: number;
}

/**
 * Spec 007 FR-007 (research R8): one section's seats, row by row. Each seat is a toggle button;
 * taken seats are disabled, and once `full`, so is every seat not already chosen. Only the chosen
 * section is drawn, so even a 100 × 200 section stays one section at a time.
 *
 * Spec 015 (research R13): the customer's own reserved seats (`mine`) are pressed, and pressing
 * one releases it. Seats another customer has reserved (`reserved`) can't be chosen. A seat that
 * became unavailable while shown (`late`) is marked `aria-disabled` and ignores presses, instead of
 * `disabled`, which would drop the keyboard focus to the page (FR-012).
 */
export function SeatPicker({
  section,
  chosen,
  mine = [],
  reserved = [],
  late = [],
  full,
  onToggle,
}: {
  section: SeatMapSection;
  chosen: ChosenSeat[];
  /** Spec 015: this customer's reserved seats, in any section. */
  mine?: ChosenSeat[];
  /** Spec 015: seats of this section in another customer's reservation. */
  reserved?: SeatPosition[];
  /** Spec 015: `row-seat` of seats here that became unavailable while shown. */
  late?: string[];
  full: boolean;
  onToggle: (seat: ChosenSeat) => void;
}) {
  const taken = new Set(section.taken.map((t) => `${t.row}-${t.seat}`));
  const held = new Set(reserved.map((t) => `${t.row}-${t.seat}`));
  const has = (list: ChosenSeat[], row: number, seat: number): boolean =>
    list.some((c) => c.sectionId === section.sectionId && c.row === row && c.seat === seat);

  return (
    // Spec 008 research R4: a wide section scrolls inside this box, never the page. Not itself a
    // tab stop; focusing a seat scrolls it into view.
    <div role="region" aria-label={`Section ${section.name} seats`} className="seat-scroll">
      {Array.from({ length: section.rows }, (_, r) => r + 1).map((row) => (
        <p key={row} className="seat-row">
          <span className="seat-row__label">{`Row ${row}: `}</span>
          {Array.from({ length: section.seatsPerRow }, (_, s) => s + 1).map((seat) => {
            const yours = has(mine, row, seat);
            const picked = !yours && has(chosen, row, seat);
            const sold = !yours && taken.has(`${row}-${seat}`);
            const reserved = !yours && !sold && held.has(`${row}-${seat}`);
            const gone = sold || reserved;
            const goneLate = gone && late.includes(`${row}-${seat}`);
            // Spec 015 FR-012 (research R13): named so reserved and sold differ for screen readers.
            const state = yours
              ? ', reserved by you'
              : sold
                ? ', sold'
                : reserved
                  ? ', reserved'
                  : '';
            return (
              <button
                key={seat}
                type="button"
                // Spec 008 FR-008: states differ by glyph, border, and pattern, not color alone;
                // aria-pressed and disabled announce them. Spec 015 research R15: reserved is a
                // dashed outline with an R, sold a striped fill with a cross, yours a clock.
                className={`seat${picked ? ' seat--chosen' : ''}${yours ? ' seat--mine' : ''}${
                  sold ? ' seat--taken' : ''
                }${reserved ? ' seat--reserved' : ''}`}
                aria-label={`Row ${row}, Seat ${seat}${state}`}
                aria-pressed={yours || picked}
                aria-disabled={goneLate || undefined}
                disabled={(gone && !goneLate) || (full && !yours && !picked)}
                onClick={() => {
                  if (gone) return;
                  onToggle({ sectionId: section.sectionId, section: section.name, row, seat });
                }}
              >
                {sold ? (
                  '✕'
                ) : reserved ? (
                  'R'
                ) : (
                  <>
                    {yours && <span aria-hidden="true">⏱</span>}
                    {picked && <span aria-hidden="true">✓</span>}
                    {seat}
                  </>
                )}
              </button>
            );
          })}
        </p>
      ))}
    </div>
  );
}
