import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SCHEDULING_BUFFER_MINUTES, type UsTimeZone } from '@queuepass/shared';
import type { Principal } from '../auth/principal';
import { conflict } from '../common/conflict';
import { LOCKING_TX } from '../common/event-lock';
import { checkEventTime } from '../events/event-time';
import { PrismaService } from '../prisma/prisma.service';
import { closeHolds, fromHeld } from '../reservations/holds';
import { sequence, toChanges, type SeatChanges, type SeatMove } from '../seating/seat-changes';
import { SeatEventsService } from '../seating/seat-events.service';
import { SeasonInputDto } from './dto/season-input.dto';
import { lockSeasonWrite, SeasonVenueMoved, type LockedSeason } from './season-lock';
import {
  eventProblems,
  fieldProblems,
  priceProblems,
  publishProblems,
  timeProblems,
  type SeasonRuleContext,
  type SeasonRuleEvent,
  type SeasonRuleInput,
} from './season-rules';
import { databaseNow, readSeasons, type SeasonResponse } from './season-view';

type Tx = Prisma.TransactionClient;

const ADMIN_ROLE = 'queuepass-admin';
const isAdmin = (caller: Principal): boolean => caller.roles.includes(ADMIN_ROLE);

/** Research R2: a Season's venue moved under a write; tried this many times in all. */
const VENUE_ATTEMPTS = 3;

/** A 400 naming every problem, each starting with its field path (R4). */
/** R4: any write to a cancelled Season. */
const seasonCancelled = (season: LockedSeason) =>
  conflict('SEASON_CANCELLED', `${season.name} is cancelled and can no longer be changed.`);

/** contracts/openapi.yaml `SeasonCancellation`. */
export interface SeasonCancellation {
  season: SeasonResponse;
  passesRefunded: number;
  ordersRefunded: number;
  ticketsVoided: number;
}

const refuse = (problems: string[]): BadRequestException =>
  new BadRequestException({ message: problems });

/** What a save checked and will write. */
interface SeasonPlan {
  rules: SeasonRuleInput;
  ctx: SeasonRuleContext;
  events: SeasonRuleEvent[];
}

/**
 * Spec 041 (research R2–R6, R10): Seasons, their events and prices; putting one on sale, deleting
 * a draft, cancelling one on sale. Every write runs in one `LOCKING_TX` transaction under
 * `lockSeasonWrite`'s locks, so the rules it checks still hold when it commits (Constitution IV).
 */
@Injectable()
export class SeasonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seatEvents: SeatEventsService,
  ) {}

  // ---------------------------------------------------------------- reads (R3)

  /** Admins see every Season; everyone else only Seasons on sale. */
  list(caller: Principal): Promise<SeasonResponse[]> {
    const admin = isAdmin(caller);
    return readSeasons(this.prisma, admin ? {} : { status: 'ON_SALE' }, { admin });
  }

  async get(id: string, caller: Principal): Promise<SeasonResponse> {
    const admin = isAdmin(caller);
    const [season] = await readSeasons(
      this.prisma,
      { id, ...(admin ? {} : { status: 'ON_SALE' }) },
      { admin },
    );
    if (!season) throw new NotFoundException(`No season exists with id ${id}.`);
    return season;
  }

  // ---------------------------------------------------------------- writes

  /** FR-001: a new draft with its events and prices, all or nothing. */
  async create(dto: SeasonInputDto): Promise<SeasonResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locks = await lockSeasonWrite(tx, {
          locationId: dto.locationId,
          eventIds: dto.eventIds,
        });
        const plan = await this.plan(tx, dto, {
          zone: locks.zones.get(dto.locationId)!,
          season: null,
          alreadyIn: new Set(),
          complete: false,
        });
        const created = await tx.season.create({
          data: { ...this.columns(plan.rules), ...this.children(plan.rules) },
          select: { id: true },
        });
        return this.respond(tx, created.id);
      }, LOCKING_TX);
    } catch (err) {
      throw await this.namedEventConflict(err, dto.eventIds, null);
    }
  }

  /**
   * FR-010: `DRAFT` → `ON_SALE` once the Season has at least 2 events not cancelled, every level
   * (or at least one name) priced, and its sales end in the future and no later than its first
   * event (R4).
   */
  publish(id: string): Promise<SeasonResponse> {
    return this.underSeasonLock(id, async (tx, season, zone) => {
      if (season.status !== 'DRAFT') {
        throw conflict(
          'SEASON_NOT_DRAFT',
          `${season.name} is not a draft, so it can't be put on sale.`,
          {
            status: season.status,
          },
        );
      }
      const stored = await this.storedInput(tx, id);
      const plan = await this.facts(tx, stored, { alreadyIn: new Set(stored.eventIds) });
      const problems = [
        ...eventProblems(stored, plan.ctx),
        ...timeProblems(stored, plan.events, zone),
        ...publishProblems(stored, plan.ctx),
      ];
      if (problems.length > 0) throw refuse(problems);
      await tx.season.update({
        where: { id },
        data: { status: 'ON_SALE', publishedAt: plan.ctx.now },
      });
      return this.respond(tx, id);
    });
  }

  /**
   * R3: replaces the Season's fields, events and prices, all or nothing. Once a pass is active,
   * its events, venue and layout are fixed (FR-005): the Season row's `FOR UPDATE` lock waits for
   * a pass being sold under its `FOR SHARE` lock, or the sale waits for this save (R2). A Season
   * on sale keeps the rules that keep it sellable (review S2); a cancelled one is read-only.
   */
  async update(id: string, dto: SeasonInputDto): Promise<SeasonResponse> {
    try {
      return await this.underSeasonLock(
        id,
        async (tx, season, zone) => {
          if (season.status === 'CANCELLED') throw seasonCancelled(season);
          const stored = await tx.seasonEvent.findMany({
            where: { seasonId: id },
            select: { eventId: true },
          });
          const storedIds = stored.map((e) => e.eventId);
          const passesSold = await tx.seasonPass.count({
            where: { seasonId: id, status: 'ACTIVE' },
          });
          if (passesSold > 0) {
            const same = (a: string[], b: string[]) =>
              a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
            const changed = !same(storedIds, dto.eventIds)
              ? 'eventIds'
              : dto.locationId !== season.locationId
                ? 'locationId'
                : dto.layoutId !== season.layoutId
                  ? 'layoutId'
                  : null;
            if (changed) {
              throw conflict(
                'SEASON_HAS_PASSES',
                `Passes have been sold for ${season.name}, so its events, venue and layout can't ` +
                  'change.',
                { field: changed, passesSold },
              );
            }
          }
          const plan = await this.plan(tx, dto, {
            zone,
            season,
            alreadyIn: new Set(storedIds),
            complete: season.status === 'ON_SALE',
          });
          await tx.seasonEvent.deleteMany({ where: { seasonId: id } });
          await tx.seasonPrice.deleteMany({ where: { seasonId: id } });
          await tx.season.update({
            where: { id },
            data: { ...this.columns(plan.rules), ...this.children(plan.rules) },
          });
          return this.respond(tx, id);
        },
        { locationId: dto.locationId, eventIds: dto.eventIds },
      );
    } catch (err) {
      throw await this.namedEventConflict(err, dto.eventIds, id);
    }
  }

  /** FR-008: a draft with no passes is deleted with its event list and prices. */
  async remove(id: string): Promise<void> {
    await this.underSeasonLock(id, async (tx, season) => {
      if (season.status !== 'DRAFT') {
        throw conflict(
          'SEASON_NOT_DRAFT',
          `${season.name} is not a draft, so it can't be deleted.` +
            (season.status === 'ON_SALE' ? ' Cancel it instead.' : ''),
          { status: season.status },
        );
      }
      const passesSold = await tx.seasonPass.count({ where: { seasonId: id, status: 'ACTIVE' } });
      if (passesSold > 0) {
        throw conflict('SEASON_HAS_PASSES', `Passes have been sold for ${season.name}.`, {
          field: 'id',
          passesSold,
        });
      }
      await tx.season.delete({ where: { id } });
    });
  }

  /**
   * FR-014 (research R10): in one transaction under R2's locks, every live pass hold ends with its
   * reservations (`CLOSED`, no 2-minute wait), every confirmed pass order is refunded and its
   * valid tickets voided (games already played and tickets used included, review M7), every
   * active pass refunded, and the Season cancelled. Its events stay scheduled. After the commit
   * the freed seats go to live seat maps as `EventsService.cancel` sends them.
   */
  async cancel(id: string): Promise<SeasonCancellation> {
    const { result, published } = await this.underSeasonLock(id, async (tx, season) => {
      if (season.status === 'DRAFT') {
        throw conflict(
          'SEASON_NOT_ON_SALE',
          `${season.name} is a draft, so it can't be cancelled; delete it instead.`,
          { status: season.status },
        );
      }
      if (season.status === 'CANCELLED') throw seasonCancelled(season);
      const now = await databaseNow(tx);

      const holds = await tx.seasonPassHold.findMany({
        where: { seasonId: id, endedAt: null },
        select: { id: true, reservations: { select: { id: true } } },
      });
      const holdReservations = new Set(holds.flatMap((h) => h.reservations.map((r) => r.id)));
      const events = await tx.seasonEvent.findMany({
        where: { seasonId: id },
        select: { event: { select: { id: true, layoutId: true } } },
        orderBy: { eventId: 'asc' },
      });
      const freed = new Map<string, SeatMove[]>();
      for (const { event } of events) {
        const held = await closeHolds(tx, event.id, (h) => holdReservations.has(h.reservationId));
        freed.set(event.id, fromHeld(held));
      }
      if (holds.length > 0) {
        const ids = holds.map((h) => h.id);
        await tx.$executeRaw`
          UPDATE "SeatReservation" SET "endedAt" = greatest(now(), "createdAt")
          WHERE "passHoldId" = ANY(${ids}::uuid[]) AND "endedAt" IS NULL`;
        await tx.$executeRaw`
          UPDATE "SeasonPassHold" SET "endedAt" = greatest(now(), "createdAt")
          WHERE "id" = ANY(${ids}::uuid[]) AND "endedAt" IS NULL`;
      }

      const passOrders = { status: 'CONFIRMED' as const, seasonPass: { seasonId: id } };
      const sold = await tx.ticket.findMany({
        where: { status: 'VALID', seatId: { not: null }, order: passOrders },
        select: { eventId: true, seatId: true },
      });
      for (const t of sold) freed.get(t.eventId)?.push({ seatId: t.seatId, from: 'sold' });
      const tickets = await tx.ticket.updateMany({
        where: { status: 'VALID', order: passOrders },
        data: { status: 'VOID' },
      });
      const orders = await tx.order.updateMany({
        where: passOrders,
        data: { status: 'REFUNDED', refundedAt: now },
      });
      const passes = await tx.seasonPass.updateMany({
        where: { seasonId: id, status: 'ACTIVE' },
        data: { status: 'REFUNDED', refundedAt: now },
      });
      await tx.season.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: now },
      });

      const published: { eventId: string; changes: SeatChanges }[] = [];
      for (const { event } of events) {
        const moves = freed.get(event.id) ?? [];
        const changes = await toChanges(tx, event.layoutId, moves, 'open');
        published.push({ eventId: event.id, changes: await sequence(tx, event.id, changes) });
      }
      return {
        result: {
          season: await this.respond(tx, id),
          passesRefunded: passes.count,
          ordersRefunded: orders.count,
          ticketsVoided: tickets.count,
        },
        published,
      };
    });
    for (const p of published) this.seatEvents.publish(p.eventId, p.changes);
    return result;
  }

  // ---------------------------------------------------------------- helpers

  /**
   * R2 (review S8): runs `write` under the Season's locks, its venue read before the transaction;
   * if the venue moved meanwhile, rolls back and tries again.
   */
  private async underSeasonLock<T>(
    id: string,
    write: (tx: Tx, season: LockedSeason, zone: UsTimeZone) => Promise<T>,
    requested?: { locationId: string; eventIds: string[] },
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const before = await this.prisma.season.findUnique({
        where: { id },
        select: { locationId: true },
      });
      if (!before) throw new NotFoundException(`No season exists with id ${id}.`);
      try {
        return await this.prisma.$transaction(async (tx) => {
          const locks = await lockSeasonWrite(tx, {
            locationId: requested?.locationId ?? before.locationId,
            storedLocationId: before.locationId,
            seasonId: id,
            eventIds: requested?.eventIds ?? [],
          });
          const zone = locks.zones.get(requested?.locationId ?? before.locationId)!;
          return write(tx, locks.season!, zone);
        }, LOCKING_TX);
      } catch (err) {
        if (!(err instanceof SeasonVenueMoved)) throw err;
        if (attempt >= VENUE_ATTEMPTS) {
          throw conflict(
            'SCHEDULING_CONFLICT',
            'This Season was moved to another venue while it was being saved. Reload it and try again.',
            { bufferMinutes: SCHEDULING_BUFFER_MINUTES, conflictingEvent: null },
          );
        }
      }
    }
  }

  /** One Season's response, as an admin reads it (only admins write). */
  private async respond(db: Tx, id: string): Promise<SeasonResponse> {
    const [season] = await readSeasons(db, { id }, { admin: true });
    return season;
  }

  /**
   * R4, R16: the request's times in the venue's zone, its layout of the venue, its events not in
   * another Season, and every rule a save checks. `complete` (a Season on sale) also asks for
   * every level, or at least one name, priced. Throws the refusal; returns what to write.
   */
  private async plan(
    tx: Tx,
    dto: SeasonInputDto,
    opts: {
      zone: UsTimeZone;
      season: LockedSeason | null;
      alreadyIn: Set<string>;
      complete: boolean;
    },
  ): Promise<SeasonPlan> {
    const venue = await tx.location.findUniqueOrThrow({
      where: { id: dto.locationId },
      select: { name: true },
    });
    const salesEndAt = checkEventTime('salesEndAt', dto.salesEndAt, opts.zone, venue.name);
    const singleSalesOpenAt = dto.singleSalesOpenAt
      ? checkEventTime('singleSalesOpenAt', dto.singleSalesOpenAt, opts.zone, venue.name)
      : null;
    const team = dto.team?.trim() ? dto.team.trim() : null;
    const rules: SeasonRuleInput = {
      name: dto.name,
      sport: dto.sport ?? null,
      team,
      locationId: dto.locationId,
      layoutId: dto.layoutId,
      salesEndAt,
      singleSalesOpenAt,
      maxPassesPerCustomer: dto.maxPassesPerCustomer ?? null,
      eventIds: dto.eventIds,
      prices: dto.prices.map((p) => ({
        ...(p.levelId !== undefined ? { levelId: p.levelId } : {}),
        ...(p.tierName !== undefined ? { tierName: p.tierName } : {}),
        price: p.price,
      })),
    };

    const problems: string[] = [];
    if (dto.layoutId !== null) {
      const layout = await tx.layout.findUnique({
        where: { id: dto.layoutId },
        select: { locationId: true },
      });
      if (!layout || layout.locationId !== dto.locationId) {
        problems.push(`layoutId is not a layout of ${venue.name}`);
      }
    }
    const facts = await this.facts(tx, rules, { alreadyIn: opts.alreadyIn });
    const refusedEvents = eventProblems(rules, facts.ctx);
    // The sales end is compared with the events the Season can keep, not one already refused.
    const refusedAt = new Set(refusedEvents.map((p) => p.split(' ')[0]));
    const kept = rules.eventIds
      .filter((_, i) => !refusedAt.has(`eventIds.${i}`))
      .map((id) => facts.ctx.events.get(id))
      .filter((e): e is SeasonRuleEvent => e !== undefined);
    problems.push(
      ...fieldProblems(rules),
      ...refusedEvents,
      ...timeProblems(rules, kept, opts.zone),
      ...priceProblems(rules, facts.ctx, { complete: opts.complete }),
    );
    if (problems.length > 0) throw refuse(problems);
    await this.assertNotInAnotherSeason(tx, rules.eventIds, opts.season?.id ?? null);
    return facts;
  }

  /** The facts the rules read: the named events, the layout's levels, the database's clock. */
  private async facts(
    tx: Tx,
    rules: SeasonRuleInput,
    opts: { alreadyIn: Set<string> },
  ): Promise<SeasonPlan> {
    const rows = await tx.event.findMany({
      where: { id: { in: rules.eventIds } },
      select: {
        id: true,
        name: true,
        locationId: true,
        layoutId: true,
        status: true,
        startsAt: true,
        tiers: { select: { name: true } },
      },
    });
    const events: SeasonRuleEvent[] = rows.map((e) => ({
      id: e.id,
      name: e.name,
      locationId: e.locationId,
      layoutId: e.layoutId,
      status: e.status,
      startsAt: e.startsAt,
      tierNames: e.tiers.map((t) => t.name),
    }));
    const levels = rules.layoutId
      ? await tx.priceLevel.findMany({
          where: { layoutId: rules.layoutId },
          select: { id: true, name: true, rank: true },
        })
      : [];
    return {
      rules,
      events,
      ctx: {
        events: new Map(events.map((e) => [e.id, e])),
        alreadyIn: opts.alreadyIn,
        levels,
        now: await databaseNow(tx),
      },
    };
  }

  /** The stored Season as the rules read it. */
  private async storedInput(tx: Tx, id: string): Promise<SeasonRuleInput> {
    const s = await tx.season.findUniqueOrThrow({
      where: { id },
      include: { events: { select: { eventId: true } }, prices: true },
    });
    return {
      name: s.name,
      sport: s.sport,
      team: s.team,
      locationId: s.locationId,
      layoutId: s.layoutId,
      salesEndAt: s.salesEndAt,
      singleSalesOpenAt: s.singleSalesOpenAt,
      maxPassesPerCustomer: s.maxPassesPerCustomer,
      eventIds: s.events.map((e) => e.eventId),
      prices: s.prices.map((p) =>
        p.levelId !== null
          ? { levelId: p.levelId, price: p.price.toFixed(2) }
          : { tierName: p.tierName!, price: p.price.toFixed(2) },
      ),
    };
  }

  /**
   * FR-004: an event already in another Season is `409 EVENT_IN_SEASON`, naming it by its index
   * and the Season. Read under the event locks, so a Season that took it first is seen.
   */
  private async assertNotInAnotherSeason(
    tx: Tx | PrismaService,
    eventIds: readonly string[],
    seasonId: string | null,
  ): Promise<void> {
    const taken = await tx.seasonEvent.findMany({
      where: {
        eventId: { in: [...eventIds] },
        ...(seasonId ? { seasonId: { not: seasonId } } : {}),
      },
      select: {
        eventId: true,
        event: { select: { name: true } },
        season: { select: { id: true, name: true } },
      },
    });
    if (taken.length === 0) return;
    const first = eventIds.findIndex((id) => taken.some((t) => t.eventId === id));
    const hit = taken.find((t) => t.eventId === eventIds[first])!;
    throw conflict('EVENT_IN_SEASON', `${hit.event.name} is already in ${hit.season.name}.`, {
      field: `eventIds.${first}`,
      seasonId: hit.season.id,
      seasonName: hit.season.name,
    });
  }

  /**
   * R2: the primary key of `SeasonEvent` is the guarantee that an event is in at most one Season;
   * its violation (a race the pre-check did not see) is the same `409 EVENT_IN_SEASON`, naming
   * the event as committed by the winner. Anything else is passed on unchanged.
   */
  private async namedEventConflict(
    err: unknown,
    eventIds: readonly string[],
    seasonId: string | null,
  ): Promise<unknown> {
    const isPk =
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      JSON.stringify(err.meta ?? {}).match(/SeasonEvent|eventId/) !== null;
    if (!isPk) return err;
    try {
      await this.assertNotInAnotherSeason(this.prisma, eventIds, seasonId);
    } catch (named) {
      return named;
    }
    return conflict(
      'EVENT_IN_SEASON',
      'An event of this Season was just added to another Season.',
      {
        field: 'eventIds',
      },
    );
  }

  /** The Season's own columns from the checked request. */
  private columns(rules: SeasonRuleInput) {
    return {
      name: rules.name.trim(),
      sport: rules.sport,
      team: rules.team,
      locationId: rules.locationId,
      layoutId: rules.layoutId,
      salesEndAt: rules.salesEndAt,
      singleSalesOpenAt: rules.singleSalesOpenAt,
      maxPassesPerCustomer: rules.maxPassesPerCustomer,
    };
  }

  /** Its events and prices, as nested creates. */
  private children(rules: SeasonRuleInput) {
    return {
      events: { create: rules.eventIds.map((eventId) => ({ eventId })) },
      prices: {
        create: rules.prices.map((p) =>
          p.levelId !== undefined
            ? { levelId: p.levelId, price: p.price }
            : { tierName: p.tierName!.trim(), price: p.price },
        ),
      },
    };
  }
}
