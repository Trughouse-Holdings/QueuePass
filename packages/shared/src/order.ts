import type { Event, EventStatus } from './event.js';
import type { SeatChoice, SeatLabel } from './seating.js';
import type { UsTimeZone } from './time-zone.js';

/**
 * Mirrors the order, ticket, and report schemas in contracts/openapi.yaml (spec 005). Every
 * amount is a two-decimal STRING, never a number.
 */
export interface Ticket {
  id: string;
  code: string;
  status: 'VALID' | 'VOID';
  checkedInAt: string | null;
  /** Spec 007: the seat this ticket is for; `null` for general admission. */
  seat: SeatLabel | null;
}

export interface Order {
  id: string;
  eventId: string;
  tierId: string | null;
  tierName: string | null;
  customerUsername: string;
  /** Spec 017 FR-001: the buyer's name, on every ticket; `null` for orders placed before 017. */
  holderName: string | null;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  status: 'CONFIRMED' | 'REFUNDED';
  createdAt: string;
  refundedAt: string | null;
  tickets: Ticket[];
}

export interface OrderInput {
  tierId?: string;
  /** Spec 017 FR-001: the buyer's own name, required on every new order, fixed for good. */
  holderName: string;
  quantity: number;
  /** Spec 006: one random id per confirmation, so repeating it never places a second order. */
  requestId?: string;
  /** Spec 007: required for reserved seating, one per ticket. */
  seats?: SeatChoice[];
}

/** Spec 006: the parts of an event My tickets shows next to an order. */
export interface OrderEvent {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  /** Spec 025 FR-010: when the venue's doors open; required from contract 1.18.1. */
  doorsOpenAt: string;
  status: EventStatus;
  /**
   * Spec 032 FR-014: when the event's check-in details were removed; set, My tickets shows its
   * valid tickets as "Event over". A missing value means `null`.
   */
  checkInDetailsRemovedAt?: string | null;
  location: {
    id: string;
    name: string;
    /** Spec 019 FR-012: the venue's full one-line address (`Location.address`). */
    address: string;
    /** Spec 020 FR-021: the venue's zone, for the event's times (always sent, research R18). */
    timeZone?: UsTimeZone;
  };
}

/** Spec 006: one of the signed-in customer's own orders (`GET /me/orders`). */
export interface MyOrder extends Order {
  event: OrderEvent;
}

/**
 * Spec 006: why tickets cannot be ordered, or `null` while they can. Spec 034: `CANCELLED`
 * whatever the time, else `ENDED` from the event's end (contracts/openapi.yaml 1.26.0).
 */
export type SalesClosedReason = 'CANCELLED' | 'ENDED';

export interface TierAvailability {
  tierId: string;
  ticketsLeft: number;
}

/** Spec 016: the signed-in customer's own standing against an event's per-customer limit. */
export interface CustomerLimit {
  limit: number;
  /** Their valid tickets for the event, across all their orders. */
  held: number;
  /** `limit - held`, never below 0. */
  remaining: number;
}

/** Spec 006: tickets left for an event and its tiers (`GET /events/{id}/availability`). */
export interface Availability {
  eventId: string;
  ticketsLeft: number;
  salesClosed: SalesClosedReason | null;
  /** Spec 034: from the event's start until its end, by the Backend's clock, whatever the status. */
  inProgress: boolean;
  tiers: TierAvailability[];
  /**
   * Spec 016: `null` without a limit or for a non-customer. Always sent by the Backend; a missing
   * value means `null` (research R9).
   */
  customerLimit?: CustomerLimit | null;
}

export const ORDER_LIMITS = { maxQuantity: 10 } as const;

export interface Cancellation {
  event: Event;
  ordersRefunded: number;
  ticketsVoided: number;
}

export interface TierSales {
  tierId: string;
  name: string;
  price: string;
  quantity: number;
  ticketsSold: number;
  revenue: string;
}

export interface EventSales {
  eventId: string;
  name: string;
  venueName: string;
  startsAt: string;
  /** Spec 020 FR-022: the venue's zone, for the event's date (always sent, research R18). */
  timeZone?: UsTimeZone;
  status: EventStatus;
  ticketCapacity: number;
  ticketsSold: number;
  /** Spec 032 FR-009: 0 when cancelled, else the kept count once removed, else the live count. */
  checkedIn: number;
  /** Spec 032 FR-009: when the event's check-in details were removed; a missing value means `null`. */
  checkInDetailsRemovedAt?: string | null;
  revenue: string;
  tiers: TierSales[];
}

export interface SalesReport {
  generatedAt: string;
  totals: {
    events: number;
    ticketCapacity: number;
    ticketsSold: number;
    checkedIn: number;
    revenue: string;
  };
  events: EventSales[];
}
