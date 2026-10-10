import type { SeatMapSection } from '@queuepass/shared';

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
 */
export function SeatPicker({
  section,
  chosen,
  full,
  onToggle,
}: {
  section: SeatMapSection;
  chosen: ChosenSeat[];
  full: boolean;
  onToggle: (seat: ChosenSeat) => void;
}) {
  const taken = new Set(section.taken.map((t) => `${t.row}-${t.seat}`));
  const isChosen = (row: number, seat: number): boolean =>
    chosen.some((c) => c.sectionId === section.sectionId && c.row === row && c.seat === seat);

  return (
    // Spec 008 research R4: a wide section scrolls inside this box, never the page. Not itself a
    // tab stop; focusing a seat scrolls it into view.
    <div role="region" aria-label={`Section ${section.name} seats`} className="seat-scroll">
      {Array.from({ length: section.rows }, (_, r) => r + 1).map((row) => (
        <p key={row} className="seat-row">
          <span className="seat-row__label">{`Row ${row}: `}</span>
          {Array.from({ length: section.seatsPerRow }, (_, s) => s + 1).map((seat) => {
            const on = isChosen(row, seat);
            const gone = taken.has(`${row}-${seat}`);
            return (
              <button
                key={seat}
                type="button"
                // Spec 008 FR-008: states differ by glyph, border, and pattern, not color alone;
                // aria-pressed and disabled announce them.
                className={`seat${on ? ' seat--chosen' : ''}${gone ? ' seat--taken' : ''}`}
                aria-label={`Row ${row}, Seat ${seat}`}
                aria-pressed={on}
                disabled={gone || (full && !on)}
                onClick={() =>
                  onToggle({ sectionId: section.sectionId, section: section.name, row, seat })
                }
              >
                {gone ? (
                  '✕'
                ) : (
                  <>
                    {on && <span aria-hidden="true">✓</span>}
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
