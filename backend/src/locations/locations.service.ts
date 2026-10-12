import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Location } from '@prisma/client';
import { formatAddress } from '@queuepass/shared';
import { ADDRESS_GEOCODER, AddressGeocoder } from '../address/address-geocoder';
import { searchText } from '../common/search-text';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ADDRESS_GEOCODER) private readonly geocoder: AddressGeocoder,
  ) {}

  async create(dto: CreateLocationDto): Promise<Location> {
    const { street, city, state, zip, name, seatingCapacity } = dto;
    const result = await this.geocoder.lookup({ street, city, state, zip });
    if (result.kind !== 'match') throw new Error('not yet implemented');
    const parts = {
      street: result.street,
      city: result.city,
      state: result.state,
      zip: result.zip,
    };
    return this.prisma.location.create({
      data: {
        name,
        seatingCapacity,
        ...parts,
        address: formatAddress(parts),
        addressVerified: true,
      },
    });
  }

  /** Spec 004 FR-007: `q` matches name or address, ignoring case; name order is unchanged. */
  findAll(q?: string): Promise<Location[]> {
    const text = searchText(q);
    return this.prisma.location.findMany({
      where: text
        ? {
            OR: [
              { name: { contains: text, mode: 'insensitive' } },
              { address: { contains: text, mode: 'insensitive' } },
            ],
          }
        : {},
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string): Promise<Location> {
    const location = await this.prisma.location.findUnique({ where: { id } });
    if (!location) throw new NotFoundException(`No venue exists with id ${id}.`);
    return location;
  }

  async update(id: string, dto: UpdateLocationDto): Promise<Location> {
    await this.findOne(id);

    // Spec 007 FR-017: a venue with a seating layout takes its capacity from the layout.
    if (
      dto.seatingCapacity !== undefined &&
      (await this.prisma.section.count({ where: { locationId: id } })) > 0
    ) {
      throw new BadRequestException({
        message: [
          "seatingCapacity is set by this venue's seating layout; change the layout instead",
        ],
      });
    }

    // Cross-table rule, so it cannot be a database constraint: reducing seating capacity
    // below an already-scheduled event's ticket capacity would leave that event silently
    // invalid (research R8, spec Edge Cases).
    if (dto.seatingCapacity !== undefined) {
      const offending = await this.prisma.event.findFirst({
        where: { locationId: id, totalTicketCapacity: { gt: dto.seatingCapacity } },
        orderBy: { totalTicketCapacity: 'desc' },
      });

      if (offending) {
        throw new HttpException(
          {
            error: {
              code: 'CAPACITY_EXCEEDED',
              message:
                `Cannot reduce seating capacity to ${dto.seatingCapacity}; ` +
                `event '${offending.name}' has a ticket capacity of ${offending.totalTicketCapacity}.`,
              details: {
                proposedSeatingCapacity: dto.seatingCapacity,
                conflictingEvent: {
                  id: offending.id,
                  name: offending.name,
                  totalTicketCapacity: offending.totalTicketCapacity,
                },
              },
            },
          },
          HttpStatus.CONFLICT,
        );
      }
    }

    return this.prisma.location.update({
      where: { id },
      data: { name: dto.name, seatingCapacity: dto.seatingCapacity },
    });
  }

  async remove(id: string): Promise<void> {
    const location = await this.findOne(id);

    // The count exists only so the refusal can name the venue and say how many events block
    // it (spec 002 research R7). It is NOT the enforcement: the FK is ON DELETE RESTRICT, so
    // if an event is inserted between this count and the delete, the database still refuses
    // and the exception filter maps it to 409 VENUE_HAS_EVENTS. No client — including one
    // bypassing this service — can orphan events.
    const n = await this.prisma.event.count({ where: { locationId: id } });
    if (n > 0) {
      throw new HttpException(
        {
          error: {
            code: 'VENUE_HAS_EVENTS',
            message: `Cannot delete "${location.name}": ${n} ${n === 1 ? 'event is' : 'events are'} still scheduled there. Delete or move them first.`,
            details: { eventCount: n },
          },
        },
        HttpStatus.CONFLICT,
      );
    }

    await this.prisma.location.delete({ where: { id } });
  }
}
