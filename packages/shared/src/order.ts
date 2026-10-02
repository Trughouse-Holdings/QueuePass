import type { Event, EventStatus } from './event.js';

/**
 * Mirrors the order, ticket, and report schemas in contracts/openapi.yaml (spec 005). Every
 * amount is a two-decimal STRING, never a number.
 */
export interface Ticket {
  id: string;
  code: string;
  status: 'VALID' | 'VOID';
  checkedInAt: string | null;
}

export interface Order {
  id: string;
  eventId: string;
  tierId: string | null;
  tierName: string | null;
  customerUsername: string;
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
  quantity: number;
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
  status: EventStatus;
  ticketCapacity: number;
  ticketsSold: number;
  checkedIn: number;
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
