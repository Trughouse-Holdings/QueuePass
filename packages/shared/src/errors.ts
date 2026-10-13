/**
 * The single error envelope used by every non-2xx API response.
 * Mirrors `ErrorEnvelope` in contracts/openapi.yaml, the shared API contract.
 *
 * `code` is the stable machine-readable discriminator. The admin web app branches on it
 * (FR-034, FR-036) — never on `message`, which is human-readable and may change freely.
 */
export const ERROR_CODES = [
  // Spec 001: no valid token (401) and valid token without the required role (403).
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'SCHEDULING_CONFLICT',
  'VENUE_HAS_EVENTS',
  'CAPACITY_EXCEEDED',
  // Spec 004: another tier of the same event already has this name, ignoring case.
  'TIER_NAME_TAKEN',
  // Spec 005: fewer tickets left than requested; the event is cancelled; an event or tier that
  // has orders cannot be deleted.
  'SOLD_OUT',
  'EVENT_CANCELLED',
  'EVENT_HAS_ORDERS',
  'TIER_HAS_ORDERS',
  // Spec 006: the event has started, so sales are closed; a requestId already used for a
  // different order.
  'SALES_CLOSED',
  'REQUEST_ID_REUSED',
  // Spec 007: seats already held by valid tickets; a layout that seated sales depend on.
  'SEAT_TAKEN',
  'LAYOUT_IN_USE',
  // Spec 016: the order would put the customer over the event's per-customer limit.
  'TICKET_LIMIT_REACHED',
  // Spec 014: a sixth image; an image over 5 MB; a file that is not a JPEG, PNG, or WebP; a new
  // image order that no longer names the event's current images; a picture too large in pixels.
  // Adds the 014 codes ahead of the implementation (013's codes arrive with #34).
  'IMAGE_LIMIT_REACHED',
  'IMAGE_TOO_LARGE',
  'IMAGE_TYPE_NOT_ALLOWED',
  'IMAGES_CHANGED',
  'IMAGE_DIMENSIONS_TOO_LARGE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** Shape carried in `details.conflictingEvent` of a SCHEDULING_CONFLICT (FR-027). */
export interface ConflictingEventRef {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
}

export interface SchedulingConflictDetails {
  bufferMinutes: number;
  /** null only in the race path: the pre-check passed but the DB constraint refused. */
  conflictingEvent: ConflictingEventRef | null;
}

export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const err = (value as ErrorEnvelope).error;
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof err.code === 'string' &&
    (ERROR_CODES as readonly string[]).includes(err.code)
  );
}

/** Minutes of clear time required between events at the same venue (FR-023). */
export const SCHEDULING_BUFFER_MINUTES = 60;
