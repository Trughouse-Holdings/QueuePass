import { Injectable } from '@nestjs/common';
import { Prisma, type EventStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SEAT_LEVEL_SQL } from '../seating/seat-levels';

interface TierSalesResponse {
  tierId: string;
  name: string;
  price: string;
  quantity: number;
  ticketsSold: number;
  revenue: string;
}

/** Spec 038 research R17: contracts/openapi.yaml `LevelSales`. */
interface LevelSalesResponse {
  /** `null` for a name sold that no current level of the event's layout has. */
  levelId: string | null;
  name: string;
  price: string | null;
  seatsOnSale: number;
  ticketsSold: number;
  revenue: string;
}

interface EventSalesResponse {
  eventId: string;
  name: string;
  venueName: string;
  startsAt: Date;
  timeZone: string;
  status: EventStatus;
  ticketCapacity: number;
  ticketsSold: number;
  checkedIn: number;
  /** Spec 032 FR-009: when the event's check-in details were removed, or `null`. */
  checkInDetailsRemovedAt: Date | null;
  revenue: string;
  tiers: TierSalesResponse[];
  /** Spec 038 research R17: a seated event's sales by price level; empty for general admission. */
  levels: LevelSalesResponse[];
}

/** API shape: contracts/openapi.yaml `SalesReport`. */
export interface SalesReportResponse {
  generatedAt: Date;
  totals: {
    events: number;
    ticketCapacity: number;
    ticketsSold: number;
    checkedIn: number;
    revenue: string;
  };
  events: EventSalesResponse[];
}

const ZERO = new Prisma.Decimal(0);
/** Event-level keys use '' for "no tier", so tierless and tiered rows can share one map. */
const key = (eventId: string, tierId: string | null) => `${eventId}/${tierId ?? ''}`;

/**
 * The sales report (spec 005 US2, research R6). Computed on every request from three grouped
 * queries, so it is never stale. Only valid tickets and confirmed orders count: a refund removes
 * its tickets and money from every figure.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async sales(): Promise<SalesReportResponse> {
    const [events, sold, checked, revenue, levels] = await Promise.all([
      this.prisma.event.findMany({
        include: { location: true, tiers: { orderBy: [{ price: 'asc' }, { name: 'asc' }] } },
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.ticket.groupBy({
        by: ['eventId', 'tierId'],
        where: { status: 'VALID' },
        _count: { _all: true },
      }),
      this.prisma.ticket.groupBy({
        by: ['eventId'],
        where: { status: 'VALID', checkedInAt: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.order.groupBy({
        by: ['eventId', 'tierId'],
        where: { status: 'CONFIRMED' },
        _sum: { totalPrice: true },
      }),
      this.levelSales(),
    ]);

    const soldBy = new Map(sold.map((r) => [key(r.eventId, r.tierId), r._count._all]));
    const checkedBy = new Map(checked.map((r) => [r.eventId, r._count._all]));
    const revenueBy = new Map(
      revenue.map((r) => [key(r.eventId, r.tierId), r._sum.totalPrice ?? ZERO]),
    );

    const sumFor = <T>(map: Map<string, T>, eventId: string, add: (a: T, b: T) => T, zero: T): T =>
      [...map.entries()]
        .filter(([k]) => k.startsWith(`${eventId}/`))
        .reduce((acc, [, v]) => add(acc, v), zero);

    let totalRevenue = ZERO;
    const totals = { events: 0, ticketCapacity: 0, ticketsSold: 0, checkedIn: 0 };

    const rows = events.map((e): EventSalesResponse => {
      const eventSold = sumFor(soldBy, e.id, (a, b) => a + b, 0);
      const eventRevenue = sumFor(revenueBy, e.id, (a, b) => a.add(b), ZERO);
      // Spec 032 FR-009 (research R4): 0 when cancelled (its tickets are void), else the count kept
      // at the removal once the details are gone, else the live count.
      const eventChecked =
        e.status === 'CANCELLED'
          ? 0
          : e.checkInDetailsRemovedAt !== null
            ? (e.keptCheckedInCount ?? 0)
            : (checkedBy.get(e.id) ?? 0);

      if (e.status === 'SCHEDULED') {
        totals.events += 1;
        totals.ticketCapacity += e.totalTicketCapacity;
      }
      totals.ticketsSold += eventSold;
      totals.checkedIn += eventChecked;
      totalRevenue = totalRevenue.add(eventRevenue);

      return {
        eventId: e.id,
        name: e.name,
        venueName: e.location.name,
        startsAt: e.startsAt,
        // Spec 020 FR-022 (research R16): the event's date is shown in its venue's zone.
        timeZone: e.location.timeZone,
        status: e.status,
        ticketCapacity: e.totalTicketCapacity,
        ticketsSold: eventSold,
        checkedIn: eventChecked,
        checkInDetailsRemovedAt: e.checkInDetailsRemovedAt,
        revenue: eventRevenue.toFixed(2),
        tiers: e.tiers.map((t) => ({
          tierId: t.id,
          name: t.name,
          price: t.price.toFixed(2),
          quantity: t.quantity,
          ticketsSold: soldBy.get(key(e.id, t.id)) ?? 0,
          revenue: (revenueBy.get(key(e.id, t.id)) ?? ZERO).toFixed(2),
        })),
        levels: levels.get(e.id) ?? [],
      };
    });

    return {
      generatedAt: new Date(),
      totals: { ...totals, revenue: totalRevenue.toFixed(2) },
      events: rows,
    };
  }

  /**
   * Spec 038 research R17: each seated event's levels. Its layout's current levels in rank order,
   * each with the event's price (`null` when unpriced) and its seats not off sale (a seat's level
   * resolved as R1 says); tickets sold and revenue are its VALID tickets grouped by `levelName` as
   * sold, matched to a current level by name. A name sold that no current level has (a level
   * renamed or removed, or a carried-over ticket type's name, R16) follows, by name, with no id,
   * price or seats. Two statements for every event.
   */
  private async levelSales(): Promise<Map<string, LevelSalesResponse[]>> {
    const [current, sold] = await Promise.all([
      this.prisma.$queryRaw<
        {
          eventId: string;
          levelId: string;
          name: string;
          price: Prisma.Decimal | null;
          seatsOnSale: number;
        }[]
      >`
        SELECT e."id"::text AS "eventId", pl."id"::text AS "levelId", pl."name", p."price",
               (SELECT count(*)::int
                FROM "Section" sec
                JOIN "Seat" s ON s."sectionId" = sec."id"
                JOIN "SeatRow" r ON r."id" = s."rowId"
                WHERE sec."layoutId" = e."layoutId" AND ${SEAT_LEVEL_SQL} = pl."id"
                  AND NOT EXISTS (SELECT 1 FROM "EventOffSaleSeat" o
                                  WHERE o."eventId" = e."id" AND o."seatId" = s."id")
               ) AS "seatsOnSale"
        FROM "Event" e
        JOIN "PriceLevel" pl ON pl."layoutId" = e."layoutId"
        LEFT JOIN "EventLevelPrice" p ON p."eventId" = e."id" AND p."levelId" = pl."id"
        WHERE e."layoutId" IS NOT NULL
        ORDER BY e."id", pl."rank"`,
      this.prisma.ticket.groupBy({
        by: ['eventId', 'levelName'],
        where: { status: 'VALID', levelName: { not: null } },
        _count: { _all: true },
        _sum: { price: true },
        orderBy: [{ eventId: 'asc' }, { levelName: 'asc' }],
      }),
    ]);

    const soldBy = new Map(
      sold.map((g) => [
        `${g.eventId}/${g.levelName}`,
        { count: g._count._all, revenue: g._sum.price ?? ZERO },
      ]),
    );
    const out = new Map<string, LevelSalesResponse[]>();
    const listFor = (eventId: string) => {
      let list = out.get(eventId);
      if (!list) out.set(eventId, (list = []));
      return list;
    };
    const matched = new Set<string>();
    for (const l of current) {
      const k = `${l.eventId}/${l.name}`;
      const s = soldBy.get(k);
      if (s) matched.add(k);
      listFor(l.eventId).push({
        levelId: l.levelId,
        name: l.name,
        price: l.price === null ? null : new Prisma.Decimal(l.price).toFixed(2),
        seatsOnSale: l.seatsOnSale,
        ticketsSold: s?.count ?? 0,
        revenue: (s?.revenue ?? ZERO).toFixed(2),
      });
    }
    for (const g of sold) {
      const k = `${g.eventId}/${g.levelName}`;
      // Only a seated event (one with current levels) lists levels; general admission has none.
      if (matched.has(k) || !out.has(g.eventId)) continue;
      listFor(g.eventId).push({
        levelId: null,
        name: g.levelName as string,
        price: null,
        seatsOnSale: 0,
        ticketsSold: g._count._all,
        revenue: (g._sum.price ?? ZERO).toFixed(2),
      });
    }
    return out;
  }
}
