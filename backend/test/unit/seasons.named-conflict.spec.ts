import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { SeatEventsService } from '../../src/seating/seat-events.service';
import { SeasonsService } from '../../src/seasons/seasons.service';

/**
 * Spec 041 research R2 (implementation review): the primary key of `SeasonEvent` is the guarantee
 * that an event is in one Season; a violation the pre-check did not see becomes the same
 * `409 EVENT_IN_SEASON`, naming the event by its index and the Season that took it first.
 */
describe('SeasonsService: a SeasonEvent primary key violation (R2)', () => {
  const taken = jest.fn();
  const prisma = { seasonEvent: { findMany: taken } } as unknown as PrismaService;
  const service = new SeasonsService(prisma, {} as SeatEventsService);
  const named = (err: unknown, ids: string[], seasonId: string | null) =>
    (
      service as unknown as {
        namedEventConflict(e: unknown, i: string[], s: string | null): Promise<unknown>;
      }
    ).namedEventConflict(err, ids, seasonId);
  const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6',
    meta: { modelName: 'SeasonEvent', target: ['eventId'] },
  });
  const body = (e: unknown) =>
    (e as HttpException).getResponse() as { error: Record<string, unknown> };

  beforeEach(() => taken.mockReset());

  it('names the event the winner took, by its index, and the Season', async () => {
    taken.mockResolvedValue([
      { eventId: 'e2', event: { name: 'Game 2' }, season: { id: 's9', name: 'Winter' } },
    ]);
    const err = await named(p2002, ['e1', 'e2'], 's1');
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(409);
    expect(body(err).error).toMatchObject({
      code: 'EVENT_IN_SEASON',
      details: { field: 'eventIds.1', seasonId: 's9', seasonName: 'Winter' },
    });
    expect(taken).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: { in: ['e1', 'e2'] }, seasonId: { not: 's1' } },
      }),
    );
  });

  it('still says EVENT_IN_SEASON when the winner can no longer be found', async () => {
    taken.mockResolvedValue([]);
    const err = await named(p2002, ['e1'], null);
    expect(body(err).error).toMatchObject({
      code: 'EVENT_IN_SEASON',
      details: { field: 'eventIds' },
    });
  });

  it('passes any other error on unchanged', async () => {
    const other = new Error('boom');
    expect(await named(other, ['e1'], null)).toBe(other);
    const tierName = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '6',
      meta: { modelName: 'TicketTier', target: ['name'] },
    });
    expect(await named(tierName, ['e1'], null)).toBe(tierName);
    expect(taken).not.toHaveBeenCalled();
  });
});
