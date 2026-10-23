import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { EntryResult, EntryState, EntryTicket, EntryTicketRef } from '@queuepass/shared';
import type { Principal } from '../auth/principal';
import { conflict } from '../common/conflict';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeCode, stateCase } from './ticket-state';

/** A 404 in the standard envelope with its own code (contracts/openapi.yaml `EntryNotFound`). */
const ticketNotFound = (message: string): HttpException =>
  new HttpException(
    { error: { code: 'TICKET_NOT_FOUND', message } },
    HttpStatus.NOT_FOUND,
  );

/** One row of the lookup SELECT (and of the refusal query, which reads a subset). */
interface LookupRow {
  ticketId: string;
  code: string;
  orderId: string;
  state: EntryState;
  eventId: string;
  eventName: string;
  startsAt: Date;
  endsAt: Date;
  tierName: string | null;
  seatSection: string | null;
  seatRow: number | null;
  seatNumber: number | null;
  holderName: string | null;
  checkedInAt: Date | null;
  entryOpensAt: Date;
  unusedOnOrder: number;
}

/** A row the admit statement returned. */
interface AdmittedRow {
  id: string;
  code: string;
  checkedInAt: Date;
}

const iso = (d: Date): string => d.toISOString();

/**
 * Spec 017 (#40): looking tickets up and admitting them at the gate. "At most one entry per
 * ticket" is one conditional UPDATE under PostgreSQL's row lock (research R4, Constitution IV):
 * no lock, no lockEvent, no isolation level, no trigger. The entry window sits in the same WHERE,
 * on the database's clock (research R5), so a lookup and its admit can never disagree.
 */
@Injectable()
export class EntryService {
  constructor(private readonly prisma: PrismaService) {}

  /** `lookupEntryTicket`: the ticket with this code, and what the agent may do with it (FR-010). */
  async lookup(eventId: string, rawCode: string): Promise<EntryTicket> {
    await this.eventOrThrow(eventId);
    const code = normalizeCode(rawCode);
    const rows = code === null ? [] : await this.select(eventId, Prisma.sql`t."code" = ${code}`);
    if (rows.length === 0) {
      throw ticketNotFound(
        code === null ? 'No ticket has this code.' : `No ticket has the code ${code}.`,
      );
    }
    return toEntryTicket(rows[0]);
  }

  /**
   * `admitTicket`: records the entry — exactly the UPDATE … RETURNING of research R4; for
   * `wholeOrder`, matching on the ticket's order — or answers 409 ENTRY_REFUSED with the reason.
   */
  async admit(
    eventId: string,
    ticketId: string,
    wholeOrder: boolean,
    agent: Principal,
  ): Promise<EntryResult> {
    await this.eventOrThrow(eventId);
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, orderId: true },
    });
    if (!ticket) throw ticketNotFound(`No ticket exists with id ${ticketId}.`);

    const match = wholeOrder
      ? Prisma.sql`t."orderId" = ${ticket.orderId}::uuid`
      : Prisma.sql`t."id" = ${ticketId}::uuid`;
    let admitted = await this.tryAdmit(eventId, match, agent);
    if (admitted.length === 0) {
      let rows = await this.select(eventId, Prisma.sql`t."id" = ${ticketId}::uuid`);
      if (rows[0].state === 'ADMITTABLE') {
        // The entry window opened between the UPDATE and this read (its now() came later,
        // research R5): the one state that can flip that way is NOT_OPEN → ADMITTABLE. Try once
        // more; a second miss is read again and refused with its then-current reason.
        admitted = await this.tryAdmit(eventId, match, agent);
        if (admitted.length === 0) {
          rows = await this.select(eventId, Prisma.sql`t."id" = ${ticketId}::uuid`);
        }
      }
      if (admitted.length === 0) throw this.refusal(rows[0]);
    }

    const refs: EntryTicketRef[] = admitted
      .map((t) => ({ ticketId: t.id, code: t.code, usedAt: iso(t.checkedInAt) }))
      .sort((a, b) => a.code.localeCompare(b.code));
    return {
      admitted: refs,
      alreadyUsed: wholeOrder
        ? await this.alreadyUsed(eventId, ticket.orderId, refs.map((t) => t.ticketId))
        : [],
    };
  }

  private async eventOrThrow(eventId: string): Promise<void> {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException(`No event exists with id ${eventId}.`);
  }

  /** Exactly the UPDATE … RETURNING of research R4; the window sits in the same WHERE. */
  private tryAdmit(eventId: string, match: Prisma.Sql, agent: Principal): Promise<AdmittedRow[]> {
    return this.prisma.$queryRaw<AdmittedRow[]>`
      UPDATE "Ticket" t
      SET "checkedInAt" = now(), "checkedInBySub" = ${agent.sub},
          "checkedInByUsername" = ${agent.username}
      FROM "Event" e
      WHERE e."id" = t."eventId"
        AND t."eventId" = ${eventId}::uuid
        AND ${match}
        AND t."status" = 'VALID'
        AND t."checkedInAt" IS NULL
        AND now() >= e."startsAt" - interval '2 hours'
        AND now() < e."endsAt"
      RETURNING t."id", t."code", t."checkedInAt"`;
  }

  /** One SELECT joining Ticket, Order, Event, and TicketTier, with the shared state CASE. */
  private select(gateEventId: string, where: Prisma.Sql): Promise<LookupRow[]> {
    return this.prisma.$queryRaw<LookupRow[]>`
      SELECT t."id" AS "ticketId", t."code", t."orderId",
             ${stateCase(gateEventId)} AS "state",
             e."id" AS "eventId", e."name" AS "eventName", e."startsAt", e."endsAt",
             tier."name" AS "tierName",
             t."seatSection", t."seatRow", t."seatNumber",
             o."holderName", t."checkedInAt",
             e."startsAt" - interval '2 hours' AS "entryOpensAt",
             (SELECT count(*)::int FROM "Ticket" u
              WHERE u."orderId" = t."orderId" AND u."eventId" = t."eventId"
                AND u."status" = 'VALID' AND u."checkedInAt" IS NULL) AS "unusedOnOrder"
      FROM "Ticket" t
      JOIN "Order" o ON o."id" = t."orderId"
      JOIN "Event" e ON e."id" = t."eventId"
      LEFT JOIN "TicketTier" tier ON tier."id" = t."tierId"
      WHERE ${where}`;
  }

  /**
   * The admit updated nothing: the ticket's re-read state (the same CASE as the lookup) names
   * the one reason (FR-011, research R5). Messages name no local time; the client formats the
   * times in `details`.
   */
  private refusal(t: LookupRow): HttpException {
    switch (t.state) {
      case 'USED':
        return conflict('ENTRY_REFUSED', 'This ticket was already used.', {
          reason: 'USED',
          usedAt: iso(t.checkedInAt as Date),
        });
      case 'VOID':
        return conflict('ENTRY_REFUSED', 'This ticket was cancelled and refunded.', {
          reason: 'VOID',
        });
      case 'OTHER_EVENT':
        return conflict('ENTRY_REFUSED', `This ticket is for ${t.eventName}, not this event.`, {
          reason: 'OTHER_EVENT',
          event: { id: t.eventId, name: t.eventName, startsAt: iso(t.startsAt) },
        });
      case 'NOT_OPEN':
        return conflict('ENTRY_REFUSED', 'Entry has not opened for this event.', {
          reason: 'NOT_OPEN',
          entryOpensAt: iso(t.entryOpensAt),
        });
      case 'ENDED':
        return conflict('ENTRY_REFUSED', 'This event has ended.', { reason: 'ENDED' });
      default:
        // Still ADMITTABLE after a retry: only reachable if the window keeps opening between
        // each UPDATE and its re-read, which two consecutive statements cannot sustain. The
        // truthful reason for the refused attempts is that entry had not opened at their now().
        return conflict('ENTRY_REFUSED', 'Entry has not opened for this event.', {
          reason: 'NOT_OPEN',
          entryOpensAt: iso(t.entryOpensAt),
        });
    }
  }

  /** The order's other valid tickets for the event that were used before this wholeOrder admit. */
  private async alreadyUsed(
    eventId: string,
    orderId: string,
    admittedNow: string[],
  ): Promise<EntryTicketRef[]> {
    const rows = await this.prisma.ticket.findMany({
      where: {
        orderId,
        eventId,
        status: 'VALID',
        checkedInAt: { not: null },
        id: { notIn: admittedNow },
      },
      select: { id: true, code: true, checkedInAt: true },
      orderBy: { code: 'asc' },
    });
    return rows.map((t) => ({
      ticketId: t.id,
      code: t.code,
      usedAt: iso(t.checkedInAt as Date),
    }));
  }
}

/** The API shape (contracts/openapi.yaml `EntryTicket`), from one lookup row. */
function toEntryTicket(r: LookupRow): EntryTicket {
  return {
    ticketId: r.ticketId,
    code: r.code,
    orderId: r.orderId,
    state: r.state,
    event: { id: r.eventId, name: r.eventName, startsAt: iso(r.startsAt), endsAt: iso(r.endsAt) },
    tierName: r.tierName,
    seat:
      r.seatSection !== null && r.seatRow !== null && r.seatNumber !== null
        ? { section: r.seatSection, row: r.seatRow, seat: r.seatNumber }
        : null,
    holderName: r.holderName,
    // `null` unless the state is USED: a void ticket admitted before its event was cancelled
    // keeps its checkedInAt (Edge Cases), but the agent is told VOID, not when it entered.
    usedAt: r.state === 'USED' && r.checkedInAt ? iso(r.checkedInAt) : null,
    entryOpensAt: iso(r.entryOpensAt),
    unusedOnOrder: r.unusedOnOrder,
  };
}
