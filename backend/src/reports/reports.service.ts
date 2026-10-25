import { Injectable } from '@nestjs/common';
import { Prisma, type EventStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface TierSalesResponse {
  tierId: string;
  name: string;
  price: string;
  quantity: number;
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
  revenue: string;
  tiers: TierSalesResponse[];
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
    const [events, sold, checked, revenue] = await Promise.all([
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
      const eventChecked = checkedBy.get(e.id) ?? 0;

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
        revenue: eventRevenue.toFixed(2),
        tiers: e.tiers.map((t) => ({
          tierId: t.id,
          name: t.name,
          price: t.price.toFixed(2),
          quantity: t.quantity,
          ticketsSold: soldBy.get(key(e.id, t.id)) ?? 0,
          revenue: (revenueBy.get(key(e.id, t.id)) ?? ZERO).toFixed(2),
        })),
      };
    });

    return {
      generatedAt: new Date(),
      totals: { ...totals, revenue: totalRevenue.toFixed(2) },
      events: rows,
    };
  }
}
