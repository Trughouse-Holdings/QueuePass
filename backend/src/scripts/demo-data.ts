import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  localDate,
  resolveLocal,
  toOffsetDateTime,
  type LayoutDetail,
  type OffSaleSelector,
  type SeatChoice,
  type UsTimeZone,
} from '@queuepass/shared';
import { AppModule } from '../app.module';
import type { Principal } from '../auth/principal';
import { EventImagesService } from '../events/event-images.service';
import { EventsService } from '../events/events.service';
import { LayoutsService } from '../layouts/layouts.service';
import { LocationsService } from '../locations/locations.service';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationsService } from '../reservations/reservations.service';
import { TiersService } from '../tiers/tiers.service';
import { demoPng, type Rgb } from './demo-images';
// Spec 038 research R18: the generator's files (T045), as JSON modules, so the build copies them.
import basketball from './layouts/yum-center-basketball.json';
import centerStage from './layouts/yum-center-center-stage.json';
import endStage from './layouts/yum-center-end-stage.json';
import wrestling from './layouts/yum-center-wrestling.json';

/**
 * Demo data for local demonstrations (spec 005 FR-013, research R9).
 *
 *     docker compose exec backend node backend/dist/scripts/demo-data.js
 *
 * Goes through the real services, so every rule applies: capacity, tiers, no overselling. Never
 * run by `docker compose up` (Constitution VIII). Safe to run twice: it stops if the demo venue
 * already exists.
 *
 * Spec 013 research R14: the venues have real addresses the address service matches. So a demo
 * still works offline, this script alone saves them not verified when the service is unavailable,
 * through an internal option of LocationsService.create that no request can reach. The Hall is
 * created before the Arena (the "already run" marker), so a failed run can be run again.
 *
 * Spec 038 (FR-033, research R18): the KFC Yum! Center, with its four layouts imported from the
 * committed files and its four events, is made after the Hall and before the Arena, for the same
 * reason. Its seats are sold as a customer buys them: a hold, then an order.
 */
export const DEMO_VENUE = 'QueuePass Demo Arena';
/** Spec 038 research R18: the venue of the demo's seated events. */
export const SEATED_VENUE = 'KFC Yum! Center';

export interface DemoSummary {
  created: boolean;
  venues: number;
  events: number;
  orders: number;
  tickets: number;
  checkedIn: number;
  cancelled: string | null;
  /** Spec 029 FR-007 (research R5): the event that is over, "Season Opener". */
  past: string | null;
  /** Spec 013: demo venues saved not verified because the address service was unavailable. */
  unverifiedVenues: number;
  /** Spec 014: generated images added to the demo events. */
  images: number;
  /** Spec 038 (T047): the Yum! Center's layouts, in the order imported. */
  layouts: { name: string; seats: number }[];
}

/** Spec 014 research R15: color pairs for the generated pictures, one picture each. */
const CONCERT_COLORS: [Rgb, Rgb][] = [
  [
    [32, 64, 160],
    [240, 176, 48],
  ],
  [
    [144, 32, 80],
    [32, 160, 144],
  ],
  [
    [24, 96, 48],
    [224, 224, 208],
  ],
];
const COMEDY_COLORS: [Rgb, Rgb] = [
  [96, 48, 160],
  [248, 120, 88],
];

/**
 * Spec 017 FR-006 (research R13): a fixed list of 20 sample names, one per demo customer, keyed
 * by the customer's number, so every demo order carries a holder's name.
 */
const HOLDER_NAMES = [
  'Jordan Lee',
  'Maya Alvarez',
  'Samir Haddad',
  'Grace Chen',
  'Tomás Rivera',
  'Aisha Okafor',
  'Liam O’Connell',
  'Priya Nair',
  'Noah Kim',
  'Fatima Zahra',
  'Ethan Brooks',
  'Yuki Tanaka',
  'Olivia Novak',
  'Mateo Rossi',
  'Hannah Weiss',
  'Dmitri Volkov',
  'Zoe Papadopoulos',
  'Kwame Mensah',
  'Ingrid Larsen',
  'Ravi Patel',
] as const;

/** The demo holder's name for customer `n` (research R13). */
const holderFor = (n: number): string => HOLDER_NAMES[(n - 1) % HOLDER_NAMES.length];

/** Stand-in buyer: demo orders are not tied to a real Keycloak sign-in (spec 005 Assumptions). */
const buyer = (n: number): Principal => ({
  sub: `demo-customer${n}`,
  username: `customer${n}`,
  roles: ['customer'],
  // No token: these orders are placed directly, and no seat stream is opened for them.
  expiresAt: 0,
});

/**
 * Spec 020 research R19: the venue's local date `days` from today there, at the local `time`
 * (`HH:mm`). On a fall-back night the first of a repeated time is taken, on a spring-forward
 * night the next hour, so the script never fails on a daylight-saving date.
 */
function atLocal(days: number, time: string, zone: UsTimeZone): Date {
  const [y, m, d] = localDate(new Date(), zone).split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  const r = resolveLocal(`${day}T${time}`, zone);
  if (r.kind === 'ok') return r.moment.instant;
  if (r.kind === 'repeated') return r.first.instant;
  const [hh, mm] = time.split(':').map(Number);
  return atLocal(days, `${String(hh + 1).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, zone);
}

const HOUR = 3_600_000;

/** Seats `count` seats of a row from seat `first` on: `[section, row label, first, count]`. */
type Sale = [section: string, row: string, first: number, count: number];

/**
 * Spec 038 research R18's demo events table: the layout, prices by level name (a level left out
 * has none), the seats off sale (whole sections, or only the rows labelled `rows` of them), and
 * the seats sold, about 40, in orders of 2 to 6 seats across the levels. Upcoming, at round local
 * times, as days from the run.
 */
interface SeatedDemo {
  name: string;
  layout: string;
  days: number;
  time: string;
  prices: Record<string, string>;
  offSale?: { sections: string[]; rows?: string[] };
  sales: Sale[];
}

const sectionRange = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

/** R18: the four layout files, in the order imported. */
const YUM_LAYOUTS: Record<string, unknown>[] = [basketball, endStage, centerStage, wrestling];

const SEATED_EVENTS: SeatedDemo[] = [
  {
    name: 'Cardinals Women vs. Duke',
    layout: 'Basketball',
    days: 9,
    time: '19:00',
    // The upper level off sale, with no price.
    prices: { Courtside: '95.00', 'Lower sideline': '60.00', 'Lower end': '35.00' },
    offSale: { sections: sectionRange(301, 330) },
    sales: [
      ['105', 'D', 5, 4],
      ['106', 'E', 8, 2],
      ['115', 'F', 3, 6],
      ['107', 'K', 9, 4],
      ['114', 'P', 1, 3],
      ['210', 'C', 15, 5],
      ['101', 'J', 2, 4],
      ['110', 'M', 6, 2],
      ['119', 'H', 1, 6],
      ['111', 'S', 4, 4],
    ],
  },
  {
    name: 'Cardinals Men vs. Kentucky',
    layout: 'Basketball',
    days: 16,
    time: '19:00',
    prices: {
      Courtside: '150.00',
      'Lower sideline': '90.00',
      'Lower end': '55.00',
      Upper: '25.00',
    },
    sales: [
      ['104', 'D', 3, 4],
      ['116', 'G', 5, 2],
      ['108', 'L', 1, 6],
      ['113', 'T', 7, 4],
      ['211', 'A', 10, 3],
      ['102', 'N', 2, 5],
      ['120', 'F', 1, 4],
      ['305', 'B', 6, 2],
      ['316', 'H', 4, 6],
      ['327', 'R', 8, 4],
    ],
  },
  {
    name: 'Arena Tour: Live',
    layout: 'End-stage concert',
    days: 23,
    time: '20:00',
    // The seats behind the stage are not in this layout, so nothing more is off sale.
    prices: { Floor: '120.00', Lower: '75.00', Upper: '40.00' },
    sales: [
      ['Floor 1', '1', 3, 4],
      ['Floor 3', '5', 1, 2],
      ['Floor 5', '2', 3, 6],
      ['106', 'E', 4, 4],
      ['112', 'J', 1, 3],
      ['117', 'Q', 6, 5],
      ['210', 'B', 12, 4],
      ['310', 'C', 3, 2],
      ['315', 'K', 7, 6],
      ['322', 'P', 1, 4],
    ],
  },
  {
    name: 'WWE Saturday Night',
    layout: 'Wrestling (ring)',
    days: 26,
    time: '19:30',
    prices: { Floor: '110.00', Lower: '65.00', Upper: '30.00' },
    // The back rows of some upper sections.
    offSale: {
      sections: [...sectionRange(305, 310), ...sectionRange(320, 325)],
      rows: ['S', 'T', 'U', 'V', 'W'],
    },
    sales: [
      ['Floor 1', '1', 5, 4],
      ['Floor 2', '3', 2, 2],
      ['Floor 3', '1', 1, 6],
      ['105', 'D', 2, 4],
      ['109', 'H', 1, 3],
      ['114', 'L', 4, 5],
      ['211', 'D', 8, 4],
      ['307', 'A', 3, 2],
      ['313', 'S', 1, 6],
      ['322', 'F', 5, 4],
    ],
  },
];

/**
 * Spec 020 research R9, R19: every demo time is sent in the venue's offset, never
 * `toISOString()` (a `Z`, which the Backend refuses). An instant has exactly one offset in a zone.
 */
const timesAt = (start: Date | number, hours: number, zone: UsTimeZone) => ({
  startsAt: toOffsetDateTime(start, zone),
  endsAt: toOffsetDateTime(new Date(start).getTime() + hours * HOUR, zone),
});

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
      past: null,
      unverifiedVenues: 0,
      images: 0,
      layouts: [],
    };
  }

  const locations = app.get(LocationsService);
  const events = app.get(EventsService);
  const tiers = app.get(TiersService);
  const orders = app.get(OrdersService);
  const images = app.get(EventImagesService);
  const layouts = app.get(LayoutsService);
  const reservations = app.get(ReservationsService);

  // Spec 020 research R19: offline, a Kentucky venue gets the default zone instead of a refusal.
  const offline = {
    whenServiceUnavailable: 'saveUnverified',
    fallbackToDefaultTimeZone: true,
  } as const;
  const hall = await locations.create(
    {
      name: 'Demo Riverside Hall',
      street: '430 W Vine St',
      city: 'Lexington',
      state: 'KY',
      zip: '40507',
      seatingCapacity: 400,
    },
    offline,
  );
  const yum = await locations.create(
    {
      name: SEATED_VENUE,
      street: '1 Arena Plaza',
      city: 'Louisville',
      state: 'KY',
      zip: '40202',
      // Its largest layout's seats; each import sets it again (spec 038 FR-009).
      seatingCapacity: 22_090,
    },
    offline,
  );
  const seated = await createSeatedDemo(yum.id, yum.timeZone as UsTimeZone, {
    layouts,
    events,
    reservations,
    orders,
  });
  const arena = await locations.create(
    {
      name: DEMO_VENUE,
      street: '937 Phillips Ln',
      city: 'Louisville',
      state: 'KY',
      zip: '40209',
      seatingCapacity: 2000,
    },
    offline,
  );

  const hallZone = hall.timeZone as UsTimeZone;
  const arenaZone = arena.timeZone as UsTimeZone;

  const concert = await events.create({
    name: 'Fall Concert',
    locationId: arena.id,
    // 7:00 PM to 10:00 PM at the venue, whatever the season (R19).
    ...timesAt(atLocal(14, '19:00', arenaZone), 3, arenaZone),
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
    // 8:00 PM to 11:00 PM at the venue.
    ...timesAt(atLocal(21, '20:00', hallZone), 3, hallZone),
    totalTicketCapacity: 200,
    // Spec 016 research R10: a per-customer limit to show live; every demo order fits under it.
    maxTicketsPerCustomer: 4,
    basePrice: '25.00',
  });

  // Spec 017 FR-006 (research R13): an event whose entry window is open the moment the demo data
  // loads — starts 1 hour after the run, ends 4 hours after. The Hall's other event (Comedy
  // Night) is weeks away, far past spec 002's 60-minute buffer.
  const tonight = await events.create({
    name: 'Demo Tonight',
    locationId: hall.id,
    // An instant, not a local time (spec 017 research R13), in the venue's offset (R19).
    // On the whole minute (review round 2, m1): an edit form shows minutes only.
    ...timesAt(Math.floor(Date.now() / 60_000) * 60_000 + HOUR, 3, hallZone),
    totalTicketCapacity: 100,
    basePrice: '20.00',
  });

  const gala = await events.create({
    name: 'Holiday Gala',
    locationId: arena.id,
    // 7:00 PM to 10:00 PM at the venue.
    ...timesAt(atLocal(30, '19:00', arenaZone), 3, arenaZone),
    totalTicketCapacity: 300,
    basePrice: '80.00',
  });
  const floor = await tiers.create(gala.id, { name: 'Floor', price: '80.00', quantity: 200 });
  await tiers.create(gala.id, { name: 'Balcony', price: '50.00', quantity: 100 });

  // Spec 029 FR-007 (research R5): an event that is over, so the apps show one; 7 days before the
  // run at 7:00 PM to 10:00 PM at the Hall. Sales closed at its end (034); the demo places no
  // order for it.
  const past = await events.create({
    name: 'Season Opener',
    locationId: hall.id,
    ...timesAt(atLocal(-7, '19:00', hallZone), 3, hallZone),
    totalTicketCapacity: 150,
    basePrice: '30.00',
  });

  // Spec 014 FR-034 (research R15): through the image rules, like an upload. Several pictures on
  // the concert, so it rotates; one on the comedy night; none on the gala, which looks as before.
  let imageCount = 0;
  const addImage = async (eventId: string, colors: readonly [Rgb, Rgb]) => {
    const buffer = demoPng(960, 540, colors);
    await images.add(eventId, { buffer, size: buffer.length });
    imageCount += 1;
  };
  for (const colors of CONCERT_COLORS) await addImage(concert.id, colors);
  await addImage(comedy.id, COMEDY_COLORS);

  let orderCount = 0;
  const place = async (eventId: string, n: number, quantity: number, tierId?: string) => {
    await orders.create(
      eventId,
      { quantity, holderName: holderFor(n), ...(tierId ? { tierId } : {}) },
      buyer(n),
    );
    orderCount += 1;
  };
  for (let n = 1; n <= 25; n++) {
    await place(concert.id, n, (n % 4) + 1, n % 5 === 0 ? vip.id : general.id);
    if (n % 2 === 0) await place(comedy.id, n, (n % 3) + 1);
    if (n % 3 === 0) await place(gala.id, n, 2, floor.id);
  }
  // Spec 017 research R13: named orders with unused tickets on the open event, including one
  // order of 4 for Admit all 4. Nothing checks these in: the gate demo does.
  await place(tonight.id, 1, 4);
  for (let n = 2; n <= 8; n++) await place(tonight.id, n, (n % 3) + 1);

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
    // Spec 017 research R13: demo entries record an agent, like real ones (ticket_entry_agent).
    data: { checkedInAt: new Date(), checkedInBySub: 'demo-agent1', checkedInByUsername: 'agent1' },
  });

  await events.cancel(gala.id);

  return {
    created: true,
    venues: 3,
    events: 5 + seated.eventIds.length,
    orders: orderCount + seated.orders,
    tickets: await prisma.ticket.count({
      where: {
        eventId: { in: [concert.id, comedy.id, tonight.id, gala.id, ...seated.eventIds] },
      },
    }),
    checkedIn: toCheckIn.length,
    cancelled: gala.name,
    past: past.name,
    unverifiedVenues: [hall, yum, arena].filter((v) => !v.addressVerified).length,
    images: imageCount,
    layouts: seated.layouts,
  };
}

/**
 * Spec 038 (FR-033, research R18; T047): the Yum! Center's four layouts through the import, its
 * four events through `EventsService` with their layout, level prices and seats off sale, then
 * each sale as a customer makes it: a hold of the seats, then an order for them. Every hold ends
 * with its order, so no seat is left held (a hold lasts 5 minutes; the demo shows one live).
 */
async function createSeatedDemo(
  locationId: string,
  zone: UsTimeZone,
  services: {
    layouts: LayoutsService;
    events: EventsService;
    reservations: ReservationsService;
    orders: OrdersService;
  },
): Promise<{ layouts: { name: string; seats: number }[]; eventIds: string[]; orders: number }> {
  const imported = new Map<string, LayoutDetail>();
  for (const file of YUM_LAYOUTS) {
    const layout = await services.layouts.importFile(locationId, { file });
    imported.set(layout.name, layout);
  }

  // Each section's rows by label, with their seat numbers by label, read once when needed.
  const rowsOf = new Map<string, Map<string, { number: number; seats: Map<string, number> }>>();
  const rows = async (layout: LayoutDetail, section: string) => {
    const sectionId = sectionIdOf(layout, section);
    let found = rowsOf.get(sectionId);
    if (!found) {
      const read = await services.layouts.section(layout.id, sectionId);
      found = new Map(
        read.rows.map((r) => [
          r.label,
          { number: r.number, seats: new Map(r.seats.map((s) => [s.label, s.number])) },
        ]),
      );
      rowsOf.set(sectionId, found);
    }
    return { sectionId, rows: found };
  };
  const rowOf = async (layout: LayoutDetail, section: string, label: string) => {
    const { sectionId, rows: byLabel } = await rows(layout, section);
    const row = byLabel.get(label);
    if (!row) throw new Error(`${layout.name} has no row ${label} in section ${section}.`);
    return { sectionId, row };
  };

  const eventIds: string[] = [];
  let orderCount = 0;
  let customer = 0;
  for (const demo of SEATED_EVENTS) {
    const layout = imported.get(demo.layout);
    if (!layout) throw new Error(`The demo layout "${demo.layout}" was not imported.`);
    const levelPrices = Object.entries(demo.prices).map(([name, price]) => {
      const level = layout.levels.find((l) => l.name === name);
      if (!level) throw new Error(`${layout.name} has no level "${name}".`);
      return { levelId: level.id, price };
    });
    const offSale: OffSaleSelector[] = [];
    for (const section of demo.offSale?.sections ?? []) {
      if (!demo.offSale?.rows) {
        offSale.push({ sectionId: sectionIdOf(layout, section) });
        continue;
      }
      for (const label of demo.offSale.rows) {
        const { sectionId, row } = await rowOf(layout, section, label);
        offSale.push({ sectionId, row: row.number });
      }
    }
    const lowest = Object.values(demo.prices).reduce((a, b) => (Number(b) < Number(a) ? b : a));
    const event = await services.events.create({
      name: demo.name,
      locationId,
      ...timesAt(atLocal(demo.days, demo.time, zone), 3, zone),
      // R9: a seated event's base price is its lowest level price, set by the Backend.
      basePrice: lowest,
      layoutId: layout.id,
      levelPrices,
      ...(offSale.length > 0 ? { offSale } : {}),
    });
    eventIds.push(event.id);

    for (const [section, label, first, count] of demo.sales) {
      const { sectionId, row } = await rowOf(layout, section, label);
      const seats: SeatChoice[] = [];
      for (let i = 0; i < count; i++) {
        const seat = row.seats.get(String(first + i));
        if (seat === undefined) {
          throw new Error(`${layout.name} has no seat ${first + i} in ${section}, row ${label}.`);
        }
        seats.push({ sectionId, row: row.number, seat });
      }
      customer = (customer % HOLDER_NAMES.length) + 1;
      const who = buyer(customer);
      await services.reservations.reserve(who, event.id, { seats });
      await services.orders.create(
        event.id,
        { quantity: seats.length, holderName: holderFor(customer), seats },
        who,
      );
      orderCount += 1;
    }
  }
  return {
    layouts: [...imported.values()].map((l) => ({ name: l.name, seats: l.seatCount })),
    eventIds,
    orders: orderCount,
  };
}

function sectionIdOf(layout: LayoutDetail, name: string): string {
  const section = layout.sections.find((s) => s.name === name);
  if (!section) throw new Error(`${layout.name} has no section ${name}.`);
  return section.id;
}

/** Spec 038 (T047): the Yum! Center's layouts and their seats, as the reset prints them. */
export function layoutsLine(layouts: DemoSummary['layouts']): string {
  const each = layouts.map((l) => `${l.name}, ${l.seats.toLocaleString('en-US')} seats`);
  return `${SEATED_VENUE} layouts: ${each.join('; ')}.`;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const s = await runDemoData(app);
    console.log(
      s.created
        ? `Demo data created: ${s.venues} venues, ${s.layouts.length} layouts, ${s.events} ` +
            `events, ${s.orders} orders, ${s.tickets} tickets (${s.checkedIn} checked in), ` +
            `${s.images} images; "${s.cancelled}" cancelled; "${s.past}" over.\n` +
            layoutsLine(s.layouts)
        : `Demo data already present ("${DEMO_VENUE}" exists); nothing changed.`,
    );
    if (s.unverifiedVenues > 0) {
      console.log(
        'The address service was unavailable, so the demo venues were saved with their ' +
          'addresses not verified.',
      );
    }
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
