import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Location, Prisma } from '@prisma/client';
import { DEFAULT_TIME_ZONE, formatAddress } from '@queuepass/shared';
import {
  ADDRESS_GEOCODER,
  AddressGeocoder,
  AddressParts,
  AddressServiceUnavailableError,
} from '../address/address-geocoder';
import { LOCKING_TX } from '../common/event-lock';
import { searchText } from '../common/search-text';
import { lockVenueAndEvents } from '../common/venue-lock';
import { PrismaService } from '../prisma/prisma.service';
import { matchesTyped } from './address-match';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

type Db = PrismaService | Prisma.TransactionClient;

const ADDRESS_KEYS = ['street', 'city', 'state', 'zip'] as const;

/** The one whitespace rule (data-model.md): trim, and collapse runs of whitespace to one space. */
const collapse = (s: string): string => s.trim().replace(/\s+/g, ' ');

/** The address "as sent": spaces tidied, the admin's case kept, the ZIP cut to 5 digits. */
const asSent = (a: AddressParts): AddressParts => ({
  street: collapse(a.street),
  city: collapse(a.city),
  state: a.state,
  zip: a.zip.slice(0, 5),
});

/** Spec 013 FR-008: the same address, ignoring case and extra spaces (data-model.md). */
function sameAddress(sent: AddressParts, stored: Location): boolean {
  if (stored.street === null || stored.city === null) return false;
  const norm = (s: string): string => collapse(s).toUpperCase();
  return (
    norm(sent.street) === norm(stored.street) &&
    norm(sent.city) === norm(stored.city) &&
    sent.state === stored.state &&
    sent.zip.slice(0, 5) === stored.zip
  );
}

/** What gets written for a checked address (spec 013 FR-003, FR-019, FR-020). */
interface CheckedAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  address: string;
  addressVerified: boolean;
}

const checked = (parts: AddressParts, addressVerified: boolean): CheckedAddress => ({
  ...parts,
  address: formatAddress(parts),
  addressVerified,
});

/**
 * Spec 013 research R14: an internal option of `create`, passed only by the dev-only
 * `demo-data` script. No request can set it: the controller never passes it and no DTO has it.
 */
export interface CreateOptions {
  whenServiceUnavailable?: 'refuse' | 'saveUnverified';
}

/** Research R6: every failure to get an answer; the cause goes to the log, not the response. */
const serviceUnavailable = (): HttpException =>
  new HttpException(
    {
      error: {
        code: 'ADDRESS_SERVICE_UNAVAILABLE',
        message: "We can't verify the address right now. Nothing was saved. Try again in a minute.",
      },
    },
    HttpStatus.SERVICE_UNAVAILABLE,
  );

const addressRefused = (code: string, message: string, details: object): HttpException =>
  new HttpException({ error: { code, message, details } }, HttpStatus.BAD_REQUEST);

@Injectable()
export class LocationsService {
  private readonly logger = new Logger(LocationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ADDRESS_GEOCODER) private readonly geocoder: AddressGeocoder,
  ) {}

  /**
   * Spec 013 FR-002: the address is checked before anything is saved. A new row has nothing to
   * race with, so it is one insert after the lookup (research R7).
   */
  async create(dto: CreateLocationDto, options: CreateOptions = {}): Promise<Location> {
    const { name, seatingCapacity, acceptUnverifiedAddress } = dto;
    const address = await this.checkAddress(
      dto,
      acceptUnverifiedAddress === true,
      options.whenServiceUnavailable === 'saveUnverified',
    );
    // Spec 020 T008: the zone every existing venue got, until T019 decides it per R7.
    return this.prisma.location.create({
      data: {
        name,
        seatingCapacity,
        ...address,
        timeZone: DEFAULT_TIME_ZONE,
        timeZoneSource: 'DEFAULT',
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

  /**
   * Spec 013 research R7. Cheap checks first, with no lock: the venue exists, the address fields
   * come all four or none (and the save-anyway flag only with them), and the capacity rules.
   * Then the address lookup, only if the address changed, still with no lock. Then one short
   * transaction locks the venue and its scheduled events (the same order as layout saves),
   * re-runs the capacity rules on what is stored now, and writes.
   */
  async update(id: string, dto: UpdateLocationDto): Promise<Location> {
    const existing = await this.findOne(id);

    const sent = ADDRESS_KEYS.filter((k) => dto[k] !== undefined);
    if (sent.length > 0 && sent.length < ADDRESS_KEYS.length) {
      throw new BadRequestException({
        message: ['street, city, state, and zip must be sent all together, or not at all'],
      });
    }
    if (dto.acceptUnverifiedAddress !== undefined && sent.length === 0) {
      throw new BadRequestException({
        message: ['acceptUnverifiedAddress can only be sent with street, city, state, and zip'],
      });
    }

    await this.assertCapacityRules(this.prisma, id, dto.seatingCapacity);

    let address: CheckedAddress | undefined;
    if (sent.length > 0) {
      const parts = dto as AddressParts;
      // FR-008: an unchanged address is not checked again and keeps its verified state.
      if (!sameAddress(parts, existing)) {
        address = await this.checkAddress(parts, dto.acceptUnverifiedAddress === true);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      await lockVenueAndEvents(tx, id);
      await this.assertCapacityRules(tx, id, dto.seatingCapacity);
      return tx.location.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.seatingCapacity !== undefined ? { seatingCapacity: dto.seatingCapacity } : {}),
          ...address,
        },
      });
    }, LOCKING_TX);
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

  /**
   * Asks the address service (spec 013 research R2, R3). Exactly one match that keeps the typed
   * ZIP code and house number is saved in the service's standard form and verified, whatever the
   * flag says; one that moves either is refused as ambiguous, listing it (FR-021). No match or
   * several are refused, unless the admin confirmed "save anyway": then the address is saved as
   * sent and not verified. When the service cannot be asked, the save is refused with 503 whatever the
   * flag says (research R6), except through `create`'s internal demo-data option (R14).
   */
  private async checkAddress(
    input: AddressParts,
    acceptUnverified: boolean,
    saveUnverifiedWhenUnavailable = false,
  ): Promise<CheckedAddress> {
    const sent = asSent(input);
    let result;
    try {
      result = await this.geocoder.lookup(sent);
    } catch (err) {
      if (!(err instanceof AddressServiceUnavailableError)) throw err;
      const cause = err.cause instanceof Error ? `: ${err.cause.message}` : '';
      this.logger.warn(`Address service unavailable: ${err.message}${cause}`);
      if (saveUnverifiedWhenUnavailable) return checked(sent, false);
      throw serviceUnavailable();
    }

    const match =
      result.kind === 'match'
        ? { street: result.street, city: result.city, state: result.state, zip: result.zip }
        : undefined;
    if (match && matchesTyped(sent, match)) return checked(match, true);
    if (acceptUnverified) return checked(sent, false);

    const typed = formatAddress(sent);
    if (result.kind === 'none') {
      throw addressRefused(
        'ADDRESS_NOT_FOUND',
        `We couldn't find ${typed} as a US address. Check the street, city, state, and ZIP code.`,
        { address: typed },
      );
    }
    if (result.kind === 'match') {
      // FR-021: one match at another ZIP code or house number is a different place, so it is
      // offered as a candidate, never saved in place of what was typed.
      throw addressRefused(
        'ADDRESS_AMBIGUOUS',
        `We found a different US address for ${typed}. Did you mean this one? Enter it to use it.`,
        { address: typed, candidates: [formatAddress(result)] },
      );
    }
    throw addressRefused(
      'ADDRESS_AMBIGUOUS',
      `${typed} matches more than one US address. Enter one of these.`,
      { address: typed, candidates: result.candidates },
    );
  }

  /**
   * The capacity rules of a venue edit, run once as a fast check and again under the venue
   * lock just before the write (spec 013 research R7).
   */
  private async assertCapacityRules(
    db: Db,
    id: string,
    seatingCapacity: number | undefined,
  ): Promise<void> {
    if (seatingCapacity === undefined) return;

    // Spec 007 FR-017: a venue with a seating layout takes its capacity from the layout.
    if ((await db.section.count({ where: { locationId: id } })) > 0) {
      throw new BadRequestException({
        message: [
          "seatingCapacity is set by this venue's seating layout; change the layout instead",
        ],
      });
    }

    // Cross-table rule, so it cannot be a database constraint: reducing seating capacity
    // below an already-scheduled event's ticket capacity would leave that event silently
    // invalid (research R8, spec Edge Cases).
    const offending = await db.event.findFirst({
      where: { locationId: id, totalTicketCapacity: { gt: seatingCapacity } },
      orderBy: { totalTicketCapacity: 'desc' },
    });

    if (offending) {
      throw new HttpException(
        {
          error: {
            code: 'CAPACITY_EXCEEDED',
            message:
              `Cannot reduce seating capacity to ${seatingCapacity}; ` +
              `event '${offending.name}' has a ticket capacity of ${offending.totalTicketCapacity}.`,
            details: {
              proposedSeatingCapacity: seatingCapacity,
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
}
