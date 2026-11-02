import { Prisma } from '@prisma/client';
import { ENTRY_OPENS_BEFORE_DOORS_MINUTES } from '@queuepass/shared';
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
 * as `e`. Reason order: VOID, OTHER_EVENT, USED, NOT_OPEN, ENDED, else ADMITTABLE. VOID comes
 * first, at any gate: a cancelled event's tickets are void, and the Ticket Booth never offers a
 * cancelled event as the gate (FR-007), so OTHER_EVENT first would hide "cancelled and refunded".
 * The entry window is `[entryOpens, endsAt)` on `now()`: spec 025 FR-011 (research R7), in
 * place of 017 FR-019's `[startsAt - 2 hours, endsAt)`.
 */
/**
 * Spec 025 FR-011 (research R7): when gate check-in opens, 1 hour before the event's doors open,
 * as SQL on the event `e`. The one place the entry SQL states the rule; `Event.entryOpensAt`
 * (EventsService.toResponse) uses the same shared constant.
 */
export const entryOpens = Prisma.sql`(e."doorsOpenAt" - make_interval(mins => ${ENTRY_OPENS_BEFORE_DOORS_MINUTES}::int))`;

export function stateCase(gateEventId: string): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN t."status" = 'VOID' THEN 'VOID'
      WHEN t."eventId" <> ${gateEventId}::uuid THEN 'OTHER_EVENT'
      WHEN t."checkedInAt" IS NOT NULL THEN 'USED'
      WHEN now() < ${entryOpens} THEN 'NOT_OPEN'
      WHEN now() >= e."endsAt" THEN 'ENDED'
      ELSE 'ADMITTABLE'
    END`;
}
