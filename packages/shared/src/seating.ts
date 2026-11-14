import type { components } from './api-schema.js';

/**
 * Mirrors the seating schemas in contracts/openapi.yaml (spec 007): seats on orders and tickets.
 * Spec 015: reservations and live seat-map changes. Spec 038: layouts with price levels, event
 * seating, and the venue map, as aliases of the generated types; `007`'s venue layout and seat map
 * types went with contract 2.0.0.
 */

/**
 * A seat a customer chooses when ordering: its section's id, its row's number and its number in
 * the row (spec 038 research R2: numbers, not labels).
 */
export interface SeatChoice {
  sectionId: string;
  row: number;
  seat: number;
}

/** A sold seat, by its section's name when sold, its row's number and its number in the row. */
export interface SeatLabel {
  section: string;
  row: number;
  seat: number;
}

/**
 * Spec 038 FR-026 (contract `SeatLabel`): a sold seat as a response gives it, with its row and seat
 * labels as sold.
 */
export type SoldSeat = components['schemas']['SeatLabel'];

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

type Schemas = components['schemas'];

/**
 * Spec 038 (FR-001 to FR-003, FR-013, research R5, R8, R16): the limits of a layout and of an
 * event's seating save. A layout carried over from `007` may have up to `maxCarriedLevels` levels
 * and more than `maxSeats` seats; imports and section lines keep 12 and 30,000.
 */
export const LAYOUT_LIMITS = {
  maxSections: 100,
  maxRows: 100,
  maxSeatsPerRow: 200,
  maxSeats: 30_000,
  maxLevels: 12,
  maxCarriedLevels: 50,
  nameMaxLength: 50,
  labelMaxLength: 5,
  maxOutlinePoints: 64,
  maxMapUnits: 5_000,
  maxOffSaleSelectors: 5_000,
  maxImportBytes: 4 * 1024 * 1024,
} as const;

/** Spec 038 research R13: one of the shared theme's 12 price-level colors. */
export type LevelColor = Schemas['LevelColor'];

/**
 * Spec 038 research R13, R16: the 12 level colors in the contract's `LevelColor` order, the order
 * the carry-over gives them out in (repeating after 12).
 */
export const LEVEL_COLORS = [
  'violet',
  'blue',
  'cyan',
  'teal',
  'green',
  'lime',
  'yellow',
  'orange',
  'red',
  'pink',
  'purple',
  'brown',
] as const satisfies readonly LevelColor[];

// Spec 038: the contract's layout, event seating and venue map schemas (contracts/README.md).
export type FloorKind = Schemas['FloorKind'];
export type MapPoint = Schemas['MapPoint'];
export type MapOutline = Schemas['MapOutline'];
export type MapSize = Schemas['MapSize'];
export type PriceLevel = Schemas['PriceLevel'];
export type LayoutSummary = Schemas['LayoutSummary'];
export type LayoutDetail = Schemas['LayoutDetail'];
export type LayoutSectionSummary = Schemas['LayoutSectionSummary'];
export type LatestPrices = Schemas['LatestPrices'];
export type LayoutSectionSeats = Schemas['LayoutSectionSeats'];
export type LayoutSeat = Schemas['LayoutSeat'];
export type LayoutLinesInput = Schemas['LayoutLinesInput'];
export type LayoutLevelLine = Schemas['LayoutLevelLine'];
export type LayoutSectionLine = Schemas['LayoutSectionLine'];
export type LayoutUpdate = Schemas['LayoutUpdate'];
export type LayoutDuplicate = Schemas['LayoutDuplicate'];
export type LayoutImport = Schemas['LayoutImport'];
export type LayoutFile = Schemas['LayoutFile'];
export type LayoutFileSection = Schemas['LayoutFileSection'];
export type LayoutFileSeat = Schemas['LayoutFileSeat'];
export type LayoutFileSeatRun = Schemas['LayoutFileSeatRun'];
export type LevelPriceInput = Schemas['LevelPriceInput'];
export type OffSaleSelector = Schemas['OffSaleSelector'];
export type EventSeating = Schemas['EventSeating'];
export type VenueMap = Schemas['VenueMap'];
export type LevelSeatCounts = Schemas['LevelSeatCounts'];
export type VenueMapSection = Schemas['VenueMapSection'];
export type SeatState = Schemas['SeatState'];
export type LevelSales = Schemas['LevelSales'];
