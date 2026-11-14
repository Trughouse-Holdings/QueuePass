import { NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { lockVenueShared } from '../../src/common/venue-lock';
import { lockLayout, lockVenueForLayouts } from '../../src/layouts/layout-lock';
import { countSeatStates } from '../../src/seating/seat-levels';

/**
 * Spec 038 research R1, R7, R11, R12 (T008): the helpers every story builds on, against real
 * PostgreSQL. Seat states are counted per section and level for one event in one statement, with
 * the event's seat-change sequence number read in that same statement; a layout write locks the
 * venue, then the layout, then the scheduled events using it, in id order, so an event save (which
 * takes the venue FOR SHARE first) waits for it. Rows are written with SQL, below the Backend, and
 * removed afterwards.
 */
describe('seat levels and the layout lock (R1, R7, R11)', () => {
  const db = new PrismaClient();
  const venue = randomUUID();
  const otherVenue = randomUUID();
  const layout = randomUUID();
  const otherLayout = randomUUID();
  const levels = { a: randomUUID(), b: randomUUID(), other: randomUUID() };
  const section = randomUUID();
  const otherSection = randomUUID();
  const rows = { 1: randomUUID(), 2: randomUUID() };
  /** Seat ids by "row-seat". */
  const seats = new Map<string, string>();
  // Ids sorted, so "in id order" is checkable: the second sorts after the first.
  const [seatedA, seatedB] = [randomUUID(), randomUUID()].sort();
  const events = { seatedA, seatedB, cancelled: randomUUID(), ga: randomUUID() };

  const sql = (text: string) => db.$executeRawUnsafe(text);

  beforeAll(async () => {
    for (const v of [venue, otherVenue]) {
      await sql(`
        INSERT INTO "Location" ("id", "name", "address", "seatingCapacity", "timeZone",
                                "timeZoneSource", "updatedAt")
        VALUES ('${v}', 'Lock Hall ${v.slice(0, 4)}', '1 Main St', 100, 'America/New_York',
                'DEFAULT', now())`);
    }
    for (const [id, loc, name] of [
      [layout, venue, 'Main'],
      [otherLayout, venue, 'Other'],
    ]) {
      await sql(`
        INSERT INTO "Layout" ("id", "locationId", "name", "source", "floorKind", "width", "height",
                              "seatCount", "updatedAt")
        VALUES ('${id}', '${loc}', '${name}', 'LINES', 'NONE', 100, 100, 6, now())`);
    }
    await sql(`
      INSERT INTO "PriceLevel" ("id", "layoutId", "name", "rank", "color")
      VALUES ('${levels.a}', '${layout}', 'A', 1, 'violet'),
             ('${levels.b}', '${layout}', 'B', 2, 'teal'),
             ('${levels.other}', '${otherLayout}', 'O', 1, 'red')`);
    await sql(`
      INSERT INTO "Section" ("id", "layoutId", "name", "levelId", "outline", "labelX", "labelY",
                             "position", "updatedAt")
      VALUES ('${section}', '${layout}', 'S', '${levels.a}', '[[0,0],[10,0],[10,10]]', 5, 5, 0, now()),
             ('${otherSection}', '${otherLayout}', 'T', '${levels.other}', '[[0,0],[10,0],[10,10]]',
              5, 5, 0, now())`);
    // Row 1 has the section's level A; row 2 its own level B; seat 1-1 its own level B.
    await sql(`
      INSERT INTO "SeatRow" ("id", "sectionId", "number", "label", "levelId")
      VALUES ('${rows[1]}', '${section}', 1, '1', NULL), ('${rows[2]}', '${section}', 2, '2', '${levels.b}')`);
    for (const r of [1, 2] as const) {
      for (const n of [1, 2, 3]) {
        const id = randomUUID();
        seats.set(`${r}-${n}`, id);
        const own = r === 1 && n === 1 ? `'${levels.b}'` : 'NULL';
        await sql(`
          INSERT INTO "Seat" ("id", "rowId", "sectionId", "number", "label", "x", "y", "levelId")
          VALUES ('${id}', '${rows[r]}', '${section}', ${n}, '${n}', ${n}, ${r}, ${own})`);
      }
    }
    const event = (id: string, day: number, layoutId: string | null, status = 'SCHEDULED') =>
      sql(`
        INSERT INTO "Event" ("id", "name", "locationId", "startsAt", "endsAt", "doorsOpenAt",
                             "totalTicketCapacity", "basePrice", "status", "cancelledAt",
                             "reservedSeating", "layoutId", "updatedAt")
        VALUES ('${id}', 'E${day}', '${venue}', '2027-05-${day} 20:00+00', '2027-05-${day} 22:00+00',
                '2027-05-${day} 19:00+00', 6, 10, '${status}',
                ${status === 'CANCELLED' ? 'now()' : 'NULL'}, ${layoutId !== null},
                ${layoutId ? `'${layoutId}'` : 'NULL'}, now())`);
    await event(events.seatedA, 10, layout);
    await event(events.seatedB, 12, layout);
    await event(events.cancelled, 14, layout, 'CANCELLED');
    await event(events.ga, 16, null);
    await sql(`UPDATE "Event" SET "seatSeq" = 7 WHERE "id" = '${events.seatedA}'`);

    // Seat 1-1 off sale; 1-2 sold; 1-3 held; 2-1 a void ticket (open); 2-2 held by a reservation
    // that ran out and was not yet swept (open, spec 015 research R3); 2-3 open.
    await sql(`
      INSERT INTO "EventOffSaleSeat" ("eventId", "seatId")
      VALUES ('${events.seatedA}', '${seats.get('1-1')}')`);
    const order = randomUUID();
    await sql(`
      INSERT INTO "Order" ("id", "eventId", "customerSub", "customerUsername", "quantity",
                           "unitPrice", "totalPrice")
      VALUES ('${order}', '${events.seatedA}', 'sub-1', 'c1', 2, 10, 20)`);
    for (const [key, status, code] of [
      ['1-2', 'VALID', 'LVLAAAAAAAAA'],
      ['2-1', 'VOID', 'LVLBBBBBBBBB'],
    ]) {
      const [r, n] = key.split('-');
      await sql(`
        INSERT INTO "Ticket" ("id", "orderId", "eventId", "code", "status", "seatId", "seatSection",
                              "seatRow", "seatNumber", "seatRowLabel", "seatLabel", "levelName",
                              "price")
        VALUES ('${randomUUID()}', '${order}', '${events.seatedA}', '${code}', '${status}',
                '${seats.get(key)}', 'S', ${r}, ${n}, '${r}', '${n}', 'A', 10)`);
    }
    const live = randomUUID();
    const ranOut = randomUUID();
    await sql(`
      INSERT INTO "SeatReservation" ("id", "eventId", "customerSub", "createdAt", "expiresAt")
      VALUES ('${live}', '${events.seatedA}', 'sub-2', now(), now() + interval '5 minutes'),
             ('${ranOut}', '${events.seatedA}', 'sub-3', now() - interval '10 minutes',
              now() - interval '5 minutes')`);
    for (const [reservation, key] of [
      [live, '1-3'],
      [ranOut, '2-2'],
    ]) {
      const [r, n] = key.split('-');
      await sql(`
        INSERT INTO "SeatHold" ("id", "reservationId", "eventId", "seatId", "seatSection", "seatRow",
                                "seatNumber", "createdAt")
        VALUES ('${randomUUID()}', '${reservation}', '${events.seatedA}', '${seats.get(key)}', 'S',
                ${r}, ${n}, now())`);
    }
  });

  afterAll(async () => {
    await sql(`DELETE FROM "SeatHold" WHERE "eventId" IN ('${Object.values(events).join("','")}')`);
    await sql(
      `DELETE FROM "SeatReservation" WHERE "eventId" IN ('${Object.values(events).join("','")}')`,
    );
    await sql(`DELETE FROM "Ticket" WHERE "eventId" IN ('${Object.values(events).join("','")}')`);
    await sql(`DELETE FROM "Order" WHERE "eventId" IN ('${Object.values(events).join("','")}')`);
    await sql(`DELETE FROM "Event" WHERE "id" IN ('${Object.values(events).join("','")}')`);
    // Rows and seats first: with a row or seat level of its own, a cascade from the venue is
    // refused by SeatRow_levelId_fkey / Seat_levelId_fkey (NO ACTION is checked before the
    // cascade reaches them; reported against data-model.md, research R7).
    await sql(`DELETE FROM "SeatRow" WHERE "sectionId" IN ('${section}', '${otherSection}')`);
    await sql(`DELETE FROM "Location" WHERE "id" IN ('${venue}', '${otherVenue}')`);
    await db.$disconnect();
  });

  describe('countSeatStates (R11, R12)', () => {
    it("counts one event's seats per section and resolved level, by state, with its seq", async () => {
      const { seq, counts } = await countSeatStates(db, events.seatedA);
      expect(seq).toBe(7n);
      expect(counts).toEqual([
        { sectionId: section, levelId: levels.a, open: 0, reserved: 1, sold: 1, offSale: 0 },
        { sectionId: section, levelId: levels.b, open: 3, reserved: 0, sold: 0, offSale: 1 },
      ]);
    });

    it("gives every seat open for another event on the layout, at that event's seq", async () => {
      const { seq, counts } = await countSeatStates(db, events.seatedB);
      expect(seq).toBe(0n);
      expect(counts).toEqual([
        { sectionId: section, levelId: levels.a, open: 2, reserved: 0, sold: 0, offSale: 0 },
        { sectionId: section, levelId: levels.b, open: 4, reserved: 0, sold: 0, offSale: 0 },
      ]);
    });

    it('gives no counts for a general-admission event, and 404 for no event', async () => {
      expect(await countSeatStates(db, events.ga)).toEqual({ seq: 0n, counts: [] });
      await expect(countSeatStates(db, randomUUID())).rejects.toThrow(NotFoundException);
    });
  });

  describe('lockLayout (R7)', () => {
    it('locks the venue, the layout and its scheduled events, giving them in id order', async () => {
      const locked = await db.$transaction((tx) => lockLayout(tx, layout));
      expect(locked.layout).toMatchObject({ id: layout, locationId: venue, name: 'Main' });
      expect(locked.venue.seatingCapacity).toBe(100);
      // The cancelled event uses it too but sells nothing; the GA event uses no layout.
      expect(locked.eventIds).toEqual([events.seatedA, events.seatedB]);
    });

    it('is a 404 for a layout that does not exist', async () => {
      await expect(db.$transaction((tx) => lockLayout(tx, randomUUID()))).rejects.toThrow(
        NotFoundException,
      );
    });

    it('makes an event save at the venue wait until the layout write ends', async () => {
      const order: string[] = [];
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      const second = new PrismaClient();
      try {
        const writer = db.$transaction(
          async (tx) => {
            await lockLayout(tx, layout);
            locked();
            await held;
            order.push('layout write ends');
          },
          { timeout: 10_000 },
        );
        await isLocked;
        const save = second.$transaction(async (tx) => {
          await lockVenueShared(tx, [venue]);
          order.push('event save locks the venue');
        });
        await new Promise((r) => setTimeout(r, 300));
        release();
        await Promise.all([writer, save]);
        expect(order).toEqual(['layout write ends', 'event save locks the venue']);
      } finally {
        await second.$disconnect();
      }
    });

    it('lockVenueForLayouts locks the venue alone, for a new layout', async () => {
      const venueRow = await db.$transaction((tx) => lockVenueForLayouts(tx, otherVenue));
      expect(venueRow.name).toMatch(/^Lock Hall/);
      await expect(db.$transaction((tx) => lockVenueForLayouts(tx, randomUUID()))).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
