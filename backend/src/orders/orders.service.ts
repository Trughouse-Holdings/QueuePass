import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type EventStatus, type Order, type Ticket, type TicketTier } from '@prisma/client';
import {
  holderNameMessage,
  holderNameProblem,
  normalizeHolderName,
  type SeatStateChange,
  type UsTimeZone,
} from '@queuepass/shared';
import type { Principal } from '../auth/principal';
import { conflict, eventCancelled } from '../common/conflict';
import {
  LOCKING_TX,
  type LockedEvent,
  customerHeld,
  lockEvent,
  ticketsSold,
} from '../common/event-lock';
import { limitMessage } from '../common/ticket-limit';
import { PrismaService } from '../prisma/prisma.service';
import {
  closeRunOut,
  endHolds,
  liveHolds,
  seatsTaken,
  toChanges,
  type LiveHold,
} from '../reservations/holds';
import { SeatEventsService } from '../seating/seat-events.service';
import {
  badSeats,
  resolveSeats,
  seatKey,
  seatText,
  soldSeats,
  sortSeats,
  type ResolvedSeat,
} from '../seating/seat-rules';
import { CreateOrderDto } from './dto/create-order.dto';
import { ticketCode } from './ticket-code';

// Spec 018 research R1: queries leave entrySecret out (PrismaService's global omit).
type OrderRow = Order & { tier: TicketTier | null; tickets: Omit<Ticket, 'entrySecret'>[] };

/** API shape (contracts/openapi.yaml `Order`): amounts as two-decimal strings. */
export interface OrderResponse {
  id: string;
  eventId: string;
  tierId: string | null;
  tierName: string | null;
  customerUsername: string;
  /** Spec 017 FR-001: the buyer's name on every ticket; `null` for orders placed before 017. */
  holderName: string | null;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  status: Order['status'];
  createdAt: Date;
  refundedAt: Date | null;
  tickets: {
    id: string;
    code: string;
    status: Ticket['status'];
    checkedInAt: Date | null;
    /** Spec 007 FR-011: the seat, or `null` for general admission. */
    seat: { section: string; row: number; seat: number } | null;
  }[];
}

export function toOrderResponse(o: OrderRow): OrderResponse {
  return {
    id: o.id,
    eventId: o.eventId,
    tierId: o.tierId,
    tierName: o.tier?.name ?? null,
    customerUsername: o.customerUsername,
    holderName: o.holderName,
    quantity: o.quantity,
    unitPrice: o.unitPrice.toFixed(2),
    totalPrice: o.totalPrice.toFixed(2),
    status: o.status,
    createdAt: o.createdAt,
    refundedAt: o.refundedAt,
    tickets: o.tickets.map((t) => ({
      id: t.id,
      code: t.code,
      status: t.status,
      checkedInAt: t.checkedInAt,
      seat:
        t.seatSection !== null && t.seatRow !== null && t.seatNumber !== null
          ? { section: t.seatSection, row: t.seatRow, seat: t.seatNumber }
          : null,
    })),
  };
}

/** API shape (contracts/openapi.yaml `MyOrder`): an order plus a summary of its event. */
export interface MyOrderResponse extends OrderResponse {
  event: {
    id: string;
    name: string;
    startsAt: Date;
    endsAt: Date;
    status: EventStatus;
    /** Spec 019 FR-012 (research R2): `address` is the venue's one-line `Location.address`. */
    location: { id: string; name: string; address: string; timeZone: UsTimeZone };
  };
}

const ORDER_INCLUDE = {
  tier: true,
  tickets: { orderBy: { code: 'asc' } },
} satisfies Prisma.OrderInclude;

const isUniqueViolationOn = (err: unknown, column: string): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError &&
  err.code === 'P2002' &&
  JSON.stringify(err.meta ?? {}).includes(column);

const isCodeCollision = (err: unknown): boolean => isUniqueViolationOn(err, 'code');

/** Spec 006 research R3: a repeat of the same confirmation for another event won the race. */
const isRequestIdCollision = (err: unknown): boolean => isUniqueViolationOn(err, 'requestId');

/**
 * Spec 007 research R2: the one-valid-ticket-per-seat index refused a seat. Under the event lock
 * this needs a write from outside the Backend; the retry's check then names the taken seats.
 */
const isSeatCollision = (err: unknown): boolean =>
  isUniqueViolationOn(err, 'ticket_one_valid_per_seat') || isUniqueViolationOn(err, 'seatSection');

/** An order, and whether it was placed now (`false`) or returned for a repeated request. */
export interface PlacedOrder {
  order: OrderResponse;
  replayed: boolean;
}

/** Spec 015 research R7: an order's seats, and the caller's holds on them that it buys. */
interface OrderSeats {
  seats: ResolvedSeat[];
  holds: LiveHold[];
}

/**
 * Orders and tickets (spec 005 US1). An order runs in one transaction that first takes the
 * event-row lock shared with tier writes, capacity edits, and cancellation, then counts valid
 * tickets, so no two orders can both take the last seat (FR-002, research R2). Spec 006 adds a
 * repeat check and the sales-closed rule under the same lock. Spec 015: a seated order buys seats
 * from the caller's own reservation, and the seats it sells are published to live viewers.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seatEvents: SeatEventsService,
  ) {}

  async create(eventId: string, dto: CreateOrderDto, buyer: Principal): Promise<PlacedOrder> {
    // Spec 017 FR-002 (research R2): the name rule, checked before the event lock is taken. The
    // one definition lives in packages/shared; a refusal records no order and no ticket.
    const problem = holderNameProblem(dto.holderName);
    if (problem !== null) {
      throw new HttpException(
        {
          error: {
            code: 'HOLDER_NAME_INVALID',
            message: holderNameMessage(problem),
            details: { reason: problem },
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const holderName = normalizeHolderName(dto.holderName as string);
    // Retry once when a ticket code collides (60 random bits: vanishingly rare), when a repeat of
    // this confirmation for another event committed first (the retry's lookup then finds it), or
    // when the seat index refused a seat (the retry's check then names it).
    for (let attempt = 1; ; attempt++) {
      try {
        const { placed, changes } = await this.prisma.$transaction(
          (tx) => this.createLocked(tx, eventId, dto, buyer, holderName),
          LOCKING_TX,
        );
        // Spec 015 research R9: only after the commit.
        this.seatEvents.publish(eventId, changes);
        return placed;
      } catch (err) {
        const retryable = isCodeCollision(err) || isRequestIdCollision(err) || isSeatCollision(err);
        if (!retryable || attempt >= 2) throw err;
      }
    }
  }

  private async createLocked(
    tx: Prisma.TransactionClient,
    eventId: string,
    dto: CreateOrderDto,
    buyer: Principal,
    holderName: string,
  ): Promise<{ placed: PlacedOrder; changes: SeatStateChange[] }> {
    const event = await lockEvent(tx, eventId);

    // Spec 006 FR-005: a repeated confirmation gets its first answer back, before any other rule,
    // because the customer is asking what happened to that request. Repeats for this event wait
    // on the lock above, so this lookup always sees an earlier one that committed.
    if (dto.requestId) {
      const earlier = await tx.order.findFirst({
        where: { customerSub: buyer.sub, requestId: dto.requestId },
        include: ORDER_INCLUDE,
      });
      if (earlier) {
        const same =
          earlier.eventId === eventId &&
          earlier.tierId === (dto.tierId ?? null) &&
          earlier.quantity === dto.quantity &&
          // Spec 017 (research R2): a repeat must name the same holder, like the same quantity.
          earlier.holderName === holderName &&
          (await this.sameSeats(tx, event, earlier.tickets, dto));
        if (!same) {
          throw conflict(
            'REQUEST_ID_REUSED',
            'This requestId was already used for a different order. Start a new confirmation.',
          );
        }
        return { placed: { order: toOrderResponse(earlier), replayed: true }, changes: [] };
      }
    }

    if (event.status === 'CANCELLED') throw eventCancelled(event.name);
    // Spec 006 FR-014: sales close when the event starts; half-open, so at startsAt is closed.
    if (new Date() >= event.startsAt) {
      throw conflict('SALES_CLOSED', `Sales for ${event.name} closed when it started.`);
    }
    // Spec 015 research R3, R7: run-out reservations end first, so their seats are free.
    const freed = await closeRunOut(tx, eventId);

    const tierCount = await tx.ticketTier.count({ where: { eventId } });
    let tier: TicketTier | null = null;
    if (tierCount > 0) {
      if (!dto.tierId) {
        throw new BadRequestException({
          message: ['tierId is required: this event sells tickets by tier'],
        });
      }
      tier = await tx.ticketTier.findFirst({ where: { id: dto.tierId, eventId } });
      if (!tier) throw new NotFoundException(`No tier ${dto.tierId} exists for event ${eventId}.`);
    } else if (dto.tierId) {
      throw new BadRequestException({
        message: ['tierId must be omitted: this event has no ticket tiers'],
      });
    }

    // Spec 007 research R6: seats are checked before counts, so a refusal names the seat.
    const { seats, holds } = await this.seatsFor(tx, event, dto, tier, buyer);

    let available = event.totalTicketCapacity - (await ticketsSold(tx, { eventId }));
    if (tier) {
      const tierLeft = tier.quantity - (await ticketsSold(tx, { eventId, tierId: tier.id }));
      available = Math.min(available, tierLeft);
    }
    available = Math.max(0, available);

    // Spec 016 FR-002, FR-004 (research R2, R3): the customer's own valid tickets for the event,
    // counted under the event lock above, so two of their orders can never both pass. When both
    // caps bind, the refusal names the smaller; on a tie, SOLD_OUT.
    const limit = event.maxTicketsPerCustomer;
    if (limit !== null) {
      const held = await customerHeld(tx, eventId, buyer.sub);
      // Clamped: an admin may lower the limit below what a customer already holds (FR-009).
      const remaining = Math.max(0, limit - held);
      if (dto.quantity > remaining && remaining < available) {
        throw conflict(
          'TICKET_LIMIT_REACHED',
          limitMessage(event.name, limit, held, dto.quantity),
          {
            limit,
            held,
            remaining,
            requested: dto.quantity,
          },
        );
      }
    }

    if (dto.quantity > available) {
      const kind = tier ? `${tier.name} ` : '';
      throw conflict(
        'SOLD_OUT',
        `Only ${available} ${kind}${available === 1 ? 'ticket is' : 'tickets are'} left for ` +
          `${event.name}; ${dto.quantity} ${dto.quantity === 1 ? 'was' : 'were'} requested.`,
        { available, requested: dto.quantity },
      );
    }

    // FR-004: the price is fixed on the order now; later tier price changes do not touch it.
    const unitPrice = new Prisma.Decimal(tier ? tier.price : event.basePrice);
    const order = await tx.order.create({
      data: {
        eventId,
        tierId: tier?.id ?? null,
        customerSub: buyer.sub,
        customerUsername: buyer.username,
        holderName,
        requestId: dto.requestId ?? null,
        quantity: dto.quantity,
        unitPrice,
        totalPrice: unitPrice.mul(dto.quantity),
        tickets: {
          create: Array.from({ length: dto.quantity }, (_, i) => ({
            eventId,
            tierId: tier?.id ?? null,
            code: ticketCode(),
            ...(seats[i]
              ? { seatSection: seats[i].section, seatRow: seats[i].row, seatNumber: seats[i].seat }
              : {}),
          })),
        },
      },
      include: ORDER_INCLUDE,
    });
    // Spec 015 research R7: the bought seats leave the reservation with the tickets, under the same
    // lock, so a seat is never both reserved and sold; the rest stay reserved until it ends.
    await endHolds(tx, eventId, holds, 'BOUGHT');
    return {
      placed: { order: toOrderResponse(order), replayed: false },
      changes: [
        ...(await toChanges(tx, event.locationId, freed, 'open')),
        ...seats.map((s) => ({
          sectionId: s.sectionId,
          row: s.row,
          seat: s.seat,
          state: 'sold' as const,
        })),
      ],
    };
  }

  /**
   * Spec 007 FR-008, research R6: the seats an order names, as labels, after every seat rule
   * (`seating/seat-rules.ts`, shared with reservations). General admission takes no seats. Seats
   * sold or in another customer's reservation are refused by name (409 SEAT_TAKEN); the partial
   * unique index guarantees no seat is sold twice even if this check were bypassed (FR-009).
   * Spec 015 FR-006 (research R7): every other seat must be in the caller's own reservation.
   */
  private async seatsFor(
    tx: Prisma.TransactionClient,
    event: LockedEvent,
    dto: CreateOrderDto,
    tier: TicketTier | null,
    buyer: Principal,
  ): Promise<OrderSeats> {
    if (!event.reservedSeating) {
      if (dto.seats?.length)
        throw badSeats('seats must be omitted: this event has no reserved seating');
      return { seats: [], holds: [] };
    }
    if (!dto.seats || dto.seats.length !== dto.quantity) {
      throw badSeats(
        `seats must list exactly ${dto.quantity} ${dto.quantity === 1 ? 'seat' : 'seats'}: ` +
          'this event has reserved seating',
      );
    }

    const seats = await resolveSeats(tx, event, tier, dto.seats);
    const sold = await soldSeats(tx, event.id, seats);
    const held = (await liveHolds(tx, event.id)).filter((h) =>
      seats.some((s) => seatKey(s) === seatKey(h)),
    );
    const others = held.filter((h) => h.customerSub !== buyer.sub);
    if (sold.length > 0 || others.length > 0) throw seatsTaken(sold, others);

    const mine = held.filter((h) => h.customerSub === buyer.sub);
    const missing = seats.filter((s) => !mine.some((h) => seatKey(h) === seatKey(s)));
    if (missing.length > 0) {
      const expired = await this.reservationRanOut(tx, event.id, buyer.sub);
      const labels = sortSeats(missing.map(({ section, row, seat }) => ({ section, row, seat })));
      const them = labels.length === 1 ? 'it' : 'them';
      throw conflict(
        'RESERVATION_REQUIRED',
        expired
          ? `Your reservation for ${event.name} ran out. Reserve the seats again to get them.`
          : `${labels.map(seatText).join('; ')} ${labels.length === 1 ? 'is' : 'are'} not in ` +
              `your reservation. Reserve ${them} first.`,
        { seats: labels, expired },
      );
    }
    return { seats, holds: mine };
  }

  /** Spec 015 FR-006: whether the caller's latest reservation for the event ran out. */
  private async reservationRanOut(
    tx: Prisma.TransactionClient,
    eventId: string,
    customerSub: string,
  ): Promise<boolean> {
    const latest = await tx.seatReservation.findFirst({
      where: { eventId, customerSub },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { holds: { where: { endReason: 'EXPIRED' }, take: 1 } },
    });
    return latest !== null && latest.endedAt !== null && latest.holds.length > 0;
  }

  /** Spec 007 research R6: a repeated requestId must name the same seats (as a set). */
  private async sameSeats(
    tx: Prisma.TransactionClient,
    event: LockedEvent,
    tickets: Omit<Ticket, 'entrySecret'>[],
    dto: CreateOrderDto,
  ): Promise<boolean> {
    const before = tickets
      .filter((t) => t.seatSection !== null)
      .map((t) =>
        seatKey({
          section: t.seatSection as string,
          row: t.seatRow as number,
          seat: t.seatNumber as number,
        }),
      )
      .sort();
    const choices = dto.seats ?? [];
    if (choices.length === 0) return before.length === 0;
    const sections = await tx.section.findMany({ where: { locationId: event.locationId } });
    const requested: string[] = [];
    for (const c of choices) {
      const section = sections.find((s) => s.id === c.sectionId);
      if (!section) return false;
      requested.push(seatKey({ section: section.name, row: c.row, seat: c.seat }));
    }
    requested.sort();
    return before.length === requested.length && before.every((k, i) => k === requested[i]);
  }

  /**
   * Spec 006 FR-007: the caller's own orders, newest first. `sub` always comes from the validated
   * token; nothing in a request can name another customer.
   */
  async mine(sub: string): Promise<MyOrderResponse[]> {
    const orders = await this.prisma.order.findMany({
      where: { customerSub: sub },
      include: { ...ORDER_INCLUDE, event: { include: { location: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return orders.map((o) => ({
      ...toOrderResponse(o),
      event: {
        id: o.event.id,
        name: o.event.name,
        startsAt: o.event.startsAt,
        endsAt: o.event.endsAt,
        status: o.event.status,
        location: {
          id: o.event.location.id,
          name: o.event.location.name,
          address: o.event.location.address,
          // Spec 020 FR-021 (research R16).
          timeZone: o.event.location.timeZone as UsTimeZone,
        },
      },
    }));
  }

  /** Spec 005 US3: every order for an event, oldest first, refunded ones included. */
  async attendees(eventId: string): Promise<OrderResponse[]> {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException(`No event exists with id ${eventId}.`);
    const orders = await this.prisma.order.findMany({
      where: { eventId },
      include: ORDER_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return orders.map(toOrderResponse);
  }
}
