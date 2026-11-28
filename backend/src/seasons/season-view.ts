import { Prisma } from '@prisma/client';
import type { UsTimeZone } from '@queuepass/shared';
import type { PrismaService } from '../prisma/prisma.service';

/** The service's own client or a transaction's. */
type Db = PrismaService | Prisma.TransactionClient;

/** Everything a Season response reads, in one query. */
export const SEASON_INCLUDE = {
  location: { select: { name: true, timeZone: true } },
  layout: { select: { name: true } },
  events: {
    include: {
      event: { select: { id: true, name: true, startsAt: true, endsAt: true, status: true } },
    },
  },
  prices: { include: { level: { select: { name: true, rank: true } } } },
} satisfies Prisma.SeasonInclude;

export type SeasonRow = Prisma.SeasonGetPayload<{ include: typeof SEASON_INCLUDE }>;

/** contracts/openapi.yaml `Season`. */
export interface SeasonResponse {
  id: string;
  name: string;
  sport: SeasonRow['sport'];
  team: string | null;
  locationId: string;
  venueName: string;
  timeZone: UsTimeZone;
  layoutId: string | null;
  layoutName: string | null;
  status: SeasonRow['status'];
  salesEndAt: Date;
  singleSalesOpenAt: Date | null;
  maxPassesPerCustomer: number | null;
  salesOpen: boolean;
  publishedAt: Date | null;
  cancelledAt: Date | null;
  events: { id: string; name: string; startsAt: Date; endsAt: Date; status: string }[];
  prices: {
    levelId: string | null;
    levelName: string | null;
    tierName: string | null;
    price: string;
  }[];
  passesSold: number | null;
  passRevenue: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SeasonFigures {
  /** Active passes. */
  passesSold: number;
  /** The sum of the Season's confirmed pass orders. */
  passRevenue: Prisma.Decimal;
}

/**
 * Spec 041 (T010; research R3, R8): one Season as the contract states it. Events by `startsAt`
 * (then id), prices by level rank (seated) or name ignoring case (general admission). The business
 * figures go to admins only (review S3); everyone else reads them as `null`. `salesOpen` is on
 * sale and before `salesEndAt` by `now`, the database's clock (R16).
 */
export function toSeason(
  row: SeasonRow,
  opts: { admin: boolean; figures: SeasonFigures; now: Date },
): SeasonResponse {
  const events = row.events
    .map((se) => se.event)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id))
    .map((e) => ({
      id: e.id,
      name: e.name,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      status: e.status,
    }));
  const prices = [...row.prices]
    .sort((a, b) =>
      a.level && b.level
        ? a.level.rank - b.level.rank
        : (a.tierName ?? '').toLowerCase().localeCompare((b.tierName ?? '').toLowerCase()),
    )
    .map((p) => ({
      levelId: p.levelId,
      levelName: p.level?.name ?? null,
      tierName: p.tierName,
      price: p.price.toFixed(2),
    }));
  return {
    id: row.id,
    name: row.name,
    sport: row.sport,
    team: row.team,
    locationId: row.locationId,
    venueName: row.location.name,
    timeZone: row.location.timeZone as UsTimeZone,
    layoutId: row.layoutId,
    layoutName: row.layout?.name ?? null,
    status: row.status,
    salesEndAt: row.salesEndAt,
    singleSalesOpenAt: row.singleSalesOpenAt,
    maxPassesPerCustomer: row.maxPassesPerCustomer,
    salesOpen: row.status === 'ON_SALE' && opts.now < row.salesEndAt,
    publishedAt: row.publishedAt,
    cancelledAt: row.cancelledAt,
    events,
    prices,
    passesSold: opts.admin ? opts.figures.passesSold : null,
    passRevenue: opts.admin ? opts.figures.passRevenue.toFixed(2) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Research R3: lists by the start of each Season's earliest event, then name; Seasons with no
 * events last, by name.
 */
export function bySeasonOrder(a: SeasonResponse, b: SeasonResponse): number {
  const first = (s: SeasonResponse): number | null =>
    s.events.length === 0 ? null : s.events[0].startsAt.getTime();
  const fa = first(a);
  const fb = first(b);
  if (fa !== fb) {
    if (fa === null) return 1;
    if (fb === null) return -1;
    return fa - fb;
  }
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/** The database's clock (R16). */
export async function databaseNow(db: Db): Promise<Date> {
  const [{ now }] = await db.$queryRaw<{ now: Date }[]>`SELECT now() AS "now"`;
  return now;
}

/** Each Season's figures (FR-020): active passes, and the total of its confirmed pass orders. */
export async function seasonFigures(
  db: Db,
  seasonIds: readonly string[],
): Promise<Map<string, SeasonFigures>> {
  const figures = new Map<string, SeasonFigures>(
    seasonIds.map((id) => [id, { passesSold: 0, passRevenue: new Prisma.Decimal(0) }]),
  );
  if (seasonIds.length === 0) return figures;
  const passes = await db.seasonPass.groupBy({
    by: ['seasonId'],
    where: { seasonId: { in: [...seasonIds] }, status: 'ACTIVE' },
    _count: { _all: true },
  });
  for (const p of passes) figures.get(p.seasonId)!.passesSold = p._count._all;
  const revenue = await db.$queryRaw<{ seasonId: string; total: Prisma.Decimal }[]>`
    SELECT sp."seasonId"::text AS "seasonId", SUM(o."totalPrice") AS "total"
    FROM "Order" o JOIN "SeasonPass" sp ON sp."id" = o."seasonPassId"
    WHERE o."status" = 'CONFIRMED' AND sp."seasonId" = ANY(${[...seasonIds]}::uuid[])
    GROUP BY sp."seasonId"`;
  for (const r of revenue) figures.get(r.seasonId)!.passRevenue = new Prisma.Decimal(r.total);
  return figures;
}

/** The Seasons matching `where`, as responses, in list order. */
export async function readSeasons(
  db: Db,
  where: Prisma.SeasonWhereInput,
  opts: { admin: boolean },
): Promise<SeasonResponse[]> {
  const rows = await db.season.findMany({ where, include: SEASON_INCLUDE });
  // One after the other: `db` may be an interactive transaction, which runs one query at a time.
  const figures = opts.admin
    ? await seasonFigures(
        db,
        rows.map((r) => r.id),
      )
    : new Map<string, SeasonFigures>();
  const now = await databaseNow(db);
  const none: SeasonFigures = { passesSold: 0, passRevenue: new Prisma.Decimal(0) };
  return rows
    .map((row) => toSeason(row, { admin: opts.admin, figures: figures.get(row.id) ?? none, now }))
    .sort(bySeasonOrder);
}
