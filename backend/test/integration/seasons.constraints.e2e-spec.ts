import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { seasonWithSoldPass, splitPassPrice, type SeasonFixture } from '../setup/season-fixtures';

/**
 * Spec 041 data-model.md, research R1, R6, R7, R14: the shared Season contract's rules that the
 * database states on its own, proven with rows written directly, below any Backend path; and the
 * shared fixture (`seasonWithSoldPass`) both 041 and 042 build their tests on.
 */
describe('Season rules below the Backend (041 shared contract)', () => {
  let ctx: TestContext;
  let seated: SeasonFixture;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    seated = await seasonWithSoldPass(ctx);
  });

  // Prisma names a CHECK in its message, but reports a unique index only by its fields.
  const refusedBy = (name: string) =>
    new RegExp(`${name}|23514|23505|23503|Unique constraint failed`);

  /** A Season row written directly, valid unless `data` overrides a field. */
  const season = (data: Partial<Prisma.SeasonUncheckedCreateInput> = {}) =>
    ctx.prisma.season.create({
      data: {
        name: 'Direct Season',
        locationId: seated.venueId,
        salesEndAt: new Date(Date.now() + 86_400_000),
        ...data,
      },
    });

  describe('the fixture', () => {
    it('makes a seated Season on sale with 3 events, a price, and one pass split 33.34/33.33/33.33', async () => {
      const s = await ctx.prisma.season.findUniqueOrThrow({
        where: { id: seated.seasonId },
        include: { events: true, prices: true, passes: { include: { orders: true } } },
      });
      expect(s.status).toBe('ON_SALE');
      expect(s.events).toHaveLength(3);
      expect(s.prices.map((p) => p.price.toFixed(2))).toEqual(['100.00']);
      expect(s.passes).toHaveLength(1);
      expect(seated.pass?.orders.map((o) => o.price)).toEqual(['33.34', '33.33', '33.33']);
      const sum = s.passes[0].orders.reduce((t, o) => t + Number(o.totalPrice), 0);
      expect(sum.toFixed(2)).toBe('100.00');
    });

    it('makes a general-admission Season with a ticket type name priced and no seat', async () => {
      const ga = await seasonWithSoldPass(ctx, { kind: 'ga' });
      const pass = await ctx.prisma.seasonPass.findUniqueOrThrow({ where: { id: ga.pass!.id } });
      expect(pass.seatId).toBeNull();
      expect(pass.tierName).toBe('General');
      expect(ga.layout).toBeNull();
    });

    it('splits a pass price evenly with the leftover cents on the first event', () => {
      expect(splitPassPrice('100.00', 3)).toEqual(['33.34', '33.33', '33.33']);
      expect(splitPassPrice('640.00', 16)).toEqual(Array(16).fill('40.00'));
      expect(splitPassPrice('0.02', 3)).toEqual(['0.02', '0.00', '0.00']);
    });
  });

  describe('Season', () => {
    it('refuses a sport without a team, and a team without a sport', async () => {
      await expect(season({ sport: 'BASKETBALL' })).rejects.toThrow(
        refusedBy('season_sport_team_together'),
      );
      await expect(season({ team: 'Cardinals' })).rejects.toThrow(
        refusedBy('season_sport_team_together'),
      );
      await expect(season({ sport: 'BASKETBALL', team: 'Cardinals' })).resolves.toBeDefined();
    });

    it('refuses a blank or untrimmed name', async () => {
      await expect(season({ name: '   ' })).rejects.toThrow(refusedBy('season_name_length'));
      await expect(season({ name: ' Padded ' })).rejects.toThrow(refusedBy('season_name_length'));
    });

    it('refuses passes per customer outside 1 to 10', async () => {
      await expect(season({ maxPassesPerCustomer: 0 })).rejects.toThrow(
        refusedBy('season_max_passes_range'),
      );
      await expect(season({ maxPassesPerCustomer: 11 })).rejects.toThrow(
        refusedBy('season_max_passes_range'),
      );
    });

    it('refuses single tickets going on sale after pass sales end', async () => {
      const end = new Date(Date.now() + 86_400_000);
      await expect(
        season({ salesEndAt: end, singleSalesOpenAt: new Date(end.getTime() + 1) }),
      ).rejects.toThrow(refusedBy('season_presale_before_sales_end'));
    });

    it('keeps the status and its times together', async () => {
      await expect(season({ status: 'ON_SALE' })).rejects.toThrow(
        refusedBy('season_published_when_not_draft'),
      );
      await expect(season({ publishedAt: new Date() })).rejects.toThrow(
        refusedBy('season_published_when_not_draft'),
      );
      await expect(season({ status: 'CANCELLED', publishedAt: new Date() })).rejects.toThrow(
        refusedBy('season_cancelled_together'),
      );
    });

    it('can not be deleted once it has a pass, and deleting a draft takes its events and prices', async () => {
      await expect(ctx.prisma.season.delete({ where: { id: seated.seasonId } })).rejects.toThrow();

      const draft = await seasonWithSoldPass(ctx, { sold: false, status: 'DRAFT' });
      await ctx.prisma.season.delete({ where: { id: draft.seasonId } });
      expect(await ctx.prisma.seasonEvent.count({ where: { seasonId: draft.seasonId } })).toBe(0);
      expect(await ctx.prisma.seasonPrice.count({ where: { seasonId: draft.seasonId } })).toBe(0);
    });
  });

  describe('SeasonEvent', () => {
    it('puts an event in at most one Season', async () => {
      const other = await season();
      await expect(
        ctx.prisma.seasonEvent.create({
          data: { seasonId: other.id, eventId: seated.eventIds[0] },
        }),
      ).rejects.toThrow(/SeasonEvent_pkey|23505|Unique constraint/);
    });

    it('keeps an event in a Season from being deleted', async () => {
      await ctx.prisma.ticket.deleteMany({});
      await ctx.prisma.order.deleteMany({});
      await expect(
        ctx.prisma.event.delete({ where: { id: seated.eventIds[0] } }),
      ).rejects.toThrow();
    });
  });

  describe('SeasonPrice', () => {
    it('refuses both or neither of a level and a ticket type name', async () => {
      const s = await season();
      await expect(
        ctx.prisma.seasonPrice.create({ data: { seasonId: s.id, price: '1.00' } }),
      ).rejects.toThrow(refusedBy('season_price_one_target'));
      await expect(
        ctx.prisma.seasonPrice.create({
          data: {
            seasonId: s.id,
            levelId: seated.layout!.levels.Lower,
            tierName: 'X',
            price: '1.00',
          },
        }),
      ).rejects.toThrow(refusedBy('season_price_one_target'));
    });

    it('refuses a negative price, a level twice, and a name twice ignoring case', async () => {
      const s = await season();
      const levelId = seated.layout!.levels.Lower;
      await expect(
        ctx.prisma.seasonPrice.create({ data: { seasonId: s.id, levelId, price: '-1.00' } }),
      ).rejects.toThrow(refusedBy('season_price_non_negative'));
      await ctx.prisma.seasonPrice.create({ data: { seasonId: s.id, levelId, price: '1.00' } });
      await expect(
        ctx.prisma.seasonPrice.create({ data: { seasonId: s.id, levelId, price: '2.00' } }),
      ).rejects.toThrow(refusedBy('season_price_level_unique'));
      await ctx.prisma.seasonPrice.create({
        data: { seasonId: s.id, tierName: 'General', price: '1.00' },
      });
      await expect(
        ctx.prisma.seasonPrice.create({
          data: { seasonId: s.id, tierName: 'GENERAL', price: '1.00' },
        }),
      ).rejects.toThrow(refusedBy('season_price_tier_unique'));
    });
  });

  describe('SeasonPass', () => {
    const pass = (data: Partial<Prisma.SeasonPassUncheckedCreateInput>) =>
      ctx.prisma.seasonPass.create({
        data: {
          seasonId: seated.seasonId,
          customerSub: 'sub-x',
          customerUsername: 'x',
          holderName: 'X',
          totalPrice: '1.00',
          ...data,
        },
      });

    it('is for exactly one of a seat and a ticket type name', async () => {
      await expect(pass({})).rejects.toThrow(refusedBy('season_pass_one_target'));
      await expect(
        pass({ seatId: seated.layout!.seat('101', 1, 2), tierName: 'General' }),
      ).rejects.toThrow(refusedBy('season_pass_one_target'));
    });

    it('keeps REFUNDED and refundedAt together', async () => {
      await expect(pass({ tierName: 'G', status: 'REFUNDED' })).rejects.toThrow(
        refusedBy('season_pass_refunded_together'),
      );
    });

    it('allows one order per event per pass', async () => {
      const first = await ctx.prisma.order.findFirstOrThrow({
        where: { seasonPassId: seated.pass!.id, eventId: seated.eventIds[0] },
      });
      await expect(
        ctx.prisma.order.create({
          data: {
            eventId: first.eventId,
            seasonPassId: seated.pass!.id,
            customerSub: first.customerSub,
            customerUsername: first.customerUsername,
            quantity: 1,
            totalPrice: '1.00',
          },
        }),
      ).rejects.toThrow(refusedBy('order_one_per_event_per_pass'));
    });
  });

  describe('SeasonPassHold and reservations (for 042, research R7)', () => {
    async function passHold(customerSub: string): Promise<string> {
      const id = randomUUID();
      await ctx.prisma.$executeRaw`
        INSERT INTO "SeasonPassHold" ("id", "seasonId", "customerSub", "seatId", "createdAt", "expiresAt")
        VALUES (${id}::uuid, ${seated.seasonId}::uuid, ${customerSub},
                ${seated.layout!.seat('101', 2, 1)}::uuid, now(), now() + interval '5 minutes')`;
      return id;
    }
    async function reservation(customerSub: string, passHoldId: string | null): Promise<string> {
      const id = randomUUID();
      await ctx.prisma.$executeRaw`
        INSERT INTO "SeatReservation" ("id", "eventId", "customerSub", "createdAt", "expiresAt", "passHoldId")
        VALUES (${id}::uuid, ${seated.eventIds[0]}::uuid, ${customerSub}, now(),
                now() + interval '5 minutes', ${passHoldId}::uuid)`;
      return id;
    }

    it('lasts exactly 5 minutes, and one is live per customer per Season', async () => {
      await expect(
        ctx.prisma.$executeRaw`
          INSERT INTO "SeasonPassHold" ("id", "seasonId", "customerSub", "seatId", "createdAt", "expiresAt")
          VALUES (${randomUUID()}::uuid, ${seated.seasonId}::uuid, 'sub-1',
                  ${seated.layout!.seat('101', 2, 1)}::uuid, now(), now() + interval '6 minutes')`,
      ).rejects.toThrow(refusedBy('season_pass_hold_five_minutes'));
      await passHold('sub-1');
      await expect(passHold('sub-1')).rejects.toThrow(refusedBy('season_pass_hold_one_live'));
      await expect(passHold('sub-2')).resolves.toEqual(expect.any(String));
    });

    it('lets a customer hold a single reservation and a pass reservation for one event, not two of either', async () => {
      const h = await passHold('sub-1');
      await reservation('sub-1', null);
      await reservation('sub-1', h);
      await expect(reservation('sub-1', null)).rejects.toThrow(
        refusedBy('seat_reservation_one_active'),
      );
      await expect(reservation('sub-1', h)).rejects.toThrow(
        /seat_reservation_one_per_pass_hold_event|seat_reservation_one_active|23505/,
      );
    });
  });
});
