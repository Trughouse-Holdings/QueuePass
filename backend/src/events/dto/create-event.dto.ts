import { Transform, Type } from 'class-transformer';
import { LAYOUT_LIMITS } from '@queuepass/shared';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsInt,
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
import { LevelPriceDto, OffSaleSelectorDto } from './event-seating.dto';
import { EventTierDto } from './event-tier.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const LIMIT_MESSAGE =
  'maxTicketsPerCustomer must be a whole number of at least 1, or empty for no limit';

export class CreateEventDto {
  @Transform(trim)
  @IsString({ message: 'name must be a string' })
  @Length(1, 200, { message: 'name must be between 1 and 200 characters' })
  name!: string;

  @IsUUID('4', { message: 'locationId must be a UUID' })
  locationId!: string;

  /** Spec 020 research R9: the venue's local time with the venue's offset. */
  @IsISO8601({ strict: true }, { message: 'startsAt must be an ISO-8601 timestamp' })
  @Matches(OFFSET_DATE_TIME, { message: needsOffset('startsAt') })
  startsAt!: string;

  @IsISO8601({ strict: true }, { message: 'endsAt must be an ISO-8601 timestamp' })
  @Matches(OFFSET_DATE_TIME, { message: needsOffset('endsAt') })
  endsAt!: string;

  /**
   * Spec 025 FR-007, FR-008: optional, the venue's local time with its offset; left out, the
   * start minus 1 hour.
   */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'doorsOpenAt must be an ISO-8601 timestamp' })
  @Matches(OFFSET_DATE_TIME, { message: needsOffset('doorsOpenAt') })
  doorsOpenAt?: string;

  /** Spec 007 FR-019: optional; when left out, the venue's seating capacity. */
  @IsOptional()
  @IsInt({ message: 'totalTicketCapacity must be a whole number' })
  @IsPositive({ message: 'totalTicketCapacity must be a positive whole number' })
  totalTicketCapacity?: number;

  /** Spec 016 FR-001: optional; left out or `null`, the event has no per-customer limit. */
  @IsOptional()
  @IsInt({ message: LIMIT_MESSAGE })
  @Min(1, { message: LIMIT_MESSAGE })
  maxTicketsPerCustomer?: number | null;

  /**
   * Decimal STRING, not a number — binary floating point cannot represent currency
   * exactly. The pattern also rejects negatives, satisfying FR-021 at the edge.
   */
  @IsString({ message: 'basePrice must be a decimal string such as "45.00"' })
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'basePrice must be a non-negative decimal string with at most 2 decimal places',
  })
  basePrice!: string;

  /**
   * Spec 031 (research R9): optional, at most 50 (a layout's section cap); never `null`. Saved
   * with the event in one transaction, all or nothing.
   */
  @ValidateIf((o: CreateEventDto) => o.tiers !== undefined)
  @IsArray({ message: 'tiers must be a list of ticket types' })
  @ArrayMaxSize(50, { message: 'tiers may hold at most 50 ticket types' })
  @ValidateNested({
    each: true,
    message: 'tiers must be a list of ticket types, each an object with a name and a price',
  })
  @Type(() => EventTierDto)
  tiers?: EventTierDto[];

  /**
   * Spec 038 (research R8): one of the venue's layouts for reserved seating; `null` or left out,
   * general admission.
   */
  @ValidateIf((o: CreateEventDto) => o.layoutId !== undefined && o.layoutId !== null)
  @IsUUID('all', { message: 'layoutId must be a layout id (UUID), or null for general admission' })
  layoutId?: string | null;

  /** Spec 038 (FR-011): a price per level with seats on sale; at most 50, never `null`. */
  @ValidateIf((o: CreateEventDto) => o.levelPrices !== undefined)
  @IsArray({ message: 'levelPrices must be a list of level prices' })
  @ArrayMaxSize(LAYOUT_LIMITS.maxCarriedLevels, {
    message: `levelPrices may hold at most ${LAYOUT_LIMITS.maxCarriedLevels} prices`,
  })
  @ValidateNested({
    each: true,
    message:
      'levelPrices must be a list of level prices, each an object with a levelId and a price',
  })
  @Type(() => LevelPriceDto)
  levelPrices?: LevelPriceDto[];

  /** Spec 038 (FR-013): the seats not sold, by section, row or seat; at most 5,000, never `null`. */
  @ValidateIf((o: CreateEventDto) => o.offSale !== undefined)
  @IsArray({ message: 'offSale must be a list of sections, rows or seats' })
  @ArrayMaxSize(LAYOUT_LIMITS.maxOffSaleSelectors, {
    message: `offSale may hold at most ${LAYOUT_LIMITS.maxOffSaleSelectors.toLocaleString('en-US')} entries`,
  })
  @ValidateNested({
    each: true,
    message: 'offSale must be a list of sections, rows or seats, each an object with a sectionId',
  })
  @Type(() => OffSaleSelectorDto)
  offSale?: OffSaleSelectorDto[];
}
