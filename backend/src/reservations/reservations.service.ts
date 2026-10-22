import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type TicketTier } from '@prisma/client';
import type { Reservation, SeatStateChange } from '@queuepass/shared';
import { RESERVATION_LIMITS } from '@queuepass/shared';
import type { Principal } from '../auth/principal';
import { conflict, eventCancelled } from '../common/conflict';
import { LOCKING_TX, customerHeld, lockEvent, type LockedEvent } from '../common/event-lock';
import { limitMessage } from '../common/ticket-limit';
import { PrismaService } from '../prisma/prisma.service';
import { SeatEventsService } from '../seating/seat-events.service';
import {
  badSeats,
  resolveSeats,
  seatKey,
  seatText,
  soldSeats,
  sortSeats,
  type ResolvedSeat,
  type SeatLabel,
} from '../seating/seat-rules';
import { ReservationInputDto } from './dto/reservation-input.dto';
import { ReservationReleaseDto } from './dto/reservation-release.dto';
import { closeRunOut, endHolds, liveHolds, seatsTaken, toChanges } from './holds';

type Tx = Prisma.TransactionClient;
type Db = PrismaService | Tx;

/** What a locked path did, and the seat changes to publish once it has committed. */
interface Locked<T> {
  result: T;
  changes: SeatStateChange[];
}

/**
 * Research R2, T027: a unique index refused a hold or a second active reservation. Under the event
 * lock only a write from outside the Backend can cause it; the retry's checks then name the seat.
 */
const isHoldCollision = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError &&
  /seat_hold_one_live_per_seat|seat_reservation_one_active/.test(
    `${err.message} ${JSON.stringify(err.meta ?? {})}`,
  );

/** `HH:MM:SS UTC` of a time, for refusal messages; the apps show it in the viewer's own zone. */
const utcTime = (d: Date): string => `${d.toISOString().slice(11, 19)} UTC`;

/**
 * Spec 015 US1 (research R5–R8): reserving seats for 5 minutes, adding to and releasing them, and
 * releasing them all on logout. Every write takes the event's row lock first, the lock orders take
 * (research R2), then closes run-out reservations (research R3). Seat changes are published only
 * after the transaction commits (research R9).
 */
@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seatEvents: SeatEventsService,
  ) {}

  async reserve(
    principal: Principal,
    eventId: string,
    dto: ReservationInputDto,
  ): Promise<{ status: HttpStatus.OK | HttpStatus.CREATED; reservation: Reservation }> {
    for (let attempt = 1; ; attempt++) {
      try {
        const { result, changes } = await this.prisma.$transaction(
          (tx) => this.reserveLocked(tx, principal, eventId, dto),
          LOCKING_TX,
        );
        this.seatEvents.publish(eventId, changes);
        return result;
      } catch (err) {
        if (!isHoldCollision(err) || attempt >= 2) throw err;
      }
    }
  }

  /** Research R5, steps 1 to 7, in order. All or nothing: any refusal rolls everything back. */
  private async reserveLocked(
    tx: Tx,
    principal: Principal,
    eventId: string,
    dto: ReservationInputDto,
  ): Promise<Locked<{ status: HttpStatus.OK | HttpStatus.CREATED; reservation: Reservation }>> {
    // 1. Lock, then close what has run out, so its seats are free for this request.
    const event = await lockEvent(tx, eventId);
    const freed = await closeRunOut(tx, eventId);

    // 2. The event itself. Sales close by the database's clock (research R3).
    if (event.status === 'CANCELLED') throw eventCancelled(event.name);
    if (await salesClosed(tx, eventId)) {
      throw conflict('SALES_CLOSED', `Sales for ${event.name} closed when it started.`);
    }
    if (!event.reservedSeating) {
      throw badSeats('seats can only be reserved for an event with reserved seating');
    }

    // 3. The order's seat rules (seat-rules.ts), then this customer's active reservation.
    const holds = await liveHolds(tx, eventId);
    const active = await tx.seatReservation.findFirst({
      where: { eventId, customerSub: principal.sub, endedAt: null },
    });
    const mine = active ? holds.filter((h) => h.reservationId === active.id) : [];
    const tier = await this.tierFor(tx, event, dto, active?.tierId);
    const seats = await resolveSeats(tx, event, tier, dto.seats);
    const already = seats.filter((s) => mine.some((h) => seatKey(h) === seatKey(s)));
    if (already.length > 0) {
      throw badSeats(`${seatText(already[0])} is already in your reservation`);
    }

    // 4. The 2-minute wait on this customer's own recently ended holds (FR-004a, research R6).
    await this.assertNoWait(tx, eventId, principal.sub, seats);

    // 5. Seats sold, or in another customer's reservation (FR-002).
    const sold = await soldSeats(tx, eventId, seats);
    const others = holds.filter(
      (h) => h.customerSub !== principal.sub && seats.some((s) => seatKey(s) === seatKey(h)),
    );
    if (sold.length > 0 || others.length > 0) throw seatsTaken(sold, others);

    // 6. At most 10 seats, and no more than the 016 limit allows, counting valid tickets only.
    const total = mine.length + seats.length;
    if (total > RESERVATION_LIMITS.maxSeats) {
      throw badSeats(
        `a reservation holds at most ${RESERVATION_LIMITS.maxSeats} seats; ` +
          `this one would hold ${total}`,
      );
    }
    const limit = event.maxTicketsPerCustomer;
    if (limit !== null) {
      const held = await customerHeld(tx, eventId, principal.sub);
      const remaining = Math.max(0, limit - held);
      if (total > remaining) {
        throw conflict('TICKET_LIMIT_REACHED', limitMessage(event.name, limit, held, total), {
          limit,
          held,
          remaining,
          requested: total,
        });
      }
    }

    // 7. A new reservation, or the seats added to the active one with its expiresAt unchanged.
    const reservationId = active?.id ?? (await this.insertReservation(tx, event, principal, tier));
    await this.insertHolds(tx, eventId, reservationId, seats);

    const reservation = await loadReservation(tx, reservationId);
    if (!reservation) throw new Error(`Reservation ${reservationId} vanished in its transaction.`);
    return {
      result: { status: active ? HttpStatus.OK : HttpStatus.CREATED, reservation },
      changes: [
        ...(await toChanges(tx, event.locationId, freed, 'open')),
        ...seats.map((s) => ({
          sectionId: s.sectionId,
          row: s.row,
          seat: s.seat,
          state: 'reserved' as const,
        })),
      ],
    };
  }

  /**
   * The reservation's tier (research R5): the active one's, or the tier of the first seat's
   * section; `null` for an event without tiers. A first seat in a section not for sale is `400`,
   * after the layout rules have had their say.
   */
  private async tierFor(
    tx: Tx,
    event: LockedEvent,
    dto: ReservationInputDto,
    activeTierId: string | null | undefined,
  ): Promise<TicketTier | null> {
    const tiers = await tx.ticketTier.findMany({ where: { eventId: event.id } });
    if (tiers.length === 0) return null;
    if (activeTierId) {
      const tier = tiers.find((t) => t.id === activeTierId);
      if (tier) return tier;
    }
    const first = dto.seats[0];
    const mapping = await tx.sectionTier.findUnique({
      where: { eventId_sectionId: { eventId: event.id, sectionId: first.sectionId } },
    });
    const tier = tiers.find((t) => t.id === mapping?.tierId);
    if (tier) return tier;
    const [label] = await resolveSeats(tx, event, null, [first]);
    throw badSeats(`${seatText(label)} is not for sale`);
  }

  private async assertNoWait(
    tx: Tx,
    eventId: string,
    customerSub: string,
    seats: SeatLabel[],
  ): Promise<void> {
    const recent = await tx.$queryRaw<
      { seatSection: string; seatRow: number; seatNumber: number; availableAt: Date }[]
    >`
      SELECT h."seatSection", h."seatRow", h."seatNumber",
             h."releasedAt" + interval '2 minutes' AS "availableAt"
      FROM "SeatHold" h JOIN "SeatReservation" r ON r."id" = h."reservationId"
      WHERE h."eventId" = ${eventId}::uuid AND r."customerSub" = ${customerSub}
        AND h."endReason" IN ('EXPIRED', 'RELEASED', 'LOGOUT')
        AND now() < h."releasedAt" + interval '2 minutes'`;
    const waiting = recent.filter((h) =>
      seats.some(
        (s) => s.section === h.seatSection && s.row === h.seatRow && s.seat === h.seatNumber,
      ),
    );
    if (waiting.length === 0) return;
    const labels = sortSeats(
      waiting.map((h) => ({ section: h.seatSection, row: h.seatRow, seat: h.seatNumber })),
    );
    const availableAt = new Date(Math.max(...waiting.map((h) => h.availableAt.getTime())));
    throw conflict(
      'SEAT_COOLDOWN',
      `You released ${labels.map(seatText).join('; ')} less than 2 minutes ago. You can ` +
        `reserve ${labels.length === 1 ? 'it' : 'them'} again at ${utcTime(availableAt)}.`,
      { seats: labels, availableAt: availableAt.toISOString() },
    );
  }

  private async insertReservation(
    tx: Tx,
    event: LockedEvent,
    principal: Principal,
    tier: TicketTier | null,
  ): Promise<string> {
    const [{ id }] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "SeatReservation" ("id", "eventId", "customerSub", "tierId", "createdAt", "expiresAt")
      VALUES (gen_random_uuid(), ${event.id}::uuid, ${principal.sub}, ${tier?.id ?? null}::uuid,
              now(), now() + interval '5 minutes')
      RETURNING "id"`;
    return id;
  }

  private async insertHolds(
    tx: Tx,
    eventId: string,
    reservationId: string,
    seats: ResolvedSeat[],
  ): Promise<void> {
    for (const s of seats) {
      await tx.$executeRaw`
        INSERT INTO "SeatHold" ("id", "reservationId", "eventId", "seatSection", "seatRow",
                                "seatNumber", "createdAt")
        VALUES (gen_random_uuid(), ${reservationId}::uuid, ${eventId}::uuid, ${s.section},
                ${s.row}, ${s.seat}, now())`;
    }
  }

  /**
   * Research R8: releases the listed seats, or all of them, with `RELEASED` (which starts the
   * 2-minute wait), and ends the reservation once no seat is left. Without an active reservation
   * nothing happens, so a repeat is harmless.
   */
  async release(
    principal: Principal,
    eventId: string,
    dto: ReservationReleaseDto,
  ): Promise<{ reservation: Reservation | null }> {
    const { result, changes } = await this.prisma.$transaction(async (tx) => {
      const event = await lockEvent(tx, eventId);
      const freed = await closeRunOut(tx, eventId);
      const active = await tx.seatReservation.findFirst({
        where: { eventId, customerSub: principal.sub, endedAt: null },
      });
      const opened = await toChanges(tx, event.locationId, freed, 'open');
      if (!active) return { result: { reservation: null }, changes: opened };

      const mine = (await liveHolds(tx, eventId)).filter((h) => h.reservationId === active.id);
      let targets = mine;
      if (dto.seats) {
        const sections = await tx.section.findMany({ where: { locationId: event.locationId } });
        targets = dto.seats.map((c) => {
          const name = sections.find((s) => s.id === c.sectionId)?.name;
          const hold = mine.find((h) => h.section === name && h.row === c.row && h.seat === c.seat);
          if (!hold) {
            const label = name ? seatText({ section: name, row: c.row, seat: c.seat }) : null;
            throw badSeats(
              label
                ? `${label} is not in your reservation`
                : `section ${c.sectionId} is not part of this venue's layout`,
            );
          }
          return hold;
        });
      }
      await endHolds(tx, eventId, targets, 'RELEASED');
      return {
        result: { reservation: await loadReservation(tx, active.id) },
        changes: [...opened, ...(await toChanges(tx, event.locationId, targets, 'open'))],
      };
    }, LOCKING_TX);
    this.seatEvents.publish(eventId, changes);
    return result;
  }

  /** Research R8: the caller's active reservations, for every event, newest first. */
  listMine(principal: Principal): Promise<Reservation[]> {
    return loadReservations(
      this.prisma,
      Prisma.sql`r."customerSub" = ${principal.sub} AND r."endedAt" IS NULL AND now() < r."expiresAt"`,
    );
  }

  /**
   * Research R8: logout. Ends every active reservation of the caller with `LOGOUT`, one event at a
   * time in event-id order, each in its own transaction under that event's lock.
   */
  async releaseAllMine(principal: Principal): Promise<{ released: number }> {
    const events = await this.prisma.seatReservation.findMany({
      where: { customerSub: principal.sub, endedAt: null },
      select: { eventId: true },
      distinct: ['eventId'],
      orderBy: { eventId: 'asc' },
    });
    let released = 0;
    for (const { eventId } of events) {
      try {
        const { result, changes } = await this.prisma.$transaction(async (tx) => {
          const event = await lockEvent(tx, eventId);
          const freed = await closeRunOut(tx, eventId);
          const mine = (await liveHolds(tx, eventId)).filter(
            (h) => h.customerSub === principal.sub,
          );
          await endHolds(tx, eventId, mine, 'LOGOUT');
          return {
            result: mine.length,
            changes: await toChanges(tx, event.locationId, [...freed, ...mine], 'open'),
          };
        }, LOCKING_TX);
        released += result;
        this.seatEvents.publish(eventId, changes);
      } catch (err) {
        // Deleted meanwhile: its reservations went with it (research R11).
        if (!(err instanceof NotFoundException)) throw err;
      }
    }
    return { released };
  }
}

/** Research R3: whether the event has started, by the database's clock. */
export async function salesClosed(tx: Tx, eventId: string): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ closed: boolean }[]>`
    SELECT now() >= "startsAt" AS "closed" FROM "Event" WHERE "id" = ${eventId}::uuid`;
  return row?.closed ?? false;
}

/** One reservation as the API returns it, or `null` once it has ended. */
async function loadReservation(db: Db, id: string): Promise<Reservation | null> {
  const [reservation] = await loadReservations(
    db,
    Prisma.sql`r."id" = ${id}::uuid AND r."endedAt" IS NULL`,
  );
  return reservation ?? null;
}

/**
 * Reservations as the API returns them (contracts/openapi.yaml `Reservation`), newest first, with
 * their live seats in layout order. `secondsLeft` is the database's (research R3), clamped to the
 * contract's 0–300 for a reservation made by a transaction that started after this one.
 */
async function loadReservations(db: Db, where: Prisma.Sql): Promise<Reservation[]> {
  const rows = await db.$queryRaw<
    {
      id: string;
      eventId: string;
      tierId: string | null;
      createdAt: Date;
      expiresAt: Date;
      secondsLeft: number;
    }[]
  >`
    SELECT r."id", r."eventId", r."tierId", r."createdAt", r."expiresAt",
           greatest(0, least(300, floor(extract(epoch FROM r."expiresAt" - now()))))::int
             AS "secondsLeft"
    FROM "SeatReservation" r
    WHERE ${where}
    ORDER BY r."createdAt" DESC, r."id" DESC`;
  if (rows.length === 0) return [];
  const ids = Prisma.join(rows.map((r) => Prisma.sql`${r.id}::uuid`));
  const seats = await db.$queryRaw<
    {
      reservationId: string;
      sectionId: string;
      seatSection: string;
      seatRow: number;
      seatNumber: number;
    }[]
  >`
    SELECT h."reservationId", s."id" AS "sectionId", h."seatSection", h."seatRow", h."seatNumber"
    FROM "SeatHold" h
    JOIN "Event" e ON e."id" = h."eventId"
    JOIN "Section" s ON s."locationId" = e."locationId" AND s."name" = h."seatSection"
    WHERE h."reservationId" IN (${ids}) AND h."releasedAt" IS NULL
    ORDER BY s."position", h."seatRow", h."seatNumber"`;
  return rows
    .map((r) => ({
      eventId: r.eventId,
      tierId: r.tierId,
      seats: seats
        .filter((s) => s.reservationId === r.id)
        .map((s) => ({
          sectionId: s.sectionId,
          section: s.seatSection,
          row: s.seatRow,
          seat: s.seatNumber,
        })),
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      secondsLeft: r.secondsLeft,
    }))
    .filter((r) => r.seats.length > 0);
}
