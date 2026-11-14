import { IsInt, IsString, IsUUID, Matches, Min, ValidateIf } from 'class-validator';

/**
 * Spec 038 (research R8; contracts/openapi.yaml `LevelPriceInput`): one level's price for an event.
 * Each message starts with its property name, so a refusal reads `levelPrices.<i>.<field> …`.
 */
export class LevelPriceDto {
  @IsUUID('all', { message: 'levelId must be a price level id (UUID)' })
  levelId!: string;

  @IsString({ message: 'price must be a decimal string such as "60.00"' })
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'price must be a non-negative decimal string with at most 2 decimal places',
  })
  price!: string;
}

const ROW_MESSAGE = 'row must be a whole number of at least 1, and is required with seat';
const SEAT_MESSAGE = 'seat must be a whole number of at least 1';

/**
 * Spec 038 (research R8; `OffSaleSelector`): a whole section, one row of it, or one seat, by numbers
 * as in `SeatChoice`. `seat` is only allowed with `row` (`offSale.<i>.row …`). Never `null`.
 */
export class OffSaleSelectorDto {
  @IsUUID('all', { message: 'sectionId must be a section id (UUID)' })
  sectionId!: string;

  @ValidateIf((o: OffSaleSelectorDto) => o.row !== undefined || o.seat !== undefined)
  @IsInt({ message: ROW_MESSAGE })
  @Min(1, { message: ROW_MESSAGE })
  row?: number;

  @ValidateIf((o: OffSaleSelectorDto) => o.seat !== undefined)
  @IsInt({ message: SEAT_MESSAGE })
  @Min(1, { message: SEAT_MESSAGE })
  seat?: number;
}
