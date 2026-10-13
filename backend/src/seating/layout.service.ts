import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, Section } from '@prisma/client';
import type { SeatingLayout } from '@queuepass/shared';
import { conflict } from '../common/conflict';
import { LOCKING_TX } from '../common/event-lock';
import { lockVenueAndEvents } from '../common/venue-lock';
import { PrismaService } from '../prisma/prisma.service';
import { LayoutInputDto } from './dto/layout-input.dto';
import { recalcSeatedTiers } from './tier-seats';

const toLayout = (locationId: string, sections: Section[]): SeatingLayout => ({
  locationId,
  totalSeats: sections.reduce((n, s) => n + s.rows * s.seatsPerRow, 0),
  sections: sections.map((s) => ({
    id: s.id,
    name: s.name,
    rows: s.rows,
    seatsPerRow: s.seatsPerRow,
  })),
});

/**
 * A venue's seating layout (spec 007 US1; research R3, R4). Writes lock the venue row and then
 * every scheduled event at the venue, in id order, so no order, seating switch, or event edit
 * for those events can slip in between the checks and the write (`common/venue-lock.ts`, shared
 * with venue updates, spec 013 research R7). Nothing else locks an event and then a venue, so
 * these locks never deadlock.
 */
@Injectable()
export class LayoutService {
  constructor(private readonly prisma: PrismaService) {}

  async get(locationId: string): Promise<SeatingLayout> {
    const venue = await this.prisma.location.findUnique({
      where: { id: locationId },
      include: { sections: { orderBy: { position: 'asc' } } },
    });
    if (!venue) throw new NotFoundException(`No venue exists with id ${locationId}.`);
    return toLayout(locationId, venue.sections);
  }

  replace(locationId: string, dto: LayoutInputDto): Promise<SeatingLayout> {
    return this.prisma.$transaction(async (tx) => {
      const venue = await lockVenueAndEvents(tx, locationId);

      const names = dto.sections.map((s) => s.name.toLowerCase());
      const repeated = names.find((n, i) => names.indexOf(n) !== i);
      if (repeated !== undefined) {
        throw new BadRequestException({
          message: [`section names must be unique ignoring case; '${repeated}' repeats`],
        });
      }
      const totalSeats = dto.sections.reduce((n, s) => n + s.rows * s.seatsPerRow, 0);
      await this.assertNoSeatedSales(tx, locationId, venue.name);

      // FR-017: the layout becomes the venue's capacity, so a general-admission event that
      // already sells more than the new total would exceed its venue (spec 002).
      const tooBig = await tx.event.findFirst({
        where: {
          locationId,
          status: 'SCHEDULED',
          reservedSeating: false,
          totalTicketCapacity: { gt: totalSeats },
        },
        orderBy: { totalTicketCapacity: 'desc' },
      });
      if (tooBig) {
        throw conflict(
          'CAPACITY_EXCEEDED',
          `The layout has ${totalSeats.toLocaleString('en-US')} seats, fewer than "${tooBig.name}" ` +
            `sells (${tooBig.totalTicketCapacity.toLocaleString('en-US')} tickets). Lower its ` +
            'capacity first.',
          { totalSeats, conflictingEvent: { id: tooBig.id, name: tooBig.name } },
        );
      }

      // Spec 016 research R6: the total becomes every scheduled seated event's capacity, which
      // may never fall below its per-customer limit.
      const overLimit = await tx.event.findFirst({
        where: {
          locationId,
          status: 'SCHEDULED',
          reservedSeating: true,
          maxTicketsPerCustomer: { gt: totalSeats },
        },
        orderBy: { maxTicketsPerCustomer: 'desc' },
      });
      if (overLimit) {
        throw conflict(
          'CAPACITY_EXCEEDED',
          `The layout has ${totalSeats.toLocaleString('en-US')} seats, fewer than ` +
            `"${overLimit.name}" allows per customer ` +
            `(${(overLimit.maxTicketsPerCustomer ?? 0).toLocaleString('en-US')} tickets). Lower ` +
            'its limit first.',
          { totalSeats, conflictingEvent: { id: overLimit.id, name: overLimit.name } },
        );
      }

      // Deleting the sections drops every event's mappings at this venue (ON DELETE CASCADE).
      await tx.section.deleteMany({ where: { locationId } });
      await tx.section.createMany({
        data: dto.sections.map((s, position) => ({ ...s, locationId, position })),
      });
      const sections = await tx.section.findMany({
        where: { locationId },
        orderBy: { position: 'asc' },
      });

      // FR-017, FR-018 (research R11): the total is the venue's capacity and every scheduled
      // seated event's; their mappings went with the old sections, so their tiers drop to 0.
      await tx.location.update({
        where: { id: locationId },
        data: { seatingCapacity: totalSeats },
      });
      const seated = await tx.event.findMany({
        where: { locationId, status: 'SCHEDULED', reservedSeating: true },
        select: { id: true },
      });
      for (const e of seated) {
        await tx.event.update({ where: { id: e.id }, data: { totalTicketCapacity: totalSeats } });
        await recalcSeatedTiers(tx, e.id);
      }
      return toLayout(locationId, sections);
    }, LOCKING_TX);
  }

  remove(locationId: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const venue = await lockVenueAndEvents(tx, locationId);
      await this.assertNoSeatedSales(tx, locationId, venue.name);

      const seated = await tx.event.findMany({
        where: { locationId, status: 'SCHEDULED', reservedSeating: true },
        select: { id: true, name: true },
        orderBy: { startsAt: 'asc' },
      });
      if (seated.length > 0) {
        throw conflict(
          'LAYOUT_IN_USE',
          `The seating layout of ${venue.name} can't be removed while ${names(seated)} ` +
            `${seated.length === 1 ? 'has' : 'have'} reserved seating on.`,
          { events: seated },
        );
      }
      await tx.section.deleteMany({ where: { locationId } });
    }, LOCKING_TX);
  }

  /** Total seats in a venue's layout; 0 without one (spec 007 research R3, venue edits). */
  async totalSeats(locationId: string): Promise<number> {
    const sections = await this.prisma.section.findMany({ where: { locationId } });
    return sections.reduce((n, s) => n + s.rows * s.seatsPerRow, 0);
  }

  /** FR-003: no change while a scheduled seated event at the venue has valid tickets. */
  private async assertNoSeatedSales(
    tx: Prisma.TransactionClient,
    locationId: string,
    venueName: string,
  ): Promise<void> {
    const blocking = await tx.event.findMany({
      where: {
        locationId,
        status: 'SCHEDULED',
        reservedSeating: true,
        tickets: { some: { status: 'VALID' } },
      },
      select: { id: true, name: true },
      orderBy: { startsAt: 'asc' },
    });
    if (blocking.length > 0) {
      throw conflict(
        'LAYOUT_IN_USE',
        `The seating layout of ${venueName} is in use by ${names(blocking)}, which ` +
          `${blocking.length === 1 ? 'has' : 'have'} sold seats.`,
        { events: blocking },
      );
    }
  }
}

const names = (events: { name: string }[]): string => events.map((e) => `"${e.name}"`).join(', ');
