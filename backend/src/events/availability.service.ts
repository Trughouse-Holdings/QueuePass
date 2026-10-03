import { Injectable, NotFoundException } from '@nestjs/common';
import type { Availability } from '@queuepass/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Tickets left for an event and its tiers, and whether sales are closed (spec 006 FR-002, FR-014;
 * research R1). A plain read without the event lock: the numbers are guidance, and an order
 * decides under the lock. Sales-closed uses the Backend's clock, as ordering does.
 */
@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async forEvent(eventId: string): Promise<Availability> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { tiers: { orderBy: [{ price: 'asc' }, { name: 'asc' }] } },
    });
    if (!event) throw new NotFoundException(`No event exists with id ${eventId}.`);

    // Valid tickets per tier in one query; the `null` group is tierless sales.
    const sold = await this.prisma.ticket.groupBy({
      by: ['tierId'],
      where: { eventId, status: 'VALID' },
      _count: { _all: true },
    });
    const soldIn = (tierId: string | null): number =>
      sold.find((g) => g.tierId === tierId)?._count._all ?? 0;
    const eventSold = sold.reduce((sum, g) => sum + g._count._all, 0);
    const ticketsLeft = Math.max(0, event.totalTicketCapacity - eventSold);

    return {
      eventId,
      ticketsLeft,
      salesClosed:
        event.status === 'CANCELLED'
          ? 'CANCELLED'
          : new Date() >= event.startsAt
            ? 'STARTED'
            : null,
      // Same order as listTicketTiers (TiersService.list).
      tiers: event.tiers.map((t) => ({
        tierId: t.id,
        ticketsLeft: Math.max(0, Math.min(t.quantity - soldIn(t.id), ticketsLeft)),
      })),
    };
  }
}
