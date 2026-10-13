import type { Location } from './location.js';

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
  createdAt: string;
  updatedAt: string;
}

export type EventStatus = 'SCHEDULED' | 'CANCELLED';

export interface EventInput {
  name: string;
  locationId: string;
  startsAt: string;
  endsAt: string;
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
