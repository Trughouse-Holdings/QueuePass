/**
 * Spec 038 FR-026 (contract `SeatLabel`): a sold seat as responses give it, with its row and seat
 * labels as sold.
 */
export interface SoldSeat {
  section: string;
  row: number;
  seat: number;
  rowLabel: string;
  seatLabel: string;
}

/** Spec 038 FR-026: a ticket's seat as sold, from its own columns (all set or all NULL). */
export function ticketSeat(t: {
  seatSection: string | null;
  seatRow: number | null;
  seatNumber: number | null;
  seatRowLabel: string | null;
  seatLabel: string | null;
}): SoldSeat | null {
  return t.seatSection !== null &&
    t.seatRow !== null &&
    t.seatNumber !== null &&
    t.seatRowLabel !== null &&
    t.seatLabel !== null
    ? {
        section: t.seatSection,
        row: t.seatRow,
        seat: t.seatNumber,
        rowLabel: t.seatRowLabel,
        seatLabel: t.seatLabel,
      }
    : null;
}
