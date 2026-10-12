import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { ZIP_PATTERN } from '@queuepass/shared';
import { MESSAGES, STATE_CODES, trim } from './address-fields';

/**
 * Partial update — every field optional, same rules as create when supplied.
 * Written out rather than derived from CreateLocationDto via @nestjs/mapped-types,
 * which ships ESM-only and cannot load under the CommonJS test runner.
 *
 * Spec 013 FR-009, FR-019: the four address fields come all together or not at all, and
 * `acceptUnverifiedAddress` only with them; LocationsService checks both.
 */
export class UpdateLocationDto {
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'name must be a string' })
  @Length(1, 200, { message: 'name must be between 1 and 200 characters' })
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'street must be a string' })
  @Length(1, 200, { message: MESSAGES.street })
  street?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'city must be a string' })
  @Length(1, 100, { message: MESSAGES.city })
  city?: string;

  @IsOptional()
  @IsIn(STATE_CODES, { message: MESSAGES.state })
  state?: string;

  @IsOptional()
  @IsString({ message: 'zip must be a string' })
  @Matches(ZIP_PATTERN, { message: MESSAGES.zip })
  zip?: string;

  @IsOptional()
  @IsBoolean({ message: MESSAGES.acceptUnverifiedAddress })
  acceptUnverifiedAddress?: boolean;

  @IsOptional()
  @IsInt({ message: 'seatingCapacity must be a whole number' })
  @IsPositive({ message: 'seatingCapacity must be a positive whole number' })
  seatingCapacity?: number;
}
