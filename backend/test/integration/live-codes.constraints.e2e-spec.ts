import { randomUUID } from 'node:crypto';
import { event, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 018 research R1 (FR-006): every ticket's entry secret is made by the database, is exactly
 * 32 bytes, and is left out of every query that doesn't name it, in the types as well as at
 * runtime.
 */
describe('Ticket entry secrets', () => {
  let ctx: TestContext;
  let orderId: string;
  let eventId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    eventId = await event(ctx, await venue(ctx, 'Secret Hall'));
    orderId = randomUUID();
    await ctx.prisma.$executeRaw`
      INSERT INTO "Order" ("id", "eventId", "customerSub", "customerUsername", "quantity",
                           "unitPrice", "totalPrice")
      VALUES (${orderId}::uuid, ${eventId}::uuid, 'demo-customer1', 'customer1', 2, 45.00, 90.00)`;
  });

  /** Inserts a ticket by SQL with no entrySecret, as every existing insert path does. */
  const insertTicket = async (code: string): Promise<string> => {
    const id = randomUUID();
    await ctx.prisma.$executeRaw`
      INSERT INTO "Ticket" ("id", "orderId", "eventId", "code")
      VALUES (${id}::uuid, ${orderId}::uuid, ${eventId}::uuid, ${code})`;
    return id;
  };

  const secretOf = async (id: string): Promise<Buffer> => {
    const rows = await ctx.prisma.$queryRaw<{ s: Buffer }[]>`
      SELECT "entrySecret" AS s FROM "Ticket" WHERE "id" = ${id}::uuid`;
    return Buffer.from(rows[0].s);
  };

  it('gives every new ticket its own 32-byte secret', async () => {
    const a = await secretOf(await insertTicket('SECRETAAAAA2'));
    const b = await secretOf(await insertTicket('SECRETAAAAA3'));
    expect(a).toHaveLength(32);
    expect(b).toHaveLength(32);
    expect(a.equals(b)).toBe(false);
  });

  it.each([31, 33])('refuses a %d-byte secret (ticket_entry_secret_32_bytes)', async (n) => {
    const id = await insertTicket('SECRETAAAAA4');
    const bytes = Buffer.alloc(n, 7);
    await expect(
      ctx.prisma.$executeRaw`UPDATE "Ticket" SET "entrySecret" = ${bytes} WHERE "id" = ${id}::uuid`,
    ).rejects.toThrow(/ticket_entry_secret_32_bytes/);
  });

  it('leaves the secret out of every query that does not name it', async () => {
    await insertTicket('SECRETAAAAA5');

    const ticket = await ctx.prisma.ticket.findFirst();
    expect(ticket).not.toBeNull();
    expect(Object.keys(ticket as object)).not.toContain('entrySecret');

    const order = await ctx.prisma.order.findFirst({ include: { tickets: true } });
    expect(order?.tickets).toHaveLength(1);
    for (const t of order?.tickets ?? []) expect(Object.keys(t)).not.toContain('entrySecret');

    // Inside a transaction the omit holds at runtime, though not in `tx`'s types (tasks T007).
    const inTx = await ctx.prisma.$transaction((tx) => tx.ticket.findFirst());
    expect(Object.keys(inTx as object)).not.toContain('entrySecret');

    const named = await ctx.prisma.ticket.findFirst({ select: { entrySecret: true } });
    expect(named?.entrySecret).toHaveLength(32);
  });

  it('leaves it out of the types too', async () => {
    await insertTicket('SECRETAAAAA6');
    const ticket = await ctx.prisma.ticket.findFirstOrThrow();
    // Non-null on purpose: on `T | null` the "possibly null" error alone would satisfy this.
    // @ts-expect-error entrySecret is omitted by PrismaService's global omit (research R1).
    expect(ticket.entrySecret).toBeUndefined();
  });
});
