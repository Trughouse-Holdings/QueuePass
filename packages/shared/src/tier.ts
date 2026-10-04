/**
 * Mirrors the TicketTier schemas in contracts/openapi.yaml (spec 004).
 *
 * `price` is a decimal STRING, like `Event.basePrice`, so no client ever loses a cent.
 */
export interface TicketTier {
  id: string;
  eventId: string;
  name: string;
  price: string;
  quantity: number;
  createdAt: string;
  updatedAt: string;
}

export interface TicketTierInput {
  name: string;
  price: string;
  /** Required without reserved seating; omitted with it (spec 007 FR-006). */
  quantity?: number;
}

export type TicketTierUpdate = Partial<TicketTierInput>;

export const TIER_LIMITS = { nameMaxLength: 100 } as const;
