import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Event, Location, Prisma } from '@prisma/client';
import { SCHEDULING_BUFFER_MINUTES } from '@queuepass/shared';
import { conflict, eventCancelled } from '../common/conflict';
import { LOCKING_TX, lockEvent, ticketsSold } from '../common/event-lock';
import { searchText } from '../common/search-text';
import { PrismaService } from '../prisma/prisma.service';
import { closeHolds, closeRunOut, toChanges } from '../reservations/holds';
import { SeatEventsService } from '../seating/seat-events.service';
import type { SeatLabel } from '../seating/seat-rules';
import { CreateEventDto } from './dto/create-event.dto';
import { ListEventsQuery } from './dto/list-events.query';
import { UpdateEventDto } from './dto/update-event.dto';
import { SchedulingConflictException } from './scheduling-conflict.exception';

type EventWithLocation = Event & { location: Location };
/** The service's own client or a transaction's; the rule helpers work with either. */
type Db = PrismaService | Prisma.TransactionClient;

/** PostgreSQL SQLSTATE for a detected deadlock. */
const PG_DEADLOCK = '40P01';
const DEADLOCK_ATTEMPTS = 3;

const isDeadlock = (err: unknown): boolean =>
  err instanceof Error && err.message.includes(PG_DEADLOCK);

/**
 * Two simultaneous writes for the same venue and window can deadlock inside the
 * event_no_overlap exclusion index: each waits for the other's uncommitted row. PostgreSQL
 * aborts one. Retrying it is safe, because the retry's pre-check then sees the winner and
 * refuses with a normal SCHEDULING_CONFLICT that names it (spec 002 FR-016, FR-017).
 */
async function retryOnDeadlock<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await write();
    } catch (err) {
      if (!isDeadlock(err) || attempt >= DEADLOCK_ATTEMPTS) throw err;
    }
  }
}

/** API shape: basePrice serialized as a decimal string (never a JSON number). */
export interface EventResponse extends Omit<EventWithLocation, 'basePrice'> {
  basePrice: string;
}

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seatEvents: SeatEventsService,
  ) {}

  private toResponse(event: EventWithLocation): EventResponse {
    return { ...event, basePrice: event.basePrice.toFixed(2) };
  }

  create(dto: CreateEventDto): Promise<EventResponse> {
    return retryOnDeadlock(() => this.createOnce(dto));
  }

  private async createOnce(dto: CreateEventDto): Promise<EventResponse> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);

    this.assertWindowOrdered(startsAt, endsAt);
    const location = await this.requireLocation(dto.locationId);
    // Spec 007 FR-019: left out, the event can sell as many tickets as the venue holds.
    const capacity = dto.totalTicketCapacity ?? location.seatingCapacity;
    this.assertCapacityWithinVenue(capacity, location);
    this.assertLimitWithinCapacity(dto.maxTicketsPerCustomer, null, capacity);
    await this.assertNoConflict(dto.locationId, startsAt, endsAt, null);

    const created = await this.prisma.event.create({
      data: {
        name: dto.name,
        locationId: dto.locationId,
        startsAt,
        endsAt,
        totalTicketCapacity: capacity,
        maxTicketsPerCustomer: dto.maxTicketsPerCustomer ?? null,
        basePrice: dto.basePrice,
      },
      include: { location: true },
    });

    return this.toResponse(created);
  }

  async findAll(query: ListEventsQuery = {}): Promise<EventResponse[]> {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from >= to) {
      throw new BadRequestException({ message: ['from must be earlier than to'] });
    }
    const q = searchText(query.q);
    // Spec 004 FR-006: filters combine; the soonest-first order is unchanged.
    const where: Prisma.EventWhereInput = {
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
      ...(from || to
        ? { startsAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
        : {}),
    };
    const events = await this.prisma.event.findMany({
      where,
      include: { location: true },
      orderBy: { startsAt: 'asc' },
    });
    return events.map((e) => this.toResponse(e));
  }

  async findOne(id: string): Promise<EventResponse> {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: { location: true },
    });
    if (!event) throw new NotFoundException(`No event exists with id ${id}.`);
    return this.toResponse(event);
  }

  update(id: string, dto: UpdateEventDto): Promise<EventResponse> {
    return retryOnDeadlock(() => this.updateOnce(id, dto));
  }

  /**
   * Runs in one transaction that first locks the event row, the same lock tier writes take
   * (spec 004 research R2), so a capacity cut and a tier change can never both slip through.
   */
  private updateOnce(id: string, dto: UpdateEventDto): Promise<EventResponse> {
    return this.prisma.$transaction((tx) => this.updateLocked(tx, id, dto), LOCKING_TX);
  }

  private async updateLocked(
    tx: Prisma.TransactionClient,
    id: string,
    dto: UpdateEventDto,
  ): Promise<EventResponse> {
    const locked = await lockEvent(tx, id);
    if (locked.status === 'CANCELLED') throw eventCancelled(locked.name);
    // Spec 007 research R3: a seated event's sections belong to its venue, so it cannot move.
    if (locked.reservedSeating && dto.locationId && dto.locationId !== locked.locationId) {
      throw new BadRequestException({
        message: ['Turn reserved seating off before moving this event to another venue.'],
      });
    }
    // Spec 007 FR-018: a seated event's capacity is its venue's layout total.
    if (locked.reservedSeating && dto.totalTicketCapacity !== undefined) {
      throw new BadRequestException({
        message: [
          "totalTicketCapacity is set by the venue's seating layout while reserved seating is on",
        ],
      });
    }
    const existing = await tx.event.findUniqueOrThrow({ where: { id } });

    // The conflict check runs against the DESTINATION venue and DESTINATION window —
    // an edit that only moves the venue must be checked where it is going, not where it was.
    const locationId = dto.locationId ?? existing.locationId;
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : existing.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : existing.endsAt;

    this.assertWindowOrdered(startsAt, endsAt);
    const location = await this.requireLocation(locationId, tx);

    const capacity = dto.totalTicketCapacity ?? existing.totalTicketCapacity;
    this.assertCapacityWithinVenue(capacity, location);
    if (dto.totalTicketCapacity !== undefined) {
      await this.assertCoversTiers(tx, id, capacity);
      await this.assertCoversSales(tx, id, capacity);
    }
    this.assertLimitWithinCapacity(
      dto.maxTicketsPerCustomer,
      existing.maxTicketsPerCustomer,
      capacity,
    );

    // `id` is excluded so an event never conflicts with itself (FR-025) — saving an
    // unchanged event must always succeed.
    await this.assertNoConflict(locationId, startsAt, endsAt, id, tx);

    const updated = await tx.event.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.locationId !== undefined ? { locationId: dto.locationId } : {}),
        ...(dto.startsAt !== undefined ? { startsAt } : {}),
        ...(dto.endsAt !== undefined ? { endsAt } : {}),
        ...(dto.totalTicketCapacity !== undefined
          ? { totalTicketCapacity: dto.totalTicketCapacity }
          : {}),
        ...(dto.basePrice !== undefined ? { basePrice: dto.basePrice } : {}),
        // Spec 016: `null` clears the limit, so presence, not truthiness, decides.
        ...(dto.maxTicketsPerCustomer !== undefined
          ? { maxTicketsPerCustomer: dto.maxTicketsPerCustomer }
          : {}),
      },
      include: { location: true },
    });

    return this.toResponse(updated);
  }

  async remove(id: string): Promise<void> {
    // Spec 015 research R11: under the event lock every other event write takes, so no
    // reservation slips in between the order count and the delete. Its reservations and holds go
    // with it (ON DELETE CASCADE).
    await this.prisma.$transaction(async (tx) => {
      const existing = await lockEvent(tx, id);

      // Spec 005 FR-010. The count only names the refusal; Order.eventId is ON DELETE RESTRICT,
      // so the database refuses even if an order lands between this check and the delete.
      const orderCount = await tx.order.count({ where: { eventId: id } });
      if (orderCount > 0) {
        throw conflict(
          'EVENT_HAS_ORDERS',
          `Cannot delete "${existing.name}": it has ${orderCount} ${orderCount === 1 ? 'order' : 'orders'}. ` +
            'Cancel it instead, which keeps its records.',
          { orderCount },
        );
      }
      await tx.event.delete({ where: { id } });
    }, LOCKING_TX);
    // Every live viewer's stream ends; a reconnect gets 404 (research R9).
    this.seatEvents.end(id);
  }

  /**
   * Spec 005 US4 (FR-008, research R4): in one transaction under the event lock, void every
   * valid ticket, refund every confirmed order, and mark the event cancelled. All or nothing.
   * Spec 015 FR-016 (research R11): its reservations end `CLOSED`, and every seat it frees, held
   * or sold, is published as open after the commit.
   */
  async cancel(
    id: string,
  ): Promise<{ event: EventResponse; ordersRefunded: number; ticketsVoided: number }> {
    const { result, changes } = await this.prisma.$transaction(async (tx) => {
      const locked = await lockEvent(tx, id);
      if (locked.status === 'CANCELLED') throw eventCancelled(locked.name);

      const freed: SeatLabel[] = [...(await closeRunOut(tx, id)), ...(await closeHolds(tx, id))];
      const sold = await tx.ticket.findMany({
        where: { eventId: id, status: 'VALID', seatSection: { not: null } },
        select: { seatSection: true, seatRow: true, seatNumber: true },
      });
      for (const t of sold) {
        freed.push({
          section: t.seatSection as string,
          row: t.seatRow as number,
          seat: t.seatNumber as number,
        });
      }

      const now = new Date();
      const tickets = await tx.ticket.updateMany({
        where: { eventId: id, status: 'VALID' },
        data: { status: 'VOID' },
      });
      const orders = await tx.order.updateMany({
        where: { eventId: id, status: 'CONFIRMED' },
        data: { status: 'REFUNDED', refundedAt: now },
      });
      const event = await tx.event.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: now },
        include: { location: true },
      });
      return {
        result: {
          event: this.toResponse(event),
          ordersRefunded: orders.count,
          ticketsVoided: tickets.count,
        },
        changes: await toChanges(tx, locked.locationId, freed, 'open'),
      };
    }, LOCKING_TX);
    this.seatEvents.publish(id, changes);
    return result;
  }

  // ---------------------------------------------------------------- rules

  private assertWindowOrdered(startsAt: Date, endsAt: Date): void {
    if (endsAt <= startsAt) {
      throw new BadRequestException({ message: ['endsAt must be later than startsAt'] });
    }
  }

  private async requireLocation(locationId: string, db: Db = this.prisma): Promise<Location> {
    const location = await db.location.findUnique({ where: { id: locationId } });
    if (!location) throw new NotFoundException(`No venue exists with id ${locationId}.`);
    return location;
  }

  private assertCapacityWithinVenue(requested: number, location: Location): void {
    if (requested > location.seatingCapacity) {
      throw new HttpException(
        {
          error: {
            code: 'CAPACITY_EXCEEDED',
            message:
              `Ticket capacity ${requested} exceeds the seating capacity of ` +
              `${location.name} (${location.seatingCapacity}).`,
            details: {
              seatingCapacity: location.seatingCapacity,
              requestedTicketCapacity: requested,
            },
          },
        },
        HttpStatus.CONFLICT,
      );
    }
  }

  /**
   * Spec 016 FR-001, FR-008 (research R6): the limit in force after the write may not exceed the
   * event's capacity. A limit sent in the request is bad input (400); a capacity cut below the
   * stored limit conflicts with saved data (409), like a cut below tiers or sales. The
   * event_max_tickets_per_customer_range CHECK backs both.
   */
  private assertLimitWithinCapacity(
    sent: number | null | undefined,
    stored: number | null,
    capacity: number,
  ): void {
    if (sent !== undefined) {
      if (sent !== null && sent > capacity) {
        throw new BadRequestException({
          message: [
            `maxTicketsPerCustomer must be from 1 to the event's ticket capacity (${capacity}), ` +
              'or empty for no limit',
          ],
        });
      }
      return;
    }
    if (stored !== null && stored > capacity) {
      throw conflict(
        'CAPACITY_EXCEEDED',
        `Cannot set ticket capacity to ${capacity}; this event allows ${stored} tickets per ` +
          'customer. Lower its limit first.',
        { proposedTicketCapacity: capacity, maxTicketsPerCustomer: stored },
      );
    }
  }

  /** Spec 005 FR-011: capacity may not drop below the tickets already sold. */
  private async assertCoversSales(
    tx: Prisma.TransactionClient,
    eventId: string,
    proposed: number,
  ): Promise<void> {
    const sold = await ticketsSold(tx, { eventId });
    if (proposed < sold) {
      throw conflict(
        'CAPACITY_EXCEEDED',
        `Cannot set ticket capacity to ${proposed}; ${sold} tickets are already sold.`,
        { proposedTicketCapacity: proposed, ticketsSold: sold },
      );
    }
  }

  /** Spec 004 FR-004: capacity may not drop below the tickets already allocated to tiers. */
  private async assertCoversTiers(
    tx: Prisma.TransactionClient,
    eventId: string,
    proposed: number,
  ): Promise<void> {
    const tiers = await tx.ticketTier.aggregate({ where: { eventId }, _sum: { quantity: true } });
    const tierTotal = tiers._sum.quantity ?? 0;
    if (proposed < tierTotal) {
      throw new HttpException(
        {
          error: {
            code: 'CAPACITY_EXCEEDED',
            message:
              `Cannot set ticket capacity to ${proposed}; this event's tiers already total ` +
              `${tierTotal} tickets. Reduce or remove tiers first.`,
            details: { proposedTicketCapacity: proposed, tierTotal },
          },
        },
        HttpStatus.CONFLICT,
      );
    }
  }

  /**
   * ⚠️ THIS IS NOT THE ENFORCEMENT MECHANISM. ⚠️
   *
   * The scheduling rule is enforced by the `event_no_overlap` EXCLUDE constraint in
   * backend/prisma/migrations/*_scheduling_constraints/migration.sql. That constraint is
   * the only thing that makes FR-029 true: a read-then-write check like this one has a
   * window between the SELECT and the INSERT in which two concurrent transactions both
   * pass and both commit, producing exactly the double-booking this feature exists to
   * prevent.
   *
   * This query exists for ONE reason: PostgreSQL's 23P01 exclusion violation carries no
   * information about WHICH row conflicted, and FR-027 requires naming the conflicting
   * event. So we look it up first to produce a good error. When this check passes and the
   * constraint still refuses (a genuine race), the exception filter returns the same 409
   * with conflictingEvent: null.
   *
   * DO NOT "simplify" by removing the database constraint because this check looks
   * sufficient. It is not. See research.md R3 and plan.md Complexity Tracking.
   */
  private async assertNoConflict(
    locationId: string,
    startsAt: Date,
    endsAt: Date,
    excludeEventId: string | null,
    db: Db = this.prisma,
  ): Promise<void> {
    const bufferMs = SCHEDULING_BUFFER_MINUTES * 60_000;

    // Mirrors the constraint exactly: intervals [start - 60min, end) overlap when
    //   (A.start - 60min) < B.end  AND  (B.start - 60min) < A.end
    const candidateLowerBound = new Date(startsAt.getTime() - bufferMs);

    const clash = await db.event.findFirst({
      where: {
        locationId,
        // Spec 005 FR-009: a cancelled event no longer holds its venue's time; the
        // event_no_overlap constraint carries the same WHERE clause.
        status: 'SCHEDULED',
        ...(excludeEventId ? { id: { not: excludeEventId } } : {}),
        // existing.startsAt - 60min < candidate.endsAt
        startsAt: { lt: new Date(endsAt.getTime() + bufferMs) },
        // candidate.startsAt - 60min < existing.endsAt
        endsAt: { gt: candidateLowerBound },
      },
      orderBy: { startsAt: 'asc' },
    });

    if (clash) {
      throw new SchedulingConflictException(clash);
    }
  }
}
