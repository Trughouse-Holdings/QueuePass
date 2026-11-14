import type { MyReservation } from '@queuepass/shared/web';

/**
 * Spec 038 (research R2, R14): the customer's reservation as `listMyReservations` and the hold
 * routes give it (the contract's `Reservation`): each seat with its labels, its level and the
 * level's price now.
 */
export type Reservation = MyReservation;
export type ReservedSeat = Reservation['seats'][number];

/**
 * A seat the customer clicked, as the hold routes name it (`sectionId`, row and seat numbers),
 * with its section's name and, from the map, its labels, for what the page says about it.
 */
export interface ChosenSeat {
  sectionId: string;
  section: string;
  row: number;
  seat: number;
  rowLabel?: string;
  seatLabel?: string;
}

/** Spec 033 (research R6): a seat's request still to be answered, and what it will make it. */
export type PendingSeat = 'hold' | 'release';
