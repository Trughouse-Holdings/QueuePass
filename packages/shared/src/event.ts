import type { EventImage } from './event-image.js';
import type { Location } from './location.js';
import { formatEventEnd, formatEventTime, type InstantLike } from './time-zone.js';

/**
 * Mirrors the Event schemas in contracts/openapi.yaml.
 *
 * `basePrice` is a STRING, never a number. It comes from numeric(10,2) and binary floating
 * point cannot represent currency exactly — a JSON number would silently lose cents.
 */
export interface Event {
  id: string;
  name: string;
  locationId: string;
  location: Location;
  startsAt: string;
  endsAt: string;
  /**
   * Spec 025 FR-001: when the venue's doors open, from 6 hours before `startsAt` to `startsAt`.
   * Required from contract 1.16.1; optional here so a client of an older Backend shows nothing.
   */
  doorsOpenAt?: string;
  /**
   * Spec 025 FR-010: when gate check-in opens, 1 hour before `doorsOpenAt`, worked out by the
   * Backend. The Ticket Booth treats a missing value as already open (research R8).
   */
  entryOpensAt?: string;
  totalTicketCapacity: number;
  /**
   * Spec 016: the most valid tickets one customer may hold; `null` for no limit. Always sent by the
   * Backend, but optional in the contract (research R9), so a missing value also means no limit.
   */
  maxTicketsPerCustomer?: number | null;
  basePrice: string;
  /** Spec 005: a cancelled event stays on record but is read-only. */
  status: EventStatus;
  cancelledAt: string | null;
  /** Spec 007: whether customers choose seats. */
  reservedSeating: boolean;
  /**
   * Spec 014: the event's images in order, metadata only; `[]` when there are none. Always sent by
   * the Backend, but optional in the contract (research R8), so clients treat missing as empty.
   */
  images?: EventImage[];
  createdAt: string;
  updatedAt: string;
}

export type EventStatus = 'SCHEDULED' | 'CANCELLED';

export interface EventInput {
  name: string;
  locationId: string;
  startsAt: string;
  endsAt: string;
  /**
   * Spec 025 FR-007, FR-008: the venue's local time with its offset, like `startsAt`. Left out on
   * create, the start minus 1 hour; on an update that moves the start, the same gap.
   */
  doorsOpenAt?: string;
  /** Spec 007 FR-019: optional; when left out, the venue's seating capacity. */
  totalTicketCapacity?: number;
  /** Spec 016: 1 to the event's capacity; left out or `null` for no limit (`null` clears). */
  maxTicketsPerCustomer?: number | null;
  basePrice: string;
}

export type EventUpdate = Partial<EventInput>;

export const EVENT_LIMITS = { nameMaxLength: 200 } as const;

/** Decimal string with at most two fractional digits, non-negative. */
export const BASE_PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;

// ---------------------------------------------------------------- doors open (spec 025)

/** Spec 025 FR-008 (research R2): doors left out open this long before the start. */
export const DEFAULT_DOORS_BEFORE_START_MINUTES = 60;

/**
 * Spec 025 FR-004 (research R2): doors open at most this long before the start, and never after
 * it, both ends allowed, in elapsed time. The `event_doors_open_range` CHECK (migration SQL)
 * states the same 6 hours; a Backend test fails if the two differ.
 */
export const DOORS_OPEN_MAX_BEFORE_START_MINUTES = 360;

/**
 * Spec 025 FR-011 (research R7): gate check-in opens this long before doors open, and stays open
 * until the event ends: `[doorsOpenAt - 60 minutes, endsAt)`.
 */
export const ENTRY_OPENS_BEFORE_DOORS_MINUTES = 60;

export type DoorsOpenProblem = 'TOO_EARLY' | 'AFTER_START';

const MINUTE_MS = 60_000;
const ms = (instant: InstantLike): number =>
  instant instanceof Date ? instant.getTime() : new Date(instant).getTime();

/**
 * Spec 025 FR-004 (research R2): what is wrong with a doors-open time for a start, or `null` when
 * it is in range. The one rule the Backend, the Admin form, and a venue's zone change all call.
 */
export function doorsOpenProblem(
  startsAt: InstantLike,
  doorsOpenAt: InstantLike,
): DoorsOpenProblem | null {
  const start = ms(startsAt);
  const doors = ms(doorsOpenAt);
  if (doors > start) return 'AFTER_START';
  if (doors < start - DOORS_OPEN_MAX_BEFORE_START_MINUTES * MINUTE_MS) return 'TOO_EARLY';
  return null;
}

/**
 * Spec 025 FR-005 (research R2): the one message for a doors-open time out of range, used by the
 * Backend's DOORS_OPEN_OUT_OF_RANGE and by the Admin event form before it sends anything.
 * `Doors must open no more than 6 hours before the start and not after it: between Nov 20, 2026,
 * 1:00 PM EST and 7:00 PM EST.` (the date repeated only when the range crosses midnight).
 */
export function doorsOpenRangeMessage(startsAt: InstantLike, zone: string): string {
  const latest = new Date(ms(startsAt));
  const earliest = new Date(latest.getTime() - DOORS_OPEN_MAX_BEFORE_START_MINUTES * MINUTE_MS);
  return (
    `Doors must open no more than ${DOORS_OPEN_MAX_BEFORE_START_MINUTES / 60} hours before the ` +
    `start and not after it: between ${formatEventTime(earliest, zone)} and ` +
    `${formatEventEnd(earliest, latest, zone)}.`
  );
}
