import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type EventStatus, type Order, type Ticket, type TicketTier } from '@prisma/client';
import type { Principal } from '../auth/principal';
import { conflict, eventCancelled } from '../common/conflict';
import { LOCKING_TX, lockEvent, ticketsSold } from '../common/event-lock';
import { PrismaService } from '../prisma/prisma.service';
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
  tickets: { id: string; code: string; status: Ticket['status']; checkedInAt: Date | null }[];
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
    // Retry once when a ticket code collides (60 random bits: vanishingly rare), or when a repeat
    // of this confirmation for another event committed first; the retry's lookup then finds it.
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          (tx) => this.createLocked(tx, eventId, dto, buyer),
          LOCKING_TX,
        );
      } catch (err) {
        if (!(isCodeCollision(err) || isRequestIdCollision(err)) || attempt >= 2) throw err;
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
          earlier.quantity === dto.quantity;
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

    let available = event.totalTicketCapacity - (await ticketsSold(tx, { eventId }));
    if (tier) {
      const tierLeft = tier.quantity - (await ticketsSold(tx, { eventId, tierId: tier.id }));
      available = Math.min(available, tierLeft);
    }
    available = Math.max(0, available);
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
          create: Array.from({ length: dto.quantity }, () => ({
            eventId,
            tierId: tier?.id ?? null,
            code: ticketCode(),
          })),
        },
      },
      include: ORDER_INCLUDE,
    });
    return { order: toOrderResponse(order), replayed: false };
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
