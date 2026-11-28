import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SCHEDULING_BUFFER_MINUTES, type UsTimeZone } from '@queuepass/shared';
import type { Principal } from '../auth/principal';
import { conflict } from '../common/conflict';
import { LOCKING_TX } from '../common/event-lock';
import { checkEventTime } from '../events/event-time';
import { PrismaService } from '../prisma/prisma.service';
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
    problems.push(
      ...fieldProblems(rules),
      ...eventProblems(rules, facts.ctx),
      ...timeProblems(rules, facts.events, opts.zone),
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
