import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsPositive,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';
import { ZIP_PATTERN, type UsTimeZone } from '@queuepass/shared';
import { MESSAGES, STATE_CODES, TIME_ZONE_IDS, TIME_ZONE_MESSAGE, trim } from './address-fields';

export class CreateLocationDto {
  /** Trimmed before length-checking, so "   " fails rather than passing as length 3 (FR-012). */
  @Transform(trim)
  @IsString({ message: 'name must be a string' })
  @Length(1, 200, { message: 'name must be between 1 and 200 characters' })
  name!: string;

  /** Spec 013 FR-001: the address as four fields; the Backend builds `address` from them. */
  @Transform(trim)
  @IsString({ message: 'street must be a string' })
  @Length(1, 200, { message: MESSAGES.street })
  street!: string;

  @Transform(trim)
  @IsString({ message: 'city must be a string' })
  @Length(1, 100, { message: MESSAGES.city })
  city!: string;

  @IsIn(STATE_CODES, { message: MESSAGES.state })
  state!: string;

  @IsString({ message: 'zip must be a string' })
  @Matches(ZIP_PATTERN, { message: MESSAGES.zip })
  zip!: string;

  /**
   * Spec 013 FR-019 "save even if unverified"; never skips the lookup (research R2). Feature 024:
   * also saves the address not verified when the service is unavailable; the Admin app sends it
   * with every address.
   */
  @ValidateIf((o: CreateLocationDto) => o.acceptUnverifiedAddress !== undefined)
  @IsBoolean({ message: MESSAGES.acceptUnverifiedAddress })
  acceptUnverifiedAddress?: boolean;

  @IsInt({ message: 'seatingCapacity must be a whole number' })
  @IsPositive({ message: 'seatingCapacity must be a positive whole number' })
  seatingCapacity!: number;

  /** Spec 020 FR-004 (research R4): the admin's explicit choice, used instead of a worked-out one. */
  @ValidateIf((o: CreateLocationDto) => o.timeZone !== undefined)
  @IsIn(TIME_ZONE_IDS, { message: TIME_ZONE_MESSAGE })
  timeZone?: UsTimeZone;
}
