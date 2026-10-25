import { HttpException } from '@nestjs/common';
import { EventsService } from '../../src/events/events.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { SeatEventsService } from '../../src/seating/seat-events.service';

/**
 * Spec 020 research R10 (implementation review round 1, m1): an event update reads the event's
 * venue, then locks it FOR SHARE and the event; if the event moved to another venue meanwhile, it
 * retries. When it keeps moving on every attempt, the update answers 409 SCHEDULING_CONFLICT (the
 * race shape, conflictingEvent null), never a 500.
 */
describe('EventsService.update when the event keeps moving venue', () => {
  it('gives up with 409 SCHEDULING_CONFLICT after its retries', async () => {
    const locked = {
      id: 'e1',
      name: 'Show',
      totalTicketCapacity: 10,
      maxTicketsPerCustomer: null,
      basePrice: '1.00',
      status: 'SCHEDULED',
      startsAt: new Date('2027-01-01T00:00:00Z'),
      reservedSeating: false,
      // Never the venue read before the lock.
      locationId: 'venue-b',
    };
    const tx = { $queryRaw: jest.fn().mockResolvedValue([locked]) };
    const prisma = {
      event: { findUnique: jest.fn().mockResolvedValue({ locationId: 'venue-a' }) },
      $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    };
    const service = new EventsService(prisma as unknown as PrismaService, {} as SeatEventsService);

    const err = await service.update('e1', { name: 'Renamed' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    const http = err as HttpException;
    expect(http.getStatus()).toBe(409);
    expect(http.getResponse()).toMatchObject({
      error: {
        code: 'SCHEDULING_CONFLICT',
        details: { bufferMinutes: 60, conflictingEvent: null },
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });
});
