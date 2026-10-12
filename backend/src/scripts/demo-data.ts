import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import type { Principal } from '../auth/principal';
import { EventsService } from '../events/events.service';
import { LocationsService } from '../locations/locations.service';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { TiersService } from '../tiers/tiers.service';

/**
 * Demo data for local demonstrations (spec 005 FR-013, research R9).
 *
 *     docker compose exec backend node backend/dist/scripts/demo-data.js
 *
 * Goes through the real services, so every rule applies: capacity, tiers, no overselling. Never
 * run by `docker compose up` (Constitution VIII). Safe to run twice: it stops if the demo venue
 * already exists.
 */
export const DEMO_VENUE = 'QueuePass Demo Arena';

export interface DemoSummary {
  created: boolean;
  venues: number;
  events: number;
  orders: number;
  tickets: number;
  checkedIn: number;
  cancelled: string | null;
}

/** Stand-in buyer: demo orders are not tied to a real Keycloak sign-in (spec 005 Assumptions). */
const buyer = (n: number): Principal => ({
  sub: `demo-customer${n}`,
  username: `customer${n}`,
  roles: ['customer'],
});

/** Midnight UTC `days` from now, plus `hour` hours. */
function at(days: number, hour: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + days * 86_400_000 + hour * 3_600_000).toISOString();
}

export async function runDemoData(app: INestApplicationContext): Promise<DemoSummary> {
  const prisma = app.get(PrismaService);
  if (await prisma.location.findFirst({ where: { name: DEMO_VENUE } })) {
    return {
      created: false,
      venues: 0,
      events: 0,
      orders: 0,
      tickets: 0,
      checkedIn: 0,
      cancelled: null,
    };
  }

  const locations = app.get(LocationsService);
  const events = app.get(EventsService);
  const tiers = app.get(TiersService);
  const orders = app.get(OrdersService);

  const arena = await locations.create({
    name: DEMO_VENUE,
    street: '937 Phillips Ln',
    city: 'Louisville',
    state: 'KY',
    zip: '40209',
    seatingCapacity: 2000,
  });
  const hall = await locations.create({
    name: 'Demo Riverside Hall',
    street: '430 W Vine St',
    city: 'Lexington',
    state: 'KY',
    zip: '40507',
    seatingCapacity: 400,
  });

  const concert = await events.create({
    name: 'Fall Concert',
    locationId: arena.id,
    startsAt: at(14, 23),
    endsAt: at(15, 2),
    totalTicketCapacity: 500,
    basePrice: '45.00',
  });
  const general = await tiers.create(concert.id, {
    name: 'General',
    price: '45.00',
    quantity: 400,
  });
  const vip = await tiers.create(concert.id, { name: 'VIP', price: '120.00', quantity: 100 });

  const comedy = await events.create({
    name: 'Comedy Night',
    locationId: hall.id,
    startsAt: at(21, 24),
    endsAt: at(22, 2),
    totalTicketCapacity: 200,
    basePrice: '25.00',
  });

  const gala = await events.create({
    name: 'Holiday Gala',
    locationId: arena.id,
    startsAt: at(30, 23),
    endsAt: at(31, 3),
    totalTicketCapacity: 300,
    basePrice: '80.00',
  });
  const floor = await tiers.create(gala.id, { name: 'Floor', price: '80.00', quantity: 200 });
  await tiers.create(gala.id, { name: 'Balcony', price: '50.00', quantity: 100 });

  let orderCount = 0;
  const place = async (eventId: string, n: number, quantity: number, tierId?: string) => {
    await orders.create(eventId, { quantity, ...(tierId ? { tierId } : {}) }, buyer(n));
    orderCount += 1;
  };
  for (let n = 1; n <= 25; n++) {
    await place(concert.id, n, (n % 4) + 1, n % 5 === 0 ? vip.id : general.id);
    if (n % 2 === 0) await place(comedy.id, n, (n % 3) + 1);
    if (n % 3 === 0) await place(gala.id, n, 2, floor.id);
  }

  // No check-in operation exists until the Ticket Booth spec; mark the first 40% of the concert's
  // tickets as checked in directly so the reports have something to show (research R9).
  const concertTickets = await prisma.ticket.findMany({
    where: { eventId: concert.id },
    orderBy: { code: 'asc' },
    select: { id: true },
  });
  const toCheckIn = concertTickets.slice(0, Math.floor(concertTickets.length * 0.4));
  await prisma.ticket.updateMany({
    where: { id: { in: toCheckIn.map((t) => t.id) } },
    data: { checkedInAt: new Date() },
  });

  await events.cancel(gala.id);

  return {
    created: true,
    venues: 2,
    events: 3,
    orders: orderCount,
    tickets: await prisma.ticket.count({
      where: { eventId: { in: [concert.id, comedy.id, gala.id] } },
    }),
    checkedIn: toCheckIn.length,
    cancelled: gala.name,
  };
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const s = await runDemoData(app);
    console.log(
      s.created
        ? `Demo data created: ${s.venues} venues, ${s.events} events, ${s.orders} orders, ` +
            `${s.tickets} tickets (${s.checkedIn} checked in); "${s.cancelled}" cancelled.`
        : `Demo data already present ("${DEMO_VENUE}" exists); nothing changed.`,
    );
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
