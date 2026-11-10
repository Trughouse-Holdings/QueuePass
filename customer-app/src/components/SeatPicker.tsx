import type { SeatMapSection, SeatPosition } from '@queuepass/shared';

/** A seat the customer has chosen, with its section's name for display. */
export interface ChosenSeat {
  sectionId: string;
  section: string;
  row: number;
  seat: number;
}

/** Spec 033 (research R6): a seat's request still to be answered, and what it will make it. */
export type PendingSeat = 'hold' | 'release';

/**
 * Spec 007 FR-007 (research R8): one section's seats, row by row. Each seat is a toggle button;
 * taken seats are disabled, and once `full`, so is every seat not already the customer's. Only the
 * chosen section is drawn, so even a 100 × 200 section stays one section at a time.
 *
 * Spec 015 (research R13): the customer's own reserved seats (`mine`) are pressed. Seats another
 * customer has reserved (`reserved`) can't be chosen. A seat that became unavailable while shown
 * (`late`) is marked `aria-disabled` and ignores presses, instead of `disabled`, which would drop
 * the keyboard focus to the page (FR-012).
 *
 * Spec 033 (FR-001, FR-007, FR-009; research R6): a press asks to hold an open seat or release a
 * held one at once. A seat whose request is still to be answered (`pending`, by
 * `sectionId-row-seat`) is pressed as it will be and named "…, holding" or "…, releasing". While
 * the hold allowance is waited out (`blocked`), open seats stay focusable but do nothing
 * (`aria-disabled`); held seats can still be released.
 */
export function SeatPicker({
  section,
  mine = [],
  pending = new Map(),
  reserved = [],
  late = [],
  full,
  blocked = false,
  onToggle,
}: {
  section: SeatMapSection;
  /** Spec 015: this customer's held seats, in any section. */
  mine?: ChosenSeat[];
  /** Spec 033: seats with a hold or release still to be answered, by `sectionId-row-seat`. */
  pending?: Map<string, PendingSeat>;
  /** Spec 015: seats of this section in another customer's reservation. */
  reserved?: SeatPosition[];
  /** Spec 015: `row-seat` of seats here that became unavailable while shown. */
  late?: string[];
  full: boolean;
  /** Spec 033 FR-009: the hold allowance's wait is running. */
  blocked?: boolean;
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
            const waiting = pending.get(`${section.sectionId}-${row}-${seat}`);
            const yours = has(mine, row, seat);
            // Pressed as it will be once its request is answered.
            const pressed = waiting ? waiting === 'hold' : yours;
            const ours = yours || waiting !== undefined;
            const sold = !ours && taken.has(`${row}-${seat}`);
            const reserved = !ours && !sold && held.has(`${row}-${seat}`);
            const gone = sold || reserved;
            const goneLate = gone && late.includes(`${row}-${seat}`);
            const resting = blocked && !ours;
            // Spec 015 FR-012 (research R13): named so reserved and sold differ for screen readers.
            const state =
              waiting === 'hold'
                ? ', holding'
                : waiting === 'release'
                  ? ', releasing'
                  : yours
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
                className={`seat${pressed ? ' seat--mine' : ''}${sold ? ' seat--taken' : ''}${
                  reserved ? ' seat--reserved' : ''
                }`}
                aria-label={`Row ${row}, Seat ${seat}${state}`}
                aria-pressed={pressed}
                aria-disabled={goneLate || resting || undefined}
                disabled={(gone && !goneLate) || (full && !ours)}
                onClick={() => {
                  if (gone || resting) return;
                  onToggle({ sectionId: section.sectionId, section: section.name, row, seat });
                }}
              >
                {sold ? (
                  '✕'
                ) : reserved ? (
                  'R'
                ) : (
                  <>
                    {pressed && <span aria-hidden="true">⏱</span>}
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
