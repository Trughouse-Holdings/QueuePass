import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type EventStatus, type Order, type Ticket, type TicketTier } from '@prisma/client';
import type { Principal } from '../auth/principal';
import { conflict, eventCancelled } from '../common/conflict';
import {
  LOCKING_TX,
  type LockedEvent,
  customerHeld,
  lockEvent,
  ticketsSold,
} from '../common/event-lock';
import { PrismaService } from '../prisma/prisma.service';
import {
  badSeats,
  resolveSeats,
  seatKey,
  seatText,
  soldSeats,
  type SeatLabel,
} from '../seating/seat-rules';
import { CreateOrderDto } from './dto/create-order.dto';
import { ticketCode } from './ticket-code';

type OrderRow = Order & { tier: TicketTier | null; tickets: Ticket[] };

/** API shape (contracts/openapi.yaml `Order`): amounts as two-decimal strings. */
export interface OrderResponse {
  id: string;
  eventId: string;
  tierId: string | null;
  tierName: string | null;
  customerUsername: string;
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
    location: { id: string; name: string };
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

const tickets = (n: number): string => `${n} ${n === 1 ? 'ticket' : 'tickets'}`;

/** Spec 016 research R4: the limit refusal, with the limit, what is held, and what is left. */
function limitMessage(event: string, limit: number, held: number, requested: number): string {
  const allows = `${event} allows ${tickets(limit)} per customer`;
  const remaining = limit - held;
  if (remaining <= 0) return `${allows}, and you already hold ${held}.`;
  return (
    `${allows}. You already hold ${held}, so you can get ${remaining} more; ` +
    `${requested} ${requested === 1 ? 'was' : 'were'} requested.`
  );
}

/** An order, and whether it was placed now (`false`) or returned for a repeated request. */
export interface PlacedOrder {
  order: OrderResponse;
  replayed: boolean;
}

/**
 * Orders and tickets (spec 005 US1). An order runs in one transaction that first takes the
 * event-row lock shared with tier writes, capacity edits, and cancellation, then counts valid
 * tickets, so no two orders can both take the last seat (FR-002, research R2). Spec 006 adds a
 * repeat check and the sales-closed rule under the same lock.
 */
@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(eventId: string, dto: CreateOrderDto, buyer: Principal): Promise<PlacedOrder> {
    // Retry once when a ticket code collides (60 random bits: vanishingly rare), when a repeat of
    // this confirmation for another event committed first (the retry's lookup then finds it), or
    // when the seat index refused a seat (the retry's check then names it).
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          (tx) => this.createLocked(tx, eventId, dto, buyer),
          LOCKING_TX,
        );
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
  ): Promise<PlacedOrder> {
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
          (await this.sameSeats(tx, event, earlier.tickets, dto));
        if (!same) {
          throw conflict(
            'REQUEST_ID_REUSED',
            'This requestId was already used for a different order. Start a new confirmation.',
          );
        }
        return { order: toOrderResponse(earlier), replayed: true };
      }
    }

    if (event.status === 'CANCELLED') throw eventCancelled(event.name);
    // Spec 006 FR-014: sales close when the event starts; half-open, so at startsAt is closed.
    if (new Date() >= event.startsAt) {
      throw conflict('SALES_CLOSED', `Sales for ${event.name} closed when it started.`);
    }

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
    const seats = await this.seatsFor(tx, event, dto, tier);

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
    return { order: toOrderResponse(order), replayed: false };
  }

  /**
   * Spec 007 FR-008, research R6: the seats an order names, as labels, after every seat rule
   * (`seating/seat-rules.ts`, shared with reservations). General admission takes no seats. Taken
   * seats are refused by name (409 SEAT_TAKEN); the partial unique index guarantees it even if
   * this check were bypassed (FR-009).
   */
  private async seatsFor(
    tx: Prisma.TransactionClient,
    event: LockedEvent,
    dto: CreateOrderDto,
    tier: TicketTier | null,
  ): Promise<SeatLabel[]> {
    if (!event.reservedSeating) {
      if (dto.seats?.length)
        throw badSeats('seats must be omitted: this event has no reserved seating');
      return [];
    }
    if (!dto.seats || dto.seats.length !== dto.quantity) {
      throw badSeats(
        `seats must list exactly ${dto.quantity} ${dto.quantity === 1 ? 'seat' : 'seats'}: ` +
          'this event has reserved seating',
      );
    }

    const labels = await resolveSeats(tx, event, tier, dto.seats);
    const seats = await soldSeats(tx, event.id, labels);
    if (seats.length > 0) {
      throw conflict(
        'SEAT_TAKEN',
        `${seats.map(seatText).join('; ')} ${seats.length === 1 ? 'is' : 'are'} already taken.`,
        { seats },
      );
    }
    return labels;
  }

  /** Spec 007 research R6: a repeated requestId must name the same seats (as a set). */
  private async sameSeats(
    tx: Prisma.TransactionClient,
    event: LockedEvent,
    tickets: Ticket[],
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
        location: { id: o.event.location.id, name: o.event.location.name },
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
