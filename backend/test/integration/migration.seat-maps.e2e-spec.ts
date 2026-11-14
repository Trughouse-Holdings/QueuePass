import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { LEVEL_COLORS } from '@queuepass/shared';
import { gridLayout, seatPlace } from '../../src/layouts/layout-lines';

/**
 * Spec 038 FR-031, FR-032, SC-006, research R16 (T003): on a database migrated up to the migration
 * before `seat_maps`, venues, sections, events, ticket types, section mappings, orders, tickets,
 * reservations and holds as they are before the feature; then the migration. Every venue with
 * sections gets a "Standard" layout with its sections' ids, a level per section, and rows and seats
 * on the R6 grid; every seated event is priced as it sold, its unmapped sections off sale; every
 * ticket keeps its seat, labels, price and status. Then the new database rules refuse what they
 * must (FR-025, R10).
 */
const PRISMA_DIR = path.resolve(__dirname, '../../prisma');
const NEW_MIGRATION = readdirSync(path.join(PRISMA_DIR, 'migrations')).find((d) =>
  d.endsWith('_seat_maps'),
);

function deploy(schemaDir: string, url: string): void {
  execFileSync(
    'npx',
    ['prisma', 'migrate', 'deploy', '--schema', path.join(schemaDir, 'schema.prisma')],
    {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      shell: process.platform === 'win32',
    },
  );
}

const id = () => randomUUID();

describe('migration seat_maps (R16)', () => {
  const dbName = `migration_seat_maps_${randomUUID().slice(0, 8)}`;
  const admin = new PrismaClient();
  let url: string;
  let db: PrismaClient;
  let work: string;

  /** Arena: three sections; Empty Hall: none; Big: two sections of 100 × 200 (40,000 seats). */
  const venues = { arena: id(), empty: id(), big: id() };
  const sections = {
    floor: { id: id(), name: 'Floor', rows: 2, seatsPerRow: 3, position: 0 },
    lower: { id: id(), name: 'Lower', rows: 3, seatsPerRow: 4, position: 1 },
    upper: { id: id(), name: 'Upper', rows: 2, seatsPerRow: 5, position: 2 },
  };
  const bigSections = [
    { id: id(), name: 'North', rows: 100, seatsPerRow: 200, position: 0 },
    { id: id(), name: 'South', rows: 100, seatsPerRow: 200, position: 1 },
  ];
  const events = {
    /** Seated, two types mapping Floor and Lower, Upper unmapped; tickets and holds. */
    typed: id(),
    /** Seated, no types. */
    untyped: id(),
    /** Seated, a type, nothing mapped. */
    unmapped: id(),
    /** General admission with a type and a sale. */
    ga: id(),
    /** Cancelled, reservedSeating on, at a venue with no sections. */
    cancelled: id(),
    /** Seated at the 40,000-seat venue. */
    big: id(),
  };
  const tiers = { premium: id(), standard: id(), unmappedType: id(), gaType: id() };
  const orders = { premium: id(), standard: id(), refunded: id(), untyped: id(), ga: id() };
  const reservations = { live: id(), ended: id() };
  const holds = { live: id(), ended: id(), gone: id() };

  let codeSeq = 0;
  const code = () => `TKT${String.fromCharCode(65 + codeSeq++).repeat(9)}`;

  const sql = (text: string) => db.$executeRawUnsafe(text);

  async function insertEvent(
    eventId: string,
    venueId: string,
    day: number,
    opts: {
      seated: boolean;
      capacity: number;
      basePrice: string;
      max?: number;
      status?: 'SCHEDULED' | 'CANCELLED';
    },
  ): Promise<void> {
    const starts = `'2027-03-${String(day).padStart(2, '0')} 20:00:00+00'`;
    const status = opts.status ?? 'SCHEDULED';
    await sql(`
      INSERT INTO "Event" ("id", "name", "locationId", "startsAt", "endsAt", "doorsOpenAt",
                           "totalTicketCapacity", "maxTicketsPerCustomer", "basePrice", "status",
                           "cancelledAt", "reservedSeating", "updatedAt")
      VALUES ('${eventId}', 'Event ${day}', '${venueId}', ${starts}, ${starts}::timestamptz + interval '3 hours',
              ${starts}::timestamptz - interval '1 hour', ${opts.capacity}, ${opts.max ?? 'NULL'},
              ${opts.basePrice}, '${status}', ${status === 'CANCELLED' ? 'now()' : 'NULL'},
              ${opts.seated}, now())`);
  }

  async function insertOrder(
    orderId: string,
    eventId: string,
    tierId: string | null,
    unitPrice: string,
    seats: { section: string; row: number; seat: number; status: 'VALID' | 'VOID' }[],
    refunded = false,
  ): Promise<void> {
    const qty = Math.max(1, seats.length);
    await sql(`
      INSERT INTO "Order" ("id", "eventId", "tierId", "customerSub", "customerUsername", "quantity",
                           "unitPrice", "totalPrice", "status", "refundedAt")
      VALUES ('${orderId}', '${eventId}', ${tierId ? `'${tierId}'` : 'NULL'}, 'sub-1', 'customer1',
              ${qty}, ${unitPrice}, ${unitPrice} * ${qty}, '${refunded ? 'REFUNDED' : 'CONFIRMED'}',
              ${refunded ? 'now()' : 'NULL'})`);
    for (const s of seats) {
      await sql(`
        INSERT INTO "Ticket" ("id", "orderId", "eventId", "tierId", "code", "status", "seatSection",
                              "seatRow", "seatNumber")
        VALUES ('${id()}', '${orderId}', '${eventId}', ${tierId ? `'${tierId}'` : 'NULL'}, '${code()}',
                '${s.status}', '${s.section}', ${s.row}, ${s.seat})`);
    }
  }

  beforeAll(async () => {
    expect(NEW_MIGRATION).toBeDefined();
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    const base = new URL(process.env.DATABASE_URL as string);
    base.pathname = `/${dbName}`;
    url = base.toString();

    // A copy of prisma/ with every migration before seat_maps and none from it on.
    work = mkdtempSync(path.join(tmpdir(), 'qp-migration-'));
    const migrations = path.join(PRISMA_DIR, 'migrations');
    cpSync(PRISMA_DIR, work, {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(migrations, src);
        if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return true;
        const dir = rel.split(path.sep)[0];
        return dir === 'migration_lock.toml' || dir < (NEW_MIGRATION as string);
      },
    });
    deploy(work, url);
    db = new PrismaClient({ datasourceUrl: url });

    for (const [venueId, name, capacity] of [
      [venues.arena, 'Arena', 28],
      [venues.empty, 'Empty Hall', 500],
      [venues.big, 'Big Dome', 40000],
    ] as const) {
      await sql(`
        INSERT INTO "Location" ("id", "name", "address", "seatingCapacity", "timeZone",
                                "timeZoneSource", "updatedAt")
        VALUES ('${venueId}', '${name}', '1 Main St', ${capacity}, 'America/New_York', 'DEFAULT', now())`);
    }
    for (const [venueId, list] of [
      [venues.arena, Object.values(sections)],
      [venues.big, bigSections],
    ] as const) {
      for (const s of list) {
        await sql(`
          INSERT INTO "Section" ("id", "locationId", "name", "rows", "seatsPerRow", "position", "updatedAt")
          VALUES ('${s.id}', '${venueId}', '${s.name}', ${s.rows}, ${s.seatsPerRow}, ${s.position}, now())`);
      }
    }

    await insertEvent(events.typed, venues.arena, 1, {
      seated: true,
      capacity: 28,
      basePrice: '10.00',
      max: 20,
    });
    await insertEvent(events.untyped, venues.arena, 3, {
      seated: true,
      capacity: 28,
      basePrice: '25.00',
    });
    await insertEvent(events.unmapped, venues.arena, 5, {
      seated: true,
      capacity: 28,
      basePrice: '30.00',
    });
    await insertEvent(events.ga, venues.arena, 7, {
      seated: false,
      capacity: 100,
      basePrice: '15.00',
      max: 50,
    });
    await insertEvent(events.cancelled, venues.empty, 9, {
      seated: true,
      capacity: 50,
      basePrice: '20.00',
      status: 'CANCELLED',
    });
    await insertEvent(events.big, venues.big, 11, {
      seated: true,
      capacity: 40000,
      basePrice: '50.00',
    });

    for (const [tierId, eventId, name, price, quantity] of [
      [tiers.premium, events.typed, 'Premium', '95.00', 6],
      [tiers.standard, events.typed, 'Standard', '40.00', 12],
      [tiers.unmappedType, events.unmapped, 'Anywhere', '30.00', 10],
      [tiers.gaType, events.ga, 'Entry', '15.00', 100],
    ] as const) {
      await sql(`
        INSERT INTO "TicketTier" ("id", "eventId", "name", "price", "quantity", "updatedAt")
        VALUES ('${tierId}', '${eventId}', '${name}', ${price}, ${quantity}, now())`);
    }
    await sql(`
      INSERT INTO "SectionTier" ("eventId", "sectionId", "tierId")
      VALUES ('${events.typed}', '${sections.floor.id}', '${tiers.premium}'),
             ('${events.typed}', '${sections.lower.id}', '${tiers.standard}')`);

    await insertOrder(orders.premium, events.typed, tiers.premium, '95.00', [
      { section: 'Floor', row: 1, seat: 1, status: 'VALID' },
    ]);
    await insertOrder(orders.standard, events.typed, tiers.standard, '40.00', [
      { section: 'Lower', row: 2, seat: 3, status: 'VALID' },
      { section: 'Lower', row: 2, seat: 4, status: 'VOID' },
    ]);
    await insertOrder(
      orders.refunded,
      events.typed,
      tiers.standard,
      '40.00',
      [{ section: 'Lower', row: 3, seat: 1, status: 'VOID' }],
      true,
    );
    await insertOrder(orders.untyped, events.untyped, null, '25.00', [
      { section: 'Upper', row: 1, seat: 2, status: 'VALID' },
    ]);
    await sql(`
      INSERT INTO "Order" ("id", "eventId", "tierId", "customerSub", "customerUsername", "quantity",
                           "unitPrice", "totalPrice")
      VALUES ('${orders.ga}', '${events.ga}', '${tiers.gaType}', 'sub-2', 'customer2', 2, 15.00, 30.00)`);
    for (let i = 0; i < 2; i++) {
      await sql(`
        INSERT INTO "Ticket" ("id", "orderId", "eventId", "tierId", "code")
        VALUES ('${id()}', '${orders.ga}', '${events.ga}', '${tiers.gaType}', '${code()}')`);
    }

    // A live hold (an active reservation of the Standard type) and an ended one; an ended hold in
    // a section that no longer exists keeps no seat.
    await sql(`
      INSERT INTO "SeatReservation" ("id", "eventId", "customerSub", "tierId", "createdAt", "expiresAt", "endedAt")
      VALUES ('${reservations.live}', '${events.typed}', 'sub-3', '${tiers.standard}', now(),
              now() + interval '5 minutes', NULL),
             ('${reservations.ended}', '${events.typed}', 'sub-4', '${tiers.premium}',
              now() - interval '10 minutes', now() - interval '5 minutes', now() - interval '6 minutes')`);
    await sql(`
      INSERT INTO "SeatHold" ("id", "reservationId", "eventId", "seatSection", "seatRow", "seatNumber",
                              "createdAt", "releasedAt", "endReason")
      VALUES ('${holds.live}', '${reservations.live}', '${events.typed}', 'Lower', 1, 1, now(), NULL, NULL),
             ('${holds.ended}', '${reservations.ended}', '${events.typed}', 'Floor', 2, 3,
              now() - interval '10 minutes', now() - interval '6 minutes', 'RELEASED'),
             ('${holds.gone}', '${reservations.ended}', '${events.typed}', 'Balcony', 1, 1,
              now() - interval '10 minutes', now() - interval '6 minutes', 'RELEASED')`);

    deploy(PRISMA_DIR, url);
  }, 300_000);

  afterAll(async () => {
    await db?.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.$disconnect();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  type Row = Record<string, unknown>;
  const query = <T = Row>(text: string) => db.$queryRawUnsafe<T[]>(text);

  const layoutOf = async (venueId: string) =>
    query<{
      id: string;
      name: string;
      source: string;
      floorKind: string;
      floorOutline: unknown;
      width: number;
      height: number;
      seatCount: number;
    }>(`
      SELECT "id"::text AS id, "name", "source"::text AS source, "floorKind"::text AS "floorKind",
             "floorOutline", "width", "height", "seatCount"
      FROM "Layout" WHERE "locationId" = '${venueId}'`);

  const eventRow = async (eventId: string) =>
    (
      await query<{
        layoutId: string | null;
        reservedSeating: boolean;
        totalTicketCapacity: number;
        maxTicketsPerCustomer: number | null;
        basePrice: string;
        seatSeq: string;
      }>(`
        SELECT "layoutId"::text AS "layoutId", "reservedSeating", "totalTicketCapacity",
               "maxTicketsPerCustomer", "basePrice"::text AS "basePrice", "seatSeq"::text AS "seatSeq"
        FROM "Event" WHERE "id" = '${eventId}'`)
    )[0];

  const prices = async (eventId: string) =>
    query<{ level: string; price: string }>(`
      SELECT l."name" AS level, p."price"::text AS price
      FROM "EventLevelPrice" p JOIN "PriceLevel" l ON l."id" = p."levelId"
      WHERE p."eventId" = '${eventId}' ORDER BY l."rank"`);

  it('gives the Arena one Standard layout made from lines, with no floor', async () => {
    const layouts = await layoutOf(venues.arena);
    expect(layouts).toHaveLength(1);
    expect(layouts[0]).toMatchObject({
      name: 'Standard',
      source: 'LINES',
      floorKind: 'NONE',
      floorOutline: null,
      seatCount: 6 + 12 + 10,
    });
    expect(await layoutOf(venues.empty)).toEqual([]);
  });

  it('keeps every section id, with a level of its own named after it, rank = position + 1', async () => {
    const [layout] = await layoutOf(venues.arena);
    const rows = await query<{
      id: string;
      name: string;
      position: number;
      layoutId: string;
      level: string;
      rank: number;
      color: string;
      levelLayout: string;
    }>(`
      SELECT s."id"::text AS id, s."name", s."position", s."layoutId"::text AS "layoutId",
             l."name" AS level, l."rank", l."color", l."layoutId"::text AS "levelLayout"
      FROM "Section" s JOIN "PriceLevel" l ON l."id" = s."levelId"
      WHERE s."layoutId" = '${layout.id}' ORDER BY s."position"`);
    expect(rows).toEqual(
      Object.values(sections).map((s) => ({
        id: s.id,
        name: s.name,
        position: s.position,
        layoutId: layout.id,
        level: s.name,
        rank: s.position + 1,
        color: LEVEL_COLORS[s.position % 12],
        levelLayout: layout.id,
      })),
    );
    const levels = await query(`SELECT 1 FROM "PriceLevel" WHERE "layoutId" = '${layout.id}'`);
    expect(levels).toHaveLength(3);
  });

  it('makes rows 1…n and seats 1…m, labelled by their numbers, placed on the R6 grid', async () => {
    const [layout] = await layoutOf(venues.arena);
    const list = Object.values(sections);
    const grid = gridLayout(list);
    expect({ width: layout.width, height: layout.height }).toEqual(grid.size);

    const outlines = await query<{ id: string; outline: unknown; labelX: number; labelY: number }>(`
      SELECT "id"::text AS id, "outline", "labelX", "labelY" FROM "Section"
      WHERE "layoutId" = '${layout.id}' ORDER BY "position"`);
    expect(outlines).toEqual(
      list.map((s, i) => ({
        id: s.id,
        outline: grid.sections[i].outline,
        labelX: grid.sections[i].labelAt[0],
        labelY: grid.sections[i].labelAt[1],
      })),
    );

    const seats = await query<{
      section: string;
      rowNumber: number;
      rowLabel: string;
      rowLevel: string | null;
      number: number;
      label: string;
      x: number;
      y: number;
      level: string | null;
      accessible: boolean;
    }>(`
      SELECT sec."id"::text AS section, r."number" AS "rowNumber", r."label" AS "rowLabel",
             r."levelId"::text AS "rowLevel", s."number", s."label", s."x", s."y",
             s."levelId"::text AS level, s."accessible"
      FROM "Seat" s JOIN "SeatRow" r ON r."id" = s."rowId" JOIN "Section" sec ON sec."id" = s."sectionId"
      WHERE sec."layoutId" = '${layout.id}'
      ORDER BY sec."position", r."number", s."number"`);
    const expected = list.flatMap((s, i) =>
      Array.from({ length: s.rows }, (_, r) =>
        Array.from({ length: s.seatsPerRow }, (_, n) => {
          const [x, y] = seatPlace(grid.sections[i], r + 1, n + 1);
          return {
            section: s.id,
            rowNumber: r + 1,
            rowLabel: String(r + 1),
            rowLevel: null,
            number: n + 1,
            label: String(n + 1),
            x,
            y,
            level: null,
            accessible: false,
          };
        }),
      ).flat(),
    );
    expect(seats).toEqual(expected);
  });

  it('prices the typed event as it sold, puts its unmapped section off sale, and drops its types', async () => {
    const [layout] = await layoutOf(venues.arena);
    expect(await eventRow(events.typed)).toEqual({
      layoutId: layout.id,
      reservedSeating: true,
      totalTicketCapacity: 6 + 12,
      maxTicketsPerCustomer: 18,
      basePrice: '40.00',
      seatSeq: '0',
    });
    expect(await prices(events.typed)).toEqual([
      { level: 'Floor', price: '95.00' },
      { level: 'Lower', price: '40.00' },
    ]);
    const offSale = await query<{ section: string; n: number }>(`
      SELECT sec."name" AS section, count(*)::int AS n
      FROM "EventOffSaleSeat" o JOIN "Seat" s ON s."id" = o."seatId"
      JOIN "Section" sec ON sec."id" = s."sectionId"
      WHERE o."eventId" = '${events.typed}' GROUP BY sec."name"`);
    expect(offSale).toEqual([{ section: 'Upper', n: 10 }]);

    expect(await query(`SELECT 1 FROM "TicketTier" WHERE "eventId" = '${events.typed}'`)).toEqual(
      [],
    );
    const tierRefs = await query<{ n: number }>(`
      SELECT (SELECT count(*) FROM "Order" WHERE "eventId" = '${events.typed}' AND "tierId" IS NOT NULL)
           + (SELECT count(*) FROM "Ticket" WHERE "eventId" = '${events.typed}' AND "tierId" IS NOT NULL)
           + (SELECT count(*) FROM "SeatReservation" WHERE "eventId" = '${events.typed}' AND "tierId" IS NOT NULL)
           AS n`);
    expect(Number(tierRefs[0].n)).toBe(0);
    // The reservations stay (only their type went).
    expect(
      await query(`SELECT 1 FROM "SeatReservation" WHERE "eventId" = '${events.typed}'`),
    ).toHaveLength(2);
  });

  it('prices every level of the untyped event at its base price', async () => {
    const [layout] = await layoutOf(venues.arena);
    expect(await eventRow(events.untyped)).toEqual({
      layoutId: layout.id,
      reservedSeating: true,
      totalTicketCapacity: 28,
      maxTicketsPerCustomer: null,
      basePrice: '25.00',
      seatSeq: '0',
    });
    expect(await prices(events.untyped)).toEqual([
      { level: 'Floor', price: '25.00' },
      { level: 'Lower', price: '25.00' },
      { level: 'Upper', price: '25.00' },
    ]);
    expect(
      await query(`SELECT 1 FROM "EventOffSaleSeat" WHERE "eventId" = '${events.untyped}'`),
    ).toEqual([]);
  });

  it('makes the event with types and nothing mapped general admission, keeping its types', async () => {
    expect(await eventRow(events.unmapped)).toEqual({
      layoutId: null,
      reservedSeating: false,
      totalTicketCapacity: 28,
      maxTicketsPerCustomer: null,
      basePrice: '30.00',
      seatSeq: '0',
    });
    expect(
      await query(`SELECT "name" FROM "TicketTier" WHERE "eventId" = '${events.unmapped}'`),
    ).toEqual([{ name: 'Anywhere' }]);
    expect(await prices(events.unmapped)).toEqual([]);
  });

  it('keeps every ticket seat, label, price and status, and points it at its seat', async () => {
    const tickets = await query<Row>(`
      SELECT t."seatSection", t."seatRow", t."seatNumber", t."status"::text AS status,
             t."seatRowLabel", t."seatLabel", t."price"::text AS price, t."levelName",
             sec."name" AS "seatOf", r."number" AS "rowOf", s."number" AS "numberOf"
      FROM "Ticket" t
      LEFT JOIN "Seat" s ON s."id" = t."seatId"
      LEFT JOIN "SeatRow" r ON r."id" = s."rowId"
      LEFT JOIN "Section" sec ON sec."id" = s."sectionId"
      WHERE t."eventId" = '${events.typed}'
      ORDER BY t."seatSection", t."seatRow", t."seatNumber"`);
    const seated = (
      section: string,
      row: number,
      seat: number,
      status: string,
      price: string,
      levelName: string,
    ) => ({
      seatSection: section,
      seatRow: row,
      seatNumber: seat,
      status,
      seatRowLabel: String(row),
      seatLabel: String(seat),
      price,
      levelName,
      seatOf: section,
      rowOf: row,
      numberOf: seat,
    });
    expect(tickets).toEqual([
      seated('Floor', 1, 1, 'VALID', '95.00', 'Premium'),
      seated('Lower', 2, 3, 'VALID', '40.00', 'Standard'),
      seated('Lower', 2, 4, 'VOID', '40.00', 'Standard'),
      seated('Lower', 3, 1, 'VOID', '40.00', 'Standard'),
    ]);
  });

  it("gives a ticket sold without a type its section's name as its level", async () => {
    const tickets = await query<Row>(`
      SELECT t."seatRowLabel", t."seatLabel", t."price"::text AS price, t."levelName",
             t."status"::text AS status, sec."name" AS "seatOf", r."number" AS "rowOf",
             s."number" AS "numberOf"
      FROM "Ticket" t JOIN "Seat" s ON s."id" = t."seatId"
      JOIN "SeatRow" r ON r."id" = s."rowId" JOIN "Section" sec ON sec."id" = s."sectionId"
      WHERE t."eventId" = '${events.untyped}'`);
    expect(tickets).toEqual([
      {
        seatRowLabel: '1',
        seatLabel: '2',
        price: '25.00',
        levelName: 'Upper',
        status: 'VALID',
        seatOf: 'Upper',
        rowOf: 1,
        numberOf: 2,
      },
    ]);
  });

  it("gives a general-admission ticket its order's price and no seat or level", async () => {
    const tickets = await query<Row>(`
      SELECT "seatSection", "seatRow", "seatNumber", "seatRowLabel", "seatLabel", "seatId",
             "price"::text AS price, "levelName", "status"::text AS status
      FROM "Ticket" WHERE "eventId" = '${events.ga}'`);
    const ga = {
      seatSection: null,
      seatRow: null,
      seatNumber: null,
      seatRowLabel: null,
      seatLabel: null,
      seatId: null,
      price: '15.00',
      levelName: null,
      status: 'VALID',
    };
    expect(tickets).toEqual([ga, ga]);
  });

  it('points the live hold at its seat; ended holds keep theirs, or none when the section is gone', async () => {
    const rows = await query<{
      id: string;
      seatOf: string | null;
      rowOf: number;
      numberOf: number;
    }>(`
      SELECT h."id"::text AS id, sec."name" AS "seatOf", r."number" AS "rowOf", s."number" AS "numberOf"
      FROM "SeatHold" h
      LEFT JOIN "Seat" s ON s."id" = h."seatId"
      LEFT JOIN "SeatRow" r ON r."id" = s."rowId"
      LEFT JOIN "Section" sec ON sec."id" = s."sectionId"
      ORDER BY h."createdAt" DESC, h."seatSection"`);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(holds.live)).toMatchObject({ seatOf: 'Lower', rowOf: 1, numberOf: 1 });
    expect(byId.get(holds.ended)).toMatchObject({ seatOf: 'Floor', rowOf: 2, numberOf: 3 });
    expect(byId.get(holds.gone)).toMatchObject({ seatOf: null });
  });

  it('leaves the general-admission event as it was', async () => {
    expect(await eventRow(events.ga)).toEqual({
      layoutId: null,
      reservedSeating: false,
      totalTicketCapacity: 100,
      maxTicketsPerCustomer: 50,
      basePrice: '15.00',
      seatSeq: '0',
    });
    expect(await query(`SELECT "name" FROM "TicketTier" WHERE "eventId" = '${events.ga}'`)).toEqual(
      [{ name: 'Entry' }],
    );
    const [order] = await query<{ tierId: string | null; unitPrice: string }>(`
      SELECT "tierId"::text AS "tierId", "unitPrice"::text AS "unitPrice" FROM "Order"
      WHERE "id" = '${orders.ga}'`);
    expect(order).toEqual({ tierId: tiers.gaType, unitPrice: '15.00' });
  });

  it('makes the cancelled seated event at a venue without sections general admission', async () => {
    expect(await eventRow(events.cancelled)).toMatchObject({
      layoutId: null,
      reservedSeating: false,
    });
  });

  it('carries all 40,000 seats of the big venue over', async () => {
    const [layout] = await layoutOf(venues.big);
    expect(layout).toMatchObject({ name: 'Standard', seatCount: 40000 });
    const [{ n }] = await query<{ n: number }>(`
      SELECT count(*)::int AS n FROM "Seat" s JOIN "Section" sec ON sec."id" = s."sectionId"
      WHERE sec."layoutId" = '${layout.id}'`);
    expect(n).toBe(40000);
    expect(await eventRow(events.big)).toMatchObject({
      layoutId: layout.id,
      reservedSeating: true,
      totalTicketCapacity: 40000,
      basePrice: '50.00',
    });
    expect(await prices(events.big)).toEqual([
      { level: 'North', price: '50.00' },
      { level: 'South', price: '50.00' },
    ]);
  });

  it('starts every event at seat-change sequence 0', async () => {
    const rows = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "Event" WHERE "seatSeq" <> 0`,
    );
    expect(rows[0].n).toBe(0);
  });

  describe('then the database refuses', () => {
    const seatId = async (section: string, row: number, seat: number) => {
      const [r] = await query<{ id: string }>(`
        SELECT s."id"::text AS id FROM "Seat" s
        JOIN "SeatRow" r ON r."id" = s."rowId" JOIN "Section" sec ON sec."id" = s."sectionId"
        JOIN "Layout" l ON l."id" = sec."layoutId"
        WHERE l."locationId" = '${venues.arena}' AND sec."name" = '${section}'
          AND r."number" = ${row} AND s."number" = ${seat}`);
      return r.id;
    };

    // A raw unique violation names its key, not its index: SQLSTATE 23505 on ("eventId",
    // "seatId"), which only the named partial index has on each table (checked first).
    const indexDef = async (name: string) =>
      (
        await query<{ def: string }>(
          `SELECT indexdef AS def FROM pg_indexes WHERE indexname = '${name}'`,
        )
      )[0]?.def;
    const SEAT_KEY = /23505[\s\S]*\("eventId", "seatId"\)/;

    it('a second VALID ticket for one seat (ticket_one_valid_per_seat)', async () => {
      expect(await indexDef('ticket_one_valid_per_seat')).toMatch(
        /UNIQUE INDEX ticket_one_valid_per_seat ON public."Ticket" USING btree \("eventId", "seatId"\) WHERE \(status = 'VALID'/,
      );
      const seat = await seatId('Floor', 1, 1);
      const orderId = id();
      await sql(`
        INSERT INTO "Order" ("id", "eventId", "customerSub", "customerUsername", "quantity",
                             "unitPrice", "totalPrice")
        VALUES ('${orderId}', '${events.typed}', 'sub-9', 'customer9', 1, 95.00, 95.00)`);
      await expect(
        sql(`
          INSERT INTO "Ticket" ("id", "orderId", "eventId", "code", "seatId", "seatSection", "seatRow",
                                "seatNumber", "seatRowLabel", "seatLabel", "levelName", "price")
          VALUES ('${id()}', '${orderId}', '${events.typed}', '${code()}', '${seat}', 'Floor', 1, 1,
                  '1', '1', 'Floor', 95.00)`),
      ).rejects.toThrow(SEAT_KEY);
    });

    it('a second live hold on one seat (seat_hold_one_live_per_seat)', async () => {
      expect(await indexDef('seat_hold_one_live_per_seat')).toMatch(
        /UNIQUE INDEX seat_hold_one_live_per_seat ON public."SeatHold" USING btree \("eventId", "seatId"\) WHERE \("releasedAt" IS NULL\)/,
      );
      const seat = await seatId('Lower', 1, 1);
      const reservationId = id();
      await sql(`
        INSERT INTO "SeatReservation" ("id", "eventId", "customerSub", "createdAt", "expiresAt")
        VALUES ('${reservationId}', '${events.typed}', 'sub-8', now(), now() + interval '5 minutes')`);
      await expect(
        sql(`
          INSERT INTO "SeatHold" ("id", "reservationId", "eventId", "seatId", "seatSection", "seatRow",
                                  "seatNumber", "createdAt")
          VALUES ('${id()}', '${reservationId}', '${events.typed}', '${seat}', 'Lower', 1, 1, now())`),
      ).rejects.toThrow(SEAT_KEY);
    });

    it('deleting a sold seat (ticket_valid_has_seat)', async () => {
      const seat = await seatId('Floor', 1, 1);
      await expect(sql(`DELETE FROM "Seat" WHERE "id" = '${seat}'`)).rejects.toThrow(
        /ticket_valid_has_seat/,
      );
    });

    it('reserved seating without a layout (event_seating_matches_layout)', async () => {
      await expect(
        sql(`UPDATE "Event" SET "reservedSeating" = true WHERE "id" = '${events.ga}'`),
      ).rejects.toThrow(/event_seating_matches_layout/);
    });
  });
});
