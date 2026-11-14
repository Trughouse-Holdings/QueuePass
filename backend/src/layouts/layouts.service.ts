import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LAYOUT_LIMITS,
  type LatestPrices,
  type LayoutDetail,
  type LayoutSectionSeats,
  type LayoutSummary,
  type LevelColor,
} from '@queuepass/shared';
import { conflict } from '../common/conflict';
import { LOCKING_TX } from '../common/event-lock';
import type { LockedVenue } from '../common/venue-lock';
import { PrismaService } from '../prisma/prisma.service';
import { SeatEventsService } from '../seating/seat-events.service';
import { SEAT_LEVEL_SQL } from '../seating/seat-levels';
import type {
  LayoutDuplicateDto,
  LayoutImportDto,
  LayoutLevelLineDto,
  LayoutLinesInputDto,
  LayoutSectionLineDto,
  LayoutUpdateDto,
} from './dto/layout-input.dto';
import { checkLayoutFile, type CheckedLayout } from './layout-file';
import { gridLayout, seatPlace } from './layout-lines';
import { lockLayout, lockVenueForLayouts } from './layout-lock';
import type { Point } from './seat-runs';

type Tx = Prisma.TransactionClient;
type Db = PrismaService | Tx;

/** Off-sale seats are written in batches of this many. */
const BATCH = 5_000;
/**
 * Rows and seats are written set-based, this many to a statement: a layout's 30,000 seats at most
 * (research R5) in one, so an import is a few statements, not a round trip per batch.
 */
const SET_BATCH = LAYOUT_LIMITS.maxSeats;
/**
 * The import's transaction. Its venue lock waits as long as every layout write's (`LOCKING_TX`);
 * the import itself, set-based, takes about a second for the Yum! Center's 22,090 seats on a
 * laptop. The 60 s bound is a safety margin for a loaded machine, not the time it is expected to
 * take (spec 029 SC-002's 10-second reset imports four layouts).
 */
const IMPORT_TX = { ...LOCKING_TX, timeout: 60_000 } as const;
/** Where a kept section waits while sections are reordered: past any position a layout has. */
const PARKED_POSITION = 1_000;

/** A level, section, row and seat to insert, each with its id chosen here. */
interface NewLevel {
  id: string;
  name: string;
  rank: number;
  color: LevelColor;
}
interface NewSeat {
  id: string;
  number: number;
  label: string;
  at: Point;
  levelId: string | null;
  accessible: boolean;
}
interface NewRow {
  id: string;
  number: number;
  label: string;
  levelId: string | null;
  seats: NewSeat[];
}
interface NewSection {
  id: string;
  name: string;
  levelId: string;
  outline: Point[];
  labelAt: Point;
  position: number;
  rows: NewRow[];
}

/** REAL columns come back as doubles; a float4 holds about 7 significant digits. */
const real = (v: number): number => Number(v.toPrecision(7));
const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const quoted = (events: { name: string }[]): string => events.map((e) => `"${e.name}"`).join(', ');
const fold = (s: string): string => s.toLowerCase();

const badRequest = (messages: string[]): BadRequestException =>
  new BadRequestException({ message: messages });

/**
 * Spec 038 US1 (FR-001–FR-009; research R4–R7): a venue's layouts. Every write locks the venue
 * first (`layout-lock.ts`): a new layout locks the venue alone; a write to an existing one locks
 * the venue, the layout and its scheduled events, in that order. The venue's `seatingCapacity`
 * is written in the same transaction (FR-009). Viewers of events on a changed layout reload: their
 * seat streams end after the commit (R12).
 */
@Injectable()
export class LayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seatEvents: SeatEventsService,
  ) {}

  // ---------------------------------------------------------------------------------- reads

  /** `listVenueLayouts`: by name ignoring case. */
  async list(locationId: string): Promise<LayoutSummary[]> {
    const venue = await this.prisma.location.findUnique({ where: { id: locationId } });
    if (!venue) throw new NotFoundException(`No venue exists with id ${locationId}.`);
    return this.summaries(this.prisma, Prisma.sql`l."locationId" = ${locationId}::uuid`);
  }

  /** `getVenueLayout`: the map without its seats. */
  get(layoutId: string, db: Db = this.prisma): Promise<LayoutDetail> {
    return this.detail(db, layoutId);
  }

  /** `getVenueLayoutSection`: one section's rows front first, each seat with its level. */
  async section(layoutId: string, sectionId: string): Promise<LayoutSectionSeats> {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, layoutId },
      select: { name: true },
    });
    if (!section) {
      throw new NotFoundException(`Layout ${layoutId} has no section with id ${sectionId}.`);
    }
    const seats = await this.prisma.$queryRaw<
      {
        rowNumber: number;
        rowLabel: string;
        number: number;
        label: string;
        x: number;
        y: number;
        levelId: string;
        accessible: boolean;
      }[]
    >`
      SELECT r."number" AS "rowNumber", r."label" AS "rowLabel", s."number", s."label", s."x", s."y",
             ${SEAT_LEVEL_SQL}::text AS "levelId", s."accessible"
      FROM "Section" sec
      JOIN "SeatRow" r ON r."sectionId" = sec."id"
      JOIN "Seat" s ON s."rowId" = r."id"
      WHERE sec."id" = ${sectionId}::uuid
      ORDER BY r."number", s."number"`;
    const rows: LayoutSectionSeats['rows'] = [];
    for (const s of seats) {
      let row = rows[rows.length - 1];
      if (!row || row.number !== s.rowNumber) {
        row = { number: s.rowNumber, label: s.rowLabel, seats: [] };
        rows.push(row);
      }
      row.seats.push({
        number: s.number,
        label: s.label,
        at: [real(s.x), real(s.y)],
        levelId: s.levelId,
        accessible: s.accessible,
      });
    }
    return { layoutId, sectionId, name: section.name, rows };
  }

  // --------------------------------------------------------------------------------- writes

  /** `createVenueLayout`: a plain layout from section lines (FR-005, R6). */
  async createFromLines(locationId: string, dto: LayoutLinesInputDto): Promise<LayoutDetail> {
    const { levels, sections } = checkLines(dto.levels, dto.sections, LAYOUT_LIMITS.maxLevels);
    return this.prisma.$transaction(async (tx) => {
      const venue = await lockVenueForLayouts(tx, locationId);
      await this.assertNameFree(tx, locationId, venue, dto.name);
      const id = randomUUID();
      const plan = linesPlan(levels, sections);
      await tx.layout.create({
        data: {
          id,
          locationId,
          name: dto.name,
          source: 'LINES',
          floorKind: 'NONE',
          floorOutline: Prisma.DbNull,
          width: plan.size.width,
          height: plan.size.height,
          seatCount: plan.seatCount,
        },
      });
      await insertContent(tx, id, plan.levels, plan.sections);
      await this.setCapacity(tx, locationId, venue);
      return this.detail(tx, id);
    }, LOCKING_TX);
  }

  /** `importVenueLayout`: a layout file, checked as a whole, saved all or nothing (FR-004, R5). */
  async importFile(locationId: string, dto: LayoutImportDto): Promise<LayoutDetail> {
    const checked = checkLayoutFile(dto.file);
    if (!checked.ok) {
      const n = checked.problems.length + checked.more;
      throw new HttpException(
        {
          error: {
            code: 'LAYOUT_FILE_INVALID',
            message: `The layout file has ${plural(n, 'problem')}; nothing was saved.`,
            details: { problems: checked.problems, more: checked.more },
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const file = checked.layout;
    const name = dto.name ?? file.name;
    return this.prisma.$transaction(async (tx) => {
      const venue = await lockVenueForLayouts(tx, locationId);
      await this.assertNameFree(tx, locationId, venue, name);
      const id = randomUUID();
      const plan = filePlan(file);
      await tx.layout.create({
        data: {
          id,
          locationId,
          name,
          source: 'FILE',
          floorKind: file.floorKind,
          floorOutline: file.floorOutline ?? Prisma.DbNull,
          width: file.width,
          height: file.height,
          seatCount: file.seatCount,
        },
      });
      await insertContent(tx, id, plan.levels, plan.sections);
      await this.setCapacity(tx, locationId, venue);
      return this.detail(tx, id);
    }, IMPORT_TX);
  }

  /**
   * `updateVenueLayout`: rename, or replace a LINES layout's lines keeping what is unchanged
   * (R6). Refused while the layout is locked (R7). For every scheduled event using it, new seats
   * go off sale and its capacity and base price follow, unless that would leave it unsellable.
   */
  async update(layoutId: string, dto: LayoutUpdateDto): Promise<LayoutDetail> {
    const lines = dto.levels !== undefined || dto.sections !== undefined;
    if (dto.name === undefined && !lines) {
      throw badRequest(['send a name, or levels and sections together']);
    }
    if (lines && (dto.levels === undefined || dto.sections === undefined)) {
      throw badRequest(['levels and sections are sent together']);
    }
    const { result, eventIds } = await this.prisma.$transaction(async (tx) => {
      const { venue, layout, eventIds } = await lockLayout(tx, layoutId);
      if (lines && layout.source !== 'LINES') {
        throw badRequest([
          `${layout.name} was imported from a layout file; only a layout made from section ` +
            'lines takes section lines',
        ]);
      }
      await this.assertUnlocked(tx, layoutId, layout.name);
      if (dto.name !== undefined) {
        await this.assertNameFree(tx, layout.locationId, venue, dto.name, layoutId);
        await tx.layout.update({ where: { id: layoutId }, data: { name: dto.name } });
      }
      if (dto.levels && dto.sections) {
        const current = await tx.priceLevel.count({ where: { layoutId } });
        const checked = checkLines(
          dto.levels,
          dto.sections,
          Math.max(LAYOUT_LIMITS.maxLevels, current),
        );
        await this.replaceLines(tx, layoutId, dto.name ?? layout.name, checked, eventIds);
      }
      await this.setCapacity(tx, layout.locationId, venue);
      return { result: await this.detail(tx, layoutId), eventIds };
    }, LOCKING_TX);
    for (const id of eventIds) this.seatEvents.end(id);
    return result;
  }

  /** `duplicateVenueLayout`: always allowed; a copy with new ids, used by no event (R7). */
  async duplicate(layoutId: string, dto: LayoutDuplicateDto | undefined): Promise<LayoutDetail> {
    const source = await this.prisma.layout.findUnique({ where: { id: layoutId } });
    if (!source) throw new NotFoundException(`No layout exists with id ${layoutId}.`);
    return this.prisma.$transaction(async (tx) => {
      const venue = await lockVenueForLayouts(tx, source.locationId);
      // Read again under the venue's lock: every layout write at the venue waits for it.
      const original = await tx.layout.findUnique({ where: { id: layoutId } });
      if (!original) throw new NotFoundException(`No layout exists with id ${layoutId}.`);
      let name: string;
      if (dto?.name !== undefined) {
        await this.assertNameFree(tx, original.locationId, venue, dto.name);
        name = dto.name;
      } else {
        name = await this.copyName(tx, original.locationId, original.name);
      }
      const id = randomUUID();
      await tx.layout.create({
        data: {
          id,
          locationId: original.locationId,
          name,
          source: original.source,
          floorKind: original.floorKind,
          floorOutline: original.floorOutline ?? Prisma.DbNull,
          width: original.width,
          height: original.height,
          seatCount: original.seatCount,
        },
      });
      await copyContent(tx, layoutId, id);
      await this.setCapacity(tx, original.locationId, venue);
      return this.detail(tx, id);
    }, LOCKING_TX);
  }

  /** `deleteVenueLayout`: refused while any event uses it (R7); the capacity follows. */
  async remove(layoutId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { venue, layout } = await lockLayout(tx, layoutId);
      const using = await tx.event.findMany({
        where: { layoutId },
        select: { id: true, name: true },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      });
      if (using.length > 0) {
        throw conflict(
          'LAYOUT_IN_USE',
          `${layout.name} is used by ${quoted(using)}, so it can't be deleted while ` +
            `${using.length === 1 ? 'that event keeps' : 'those events keep'} its seats. ` +
            'Duplicate it instead.',
          { events: using },
        );
      }
      await tx.layout.delete({ where: { id: layoutId } });
      await this.setCapacity(tx, layout.locationId, venue);
    }, LOCKING_TX);
  }

  // -------------------------------------------------------------------------------- helpers

  /** FR-006, R7: no change while a scheduled event using it has a valid ticket or a live hold. */
  private async assertUnlocked(tx: Tx, layoutId: string, name: string): Promise<void> {
    const blocking = await tx.$queryRaw<{ id: string; name: string }[]>`
      SELECT e."id"::text AS "id", e."name"
      FROM "Event" e
      WHERE e."layoutId" = ${layoutId}::uuid AND e."status" = 'SCHEDULED'
        AND (EXISTS (SELECT 1 FROM "Ticket" t WHERE t."eventId" = e."id" AND t."status" = 'VALID')
             OR EXISTS (SELECT 1 FROM "SeatHold" h
                        WHERE h."eventId" = e."id" AND h."releasedAt" IS NULL))
      ORDER BY e."startsAt", e."id"`;
    if (blocking.length > 0) {
      throw conflict(
        'LAYOUT_IN_USE',
        `${name} is used by ${quoted(blocking)}, which ` +
          `${blocking.length === 1 ? 'has' : 'have'} sold or held seats. Duplicate it to make ` +
          'changes.',
        { events: blocking },
      );
    }
  }

  /** FR-001: one name per venue, ignoring case; `except` is the layout being renamed. */
  private async assertNameFree(
    tx: Tx,
    locationId: string,
    venue: LockedVenue,
    name: string,
    except?: string,
  ): Promise<void> {
    const clash = await tx.$queryRaw<{ id: string; name: string }[]>`
      SELECT "id"::text AS "id", "name" FROM "Layout"
      WHERE "locationId" = ${locationId}::uuid AND lower("name") = lower(${name})
        AND "id" IS DISTINCT FROM ${except ?? null}::uuid`;
    if (clash.length > 0) {
      throw conflict(
        'LAYOUT_NAME_TAKEN',
        `${venue.name} already has a layout named "${clash[0].name}".`,
        { layoutId: clash[0].id },
      );
    }
  }

  /** "<name> (copy)", then "(copy 2)", …, the first that is free, within 50 characters. */
  private async copyName(tx: Tx, locationId: string, name: string): Promise<string> {
    const taken = new Set(
      (await tx.layout.findMany({ where: { locationId }, select: { name: true } })).map((l) =>
        fold(l.name),
      ),
    );
    for (let n = 1; ; n++) {
      const suffix = n === 1 ? ' (copy)' : ` (copy ${n})`;
      const base = name.slice(0, LAYOUT_LIMITS.nameMaxLength - suffix.length).trimEnd();
      const candidate = `${base}${suffix}`;
      if (!taken.has(fold(candidate))) return candidate;
    }
  }

  /**
   * FR-009, R7: the venue's capacity is its largest layout's seat count, kept as it is when it
   * has none; refused below a scheduled general-admission event's ticket capacity.
   */
  private async setCapacity(tx: Tx, locationId: string, venue: LockedVenue): Promise<void> {
    const largest = await tx.layout.aggregate({
      where: { locationId },
      _max: { seatCount: true },
    });
    const seats = largest._max.seatCount;
    if (seats === null) return;
    const tooBig = await tx.event.findFirst({
      where: {
        locationId,
        status: 'SCHEDULED',
        reservedSeating: false,
        totalTicketCapacity: { gt: seats },
      },
      orderBy: { totalTicketCapacity: 'desc' },
    });
    if (tooBig) {
      throw conflict(
        'CAPACITY_EXCEEDED',
        `${venue.name}'s largest layout would have ${plural(seats, 'seat')}, fewer than ` +
          `"${tooBig.name}" sells (${plural(tooBig.totalTicketCapacity, 'ticket')}). Lower its ` +
          'capacity first.',
        {
          seatingCapacity: seats,
          conflictingEvent: {
            id: tooBig.id,
            name: tooBig.name,
            totalTicketCapacity: tooBig.totalTicketCapacity,
          },
        },
      );
    }
    if (seats !== venue.seatingCapacity) {
      await tx.location.update({ where: { id: locationId }, data: { seatingCapacity: seats } });
    }
  }

  /**
   * R6: a LINES layout's lines replaced, keeping the id of every level and section whose name is
   * unchanged (ignoring case), and of every row and seat whose label is; what is gone is deleted
   * with its prices and off-sale entries. Then, for every scheduled event using the layout, the
   * new seats go off sale and its capacity and base price are recomputed, or the edit is refused.
   */
  private async replaceLines(
    tx: Tx,
    layoutId: string,
    layoutName: string,
    lines: CheckedLines,
    eventIds: string[],
  ): Promise<void> {
    const grid = gridLayout(lines.sections);

    // Levels by name.
    const oldLevels = await tx.priceLevel.findMany({ where: { layoutId } });
    const levelByName = new Map(oldLevels.map((l) => [fold(l.name), l]));
    const levels = lines.levels.map((l, i) => {
      const kept = levelByName.get(fold(l.name));
      return { id: kept?.id ?? randomUUID(), kept: kept !== undefined, ...l, rank: i + 1 };
    });
    const levelId = new Map(levels.map((l) => [fold(l.name), l.id]));

    // Sections by name: the gone go first, with their rows, seats and off-sale entries.
    const oldSections = await tx.section.findMany({ where: { layoutId } });
    const sectionByName = new Map(oldSections.map((s) => [fold(s.name), s]));
    const keptNames = new Set(lines.sections.map((s) => fold(s.name)));
    const goneSections = oldSections.filter((s) => !keptNames.has(fold(s.name)));
    if (goneSections.length > 0) {
      await tx.section.deleteMany({ where: { id: { in: goneSections.map((s) => s.id) } } });
    }

    // Levels: the gone go (their prices with them); the kept move to their ranks; the new come.
    const keptLevelIds = new Set(levels.filter((l) => l.kept).map((l) => l.id));
    const goneLevels = oldLevels.filter((l) => !keptLevelIds.has(l.id));
    // A kept section may still point at a gone level until it is updated below: the section's
    // foreign key is checked at commit (data-model.md, R7).
    if (goneLevels.length > 0) {
      await tx.priceLevel.deleteMany({ where: { id: { in: goneLevels.map((l) => l.id) } } });
    }
    await moveRanks(
      tx,
      oldLevels.filter((l) => keptLevelIds.has(l.id)),
      levels.filter((l) => l.kept),
    );
    for (const l of levels.filter((x) => x.kept)) {
      await tx.priceLevel.update({ where: { id: l.id }, data: { name: l.name, color: l.color } });
    }
    const newLevels = levels.filter((l) => !l.kept);
    if (newLevels.length > 0) {
      await tx.priceLevel.createMany({
        data: newLevels.map((l) => ({
          id: l.id,
          layoutId,
          name: l.name,
          rank: l.rank,
          color: l.color,
        })),
      });
    }

    // Sections: kept ones first leave their positions (to ones past any a layout can have), so
    // the new order never collides with `(layoutId, position)`.
    const kept = lines.sections
      .map((s) => sectionByName.get(fold(s.name)))
      .filter((s) => s !== undefined);
    for (const [i, s] of kept.entries()) {
      await tx.section.update({
        where: { id: s.id },
        data: { position: PARKED_POSITION + i },
      });
    }
    const newSeatIds: string[] = [];
    const freshSections: NewSection[] = [];
    for (const [position, line] of lines.sections.entries()) {
      const place = grid.sections[position];
      const old = sectionByName.get(fold(line.name));
      const sectionLevel = levelId.get(fold(line.level)) as string;
      if (!old) {
        const section = lineSection(line, place, position, sectionLevel);
        freshSections.push(section);
        for (const r of section.rows) for (const s of r.seats) newSeatIds.push(s.id);
        continue;
      }
      await tx.section.update({
        where: { id: old.id },
        data: {
          name: line.name,
          levelId: sectionLevel,
          position,
          outline: place.outline,
          labelX: place.labelAt[0],
          labelY: place.labelAt[1],
        },
      });
      newSeatIds.push(...(await this.replaceRows(tx, old.id, line, place)));
    }
    await insertContent(tx, layoutId, [], freshSections);
    await tx.layout.update({
      where: { id: layoutId },
      data: {
        width: grid.size.width,
        height: grid.size.height,
        seatCount: lines.sections.reduce((n, s) => n + s.rows * s.seatsPerRow, 0),
      },
    });

    // The scheduled events using it: new seats off sale, then each must still sell (R6).
    for (const eventId of eventIds) {
      await insertBatches(newSeatIds, (ids) =>
        tx.eventOffSaleSeat.createMany({ data: ids.map((seatId) => ({ eventId, seatId })) }),
      );
    }
    const refused: { id: string; name: string; why: string }[] = [];
    for (const eventId of eventIds) {
      const why = await recomputeEvent(tx, eventId);
      if (why) refused.push({ id: eventId, name: why.name, why: why.reason });
    }
    if (refused.length > 0) {
      throw conflict(
        'LAYOUT_IN_USE',
        `These lines can't be saved: ${layoutName} is used by ` +
          refused.map((e) => `"${e.name}", which would ${e.why}`).join('; ') +
          '. Duplicate the layout to make a different one.',
        { events: refused.map(({ id, name }) => ({ id, name })) },
      );
    }
  }

  /** A kept section's rows and seats by label; returns the ids of the seats it makes. */
  private async replaceRows(
    tx: Tx,
    sectionId: string,
    line: LayoutSectionLineDto,
    place: ReturnType<typeof gridLayout>['sections'][number],
  ): Promise<string[]> {
    const oldRows = await tx.seatRow.findMany({
      where: { sectionId },
      include: { seats: { select: { id: true, number: true, label: true } } },
    });
    // A row is kept when its label and number are both what the lines give it (lines label rows
    // and seats by their numbers), so no number ever moves.
    const keptRows = new Map(
      oldRows
        .filter((r) => r.number <= line.rows && r.label === String(r.number))
        .map((r) => [r.number, r]),
    );
    const goneRows = oldRows.filter((r) => keptRows.get(r.number) !== r);
    if (goneRows.length > 0) {
      await tx.seatRow.deleteMany({ where: { id: { in: goneRows.map((r) => r.id) } } });
    }
    const made: string[] = [];
    const rows: NewRow[] = [];
    const moved: { id: string; x: number; y: number }[] = [];
    const goneSeats: string[] = [];
    for (let number = 1; number <= line.rows; number++) {
      const row = keptRows.get(number);
      const seat = (n: number): NewSeat => {
        const id = randomUUID();
        made.push(id);
        return {
          id,
          number: n,
          label: String(n),
          at: seatPlace(place, number, n),
          levelId: null,
          accessible: false,
        };
      };
      if (!row) {
        rows.push({
          id: randomUUID(),
          number,
          label: String(number),
          levelId: null,
          seats: Array.from({ length: line.seatsPerRow }, (_, i) => seat(i + 1)),
        });
        continue;
      }
      const keptSeats = new Map(
        row.seats
          .filter((s) => s.number <= line.seatsPerRow && s.label === String(s.number))
          .map((s) => [s.number, s]),
      );
      for (const s of row.seats) if (keptSeats.get(s.number) !== s) goneSeats.push(s.id);
      const fresh: NewSeat[] = [];
      for (let n = 1; n <= line.seatsPerRow; n++) {
        const k = keptSeats.get(n);
        if (k) {
          const [x, y] = seatPlace(place, number, n);
          moved.push({ id: k.id, x, y });
        } else fresh.push(seat(n));
      }
      if (fresh.length > 0) {
        await insertSeats(
          tx,
          fresh.map((s) => seatInsert(s, row.id, sectionId)),
        );
      }
    }
    if (goneSeats.length > 0) await tx.seat.deleteMany({ where: { id: { in: goneSeats } } });
    if (moved.length > 0) {
      await tx.$executeRaw`
        UPDATE "Seat" s SET "x" = v."x", "y" = v."y"
        FROM unnest(${moved.map((m) => m.id)}::uuid[], ${moved.map((m) => m.x)}::real[],
                    ${moved.map((m) => m.y)}::real[]) AS v("id", "x", "y")
        WHERE s."id" = v."id"`;
    }
    await insertRows(tx, sectionId, rows);
    return made;
  }

  /** Summaries of the layouts `where` picks, by name ignoring case. */
  private async summaries(db: Db, where: Prisma.Sql): Promise<LayoutSummary[]> {
    const rows = await db.$queryRaw<LayoutSummary[]>`
      SELECT l."id"::text AS "id", l."locationId"::text AS "locationId", l."name",
             l."source"::text AS "source", l."floorKind"::text AS "floorKind", l."seatCount",
             (SELECT count(*)::int FROM "Section" s WHERE s."layoutId" = l."id") AS "sectionCount",
             (SELECT count(*)::int FROM "PriceLevel" p WHERE p."layoutId" = l."id") AS "levelCount",
             (SELECT count(*)::int FROM "Event" e
              WHERE e."layoutId" = l."id" AND e."status" = 'SCHEDULED') AS "eventsUsing",
             EXISTS (
               SELECT 1 FROM "Event" e
               WHERE e."layoutId" = l."id" AND e."status" = 'SCHEDULED'
                 AND (EXISTS (SELECT 1 FROM "Ticket" t
                              WHERE t."eventId" = e."id" AND t."status" = 'VALID')
                      OR EXISTS (SELECT 1 FROM "SeatHold" h
                                 WHERE h."eventId" = e."id" AND h."releasedAt" IS NULL))
             ) AS "locked"
      FROM "Layout" l
      WHERE ${where}
      ORDER BY lower(l."name"), l."name"`;
    return rows;
  }

  /** `LayoutDetail`: the summary, its size, floor, levels by rank and sections in order. */
  private async detail(db: Db, layoutId: string): Promise<LayoutDetail> {
    const [summary] = await this.summaries(db, Prisma.sql`l."id" = ${layoutId}::uuid`);
    if (!summary) throw new NotFoundException(`No layout exists with id ${layoutId}.`);
    const layout = await db.layout.findUniqueOrThrow({ where: { id: layoutId } });
    const levels = await db.$queryRaw<LayoutDetail['levels']>`
      SELECT p."id"::text AS "id", p."name", p."rank", p."color", count(s."id")::int AS "seatCount"
      FROM "PriceLevel" p
      LEFT JOIN ("Seat" s
                 JOIN "SeatRow" r ON r."id" = s."rowId"
                 JOIN "Section" sec ON sec."id" = s."sectionId")
             ON ${SEAT_LEVEL_SQL} = p."id"
      WHERE p."layoutId" = ${layoutId}::uuid
      GROUP BY p."id"
      ORDER BY p."rank"`;
    const sections = await db.$queryRaw<
      {
        id: string;
        name: string;
        levelId: string;
        outline: Point[];
        labelX: number;
        labelY: number;
        rowCount: number;
        seatCount: number;
        levelIds: string[];
      }[]
    >`
      SELECT sec."id"::text AS "id", sec."name", sec."levelId"::text AS "levelId", sec."outline",
             sec."labelX", sec."labelY",
             (SELECT count(*)::int FROM "SeatRow" r WHERE r."sectionId" = sec."id") AS "rowCount",
             (SELECT count(*)::int FROM "Seat" s WHERE s."sectionId" = sec."id") AS "seatCount",
             ARRAY(
               SELECT p."id"::text FROM "PriceLevel" p
               WHERE p."id" IN (SELECT ${SEAT_LEVEL_SQL}
                                FROM "Seat" s JOIN "SeatRow" r ON r."id" = s."rowId"
                                WHERE s."sectionId" = sec."id")
               ORDER BY p."rank") AS "levelIds"
      FROM "Section" sec
      WHERE sec."layoutId" = ${layoutId}::uuid
      ORDER BY sec."position"`;
    return {
      ...summary,
      size: { width: layout.width, height: layout.height },
      floorOutline: (layout.floorOutline as Point[] | null) ?? null,
      levels,
      sections: sections.map((s) => ({
        id: s.id,
        name: s.name,
        levelId: s.levelId,
        outline: s.outline,
        labelAt: [real(s.labelX), real(s.labelY)],
        rowCount: s.rowCount,
        seatCount: s.seatCount,
        levelIds: s.levelIds,
      })),
      latestPrices: await latestPrices(db, layoutId),
    };
  }
}

// ------------------------------------------------------------------------------ section lines

interface CheckedLines {
  levels: { name: string; color: LevelColor }[];
  sections: LayoutSectionLineDto[];
}

/**
 * FR-005, R6: section lines' own rules beyond their shape: at most `maxLevels` levels, level and
 * section names unique ignoring case, each section's level one of the levels, at most 30,000 seats.
 * Every problem at once (`400`). A section's level is given the level's own spelling.
 */
function checkLines(
  levels: LayoutLevelLineDto[],
  sections: LayoutSectionLineDto[],
  maxLevels: number,
): CheckedLines {
  const problems: string[] = [];
  if (levels.length > maxLevels) {
    problems.push(`a layout has at most ${maxLevels} levels; these lines have ${levels.length}`);
  }
  const byName = new Map<string, string>();
  for (const l of levels) {
    if (byName.has(fold(l.name))) problems.push(`level "${l.name}" appears twice`);
    else byName.set(fold(l.name), l.name);
  }
  const names = new Set<string>();
  for (const s of sections) {
    if (names.has(fold(s.name))) problems.push(`section "${s.name}" appears twice`);
    names.add(fold(s.name));
    if (!byName.has(fold(s.level))) {
      problems.push(`section "${s.name}": level "${s.level}" is not among the levels`);
    }
  }
  const seats = sections.reduce((n, s) => n + s.rows * s.seatsPerRow, 0);
  if (seats > LAYOUT_LIMITS.maxSeats) {
    problems.push(
      `these lines make ${plural(seats, 'seat')}; a layout has at most ` +
        `${LAYOUT_LIMITS.maxSeats.toLocaleString('en-US')}`,
    );
  }
  if (problems.length > 0) throw badRequest(problems);
  return {
    levels: levels.map((l) => ({ name: l.name, color: l.color })),
    sections: sections.map((s) => ({ ...s, level: byName.get(fold(s.level)) as string })),
  };
}

/** A section line's section, rows labelled 1, 2, … and seats 1, 2, …, on its grid place. */
function lineSection(
  line: LayoutSectionLineDto,
  place: ReturnType<typeof gridLayout>['sections'][number],
  position: number,
  levelId: string,
): NewSection {
  return {
    id: randomUUID(),
    name: line.name,
    levelId,
    outline: place.outline,
    labelAt: place.labelAt,
    position,
    rows: Array.from({ length: line.rows }, (_, r) => ({
      id: randomUUID(),
      number: r + 1,
      label: String(r + 1),
      levelId: null,
      seats: Array.from({ length: line.seatsPerRow }, (_, n) => ({
        id: randomUUID(),
        number: n + 1,
        label: String(n + 1),
        at: seatPlace(place, r + 1, n + 1),
        levelId: null,
        accessible: false,
      })),
    })),
  };
}

/** A new LINES layout's content: levels in rank order, sections on the R6 grid. */
function linesPlan(levels: CheckedLines['levels'], sections: LayoutSectionLineDto[]) {
  const grid = gridLayout(sections);
  const newLevels: NewLevel[] = levels.map((l, i) => ({ id: randomUUID(), ...l, rank: i + 1 }));
  const levelId = new Map(newLevels.map((l) => [fold(l.name), l.id]));
  return {
    size: grid.size,
    levels: newLevels,
    sections: sections.map((s, i) =>
      lineSection(s, grid.sections[i], i, levelId.get(fold(s.level)) as string),
    ),
    seatCount: sections.reduce((n, s) => n + s.rows * s.seatsPerRow, 0),
  };
}

/** A checked layout file's content, its level keys turned into level ids. */
function filePlan(file: CheckedLayout): { levels: NewLevel[]; sections: NewSection[] } {
  const levels = file.levels.map((l) => ({
    id: randomUUID(),
    key: l.key,
    name: l.name,
    rank: l.rank,
    color: l.color,
  }));
  const byKey = new Map(levels.map((l) => [l.key, l.id]));
  const id = (key: string | null): string | null => (key === null ? null : byKey.get(key)!);
  return {
    levels: levels.map(({ key: _key, ...l }) => l),
    sections: file.sections.map((s, position) => ({
      id: randomUUID(),
      name: s.name,
      levelId: byKey.get(s.levelKey)!,
      outline: s.outline,
      labelAt: s.labelAt,
      position,
      rows: s.rows.map((r) => ({
        id: randomUUID(),
        number: r.number,
        label: r.label,
        levelId: id(r.levelKey),
        seats: r.seats.map((seat) => ({
          id: randomUUID(),
          number: seat.number,
          label: seat.label,
          at: seat.at,
          levelId: id(seat.levelKey),
          accessible: seat.accessible,
        })),
      })),
    })),
  };
}

// ------------------------------------------------------------------------------------ writing

async function insertBatches<T>(
  items: T[],
  write: (batch: T[]) => Promise<unknown>,
  size = BATCH,
): Promise<void> {
  for (let i = 0; i < items.length; i += size) await write(items.slice(i, i + size));
}

interface SeatRowInsert {
  id: string;
  sectionId: string;
  number: number;
  label: string;
  levelId: string | null;
}
interface SeatInsert extends Omit<NewSeat, 'at'> {
  rowId: string;
  sectionId: string;
  x: number;
  y: number;
}

const seatInsert = (s: NewSeat, rowId: string, sectionId: string): SeatInsert => ({
  id: s.id,
  rowId,
  sectionId,
  number: s.number,
  label: s.label,
  x: s.at[0],
  y: s.at[1],
  levelId: s.levelId,
  accessible: s.accessible,
});

/**
 * Rows, set-based: one `INSERT … SELECT FROM jsonb_to_recordset(…)`, the rows as one JSON
 * parameter, in place of `createMany`'s batches.
 */
async function insertSeatRows(tx: Tx, rows: SeatRowInsert[]): Promise<void> {
  await insertBatches(
    rows,
    (b) => tx.$executeRaw`
      INSERT INTO "SeatRow" ("id", "sectionId", "number", "label", "levelId")
      SELECT j."id", j."sectionId", j."number", j."label", j."levelId"
      FROM jsonb_to_recordset(${JSON.stringify(b)}::jsonb)
        AS j("id" uuid, "sectionId" uuid, "number" int, "label" text, "levelId" uuid)`,
    SET_BATCH,
  );
}

/**
 * Seats, set-based as rows are (research R5: a 30,000-seat import in one transaction, all or
 * nothing, FR-004). Places go through float8 to the REAL columns, as `createMany`'s did.
 */
async function insertSeats(tx: Tx, seats: SeatInsert[]): Promise<void> {
  await insertBatches(
    seats,
    (b) => tx.$executeRaw`
      INSERT INTO "Seat" ("id", "rowId", "sectionId", "number", "label", "x", "y", "levelId",
                          "accessible")
      SELECT j."id", j."rowId", j."sectionId", j."number", j."label", j."x", j."y", j."levelId",
             j."accessible"
      FROM jsonb_to_recordset(${JSON.stringify(b)}::jsonb)
        AS j("id" uuid, "rowId" uuid, "sectionId" uuid, "number" int, "label" text, "x" float8,
             "y" float8, "levelId" uuid, "accessible" boolean)`,
    SET_BATCH,
  );
}

async function insertRows(tx: Tx, sectionId: string, rows: NewRow[]): Promise<void> {
  if (rows.length === 0) return;
  await insertSeatRows(
    tx,
    rows.map((r) => ({
      id: r.id,
      sectionId,
      number: r.number,
      label: r.label,
      levelId: r.levelId,
    })),
  );
  await insertSeats(
    tx,
    rows.flatMap((r) => r.seats.map((s) => seatInsert(s, r.id, sectionId))),
  );
}

/** Levels, then sections, then rows, then seats (set-based, in batches), with the ids chosen here. */
async function insertContent(
  tx: Tx,
  layoutId: string,
  levels: NewLevel[],
  sections: NewSection[],
): Promise<void> {
  if (levels.length > 0) {
    await tx.priceLevel.createMany({ data: levels.map((l) => ({ ...l, layoutId })) });
  }
  if (sections.length === 0) return;
  await tx.section.createMany({
    data: sections.map((s) => ({
      id: s.id,
      layoutId,
      name: s.name,
      levelId: s.levelId,
      outline: s.outline,
      labelX: s.labelAt[0],
      labelY: s.labelAt[1],
      position: s.position,
    })),
  });
  const rows = sections.flatMap((s) => s.rows.map((r) => ({ ...r, sectionId: s.id })));
  await insertSeatRows(
    tx,
    rows.map((r) => ({
      id: r.id,
      sectionId: r.sectionId,
      number: r.number,
      label: r.label,
      levelId: r.levelId,
    })),
  );
  await insertSeats(
    tx,
    rows.flatMap((r) => r.seats.map((s) => seatInsert(s, r.id, r.sectionId))),
  );
}

/**
 * R7: a layout's levels, sections, rows and seats copied to `to` with new ids, in the database.
 * Levels match by rank, sections by position, rows by number: each unique within its parent.
 */
async function copyContent(tx: Tx, from: string, to: string): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "PriceLevel" ("id", "layoutId", "name", "rank", "color")
    SELECT gen_random_uuid(), ${to}::uuid, "name", "rank", "color"
    FROM "PriceLevel" WHERE "layoutId" = ${from}::uuid`;
  await tx.$executeRaw`
    INSERT INTO "Section" ("id", "layoutId", "name", "levelId", "outline", "labelX", "labelY",
                           "position", "updatedAt")
    SELECT gen_random_uuid(), ${to}::uuid, s."name", nl."id", s."outline", s."labelX", s."labelY",
           s."position", now()
    FROM "Section" s
    JOIN "PriceLevel" ol ON ol."id" = s."levelId"
    JOIN "PriceLevel" nl ON nl."layoutId" = ${to}::uuid AND nl."rank" = ol."rank"
    WHERE s."layoutId" = ${from}::uuid`;
  await tx.$executeRaw`
    INSERT INTO "SeatRow" ("id", "sectionId", "number", "label", "levelId")
    SELECT gen_random_uuid(), ns."id", r."number", r."label", nl."id"
    FROM "SeatRow" r
    JOIN "Section" os ON os."id" = r."sectionId" AND os."layoutId" = ${from}::uuid
    JOIN "Section" ns ON ns."layoutId" = ${to}::uuid AND ns."position" = os."position"
    LEFT JOIN "PriceLevel" ol ON ol."id" = r."levelId"
    LEFT JOIN "PriceLevel" nl ON nl."layoutId" = ${to}::uuid AND nl."rank" = ol."rank"`;
  await tx.$executeRaw`
    INSERT INTO "Seat" ("id", "rowId", "sectionId", "number", "label", "x", "y", "levelId",
                        "accessible")
    SELECT gen_random_uuid(), nr."id", nr."sectionId", st."number", st."label", st."x", st."y",
           nl."id", st."accessible"
    FROM "Seat" st
    JOIN "SeatRow" orw ON orw."id" = st."rowId"
    JOIN "Section" os ON os."id" = orw."sectionId" AND os."layoutId" = ${from}::uuid
    JOIN "Section" ns ON ns."layoutId" = ${to}::uuid AND ns."position" = os."position"
    JOIN "SeatRow" nr ON nr."sectionId" = ns."id" AND nr."number" = orw."number"
    LEFT JOIN "PriceLevel" ol ON ol."id" = st."levelId"
    LEFT JOIN "PriceLevel" nl ON nl."layoutId" = ${to}::uuid AND nl."rank" = ol."rank"`;
}

/**
 * Kept levels moved to their new ranks. `(layoutId, rank)` is unique and checked row by row, so
 * a level moves only to a free rank; a cycle of moves goes through a free rank (1–50) first.
 */
async function moveRanks(
  tx: Tx,
  current: { id: string; rank: number }[],
  target: { id: string; rank: number }[],
): Promise<void> {
  const at = new Map(current.map((l) => [l.id, l.rank]));
  const taken = new Map(current.map((l) => [l.rank, l.id]));
  const want = new Map(target.map((l) => [l.id, l.rank]));
  const move = async (id: string, rank: number) => {
    await tx.priceLevel.update({ where: { id }, data: { rank } });
    taken.delete(at.get(id)!);
    taken.set(rank, id);
    at.set(id, rank);
  };
  for (;;) {
    const pending = [...want].filter(([id, rank]) => at.get(id) !== rank);
    if (pending.length === 0) return;
    const free = pending.find(([, rank]) => !taken.has(rank));
    if (free) {
      await move(free[0], free[1]);
      continue;
    }
    // Every wanted rank is taken by another pending level: park one on an unused rank.
    const spare = Array.from({ length: LAYOUT_LIMITS.maxCarriedLevels }, (_, i) => i + 1).find(
      (r) => !taken.has(r) && ![...want.values()].includes(r),
    );
    const parking =
      spare ??
      Array.from({ length: LAYOUT_LIMITS.maxCarriedLevels }, (_, i) => i + 1).find(
        (r) => !taken.has(r),
      );
    if (parking === undefined) {
      throw badRequest([
        "these levels reorder all 50 of the layout's levels at once; reorder them in two edits",
      ]);
    }
    await move(pending[0][0], parking);
  }
}

/**
 * R6, R9: an event's capacity (its seats on sale) and base price (its lowest price of a level with
 * seats on sale), recomputed after its layout changed. Returns why it can't be, if it can't.
 */
async function recomputeEvent(
  tx: Tx,
  eventId: string,
): Promise<{ name: string; reason: string } | null> {
  const event = await tx.event.findUniqueOrThrow({
    where: { id: eventId },
    select: { name: true, layoutId: true, maxTicketsPerCustomer: true },
  });
  const onSale = await tx.$queryRaw<{ levelId: string; name: string; seats: number }[]>`
    SELECT ${SEAT_LEVEL_SQL}::text AS "levelId", min(p."name") AS "name", count(*)::int AS "seats"
    FROM "Section" sec
    JOIN "Seat" s ON s."sectionId" = sec."id"
    JOIN "SeatRow" r ON r."id" = s."rowId"
    JOIN "PriceLevel" p ON p."id" = ${SEAT_LEVEL_SQL}
    WHERE sec."layoutId" = ${event.layoutId}::uuid
      AND NOT EXISTS (SELECT 1 FROM "EventOffSaleSeat" o
                      WHERE o."eventId" = ${eventId}::uuid AND o."seatId" = s."id")
    GROUP BY 1
    ORDER BY min(p."rank")`;
  const prices = new Map(
    (await tx.eventLevelPrice.findMany({ where: { eventId } })).map((p) => [p.levelId, p.price]),
  );
  const seats = onSale.reduce((n, l) => n + l.seats, 0);
  const unpriced = onSale.filter((l) => !prices.has(l.levelId)).map((l) => l.name);
  if (unpriced.length > 0) {
    return {
      name: event.name,
      reason: `have seats on sale with no price for ${unpriced.join(', ')}`,
    };
  }
  if (seats === 0) return { name: event.name, reason: 'have no seat on sale' };
  const limit = event.maxTicketsPerCustomer;
  if (limit !== null && limit > seats) {
    return {
      name: event.name,
      reason: `keep a limit of ${limit} tickets per customer, above its ${plural(seats, 'seat')} on sale`,
    };
  }
  const lowest = onSale
    .map((l) => prices.get(l.levelId) as Prisma.Decimal)
    .reduce((a, b) => (b.lessThan(a) ? b : a));
  await tx.event.update({
    where: { id: eventId },
    data: { totalTicketCapacity: seats, basePrice: lowest },
  });
  return null;
}

/** FR-015, R8: the level prices of the most recently created scheduled event on the layout. */
async function latestPrices(db: Db, layoutId: string): Promise<LatestPrices | null> {
  const event = await db.event.findFirst({
    where: { layoutId, status: 'SCHEDULED' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, name: true, startsAt: true },
  });
  if (!event) return null;
  const prices = await db.eventLevelPrice.findMany({
    where: { eventId: event.id },
    include: { level: { select: { rank: true } } },
    orderBy: { level: { rank: 'asc' } },
  });
  return {
    eventId: event.id,
    eventName: event.name,
    startsAt: event.startsAt.toISOString(),
    prices: prices.map((p) => ({ levelId: p.levelId, price: p.price.toFixed(2) })),
  };
}
