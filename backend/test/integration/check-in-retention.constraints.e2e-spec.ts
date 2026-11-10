import { event, venue } from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';

/**
 * Spec 032 FR-015 (data-model.md, Constitution IV): an event's removal instant and kept count are
 * both set or both empty, the count never negative, proven with writes made directly by SQL,
 * below the Backend.
 */
describe('event_check_ins_removed_together', () => {
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
    eventId = await event(ctx, await venue(ctx, 'Retention Hall'));
  });

  const set = (removedAt: Date | null, count: number | null): Promise<number> =>
    ctx.prisma.$executeRaw`
      UPDATE "Event" SET "checkInDetailsRemovedAt" = ${removedAt}::timestamptz,
                         "keptCheckedInCount" = ${count}::integer
      WHERE "id" = ${eventId}::uuid`;

  it('refuses a removal instant without a count', async () => {
    await expect(set(new Date(), null)).rejects.toThrow(/event_check_ins_removed_together/);
  });

  it('refuses a count without a removal instant', async () => {
    await expect(set(null, 3)).rejects.toThrow(/event_check_ins_removed_together/);
  });

  it('refuses a negative count', async () => {
    await expect(set(new Date(), -1)).rejects.toThrow(/event_check_ins_removed_together/);
  });

  it('accepts both set, with a count of 0', async () => {
    await expect(set(new Date(), 0)).resolves.toBe(1);
  });

  it('accepts both empty (an event not removed)', async () => {
    await expect(set(null, null)).resolves.toBe(1);
  });
});
