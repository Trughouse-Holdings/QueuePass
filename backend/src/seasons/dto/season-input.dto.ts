import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsISO8601,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { OFFSET_DATE_TIME, needsOffset } from '../../events/event-time';
import type { SportName } from '../season-rules';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const SPORTS: readonly SportName[] = [
  'BASKETBALL',
  'FOOTBALL',
  'BASEBALL',
  'SOCCER',
  'HOCKEY',
  'VOLLEYBALL',
];

/**
 * Spec 041 (contracts/openapi.yaml `SeasonPriceInput`): one pass price, for a level (seated) or a
 * ticket type name (general admission). "Exactly one" is the rules' check (`prices.<i>`), so the
 * refusal names the entry; each message here starts with its property name, read as
 * `prices.<i>.<field> …`.
 */
export class SeasonPriceInputDto {
  @ValidateIf((o: SeasonPriceInputDto) => o.levelId !== undefined)
  @IsUUID('all', { message: 'levelId must be a price level id (UUID)' })
  levelId?: string;

  @ValidateIf((o: SeasonPriceInputDto) => o.tierName !== undefined)
  @Transform(trim)
  @IsString({ message: 'tierName must be a ticket type name' })
  @Length(1, 100, { message: 'tierName must be between 1 and 100 characters' })
  tierName?: string;

  @IsString({ message: 'price must be a decimal string such as "640.00"' })
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'price must be a non-negative decimal string with at most 2 decimal places',
  })
  price!: string;
}

const PASSES_MESSAGE =
  'maxPassesPerCustomer must be a whole number from 1 to 10, or empty for no limit';

/**
 * Spec 041 (T008; `SeasonInput`): the whole Season as the form sends it. Shape only; the rules
 * between fields and against the database are `season-rules.ts`'s, run under the locks.
 */
export class SeasonInputDto {
  @Transform(trim)
  @IsString({ message: 'name must be a string' })
  @Length(1, 100, { message: 'name must be between 1 and 100 characters' })
  name!: string;

  @ValidateIf((o: SeasonInputDto) => o.sport !== undefined && o.sport !== null)
  @IsIn(SPORTS, { message: `sport must be one of ${SPORTS.join(', ')}, or null` })
  sport?: SportName | null;

  @ValidateIf((o: SeasonInputDto) => o.team !== undefined && o.team !== null)
  @Transform(trim)
  @IsString({ message: 'team must be a string, or null' })
  @Length(1, 100, { message: 'team must be between 1 and 100 characters' })
  team?: string | null;

  @IsUUID('all', { message: 'locationId must be a venue id (UUID)' })
  locationId!: string;

  /** The key is required (`null` is general admission), so a form can't leave it out by mistake. */
  @ValidateIf((o: SeasonInputDto) => o.layoutId !== null)
  @IsUUID('all', { message: 'layoutId must be a layout id (UUID), or null for general admission' })
  layoutId!: string | null;

  /** Research R16: the venue's local time with the venue's offset, as event times. */
  @IsISO8601({ strict: true }, { message: 'salesEndAt must be an ISO-8601 timestamp' })
  @Matches(OFFSET_DATE_TIME, { message: needsOffset('salesEndAt') })
  salesEndAt!: string;

  @ValidateIf(
    (o: SeasonInputDto) => o.singleSalesOpenAt !== undefined && o.singleSalesOpenAt !== null,
  )
  @IsISO8601({ strict: true }, { message: 'singleSalesOpenAt must be an ISO-8601 timestamp' })
  @Matches(OFFSET_DATE_TIME, { message: needsOffset('singleSalesOpenAt') })
  singleSalesOpenAt?: string | null;

  @ValidateIf(
    (o: SeasonInputDto) => o.maxPassesPerCustomer !== undefined && o.maxPassesPerCustomer !== null,
  )
  @IsInt({ message: PASSES_MESSAGE })
  @Min(1, { message: PASSES_MESSAGE })
  @Max(10, { message: PASSES_MESSAGE })
  maxPassesPerCustomer?: number | null;

  @IsArray({ message: 'eventIds must be a list of event ids' })
  @ArrayMaxSize(50, { message: 'eventIds may hold at most 50 events' })
  @ArrayUnique({ message: 'eventIds must not repeat an event' })
  @IsUUID('all', { each: true, message: 'eventIds must hold event ids (UUIDs)' })
  eventIds!: string[];

  @IsArray({ message: 'prices must be a list of pass prices' })
  @ArrayMaxSize(50, { message: 'prices may hold at most 50 prices' })
  @ValidateNested({
    each: true,
    message: 'prices must be a list of pass prices, each an object with a price',
  })
  @Type(() => SeasonPriceInputDto)
  prices!: SeasonPriceInputDto[];
}
