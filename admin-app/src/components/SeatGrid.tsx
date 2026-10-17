import type { SeatMapSection } from '@queuepass/shared';

/**
 * Spec 007 FR-012: one section's seats, row by row, each marked sold or open. Plain text marks
 * (■ sold, □ open) with a spoken label per seat; who holds a seat is never known here (FR-013).
 * Spec 015 FR-012 (research R14): ◩ for a seat in a customer's reservation, never whose (FR-014).
 */
export function SeatGrid({ section }: { section: SeatMapSection }): React.ReactElement {
  const taken = new Set(section.taken.map((t) => `${t.row}-${t.seat}`));
  const reserved = new Set((section.reserved ?? []).map((t) => `${t.row}-${t.seat}`));
  return (
    <div role="group" aria-label={`Section ${section.name} seat map`} className="seat-grid">
      {Array.from({ length: section.rows }, (_, r) => r + 1).map((row) => (
        <p key={row}>
          <span className="cell-num">{`Row ${row}: `}</span>
          {Array.from({ length: section.seatsPerRow }, (_, s) => s + 1).map((seat) => {
            const sold = taken.has(`${row}-${seat}`);
            const held = !sold && reserved.has(`${row}-${seat}`);
            return (
              <span
                key={seat}
                role="img"
                aria-label={`Row ${row}, Seat ${seat}, ${sold ? 'sold' : held ? 'reserved' : 'open'}`}
                title={`Row ${row}, Seat ${seat}`}
              >
                {sold ? '■' : held ? '◩' : '□'}
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
}
