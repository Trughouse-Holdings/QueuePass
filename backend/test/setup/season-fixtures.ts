import type { TestContext } from './test-app';
import {
  HOLDER,
  event,
  rowLabel,
  seatedEvent,
  seatedLayout,
  testTicketCode,
  tier,
  venue,
  windowAt,
  type InsertedLayout,
} from './fixtures';
import { subFor } from './tokens';

/**
 * Spec 041 (research R6, R14): the shared Season fixture for specs 041 and 042. It makes a venue,
 * three upcoming events on one layout (seated) or with one ticket type each (general admission), a
 * Season ON_SALE with its prices, and, unless `sold: false`, one pass sold to `customer1`: one
 * order per event with one ticket, the pass price split evenly by `startsAt` with the leftover
 * cents on the first event (R6). The Season, its prices and the pass are written straight to the
 * database, so neither spec's tests wait on the other's screens or checkout; the events go through
 * the API, as an admin makes them.
 */

export type SeasonKind = 'seated' | 'ga';

export interface SeasonFixtureOptions {
  kind?: SeasonKind;
  /** Write one sold pass (default `true` on sale, `false` for a draft, which can't have one). */
  sold?: boolean;
  /** The pass price of the fixture's level or ticket type name (default `100.00`, split 33.34/33.33/33.33). */
  passPrice?: string;
  /** When single tickets go on sale (a presale); default none. */
  singleSalesOpenAt?: Date | null;
  /** The Season's status (default `ON_SALE`). */
  status?: 'DRAFT' | 'ON_SALE';
}

export interface SeasonFixture {
  seasonId: string;
  venueId: string;
  /** The events by `startsAt`. */
  eventIds: string[];
  /** Seated only: the layout and its one level "Lower" with a pass price. */
  layout: InsertedLayout | null;
  /** General admission only: the priced ticket type name ("General") and each event's tier id. */
  tierName: string | null;
  tierIds: string[];
  /** The sold pass and its orders and tickets by event order; `null` with `sold: false`. */
  pass: {
    id: string;
    totalPrice: string;
    orders: { orderId: string; eventId: string; price: string; ticketId: string; code: string }[];
  } | null;
}

/** R6: the pass price split evenly over `n` events, leftover cents on the first. */
export function splitPassPrice(total: string, n: number): string[] {
  const cents = Math.round(Number(total) * 100);
  const each = Math.floor(cents / n);
  return Array.from({ length: n }, (_, i) =>
    ((i === 0 ? each + (cents - each * n) : each) / 100).toFixed(2),
  );
}

let seasons = 0;

export async function seasonWithSoldPass(
  ctx: TestContext,
  opts: SeasonFixtureOptions = {},
): Promise<SeasonFixture> {
  const kind = opts.kind ?? 'seated';
  const passPrice = opts.passPrice ?? '100.00';
  const status = opts.status ?? 'ON_SALE';
  const sold = opts.sold ?? status === 'ON_SALE';
  if (sold && status === 'DRAFT') throw new Error('seasonWithSoldPass: a draft has no passes');
  seasons += 1;
  const venueId = await venue(ctx, `Season Arena ${seasons}`);
  // Days far from the other fixtures' windows (a year plus a counter), a week apart.
  const windows = [0, 7, 14].map((d) => windowAt(900 + seasons * 30 + d, 19));

  let layout: InsertedLayout | null = null;
  const tierIds: string[] = [];
  const eventIds: string[] = [];
  if (kind === 'seated') {
    layout = await seatedLayout(
      ctx,
      venueId,
      [{ name: '101', rows: 3, seatsPerRow: 4 }],
      ['Lower'],
    );
    for (const [i, w] of windows.entries()) {
      const e = await seatedEvent(ctx, venueId, {
        layout,
        levels: [{ name: 'Lower', price: '40.00' }],
        name: `Season game ${i + 1}`,
        ...w,
      });
      eventIds.push(e.eventId);
    }
  } else {
    for (const [i, w] of windows.entries()) {
      const id = await event(ctx, venueId, { name: `Season show ${i + 1}`, capacity: 50, ...w });
      eventIds.push(id);
      tierIds.push(await tier(ctx, id, 'General', '40.00', 50));
    }
  }

  const season = await ctx.prisma.season.create({
    data: {
      name: `Fixture Season ${seasons}`,
      sport: kind === 'seated' ? 'BASKETBALL' : null,
      team: kind === 'seated' ? 'Fixture Cardinals' : null,
      locationId: venueId,
      layoutId: layout?.id ?? null,
      status,
      salesEndAt: new Date(windows[0].startsAt),
      singleSalesOpenAt: opts.singleSalesOpenAt ?? null,
      publishedAt: status === 'ON_SALE' ? new Date() : null,
      events: { create: eventIds.map((eventId) => ({ eventId })) },
      prices: {
        create: [
          layout
            ? { levelId: layout.levels.Lower, price: passPrice }
            : { tierName: 'General', price: passPrice },
        ],
      },
    },
  });

  let pass: SeasonFixture['pass'] = null;
  if (sold) {
    const shares = splitPassPrice(passPrice, eventIds.length);
    const created = await ctx.prisma.seasonPass.create({
      data: {
        seasonId: season.id,
        customerSub: subFor('customer1'),
        customerUsername: 'customer1',
        holderName: HOLDER,
        seatId: layout ? layout.seat('101', 1, 1) : null,
        seatSection: layout ? '101' : null,
        seatRowLabel: layout ? rowLabel(1) : null,
        seatLabel: layout ? '1' : null,
        levelId: layout ? layout.levels.Lower : null,
        tierName: layout ? null : 'General',
        totalPrice: passPrice,
      },
    });
    const orders: NonNullable<SeasonFixture['pass']>['orders'] = [];
    for (const [i, eventId] of eventIds.entries()) {
      const price = shares[i];
      const order = await ctx.prisma.order.create({
        data: {
          eventId,
          seasonPassId: created.id,
          tierId: layout ? null : tierIds[i],
          customerSub: subFor('customer1'),
          customerUsername: 'customer1',
          quantity: 1,
          unitPrice: price,
          totalPrice: price,
          holderName: HOLDER,
          tickets: {
            create: [
              layout
                ? {
                    eventId,
                    code: testTicketCode(),
                    price,
                    levelName: 'Lower',
                    seatId: layout.seat('101', 1, 1),
                    seatSection: '101',
                    seatRow: 1,
                    seatNumber: 1,
                    seatRowLabel: rowLabel(1),
                    seatLabel: '1',
                  }
                : { eventId, tierId: tierIds[i], code: testTicketCode(), price },
            ],
          },
        },
        include: { tickets: true },
      });
      orders.push({
        orderId: order.id,
        eventId,
        price,
        ticketId: order.tickets[0].id,
        code: order.tickets[0].code,
      });
    }
    pass = { id: created.id, totalPrice: passPrice, orders };
  }

  return {
    seasonId: season.id,
    venueId,
    eventIds,
    layout,
    tierName: layout ? null : 'General',
    tierIds,
    pass,
  };
}
