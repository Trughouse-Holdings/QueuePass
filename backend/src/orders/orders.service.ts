import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Order, type Ticket, type TicketTier } from '@prisma/client';
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

const ORDER_INCLUDE = {
  tier: true,
  tickets: { orderBy: { code: 'asc' } },
} satisfies Prisma.OrderInclude;

const isCodeCollision = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError &&
  err.code === 'P2002' &&
  JSON.stringify(err.meta ?? {}).includes('code');

/**
 * Orders and tickets (spec 005 US1). An order runs in one transaction that first takes the
 * event-row lock shared with tier writes, capacity edits, and cancellation, then counts valid
 * tickets, so no two orders can both take the last seat (FR-002, research R2).
 */
@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(eventId: string, dto: CreateOrderDto, buyer: Principal): Promise<OrderResponse> {
    // A ticket-code collision (60 random bits) is vanishingly rare; retry once if it happens.
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          (tx) => this.createLocked(tx, eventId, dto, buyer),
          LOCKING_TX,
        );
      } catch (err) {
        if (!isCodeCollision(err) || attempt >= 2) throw err;
      }
    }
  }

  private async createLocked(
    tx: Prisma.TransactionClient,
    eventId: string,
    dto: CreateOrderDto,
    buyer: Principal,
  ): Promise<OrderResponse> {
    const event = await lockEvent(tx, eventId);
    if (event.status === 'CANCELLED') throw eventCancelled(event.name);

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
    return toOrderResponse(order);
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
