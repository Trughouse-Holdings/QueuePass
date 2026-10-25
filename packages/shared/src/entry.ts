import type { SeatLabel } from './seating.js';
import type { UsTimeZone } from './time-zone.js';

/**
 * Spec 017 (#40): gate check-in. Mirrors the entry schemas in contracts/openapi.yaml
 * (`lookupEntryTicket`, `admitTicket`), field for field.
 */

/** What the gate agent may do with a looked-up ticket (research R5, in refusal order). */
export type EntryState = 'ADMITTABLE' | 'USED' | 'VOID' | 'OTHER_EVENT' | 'NOT_OPEN' | 'ENDED';

/** Mirrors `EntryLookupInput`: a ticket code as typed or scanned. */
export interface EntryLookupInput {
  /**
   * 1–80 characters: a ticket code or a live code. A ticket code's letter case, spaces, and
   * dashes are ignored.
   */
  code: string;
}

/** Mirrors `EntryTicket`: a ticket as the gate agent sees it. */
export interface EntryTicket {
  ticketId: string;
  code: string;
  orderId: string;
  state: EntryState;
  /** The ticket's own event (another event's when `state` is `OTHER_EVENT`). */
  event: {
    id: string;
    name: string;
    startsAt: string;
    endsAt: string;
    /** Spec 020 FR-021: the event's venue's zone (always sent, research R18). */
    timeZone?: UsTimeZone;
  };
  /** `null` for an event sold at its base price. */
  tierName: string | null;
  seat: SeatLabel | null;
  /** `null` for a ticket bought before feature 017 ("No name on ticket"). */
  holderName: string | null;
  /** When it was admitted; `null` unless `state` is `USED`. */
  usedAt: string | null;
  /** Two hours before the ticket's event starts (FR-019). */
  entryOpensAt: string;
  /** Valid, unused tickets of this ticket's order for this event, this one included. */
  unusedOnOrder: number;
  /**
   * Spec 018 FR-011: `LIVE_CODE` when the Backend verified a live code in its window (no ID
   * check needed); `TICKET_CODE` for a typed or printed code.
   */
  verifiedBy: 'LIVE_CODE' | 'TICKET_CODE';
}

/** Mirrors `AdmitInput`. */
export interface AdmitInput {
  ticketId: string;
  /** Also admit every other valid, unused ticket of the same order (FR-015a). */
  wholeOrder: boolean;
}

/** Mirrors `EntryTicketRef`: one ticket and the time of its entry. */
export interface EntryTicketRef {
  ticketId: string;
  code: string;
  usedAt: string;
}

/** Mirrors `EntryResult`: what one admit request did. */
export interface EntryResult {
  /** 1–10 entries recorded by this request. */
  admitted: EntryTicketRef[];
  /** Tickets of the order that were already used when `wholeOrder` arrived. */
  alreadyUsed: EntryTicketRef[];
}

/** Spec 018 (research R5). Mirrors `TicketEntryKey`: what `getTicketEntryKey` returns. */
export interface TicketEntryKey {
  ticketId: string;
  /** The ticket's 32-byte entry secret, base64url without padding (43 characters). */
  key: string;
  /** The Backend's clock when it answered, with milliseconds. */
  serverTime: string;
}
