import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { SeatMap } from '@queuepass/shared';
import { conflict, eventCancelled } from '../common/conflict';
import { LOCKING_TX, lockEvent } from '../common/event-lock';
import { PrismaService } from '../prisma/prisma.service';
import { closeHolds, closeRunOut, toChanges } from '../reservations/holds';
import { SeatingInputDto } from './dto/seating-input.dto';
import { SeatEventsService } from './seat-events.service';
import { recalcSeatedTiers } from './tier-seats';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Reserved seating, section tiers, and the seat map (spec 007 US2, US4; research R5). Writes
 * take the event lock that orders take, so a switch or remap and a sale never interleave.
 */
@Injectable()
export class SeatMapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seatEvents: SeatEventsService,
  ) {}

  async forEvent(eventId: string, db: Db = this.prisma): Promise<SeatMap> {
    const event = await db.event.findUnique({
      where: { id: eventId },
      include: {
        location: { include: { sections: { orderBy: { position: 'asc' } } } },
        sectionTiers: true,
      },
    });
    if (!event) throw new NotFoundException(`No event exists with id ${eventId}.`);

    // FR-013: seats only, by label; never the order or customer holding them.
    const taken = await db.ticket.findMany({
      where: { eventId, status: 'VALID', seatSection: { not: null } },
      select: { seatSection: true, seatRow: true, seatNumber: true },
      orderBy: [{ seatSection: 'asc' }, { seatRow: 'asc' }, { seatNumber: 'asc' }],
    });
    // Spec 015 FR-012, FR-014 (research R10): live holds of active reservations, by the database's
    // clock. A run-out reservation the sweep hasn't closed yet is already open here (research R3).
    const reserved = await db.$queryRaw<
      { seatSection: string; seatRow: number; seatNumber: number }[]
    >`
      SELECT h."seatSection", h."seatRow", h."seatNumber"
      FROM "SeatHold" h JOIN "SeatReservation" r ON r."id" = h."reservationId"
      WHERE h."eventId" = ${eventId}::uuid AND h."releasedAt" IS NULL
        AND r."endedAt" IS NULL AND now() < r."expiresAt"
      ORDER BY h."seatRow", h."seatNumber"`;

    return {
      eventId,
      reservedSeating: event.reservedSeating,
      sections: event.location.sections.map((s) => {
        const mine = taken
          .filter((t) => t.seatSection === s.name)
          .map((t) => ({ row: t.seatRow as number, seat: t.seatNumber as number }));
        return {
          sectionId: s.id,
          name: s.name,
          rows: s.rows,
          seatsPerRow: s.seatsPerRow,
          tierId: event.sectionTiers.find((m) => m.sectionId === s.id)?.tierId ?? null,
          sold: mine.length,
          taken: mine,
          reserved: reserved
            .filter((h) => h.seatSection === s.name)
            .map((h) => ({ row: h.seatRow, seat: h.seatNumber })),
        };
      }),
    };
  }

  async update(eventId: string, dto: SeatingInputDto): Promise<SeatMap> {
    const { result, changes } = await this.prisma.$transaction(async (tx) => {
      const event = await lockEvent(tx, eventId);
      if (event.status === 'CANCELLED') throw eventCancelled(event.name);

      const sold = await tx.ticket.count({ where: { eventId, status: 'VALID' } });
      if (dto.reservedSeating !== event.reservedSeating && sold > 0) {
        throw conflict(
          'EVENT_HAS_ORDERS',
          `${event.name} has sold tickets, so reserved seating can no longer be switched ` +
            `${dto.reservedSeating ? 'on' : 'off'}.`,
          { ticketsSold: sold },
        );
      }

      const sections = await tx.section.findMany({ where: { locationId: event.locationId } });
      if (dto.reservedSeating && sections.length === 0) {
        throw new BadRequestException({
          message: [`reservedSeating needs a seating layout; ${event.name}'s venue has none`],
        });
      }

      const tierIds = new Set(
        (await tx.ticketTier.findMany({ where: { eventId }, select: { id: true } })).map(
          (t) => t.id,
        ),
      );
      const seen = new Set<string>();
      for (const m of dto.sections) {
        const section = sections.find((s) => s.id === m.sectionId);
        if (!section) {
          throw new BadRequestException({
            message: [`section ${m.sectionId} is not part of this event's venue layout`],
          });
        }
        if (!tierIds.has(m.tierId)) {
          throw new BadRequestException({
            message: [`tier ${m.tierId} is not a tier of this event`],
          });
        }
        if (seen.has(m.sectionId)) {
          throw new BadRequestException({ message: [`section ${section.name} is mapped twice`] });
        }
        seen.add(m.sectionId);
      }

      // FR-004: a section with valid tickets keeps its tier.
      const current = await tx.sectionTier.findMany({ where: { eventId } });
      for (const s of sections) {
        const before = current.find((m) => m.sectionId === s.id)?.tierId ?? null;
        const after = dto.sections.find((m) => m.sectionId === s.id)?.tierId ?? null;
        if (before === after) continue;
        const soldHere = await tx.ticket.count({
          where: { eventId, status: 'VALID', seatSection: s.name },
        });
        if (soldHere > 0) {
          throw conflict(
            'EVENT_HAS_ORDERS',
            `Section ${s.name} has sold seats, so it stays in its tier.`,
            { section: s.name, ticketsSold: soldHere },
          );
        }
      }

      // Spec 015 FR-016 (research R11): turning reserved seating off ends every reservation, and
      // a section whose tier changes loses its reserved seats. CLOSED: no 2-minute wait.
      const moved = new Set(
        sections
          .filter(
            (s) =>
              (current.find((m) => m.sectionId === s.id)?.tierId ?? null) !==
              (dto.sections.find((m) => m.sectionId === s.id)?.tierId ?? null),
          )
          .map((s) => s.name),
      );
      const freed = [
        ...(await closeRunOut(tx, eventId)),
        ...(await closeHolds(tx, eventId, (h) => !dto.reservedSeating || moved.has(h.section))),
      ];
      const opened = await toChanges(tx, event.locationId, freed, 'open');

      // FR-018 (research R11): a seated event's capacity is its venue's layout total. Turning
      // seating off keeps the number, which is typed again from then on.
      const layoutSeats = sections.reduce((n, s) => n + s.rows * s.seatsPerRow, 0);
      await tx.event.update({
        where: { id: eventId },
        data: {
          reservedSeating: dto.reservedSeating,
          ...(dto.reservedSeating ? { totalTicketCapacity: layoutSeats } : {}),
        },
      });
      await tx.sectionTier.deleteMany({ where: { eventId } });
      if (dto.sections.length > 0) {
        await tx.sectionTier.createMany({
          data: dto.sections.map((m) => ({ eventId, sectionId: m.sectionId, tierId: m.tierId })),
        });
      }
      // FR-006: each tier's amount follows its sections while seating is on.
      if (dto.reservedSeating) await recalcSeatedTiers(tx, eventId);
      return { result: await this.forEvent(eventId, tx), changes: opened };
    }, LOCKING_TX);
    this.seatEvents.publish(eventId, changes);
    return result;
  }
}
