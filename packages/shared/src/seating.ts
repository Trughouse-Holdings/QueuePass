/**
 * Mirrors the seating schemas in contracts/openapi.yaml (spec 007): venue layouts, seat maps, and
 * seats on orders and tickets. Spec 015: reservations and live seat-map changes.
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
  /** Spec 015: seats in active reservations. Never says by whom. */
  reserved: SeatPosition[];
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

/** Spec 015: a seat in a reservation, by section id and by its section's name. */
export interface ReservedSeat extends SeatLabel {
  sectionId: string;
}

/** Spec 015: the caller's active hold on seats of one event, for 5 minutes. */
export interface Reservation {
  eventId: string;
  /** The tier of every seat; `null` for an event without tiers. */
  tierId: string | null;
  seats: ReservedSeat[];
  createdAt: string;
  /** Exactly 5 minutes after `createdAt`; exclusive. */
  expiresAt: string;
  /** Whole seconds until `expiresAt` by the Backend's clock; count down from this. */
  secondsLeft: number;
}

export interface ReservationInput {
  seats: SeatChoice[];
}

/** Omit `seats` to release all of them. */
export interface ReservationRelease {
  seats?: SeatChoice[];
}

export interface ReservationReleaseResult {
  /** What is left; `null` once no seat is left. */
  reservation: Reservation | null;
}

export interface ReleasedSeats {
  /** How many reserved seats were released, across every event. */
  released: number;
}

/** Spec 015: one seat's new state. Never says who reserved or bought it. */
export interface SeatStateChange extends SeatChoice {
  state: 'open' | 'reserved' | 'sold';
}

/** Spec 015: seats of one event that changed state, as `streamSeatMap` sends them. */
export interface SeatMapChange {
  eventId: string;
  changes: SeatStateChange[];
}

/** Spec 015 FR-003, FR-004, FR-004a: fixed for every event (Constitution VIII). */
export const RESERVATION_LIMITS = { minutes: 5, waitMinutes: 2, maxSeats: 10 } as const;

export const SEATING_LIMITS = {
  sectionNameMaxLength: 50,
  maxRows: 100,
  maxSeatsPerRow: 200,
  maxSections: 50,
} as const;
