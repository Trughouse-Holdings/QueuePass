import { Transform } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { OFFSET_DATE_TIME, needsOffset } from '../event-time';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const LIMIT_MESSAGE =
  'maxTicketsPerCustomer must be a whole number of at least 1, or empty for no limit';

/** Partial update — every field optional, same rules as create when supplied. */
export class UpdateEventDto {
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'name must be a string' })
  @Length(1, 200, { message: 'name must be between 1 and 200 characters' })
  name?: string;

  @IsOptional()
  @IsUUID('4', { message: 'locationId must be a UUID' })
  locationId?: string;

  /** Spec 020 research R9: the destination venue's local time with its offset. */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'startsAt must be an ISO-8601 timestamp' })
  @Matches(OFFSET_DATE_TIME, { message: needsOffset('startsAt') })
  startsAt?: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'endsAt must be an ISO-8601 timestamp' })
  @Matches(OFFSET_DATE_TIME, { message: needsOffset('endsAt') })
  endsAt?: string;

  @IsOptional()
  @IsInt({ message: 'totalTicketCapacity must be a whole number' })
  @IsPositive({ message: 'totalTicketCapacity must be a positive whole number' })
  totalTicketCapacity?: number;

  /** Spec 016 FR-001: optional; left out or `null`, the event has no per-customer limit. */
  @IsOptional()
  @IsInt({ message: LIMIT_MESSAGE })
  @Min(1, { message: LIMIT_MESSAGE })
  maxTicketsPerCustomer?: number | null;

  @IsOptional()
  @IsString({ message: 'basePrice must be a decimal string such as "45.00"' })
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'basePrice must be a non-negative decimal string with at most 2 decimal places',
  })
  basePrice?: string;
}
