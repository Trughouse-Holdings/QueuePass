import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Location, Prisma } from '@prisma/client';
import {
  DEFAULT_DOORS_BEFORE_START_MINUTES,
  DOORS_OPEN_MAX_BEFORE_START_MINUTES,
  ENTRY_OPENS_BEFORE_DOORS_MINUTES,
  SCHEDULING_BUFFER_MINUTES,
  doorsOpenProblem,
  doorsOpenRangeMessage,
  formatEventDate,
  localDate,
  type UsTimeZone,
} from '@queuepass/shared';
import { CLOCK, type Clock } from '../common/clock';
import { conflict, eventCancelled } from '../common/conflict';
import { LOCKING_TX, lockEvent, ticketsSold } from '../common/event-lock';
import { searchText } from '../common/search-text';
import { lockVenueShared } from '../common/venue-lock';
import { PrismaService } from '../prisma/prisma.service';
import { closeHolds, closeRunOut, toChanges } from '../reservations/holds';
import { SeatEventsService } from '../seating/seat-events.service';
import type { SeatLabel } from '../seating/seat-rules';
import { CreateEventDto } from './dto/create-event.dto';
import { ListEventsQuery } from './dto/list-events.query';
import { UpdateEventDto } from './dto/update-event.dto';
import {
  assertNoTierIdsOnCreate,
  eventCapacity,
  planEventSetup,
  planEventUpdate,
  writeEventSetup,
  writeEventUpdate,
} from './event-setup';
import type { SeatStateChange } from '@queuepass/shared';

import { checkEventTime } from './event-time';
import { SchedulingConflictException } from './scheduling-conflict.exception';

/**
 * Spec 014 research R6: every read and write that returns an event includes its venue and its
 * images' metadata in order. Never the `bytes` column.
 */
const EVENT_INCLUDE = {
  location: true,
  images: {
    select: { id: true, position: true, contentType: true, byteSize: true },
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.EventInclude;

type EventWithLocation = Prisma.EventGetPayload<{ include: typeof EVENT_INCLUDE }>;
/** The service's own client or a transaction's; the rule helpers work with either. */
type Db = PrismaService | Prisma.TransactionClient;

const MINUTE_MS = 60_000;

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

/** Spec 020 research R10: the event moved to another venue between the read and its lock. */
class VenueMoved extends Error {}

/**
 * API shape: basePrice serialized as a decimal string (never a JSON number). Spec 025 FR-010:
 * `entryOpensAt`, when gate check-in opens, worked out from `doorsOpenAt`, never stored. Spec 032
 * (research R7): `checkInDetailsRemovedAt` is sent; the kept count is not, it is an admin figure
 * read from the sales report.
 */
export interface EventResponse extends Omit<EventWithLocation, 'basePrice' | 'keptCheckedInCount'> {
  basePrice: string;
  entryOpensAt: Date;
}

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seatEvents: SeatEventsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private toResponse(event: EventWithLocation): EventResponse {
    const { keptCheckedInCount: _kept, ...sent } = event;
    return {
      ...sent,
      basePrice: event.basePrice.toFixed(2),
      // Spec 025 research R6, R7: the same rule as the entry SQL's `entryOpens` fragment.
      entryOpensAt: new Date(
        event.doorsOpenAt.getTime() - ENTRY_OPENS_BEFORE_DOORS_MINUTES * MINUTE_MS,
      ),
    };
  }

  create(dto: CreateEventDto): Promise<EventResponse> {
    return retryOnDeadlock(() => this.createOnce(dto));
  }

  /**
   * Spec 020 research R10: one transaction that first takes the venue row FOR SHARE, so the zone
   * the times are checked against is the zone the event is saved under (a zone change, FOR
   * UPDATE, waits for it or it waits for the zone change). The conflict pre-check and the insert
   * run in it too; the event_no_overlap constraint is still the guarantee. Spec 031 (research R4):
   * so do the event's ticket types and section mappings, all or nothing.
   */
  private createOnce(dto: CreateEventDto): Promise<EventResponse> {
    this.assertWindowOrdered(new Date(dto.startsAt), new Date(dto.endsAt));
    return this.prisma.$transaction((tx) => this.createLocked(tx, dto), LOCKING_TX);
  }

  private async createLocked(
    tx: Prisma.TransactionClient,
    dto: CreateEventDto,
  ): Promise<EventResponse> {
    await lockVenueShared(tx, [dto.locationId]);
    const location = await this.requireLocation(dto.locationId, tx);
    // Spec 020 FR-018 (research R9): each time in the venue's zone, start then end; spec 025
    // research R6: then doors, else the start minus 1 hour, then the doors' range.
    const zone = location.timeZone as UsTimeZone;
    const startsAt = checkEventTime('startsAt', dto.startsAt, zone, location.name);
    const endsAt = checkEventTime('endsAt', dto.endsAt, zone, location.name);
    const doorsOpenAt = dto.doorsOpenAt
      ? checkEventTime('doorsOpenAt', dto.doorsOpenAt, zone, location.name)
      : new Date(startsAt.getTime() - DEFAULT_DOORS_BEFORE_START_MINUTES * MINUTE_MS);
    this.assertDoorsInRange(startsAt, doorsOpenAt, zone);
    // Spec 031 research R4 step 2: with reserved seating, the venue's sections, read under the
    // venue's share lock taken above, so a layout save (FOR UPDATE) runs wholly before or after;
    // the capacity is then the layout's total.
    const sections = dto.reservedSeating
      ? await tx.section.findMany({
          where: { locationId: dto.locationId },
          orderBy: { position: 'asc' },
        })
      : [];
    // Spec 007 FR-019: left out, the event can sell as many tickets as the venue holds.
    const capacity = eventCapacity(dto, location, sections);
    this.assertCapacityWithinVenue(capacity, location);
    this.assertLimitWithinCapacity(dto.maxTicketsPerCustomer, null, capacity);
    await this.assertNoConflict(dto.locationId, zone, startsAt, endsAt, null, tx);
    // Spec 035 (research R8): id is only for an update.
    assertNoTierIdsOnCreate(dto);
    // Spec 031 research R4 steps 4, 5: each ticket type in order, then their total. Every check
    // runs before the first write; the transaction makes a failure in the writes leave nothing.
    const plan = planEventSetup(dto, location, sections, capacity);

    const created = await tx.event.create({
      data: {
        name: dto.name,
        locationId: dto.locationId,
        startsAt,
        endsAt,
        doorsOpenAt,
        totalTicketCapacity: capacity,
        maxTicketsPerCustomer: dto.maxTicketsPerCustomer ?? null,
        basePrice: dto.basePrice,
        ...(plan.reservedSeating ? { reservedSeating: true } : {}),
      },
      include: EVENT_INCLUDE,
    });
    await writeEventSetup(tx, created.id, plan);

    return this.toResponse(created);
  }

  async findAll(query: ListEventsQuery = {}): Promise<EventResponse[]> {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from >= to) {
      throw new BadRequestException({ message: ['from must be earlier than to'] });
    }
    const days = this.venueDays(query);
    const q = searchText(query.q);
    // Spec 004 FR-006: filters combine; the soonest-first order is unchanged.
    const where: Prisma.EventWhereInput = {
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
      ...(from || to
        ? { startsAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
        : {}),
      ...(days ? { startsAt: days.window } : {}),
      // Spec 030 FR-001, FR-002 (research R1, R2): past from the instant the Backend's clock
      // reaches `endsAt` (half-open), whatever the status; left out unless asked for.
      ...(query.includePast === 'true' ? {} : { endsAt: { gt: new Date(this.clock.now()) } }),
    };
    const events = await this.prisma.event.findMany({
      where,
      include: EVENT_INCLUDE,
      orderBy: { startsAt: 'asc' },
    });
    // Spec 020 research R15: the venue's local start date decides, by the shared module.
    const kept = days
      ? events.filter((e) => {
          const date = localDate(e.startsAt, e.location.timeZone);
          return (!days.fromDate || date >= days.fromDate) && (!days.toDate || date <= days.toDate);
        })
      : events;
    return kept.map((e) => this.toResponse(e));
  }

  /**
   * Spec 020 FR-020 (research R15): `fromDate`/`toDate` as a wide instant window that holds every
   * local day of every US zone (offsets -4 to -10 hours), `[fromDate 00:00Z, toDate + 1 day
   * 12:00Z)`; the exact local dates are kept afterwards. Not combinable with `from`/`to`.
   */
  private venueDays(
    query: ListEventsQuery,
  ): { fromDate?: string; toDate?: string; window: Prisma.DateTimeFilter } | null {
    const { fromDate, toDate } = query;
    if (!fromDate && !toDate) return null;
    if (query.from || query.to) {
      throw new BadRequestException({
        message: ['fromDate and toDate cannot be sent with from or to'],
      });
    }
    if (fromDate && toDate && fromDate > toDate) {
      throw new BadRequestException({ message: ['fromDate must be on or before toDate'] });
    }
    const window: Prisma.DateTimeFilter = {};
    if (fromDate) window.gte = new Date(`${fromDate}T00:00:00Z`);
    if (toDate) window.lt = new Date(Date.parse(`${toDate}T12:00:00Z`) + 86_400_000);
    return { fromDate, toDate, window };
  }

  async findOne(id: string): Promise<EventResponse> {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: EVENT_INCLUDE,
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
   *
   * Spec 020 research R10: before the event row, the event's current venue and its destination
   * are taken FOR SHARE in id order (venue, then event, the order venue-lock.ts documents). The
   * current venue is read without a lock first; if the event moved meanwhile, the transaction is
   * retried, at most twice more.
   */
  private async updateOnce(id: string, dto: UpdateEventDto): Promise<EventResponse> {
    for (let attempt = 1; ; attempt++) {
      const before = await this.prisma.event.findUnique({
        where: { id },
        select: { locationId: true },
      });
      if (!before) throw new NotFoundException(`No event exists with id ${id}.`);
      try {
        const result = await this.prisma.$transaction(
          (tx) => this.updateLocked(tx, id, dto, before.locationId),
          LOCKING_TX,
        );
        // Spec 035 (research R8): tell live seat-map viewers after the setup commits, as
        // updateSeating does; a details-only update has no changes and does not end streams.
        if (result.changes.length > 0) this.seatEvents.publish(id, result.changes);
        if (result.setupApplied) this.seatEvents.end(id);
        return result.response;
      } catch (err) {
        if (!(err instanceof VenueMoved)) throw err;
        // Review round 1, m1: still moving after every retry is a race with other writes, the
        // same 409 the database's overlap race gives, never a 500.
        if (attempt >= DEADLOCK_ATTEMPTS) {
          throw conflict(
            'SCHEDULING_CONFLICT',
            'This event was moved to another venue while it was being saved. Reload it and try ' +
              'again.',
            { bufferMinutes: SCHEDULING_BUFFER_MINUTES, conflictingEvent: null },
          );
        }
      }
    }
  }

  private async updateLocked(
    tx: Prisma.TransactionClient,
    id: string,
    dto: UpdateEventDto,
    venueBefore: string,
  ): Promise<{ response: EventResponse; changes: SeatStateChange[]; setupApplied: boolean }> {
    await lockVenueShared(tx, [venueBefore, dto.locationId ?? venueBefore]);
    const locked = await lockEvent(tx, id);
    if (locked.locationId !== venueBefore) throw new VenueMoved();
    if (locked.status === 'CANCELLED') throw eventCancelled(locked.name);
    // Spec 035: when the request carries the setup, reserved seating in force after it decides
    // whether the event can move and whether a typed capacity is allowed.
    const setupSent = dto.tiers !== undefined || dto.reservedSeating !== undefined;
    const reservedAfter = setupSent ? dto.reservedSeating === true : locked.reservedSeating;
    // Spec 007 research R3: a seated event's sections belong to its venue, so it cannot move.
    if (reservedAfter && dto.locationId && dto.locationId !== locked.locationId) {
      throw new BadRequestException({
        message: ['Turn reserved seating off before moving this event to another venue.'],
      });
    }
    // Spec 007 FR-018: a seated event's capacity is its venue's layout total.
    if (reservedAfter && dto.totalTicketCapacity !== undefined) {
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
    this.assertWindowOrdered(
      dto.startsAt ? new Date(dto.startsAt) : existing.startsAt,
      dto.endsAt ? new Date(dto.endsAt) : existing.endsAt,
    );
    const location = await this.requireLocation(locationId, tx);
    const zone = location.timeZone as UsTimeZone;

    // Spec 020 FR-019 (research R9): a move to a venue in another zone must say both local times.
    if (locationId !== existing.locationId && (!dto.startsAt || !dto.endsAt)) {
      const current = await this.requireLocation(existing.locationId, tx);
      if (current.timeZone !== location.timeZone) {
        throw new BadRequestException({
          message: [
            'Send startsAt and endsAt when moving an event to a venue in another time zone, so ' +
              'its local times are clear.',
          ],
        });
      }
    }
    // Spec 020 FR-018: only the times sent are checked, in the destination venue's zone.
    const startsAt = dto.startsAt
      ? checkEventTime('startsAt', dto.startsAt, zone, location.name)
      : existing.startsAt;
    const endsAt = dto.endsAt
      ? checkEventTime('endsAt', dto.endsAt, zone, location.name)
      : existing.endsAt;
    // Spec 025 FR-008 (research R4): doors sent are checked against the start in force after the
    // update; else a start that moves takes its doors with it, keeping the gap, so a doors-open
    // time never falls out of range for a field the caller did not send; else unchanged.
    let doorsOpenAt: Date;
    if (dto.doorsOpenAt) {
      doorsOpenAt = checkEventTime('doorsOpenAt', dto.doorsOpenAt, zone, location.name);
      this.assertDoorsInRange(startsAt, doorsOpenAt, zone);
    } else {
      doorsOpenAt = new Date(
        existing.doorsOpenAt.getTime() + (startsAt.getTime() - existing.startsAt.getTime()),
      );
    }
    // Spec 032 FR-008 (research R6): once the check-in details are removed, the times in force
    // after the update must equal the stored ones; after the checks above, so a malformed request
    // still gets their 400, and before the capacity and conflict checks.
    if (
      existing.checkInDetailsRemovedAt !== null &&
      (startsAt.getTime() !== existing.startsAt.getTime() ||
        endsAt.getTime() !== existing.endsAt.getTime() ||
        doorsOpenAt.getTime() !== existing.doorsOpenAt.getTime())
    ) {
      const removedAt = existing.checkInDetailsRemovedAt;
      // The date in the zone of the venue the event is at (where its details were removed), not
      // the destination of a move in the same request (review round 1).
      const removedZone =
        locationId === existing.locationId
          ? zone
          : ((await this.requireLocation(existing.locationId, tx)).timeZone as UsTimeZone);
      throw conflict(
        'CHECK_IN_DETAILS_REMOVED',
        `The check-in details of ${existing.name} were removed on ${formatEventDate(removedAt, removedZone)}, so its times can no longer change.`,
        { removedAt: removedAt.toISOString() },
      );
    }

    const sections = reservedAfter
      ? await tx.section.findMany({
          where: { locationId },
          orderBy: { position: 'asc' },
        })
      : [];
    const capacity = reservedAfter
      ? eventCapacity(
          {
            name: dto.name ?? existing.name,
            reservedSeating: true,
            totalTicketCapacity: undefined,
          },
          location,
          sections,
        )
      : (dto.totalTicketCapacity ?? existing.totalTicketCapacity);
    this.assertCapacityWithinVenue(capacity, location);
    if (dto.totalTicketCapacity !== undefined || (setupSent && reservedAfter)) {
      if (!setupSent) await this.assertCoversTiers(tx, id, capacity);
      await this.assertCoversSales(tx, id, capacity);
    }
    this.assertLimitWithinCapacity(
      dto.maxTicketsPerCustomer,
      existing.maxTicketsPerCustomer,
      capacity,
    );

    // `id` is excluded so an event never conflicts with itself (FR-025) — saving an
    // unchanged event must always succeed.
    await this.assertNoConflict(locationId, zone, startsAt, endsAt, id, tx);

    let setupPlan: ReturnType<typeof planEventUpdate> | null = null;
    let existingMappings: {
      sectionId: string;
      sectionName: string;
      tierId: string;
    }[] = [];
    if (setupSent) {
      const existingTiers = await tx.ticketTier.findMany({ where: { eventId: id } });
      const mappings = await tx.sectionTier.findMany({
        where: { eventId: id },
        include: { section: true },
      });
      existingMappings = mappings.map((m) => ({
        sectionId: m.sectionId,
        sectionName: m.section.name,
        tierId: m.tierId,
      }));
      const soldByTier = new Map<string, number>();
      const ordersByTier = new Map<string, number>();
      for (const tier of existingTiers) {
        soldByTier.set(tier.id, await ticketsSold(tx, { eventId: id, tierId: tier.id }));
        ordersByTier.set(tier.id, await tx.order.count({ where: { tierId: tier.id } }));
      }
      setupPlan = planEventUpdate(
        {
          name: dto.name ?? existing.name,
          totalTicketCapacity: reservedAfter ? undefined : capacity,
          reservedSeating: reservedAfter,
          tiers: dto.tiers,
        },
        {
          eventName: dto.name ?? existing.name,
          reservedSeatingBefore: existing.reservedSeating,
          existingTiers: existingTiers.map((tier) => ({ id: tier.id, name: tier.name })),
          existingMappings,
          counts: {
            eventSold: await ticketsSold(tx, { eventId: id }),
            tierlessSold: await ticketsSold(tx, { eventId: id, tierId: null }),
            soldByTier,
            ordersByTier,
            soldBySection: new Map(
              await Promise.all(
                existingMappings.map(
                  async (m) =>
                    [
                      m.sectionId,
                      await tx.ticket.count({
                        where: {
                          eventId: id,
                          status: 'VALID' as const,
                          seatSection: m.sectionName,
                        },
                      }),
                    ] as const,
                ),
              ),
            ),
          },
          venue: location,
          sections,
          capacity,
        },
      );
    }

    const updated = await tx.event.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.locationId !== undefined ? { locationId: dto.locationId } : {}),
        ...(dto.startsAt !== undefined ? { startsAt } : {}),
        ...(dto.endsAt !== undefined ? { endsAt } : {}),
        ...(doorsOpenAt.getTime() !== existing.doorsOpenAt.getTime() ? { doorsOpenAt } : {}),
        ...(dto.totalTicketCapacity !== undefined || (setupSent && reservedAfter)
          ? { totalTicketCapacity: capacity }
          : {}),
        ...(dto.basePrice !== undefined ? { basePrice: dto.basePrice } : {}),
        // Spec 016: `null` clears the limit, so presence, not truthiness, decides.
        ...(dto.maxTicketsPerCustomer !== undefined
          ? { maxTicketsPerCustomer: dto.maxTicketsPerCustomer }
          : {}),
        ...(setupSent ? { reservedSeating: reservedAfter } : {}),
      },
      include: EVENT_INCLUDE,
    });

    let changes: SeatStateChange[] = [];
    if (setupPlan) {
      changes = await writeEventUpdate(tx, id, locationId, setupPlan, {
        reservedSeating: existing.reservedSeating,
        mappings: existingMappings,
      });
    }

    const fresh = setupPlan
      ? await tx.event.findUniqueOrThrow({ where: { id }, include: EVENT_INCLUDE })
      : updated;
    return { response: this.toResponse(fresh), changes, setupApplied: setupSent };
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
        include: EVENT_INCLUDE,
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

  /**
   * Spec 025 FR-004, FR-005 (research R2): doors from 6 hours before the start to the start, or
   * 400 DOORS_OPEN_OUT_OF_RANGE naming the range in the venue's zone. The event_doors_open_range
   * CHECK is the guarantee; this check is why an admin never sees it.
   */
  private assertDoorsInRange(startsAt: Date, doorsOpenAt: Date, zone: UsTimeZone): void {
    if (!doorsOpenProblem(startsAt, doorsOpenAt)) return;
    const earliest = new Date(startsAt.getTime() - DOORS_OPEN_MAX_BEFORE_START_MINUTES * MINUTE_MS);
    throw new HttpException(
      {
        error: {
          code: 'DOORS_OPEN_OUT_OF_RANGE',
          message: doorsOpenRangeMessage(startsAt, zone),
          details: {
            field: 'doorsOpenAt',
            doorsOpenAt: doorsOpenAt.toISOString(),
            startsAt: startsAt.toISOString(),
            earliest: earliest.toISOString(),
            latest: startsAt.toISOString(),
            timeZone: zone,
          },
        },
      },
      HttpStatus.BAD_REQUEST,
    );
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
    zone: UsTimeZone,
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
      throw new SchedulingConflictException(clash, zone);
    }
  }
}
