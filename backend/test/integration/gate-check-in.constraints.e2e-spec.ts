import { randomUUID } from 'node:crypto';
import { event, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 017 (Constitution IV; research R2, R3): the holder-name and entry-agent rules the database
 * states on its own, proven with writes made directly by SQL, below the Backend.
 */
describe('Gate check-in rules below the Backend', () => {
  let ctx: TestContext;
  let orderId: string;
  let ticketId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    const venueId = await venue(ctx, 'Gate Hall');
    const eventId = await event(ctx, venueId);
    // Rows written by SQL, below the Backend, like every write in this file.
    orderId = randomUUID();
    ticketId = randomUUID();
    await ctx.prisma.$executeRaw`
      INSERT INTO "Order" ("id", "eventId", "customerSub", "customerUsername", "quantity",
                           "unitPrice", "totalPrice")
      VALUES (${orderId}::uuid, ${eventId}::uuid, 'demo-customer1', 'customer1', 1, 45.00, 45.00)`;
    await ctx.prisma.$executeRaw`
      INSERT INTO "Ticket" ("id", "orderId", "eventId", "code")
      VALUES (${ticketId}::uuid, ${orderId}::uuid, ${eventId}::uuid, 'GATECHECK234')`;
  });

  /** Sets the order's name by SQL (no trimming, no Backend rule), returning the DB's answer. */
  const setName = (name: string | null): Promise<number> =>
    ctx.prisma.$executeRaw`UPDATE "Order" SET "holderName" = ${name} WHERE "id" = ${orderId}::uuid`;

  describe('order_holder_name_valid (FR-003 backstop)', () => {
    it.each(['', ' Jordan', 'Jordan '])('refuses %j', async (bad) => {
      await expect(setName(bad)).rejects.toThrow(/order_holder_name_valid/);
    });

    it('refuses 101 characters and accepts 100', async () => {
      await expect(setName('a'.repeat(101))).rejects.toThrow(/order_holder_name_valid/);
      await expect(setName('a'.repeat(100))).resolves.toBe(1);
    });

    it('accepts NULL (an order from before this feature)', async () => {
      await expect(setName(null)).resolves.toBe(1);
    });
  });

  describe('ticket_entry_agent (research R3)', () => {
    it('refuses an agent subject without a checkedInAt', async () => {
      await expect(
        ctx.prisma.$executeRaw`
          UPDATE "Ticket" SET "checkedInBySub" = 'demo-agent1', "checkedInByUsername" = 'agent1'
          WHERE "id" = ${ticketId}::uuid`,
      ).rejects.toThrow(/ticket_entry_agent/);
    });

    it('refuses an agent subject without its username', async () => {
      await expect(
        ctx.prisma.$executeRaw`
          UPDATE "Ticket" SET "checkedInAt" = now(), "checkedInBySub" = 'demo-agent1'
          WHERE "id" = ${ticketId}::uuid`,
      ).rejects.toThrow(/ticket_entry_agent/);
    });

    it('accepts an entry with no agent (demo check-ins from before this feature)', async () => {
      await expect(
        ctx.prisma.$executeRaw`
          UPDATE "Ticket" SET "checkedInAt" = now() WHERE "id" = ${ticketId}::uuid`,
      ).resolves.toBe(1);
    });

    it('accepts a full entry: time and both agent columns', async () => {
      await expect(
        ctx.prisma.$executeRaw`
          UPDATE "Ticket" SET "checkedInAt" = now(), "checkedInBySub" = 'demo-agent1',
                              "checkedInByUsername" = 'agent1'
          WHERE "id" = ${ticketId}::uuid`,
      ).resolves.toBe(1);
    });
  });
});
