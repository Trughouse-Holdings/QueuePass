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
import { formatAddress, type UsTimeZone } from '@queuepass/shared';
import {
  ADDRESS_GEOCODER,
  AddressGeocoder,
  AddressParts,
  AddressServiceUnavailableError,
  GeocodeResult,
  Place,
} from '../address/address-geocoder';
import { MAP_SEARCH, MapSearch } from '../address/map-search';
import { TIME_ZONE_FINDER, TimeZoneFinder } from '../address/time-zone-finder';
import { LOCKING_TX } from '../common/event-lock';
import { searchText } from '../common/search-text';
import { lockVenueAndEvents } from '../common/venue-lock';
import { PrismaService } from '../prisma/prisma.service';
import { keepUnit, matchesTyped, placeAtAddress, placeByName, withoutUnit } from './address-match';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import {
  assertNoOrders,
  decideZone,
  moveEventsToZone,
  type ZoneDecision,
  type ZoneQuestion,
} from './venue-time-zone';

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

/** A match the service vouched for, with the suite or unit the admin typed kept (issue #36, R15). */
const verified = (sent: AddressParts, match: AddressParts): CheckedAddress =>
  checked({ ...match, street: keepUnit(sent.street, match.street) }, true);

/**
 * Research R16: what the address checks found. Either a verified address with its place, or
 * the address service's own answer, which no check turned into a verified address.
 */
type Lookup = { found: CheckedWithPlace } | { result: GeocodeResult };

/**
 * Spec 013 research R14: an internal option of `create`, passed only by the dev-only
 * `demo-data` script. No request can set it: the controller never passes it and no DTO has it.
 */
export interface CreateOptions {
  whenServiceUnavailable?: 'refuse' | 'saveUnverified';
  /**
   * Spec 020 research R19: when no zone can be worked out and none was sent (an address saved
   * offline in a split state), America/New_York as DEFAULT instead of TIME_ZONE_REQUIRED.
   */
  fallbackToDefaultTimeZone?: boolean;
}

/** A checked address, and the matched place beside it (never inside it: not stored, R1). */
interface CheckedWithPlace {
  address: CheckedAddress;
  location: Place | null;
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
    @Inject(MAP_SEARCH) private readonly map: MapSearch,
    @Inject(TIME_ZONE_FINDER) private readonly finder: TimeZoneFinder,
  ) {}

  /** Spec 020 research R7: the zone this request decides, or null when it leaves it alone. */
  private decide(question: ZoneQuestion): ZoneDecision | null {
    return decideZone(question, (latitude, longitude) => this.finder.zoneAt(latitude, longitude));
  }

  /**
   * Spec 013 FR-002: the address is checked before anything is saved. A new row has nothing to
   * race with, so it is one insert after the lookup (research R7). Spec 020: then its zone is
   * decided (R7): sent, else from the matched place, else from the state, else refused.
   */
  async create(dto: CreateLocationDto, options: CreateOptions = {}): Promise<Location> {
    const { name, seatingCapacity, acceptUnverifiedAddress } = dto;
    const { address, location } = await this.checkAddress(
      dto,
      name,
      acceptUnverifiedAddress === true,
      options.whenServiceUnavailable === 'saveUnverified',
    );
    const zone = this.decide({
      sent: dto.timeZone,
      address: { state: address.state, location },
      fallbackToDefault: options.fallbackToDefaultTimeZone === true,
    }) as ZoneDecision;
    // `location` (the place) is never part of `data`: it is not stored (R1).
    return this.prisma.location.create({ data: { name, seatingCapacity, ...address, ...zone } });
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
   *
   * Feature 024 (research R7): the same address resent with `acceptUnverifiedAddress: true` for a
   * venue whose address is not verified is looked up again in the same place. A match is written
   * verified, in standard form, only if the row read again under the lock still has that address,
   * not verified; any other answer, the service being down included, writes nothing about the
   * address and never refuses. This check never decides the zone. Without the flag, an unchanged
   * address is still never looked up (013 FR-008).
   *
   * Issue #36 (013 research R15): whether to look the address up is decided on the row read
   * before the lock; whether to write it is decided again on the row read under the lock.
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

    // Spec 020 research R8: an explicit zone change at a venue with orders is refused before the
    // address lookup, with no lock, so the refusal never waits on the network. Checked again
    // under the lock.
    if (dto.timeZone && dto.timeZone !== existing.timeZone) {
      await assertNoOrders(this.prisma, existing, existing.timeZone as UsTimeZone, dto.timeZone);
    }

    let checkedAddress: CheckedWithPlace | undefined;
    let recheckedAddress: CheckedAddress | undefined;
    const parts = dto as AddressParts;
    // Research R16: the map search may look the venue up by the name it will have.
    const venueName = dto.name ?? existing.name;
    if (sent.length > 0) {
      // FR-008: an unchanged address is not checked again and keeps its verified state, except
      // a not-verified one resent with the flag (feature 024, research R7).
      if (!sameAddress(parts, existing)) {
        checkedAddress = await this.checkAddress(
          parts,
          venueName,
          dto.acceptUnverifiedAddress === true,
        );
      } else if (dto.acceptUnverifiedAddress === true && !existing.addressVerified) {
        recheckedAddress = await this.recheckAddress(parts, venueName);
      }
    }

    // Spec 020 research R7: the zone is decided only when sent, or when the address changed.
    const decided = this.decide({
      sent: dto.timeZone,
      address: checkedAddress
        ? { state: checkedAddress.address.state, location: checkedAddress.location }
        : undefined,
    });

    return this.prisma.$transaction(async (tx) => {
      // Spec 020 research R8: every event of the venue is locked, and the zone compared and
      // converted from is the one read under this lock, never the row read before it
      // (review round 1, M2).
      const locked = await lockVenueAndEvents(tx, id, { allStatuses: true });
      await this.assertCapacityRules(tx, id, dto.seatingCapacity);
      // Issue #36 (research R15), like the zone above: whether the sent address is "the same"
      // (FR-008) is decided again against the row read under this lock. The same address as
      // stored now is not written, so an address another edit saved during the lookup keeps its
      // verified state; a different one is written (the later write wins, R7). Feature 024 R7:
      // a verified answer upgrades only the same address, still not verified, and never
      // decides the zone.
      let address: CheckedAddress | undefined;
      let changed = false;
      if (sent.length > 0) {
        const stored = await tx.location.findUniqueOrThrow({ where: { id } });
        const same = sameAddress(parts, stored);
        const looked = checkedAddress?.address ?? recheckedAddress;
        if (checkedAddress && !same) {
          changed = true;
          address = checkedAddress.address;
        } else if (same && !stored.addressVerified && looked?.addressVerified) {
          address = looked;
        }
      }
      // A zone worked out from the address only goes with a changed address (020 R7).
      const zone = changed || dto.timeZone !== undefined ? decided : null;
      if (zone && zone.timeZone !== locked.timeZone) {
        await moveEventsToZone(tx, { id, name: locked.name }, locked.timeZone, zone.timeZone);
      }
      return tx.location.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.seatingCapacity !== undefined ? { seatingCapacity: dto.seatingCapacity } : {}),
          ...address,
          ...zone,
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
   * flag says. Research R16: so is one a place on the map confirms, saved as sent.
   * One that moves the ZIP code or house number is refused as ambiguous, listing it (FR-021). No match or
   * several are refused, unless the request asked to save it even if unverified: then the address
   * is saved as sent and not verified. When the service cannot be asked, the save is refused with
   * 503 (research R6), unless the request sent that flag (feature 024, research R5) or came
   * through `create`'s internal demo-data option (013 R14): then it too is saved as sent, not
   * verified.
   */
  private async checkAddress(
    input: AddressParts,
    venueName: string,
    acceptUnverified: boolean,
    saveUnverifiedWhenUnavailable = false,
  ): Promise<CheckedWithPlace> {
    const sent = asSent(input);
    const unverified = (): CheckedWithPlace => ({ address: checked(sent, false), location: null });
    let looked: Lookup;
    try {
      looked = await this.lookUp(sent, venueName);
    } catch (err) {
      this.logUnavailable(err);
      if (saveUnverifiedWhenUnavailable || acceptUnverified) return unverified();
      throw serviceUnavailable();
    }
    // Spec 020 R1: only a verified address's place is used to find the zone.
    if ('found' in looked) return looked.found;
    if (acceptUnverified) return unverified();

    const { result } = looked;

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
   * Feature 024 research R7: a not-verified venue's unchanged address looked up again. Only a
   * match that keeps the typed ZIP code and house number counts, as in `checkAddress`; anything
   * else, the service being unavailable included, is no upgrade, never a refusal.
   */
  private async recheckAddress(
    input: AddressParts,
    venueName: string,
  ): Promise<CheckedAddress | undefined> {
    const sent = asSent(input);
    try {
      const looked = await this.lookUp(sent, venueName);
      return 'found' in looked ? looked.found.address : undefined;
    } catch (err) {
      this.logUnavailable(err);
      return undefined;
    }
  }

  /**
   * Research R16, in order: the address service's one match that keeps the typed ZIP code and
   * house number is verified in its standard form (FR-021). Otherwise a place on the map at the
   * typed street (`placeAtAddress`), then one found by the venue's name (`placeByName`),
   * verifies the address as typed. The map is asked only after the address service answered;
   * when the address service cannot be asked, this throws, as before (R6). A map search that
   * fails is logged and finds nothing.
   */
  private async lookUp(sent: AddressParts, venueName: string): Promise<Lookup> {
    const result = await this.geocoder.lookup(sent);
    if (result.kind === 'match') {
      const match = {
        street: result.street,
        city: result.city,
        state: result.state,
        zip: result.zip,
      };
      if (matchesTyped(sent, match)) {
        return { found: { address: verified(sent, match), location: result.location } };
      }
    }
    const place = await this.searchMap(sent, venueName);
    if (place) return { found: { address: checked(sent, true), location: place } };
    return { result };
  }

  /** Research R16: the place of the first map result that confirms the address, if any. */
  private async searchMap(sent: AddressParts, venueName: string): Promise<Place | undefined> {
    const name = venueName.trim();
    try {
      const street = withoutUnit(sent.street);
      const atAddress = await this.map.byAddress({ street, city: sent.city, state: sent.state });
      const found = atAddress.find((p) => placeAtAddress(sent, p));
      if (found) return found.location;
      if (name === '') return undefined;
      const named = await this.map.byName(name, sent);
      return named.find((p) => placeByName(sent, name, p))?.location;
    } catch (err) {
      if (!(err instanceof AddressServiceUnavailableError)) throw err;
      const cause = err.cause instanceof Error ? `: ${err.cause.message}` : '';
      this.logger.warn(`Map search unavailable: ${err.message}${cause}`);
      return undefined;
    }
  }

  /** Research R6: an unavailable service is logged with its cause; anything else is rethrown. */
  private logUnavailable(err: unknown): void {
    if (!(err instanceof AddressServiceUnavailableError)) throw err;
    const cause = err.cause instanceof Error ? `: ${err.cause.message}` : '';
    this.logger.warn(`Address service unavailable: ${err.message}${cause}`);
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

    // Spec 038 FR-009 (T017): while the venue has layouts, its capacity is its largest layout's
    // seat count, set by every layout write (layouts.service.ts), never typed. Read again under
    // the venue's lock, which every layout write takes first (research R7).
    if ((await db.layout.count({ where: { locationId: id } })) > 0) {
      throw new BadRequestException({
        message: [
          "seatingCapacity is set by this venue's seating layouts (the largest one's seats); " +
            'change a layout instead',
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
