import { Prisma } from '@prisma/client';
import { ALPHABET } from '../orders/ticket-code';

/**
 * Spec 017 (research R5): what a gate may do with a ticket, computed in SQL on the database's
 * clock, so the lookup and the admit refusal can never disagree because of two clocks.
 */

const CODE_LENGTH = 12;
const CODE_PATTERN = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);

/**
 * FR-008: a code as the agent typed or scanned it — upper case, spaces and dashes removed — or
 * `null` unless it is then exactly 12 symbols of the ticket alphabet.
 */
export function normalizeCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  return CODE_PATTERN.test(code) ? code : null;
}

/**
 * The state rules of research R5 as one SQL CASE expression, shared by the lookup's SELECT and
 * the refusal query after an admit that updated nothing. Expects the ticket as `t` and its event
 * as `e`. Reason order: OTHER_EVENT, VOID, USED, NOT_OPEN, ENDED, else ADMITTABLE. The entry
 * window is `[startsAt - 2 hours, endsAt)` on `now()` (FR-019).
 */
export function stateCase(gateEventId: string): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN t."eventId" <> ${gateEventId}::uuid THEN 'OTHER_EVENT'
      WHEN t."status" = 'VOID' THEN 'VOID'
      WHEN t."checkedInAt" IS NOT NULL THEN 'USED'
      WHEN now() < e."startsAt" - interval '2 hours' THEN 'NOT_OPEN'
      WHEN now() >= e."endsAt" THEN 'ENDED'
      ELSE 'ADMITTABLE'
    END`;
}
