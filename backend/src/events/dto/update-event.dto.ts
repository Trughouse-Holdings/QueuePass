import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { OFFSET_DATE_TIME, needsOffset } from '../event-time';
import { EventTierDto } from './event-tier.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const LIMIT_MESSAGE =
  'maxTicketsPerCustomer must be a whole number of at least 1, or empty for no limit';

/**
 * Partial update — every field optional, same rules as create when supplied.
 *
 * Issue #117 (as #36 for venues): a field that cannot be empty may be left out but never sent as
 * null; `@ValidateIf` (not `@IsOptional`) makes null fail its rule, a 400. Null keeps its meaning
 * only where it has one: `maxTicketsPerCustomer` (016, clears the limit) and `doorsOpenAt` (025
 * research R6, counts as left out).
 */
export class UpdateEventDto {
  @ValidateIf((o: UpdateEventDto) => o.name !== undefined)
  @Transform(trim)
  @IsString({ message: 'name must be a string' })
  @Length(1, 200, { message: 'name must be between 1 and 200 characters' })
  name?: string;

  @ValidateIf((o: UpdateEventDto) => o.locationId !== undefined)
  @IsUUID('4', { message: 'locationId must be a UUID' })
  locationId?: string;

  /** Spec 020 research R9: the destination venue's local time with its offset. */
  @ValidateIf((o: UpdateEventDto) => o.startsAt !== undefined)
  @IsISO8601({ strict: true }, { message: 'startsAt must be an ISO-8601 timestamp' })
  @Matches(OFFSET_DATE_TIME, { message: needsOffset('startsAt') })
  startsAt?: string;

  @ValidateIf((o: UpdateEventDto) => o.endsAt !== undefined)
  @IsISO8601({ strict: true }, { message: 'endsAt must be an ISO-8601 timestamp' })
  @Matches(OFFSET_DATE_TIME, { message: needsOffset('endsAt') })
  endsAt?: string;

  /**
   * Spec 025 FR-008: checked against the start in force after the update; left out while the
   * start moves, doors move by the same amount.
   */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'doorsOpenAt must be an ISO-8601 timestamp' })
  @Matches(OFFSET_DATE_TIME, { message: needsOffset('doorsOpenAt') })
  doorsOpenAt?: string;

  @ValidateIf((o: UpdateEventDto) => o.totalTicketCapacity !== undefined)
  @IsInt({ message: 'totalTicketCapacity must be a whole number' })
  @IsPositive({ message: 'totalTicketCapacity must be a positive whole number' })
  totalTicketCapacity?: number;

  /** Spec 016 FR-001: optional; left out or `null`, the event has no per-customer limit. */
  @IsOptional()
  @IsInt({ message: LIMIT_MESSAGE })
  @Min(1, { message: LIMIT_MESSAGE })
  maxTicketsPerCustomer?: number | null;

  @ValidateIf((o: UpdateEventDto) => o.basePrice !== undefined)
  @IsString({ message: 'basePrice must be a decimal string such as "45.00"' })
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'basePrice must be a non-negative decimal string with at most 2 decimal places',
  })
  basePrice?: string;

  /**
   * Spec 035 (research R8): optional, left out is `false` when `tiers` is sent; never `null`.
   * Without `tiers` and this field, ticket types and seating are not changed.
   */
  @ValidateIf((o: UpdateEventDto) => o.reservedSeating !== undefined)
  @IsBoolean({ message: 'reservedSeating must be true or false' })
  reservedSeating?: boolean;

  /**
   * Spec 035 (research R8): optional, the complete new set, at most 50; never `null`. Saved with
   * the event in one transaction, all or nothing.
   */
  @ValidateIf((o: UpdateEventDto) => o.tiers !== undefined)
  @IsArray({ message: 'tiers must be a list of ticket types' })
  @ArrayMaxSize(50, { message: 'tiers may hold at most 50 ticket types' })
  @ValidateNested({
    each: true,
    message: 'tiers must be a list of ticket types, each an object with a name and a price',
  })
  @Type(() => EventTierDto)
  tiers?: EventTierDto[];
}
