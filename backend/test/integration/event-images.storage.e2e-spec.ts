import { Prisma } from '@prisma/client';
import { event, venue } from '../setup/fixtures';
import { resetDb } from '../setup/reset-db';
import { createTestApp, TestContext } from '../setup/test-app';

/**
 * Spec 014 FR-001, FR-003 to FR-005, FR-009, FR-011; data-model.md; research R2. What the database
 * itself guarantees about event images, written straight to PostgreSQL, past the Backend.
 */
describe('EventImage storage rules', () => {
  let ctx: TestContext;
  let eventId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    eventId = await event(ctx, await venue(ctx));
  });

  /**
   * A violation of `event_image_position_unique`. Prisma's raw-query error does not repeat the
   * constraint's name, only SQLSTATE 23505 and the key ("eventId", "position"), its only key.
   */
  const POSITION_UNIQUE = /23505[\s\S]*\("eventId", "position"\)/;

  type Db = Pick<Prisma.TransactionClient, '$executeRaw'>;
  const insert = (
    position: number,
    opts: { contentType?: string; bytes?: Buffer; byteSize?: number; db?: Db } = {},
  ) => {
    const bytes = opts.bytes ?? Buffer.from([1, 2, 3]);
    const db = opts.db ?? ctx.prisma;
    return db.$executeRaw`
      INSERT INTO "EventImage" ("id", "eventId", "position", "contentType", "byteSize", "bytes")
      VALUES (gen_random_uuid(), ${eventId}::uuid, ${position}, ${opts.contentType ?? 'image/png'},
              ${opts.byteSize ?? bytes.length}, ${bytes})`;
  };
  const positions = async (): Promise<number[]> =>
    (
      await ctx.prisma.$queryRaw<{ position: number }[]>`
        SELECT "position" FROM "EventImage" WHERE "eventId" = ${eventId}::uuid ORDER BY "position"`
    ).map((r) => r.position);

  it('accepts a row at position 1 with a size equal to its bytes', async () => {
    await expect(insert(1)).resolves.toBe(1);
    expect(await positions()).toEqual([1]);
  });

  it('refuses positions 0 and 6', async () => {
    await expect(insert(0)).rejects.toThrow(/event_image_position_range/);
    await expect(insert(6)).rejects.toThrow(/event_image_position_range/);
  });

  it('refuses a type other than the three', async () => {
    await expect(insert(1, { contentType: 'image/gif' })).rejects.toThrow(
      /event_image_content_type/,
    );
  });

  it('refuses a size over 5 MB, of 0, or different from the bytes', async () => {
    const over = Buffer.alloc(5_242_881, 1);
    await expect(insert(1, { bytes: over })).rejects.toThrow(/event_image_byte_size/);
    await expect(insert(1, { bytes: Buffer.alloc(0) })).rejects.toThrow(/event_image_byte_size/);
    await expect(insert(1, { byteSize: 4 })).rejects.toThrow(/event_image_byte_size/);
    expect(await positions()).toEqual([]);
  });

  it('refuses a repeated position at the statement, not at commit', async () => {
    let failedAt: 'statement' | 'commit' | null = null;
    await expect(
      ctx.prisma.$transaction(async (tx) => {
        await insert(2, { db: tx });
        try {
          await insert(2, { db: tx });
        } catch (e) {
          failedAt = 'statement';
          throw e;
        }
        failedAt = 'commit';
      }),
    ).rejects.toThrow(POSITION_UNIQUE);
    expect(failedAt).toBe('statement');
  });

  it('holds positions 1 to 5 and no sixth row at any position', async () => {
    for (const p of [1, 2, 3, 4, 5]) await insert(p);
    for (const p of [1, 2, 3, 4, 5]) await expect(insert(p)).rejects.toThrow(POSITION_UNIQUE);
    await expect(insert(6)).rejects.toThrow(/event_image_position_range/);
    expect(await positions()).toEqual([1, 2, 3, 4, 5]);
  });

  it('swaps two positions in one UPDATE, with no SET CONSTRAINTS', async () => {
    await insert(1, { bytes: Buffer.from([1]) });
    await insert(2, { bytes: Buffer.from([2, 2]) });
    await ctx.prisma.$executeRaw`
      UPDATE "EventImage" SET "position" = CASE "position" WHEN 1 THEN 2 ELSE 1 END
      WHERE "eventId" = ${eventId}::uuid`;
    const rows = await ctx.prisma.$queryRaw<{ position: number; byteSize: number }[]>`
      SELECT "position", "byteSize" FROM "EventImage" WHERE "eventId" = ${eventId}::uuid
      ORDER BY "position"`;
    expect(rows).toEqual([
      { position: 1, byteSize: 2 },
      { position: 2, byteSize: 1 },
    ]);
  });

  it('closes the gap after deleting position 1 in one UPDATE', async () => {
    for (const p of [1, 2, 3, 4, 5]) await insert(p);
    await ctx.prisma.$executeRaw`
      DELETE FROM "EventImage" WHERE "eventId" = ${eventId}::uuid AND "position" = 1`;
    await ctx.prisma.$executeRaw`
      UPDATE "EventImage" SET "position" = "position" - 1
      WHERE "eventId" = ${eventId}::uuid AND "position" > 1`;
    expect(await positions()).toEqual([1, 2, 3, 4]);
  });

  it('refuses the same swap as two separate UPDATEs, at the first', async () => {
    await insert(1);
    await insert(2);
    await expect(
      ctx.prisma.$executeRaw`
        UPDATE "EventImage" SET "position" = 2
        WHERE "eventId" = ${eventId}::uuid AND "position" = 1`,
    ).rejects.toThrow(POSITION_UNIQUE);
  });

  it("deletes an event's images with the event", async () => {
    await insert(1);
    await insert(2);
    await ctx.prisma.$executeRaw`DELETE FROM "Event" WHERE "id" = ${eventId}::uuid`;
    const left = await ctx.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "EventImage" WHERE "eventId" = ${eventId}::uuid`;
    expect(Number(left[0]!.n)).toBe(0);
  });
});
