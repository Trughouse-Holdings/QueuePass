import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, TicketTier } from '@prisma/client';
import { conflict, eventCancelled } from '../common/conflict';
import { LOCKING_TX, LockedEvent, lockEvent, ticketsSold } from '../common/event-lock';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTierDto } from './dto/create-tier.dto';
import { UpdateTierDto } from './dto/update-tier.dto';

/** API shape: price serialized as a decimal string (never a JSON number). */
export interface TierResponse extends Omit<TicketTier, 'price'> {
  price: string;
}

const toResponse = (tier: TicketTier): TierResponse => ({ ...tier, price: tier.price.toFixed(2) });

/**
 * Ticket tiers (spec 004 US1). Every write runs in a transaction that first locks the event row,
 * so the capacity rule (FR-003) and the name rule (FR-002) are checked against a total no other
 * writer can change until this one commits (research R2, R3).
 */
@Injectable()
export class TiersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(eventId: string): Promise<TierResponse[]> {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException(`No event exists with id ${eventId}.`);
    const tiers = await this.prisma.ticketTier.findMany({
      where: { eventId },
      orderBy: [{ price: 'asc' }, { name: 'asc' }],
    });
    return tiers.map(toResponse);
  }

  create(eventId: string, dto: CreateTierDto): Promise<TierResponse> {
    return this.prisma.$transaction(async (tx) => {
      const event = await lockEvent(tx, eventId);
      if (event.status === 'CANCELLED') throw eventCancelled(event.name);
      await this.assertNoTierlessSales(tx, event);
      await this.assertNameFree(tx, event, dto.name, null);
      // Spec 007 FR-006: a seated tier's amount comes from its sections, 0 until mapped.
      const quantity = this.quantityFor(event, dto.quantity);
      await this.assertFits(tx, event, quantity, null);
      const created = await tx.ticketTier.create({
        data: { eventId, name: dto.name, price: dto.price, quantity },
      });
      return toResponse(created);
    }, LOCKING_TX);
  }

  update(eventId: string, tierId: string, dto: UpdateTierDto): Promise<TierResponse> {
    if (dto.name === undefined && dto.price === undefined && dto.quantity === undefined) {
      throw new BadRequestException({ message: ['supply at least one field to change'] });
    }
    return this.prisma.$transaction(async (tx) => {
      const event = await lockEvent(tx, eventId);
      if (event.status === 'CANCELLED') throw eventCancelled(event.name);
      const tier = await this.requireTier(tx, eventId, tierId);
      if (event.reservedSeating && dto.quantity !== undefined) {
        throw new BadRequestException({
          message: ["quantity follows this tier's sections while reserved seating is on"],
        });
      }
      if (dto.name !== undefined) await this.assertNameFree(tx, event, dto.name, tier.id);
      if (dto.quantity !== undefined) {
        await this.assertFits(tx, event, dto.quantity, tier.id);
        await this.assertCoversTierSales(tx, tier, dto.quantity);
      }
      const updated = await tx.ticketTier.update({
        where: { id: tier.id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.price !== undefined ? { price: dto.price } : {}),
          ...(dto.quantity !== undefined ? { quantity: dto.quantity } : {}),
        },
      });
      return toResponse(updated);
    }, LOCKING_TX);
  }

  remove(eventId: string, tierId: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const event = await lockEvent(tx, eventId);
      if (event.status === 'CANCELLED') throw eventCancelled(event.name);
      const tier = await this.requireTier(tx, eventId, tierId);
      // Spec 005 FR-010. Order.tierId is ON DELETE RESTRICT; the count only names the refusal.
      const orderCount = await tx.order.count({ where: { tierId } });
      if (orderCount > 0) {
        throw conflict(
          'TIER_HAS_ORDERS',
          `Cannot remove the tier "${tier.name}": it has ${orderCount} ${orderCount === 1 ? 'order' : 'orders'}.`,
          { orderCount },
        );
      }
      await tx.ticketTier.delete({ where: { id: tierId } });
    }, LOCKING_TX);
  }

  // ---------------------------------------------------------------- rules

  /** Spec 007 FR-006: typed without reserved seating, calculated (starting at 0) with it. */
  private quantityFor(event: LockedEvent, typed: number | undefined): number {
    if (event.reservedSeating) {
      if (typed !== undefined) {
        throw new BadRequestException({
          message: [
            "quantity must be omitted: it follows this tier's sections while reserved seating is on",
          ],
        });
      }
      return 0;
    }
    if (typed === undefined) {
      throw new BadRequestException({ message: ['quantity is required for a tier'] });
    }
    return typed;
  }

  /** A tier of a different event is reported as not found (contract). */
  private async requireTier(
    tx: Prisma.TransactionClient,
    eventId: string,
    tierId: string,
  ): Promise<TicketTier> {
    const tier = await tx.ticketTier.findFirst({ where: { id: tierId, eventId } });
    if (!tier) throw new NotFoundException(`No tier ${tierId} exists for event ${eventId}.`);
    return tier;
  }

  /**
   * Looks first only so the refusal can name the existing tier. The unique index on
   * ("eventId", lower("name")) is the guarantee; the exception filter maps its violation to the
   * same code (research R3).
   */
  private async assertNameFree(
    tx: Prisma.TransactionClient,
    event: LockedEvent,
    name: string,
    exceptTierId: string | null,
  ): Promise<void> {
    const clash = await tx.ticketTier.findFirst({
      where: {
        eventId: event.id,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptTierId ? { id: { not: exceptTierId } } : {}),
      },
    });
    if (clash) {
      throw new HttpException(
        {
          error: {
            code: 'TIER_NAME_TAKEN',
            message: `${event.name} already has a tier named '${clash.name}'.`,
            details: { existingTierId: clash.id },
          },
        },
        HttpStatus.CONFLICT,
      );
    }
  }

  /** Spec 005 FR-011: tickets already sold without a tier would belong to no tier. */
  private async assertNoTierlessSales(
    tx: Prisma.TransactionClient,
    event: LockedEvent,
  ): Promise<void> {
    const tierless = await ticketsSold(tx, { eventId: event.id, tierId: null });
    if (tierless > 0) {
      throw conflict(
        'EVENT_HAS_ORDERS',
        `${event.name} has already sold ${tierless} tickets without tiers, so tiers cannot be added.`,
        { tierlessTicketsSold: tierless },
      );
    }
  }

  /** Spec 005 FR-011: a tier cannot shrink below the tickets it has sold. */
  private async assertCoversTierSales(
    tx: Prisma.TransactionClient,
    tier: TicketTier,
    requested: number,
  ): Promise<void> {
    const sold = await ticketsSold(tx, { eventId: tier.eventId, tierId: tier.id });
    if (requested < sold) {
      throw conflict(
        'CAPACITY_EXCEEDED',
        `Cannot set ${tier.name} to ${requested} tickets; ${sold} are already sold.`,
        { requested, ticketsSold: sold },
      );
    }
  }

  /** FR-003: the event's tiers, with this one at `requested`, must fit its ticket capacity. */
  private async assertFits(
    tx: Prisma.TransactionClient,
    event: LockedEvent,
    requested: number,
    exceptTierId: string | null,
  ): Promise<void> {
    const others = await tx.ticketTier.aggregate({
      where: { eventId: event.id, ...(exceptTierId ? { id: { not: exceptTierId } } : {}) },
      _sum: { quantity: true },
    });
    const allocated = others._sum.quantity ?? 0;
    const remaining = event.totalTicketCapacity - allocated;
    if (requested > remaining) {
      throw new HttpException(
        {
          error: {
            code: 'CAPACITY_EXCEEDED',
            message:
              `${event.name} has ${event.totalTicketCapacity} tickets and ${allocated} are already ` +
              `in tiers; only ${remaining} remain, so ${requested} cannot be added.`,
            details: {
              totalTicketCapacity: event.totalTicketCapacity,
              allocated,
              requested,
              remaining,
            },
          },
        },
        HttpStatus.CONFLICT,
      );
    }
  }
}
