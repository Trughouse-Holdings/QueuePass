/**
 * Mirrors the seating schemas in contracts/openapi.yaml (spec 007): venue layouts, seat maps, and
 * seats on orders and tickets.
 */
export interface Section {
  id: string;
  name: string;
  rows: number;
  seatsPerRow: number;
}

export interface SectionInput {
  name: string;
  rows: number;
  seatsPerRow: number;
}

export interface LayoutInput {
  sections: SectionInput[];
}

export interface SeatingLayout {
  locationId: string;
  totalSeats: number;
  sections: Section[];
}

export interface SeatPosition {
  row: number;
  seat: number;
}

/** A seat a customer chooses when ordering. */
export interface SeatChoice extends SeatPosition {
  sectionId: string;
}

/** A sold seat, by its section's name when sold. */
export interface SeatLabel extends SeatPosition {
  section: string;
}

export interface SeatMapSection {
  sectionId: string;
  name: string;
  rows: number;
  seatsPerRow: number;
  tierId: string | null;
  sold: number;
  /** Seats held by valid tickets. Never says by whom. */
  taken: SeatPosition[];
}

export interface SeatMap {
  eventId: string;
  reservedSeating: boolean;
  sections: SeatMapSection[];
}

export interface SeatingInput {
  reservedSeating: boolean;
  sections: { sectionId: string; tierId: string }[];
}

export const SEATING_LIMITS = {
  sectionNameMaxLength: 50,
  maxRows: 100,
  maxSeatsPerRow: 200,
  maxSections: 50,
} as const;
