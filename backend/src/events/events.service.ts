import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Event, Location, Prisma } from '@prisma/client';
import { SCHEDULING_BUFFER_MINUTES } from '@queuepass/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { SchedulingConflictException } from './scheduling-conflict.exception';

type EventWithLocation = Event & { location: Location };

/** PostgreSQL SQLSTATE for a detected deadlock. */
const PG_DEADLOCK = '40P01';
const DEADLOCK_ATTEMPTS = 3;

const isDeadlock = (err: unknown): boolean =>
  err instanceof Error && err.message.includes(PG_DEADLOCK);

/**
 * Two simultaneous writes for the same venue and window can deadlock inside the
 * event_no_overlap exclusion index: each waits for the other's uncommitted row. PostgreSQL
 * aborts one. Retrying it is safe, because the retry's pre-check then sees the winner and
 * refuses with a normal SCHEDULING_CONFLICT that names it (spec 002 FR-016, FR-017).
 */
async function retryOnDeadlock<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await write();
    } catch (err) {
      if (!isDeadlock(err) || attempt >= DEADLOCK_ATTEMPTS) throw err;
    }
  }
}

/** API shape: basePrice serialized as a decimal string (never a JSON number). */
export interface EventResponse extends Omit<EventWithLocation, 'basePrice'> {
  basePrice: string;
}

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  private toResponse(event: EventWithLocation): EventResponse {
    return { ...event, basePrice: event.basePrice.toFixed(2) };
  }

  create(dto: CreateEventDto): Promise<EventResponse> {
    return retryOnDeadlock(() => this.createOnce(dto));
  }

  private async createOnce(dto: CreateEventDto): Promise<EventResponse> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);

    this.assertWindowOrdered(startsAt, endsAt);
    const location = await this.requireLocation(dto.locationId);
    this.assertCapacityWithinVenue(dto.totalTicketCapacity, location);
    await this.assertNoConflict(dto.locationId, startsAt, endsAt, null);

    const created = await this.prisma.event.create({
      data: {
        name: dto.name,
        locationId: dto.locationId,
        startsAt,
        endsAt,
        totalTicketCapacity: dto.totalTicketCapacity,
        basePrice: dto.basePrice,
      },
      include: { location: true },
    });

    return this.toResponse(created);
  }

  async findAll(locationId?: string): Promise<EventResponse[]> {
    const where: Prisma.EventWhereInput = locationId ? { locationId } : {};
    const events = await this.prisma.event.findMany({
      where,
      include: { location: true },
      orderBy: { startsAt: 'asc' },
    });
    return events.map((e) => this.toResponse(e));
  }

  async findOne(id: string): Promise<EventResponse> {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: { location: true },
    });
    if (!event) throw new NotFoundException(`No event exists with id ${id}.`);
    return this.toResponse(event);
  }

  update(id: string, dto: UpdateEventDto): Promise<EventResponse> {
    return retryOnDeadlock(() => this.updateOnce(id, dto));
  }

  private async updateOnce(id: string, dto: UpdateEventDto): Promise<EventResponse> {
    const existing = await this.prisma.event.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`No event exists with id ${id}.`);

    // The conflict check runs against the DESTINATION venue and DESTINATION window —
    // an edit that only moves the venue must be checked where it is going, not where it was.
    const locationId = dto.locationId ?? existing.locationId;
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : existing.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : existing.endsAt;

    this.assertWindowOrdered(startsAt, endsAt);
    const location = await this.requireLocation(locationId);

    const capacity = dto.totalTicketCapacity ?? existing.totalTicketCapacity;
    this.assertCapacityWithinVenue(capacity, location);

    // `id` is excluded so an event never conflicts with itself (FR-025) — saving an
    // unchanged event must always succeed.
    await this.assertNoConflict(locationId, startsAt, endsAt, id);

    const updated = await this.prisma.event.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.locationId !== undefined ? { locationId: dto.locationId } : {}),
        ...(dto.startsAt !== undefined ? { startsAt } : {}),
        ...(dto.endsAt !== undefined ? { endsAt } : {}),
        ...(dto.totalTicketCapacity !== undefined
          ? { totalTicketCapacity: dto.totalTicketCapacity }
          : {}),
        ...(dto.basePrice !== undefined ? { basePrice: dto.basePrice } : {}),
      },
      include: { location: true },
    });

    return this.toResponse(updated);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.event.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`No event exists with id ${id}.`);
    await this.prisma.event.delete({ where: { id } });
  }

  // ---------------------------------------------------------------- rules

  private assertWindowOrdered(startsAt: Date, endsAt: Date): void {
    if (endsAt <= startsAt) {
      throw new BadRequestException({ message: ['endsAt must be later than startsAt'] });
    }
  }

  private async requireLocation(locationId: string): Promise<Location> {
    const location = await this.prisma.location.findUnique({ where: { id: locationId } });
    if (!location) throw new NotFoundException(`No venue exists with id ${locationId}.`);
    return location;
  }

  private assertCapacityWithinVenue(requested: number, location: Location): void {
    if (requested > location.seatingCapacity) {
      throw new HttpException(
        {
          error: {
            code: 'CAPACITY_EXCEEDED',
            message:
              `Ticket capacity ${requested} exceeds the seating capacity of ` +
              `${location.name} (${location.seatingCapacity}).`,
            details: {
              seatingCapacity: location.seatingCapacity,
              requestedTicketCapacity: requested,
            },
          },
        },
        HttpStatus.CONFLICT,
      );
    }
  }

  /**
   * ⚠️ THIS IS NOT THE ENFORCEMENT MECHANISM. ⚠️
   *
   * The scheduling rule is enforced by the `event_no_overlap` EXCLUDE constraint in
   * backend/prisma/migrations/*_scheduling_constraints/migration.sql. That constraint is
   * the only thing that makes FR-029 true: a read-then-write check like this one has a
   * window between the SELECT and the INSERT in which two concurrent transactions both
   * pass and both commit, producing exactly the double-booking this feature exists to
   * prevent.
   *
   * This query exists for ONE reason: PostgreSQL's 23P01 exclusion violation carries no
   * information about WHICH row conflicted, and FR-027 requires naming the conflicting
   * event. So we look it up first to produce a good error. When this check passes and the
   * constraint still refuses (a genuine race), the exception filter returns the same 409
   * with conflictingEvent: null.
   *
   * DO NOT "simplify" by removing the database constraint because this check looks
   * sufficient. It is not. See research.md R3 and plan.md Complexity Tracking.
   */
  private async assertNoConflict(
    locationId: string,
    startsAt: Date,
    endsAt: Date,
    excludeEventId: string | null,
  ): Promise<void> {
    const bufferMs = SCHEDULING_BUFFER_MINUTES * 60_000;

    // Mirrors the constraint exactly: intervals [start - 60min, end) overlap when
    //   (A.start - 60min) < B.end  AND  (B.start - 60min) < A.end
    const candidateLowerBound = new Date(startsAt.getTime() - bufferMs);

    const conflict = await this.prisma.event.findFirst({
      where: {
        locationId,
        ...(excludeEventId ? { id: { not: excludeEventId } } : {}),
        // existing.startsAt - 60min < candidate.endsAt
        startsAt: { lt: new Date(endsAt.getTime() + bufferMs) },
        // candidate.startsAt - 60min < existing.endsAt
        endsAt: { gt: candidateLowerBound },
      },
      orderBy: { startsAt: 'asc' },
    });

    if (conflict) {
      throw new SchedulingConflictException(conflict);
    }
  }
}
