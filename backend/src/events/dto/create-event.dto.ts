import { Transform } from 'class-transformer';
import {
  IsISO8601,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateEventDto {
  @Transform(trim)
  @IsString({ message: 'name must be a string' })
  @Length(1, 200, { message: 'name must be between 1 and 200 characters' })
  name!: string;

  @IsUUID('4', { message: 'locationId must be a UUID' })
  locationId!: string;

  @IsISO8601({ strict: true }, { message: 'startsAt must be an ISO-8601 timestamp' })
  startsAt!: string;

  @IsISO8601({ strict: true }, { message: 'endsAt must be an ISO-8601 timestamp' })
  endsAt!: string;

  /** Spec 007 FR-019: optional; when left out, the venue's seating capacity. */
  @IsOptional()
  @IsInt({ message: 'totalTicketCapacity must be a whole number' })
  @IsPositive({ message: 'totalTicketCapacity must be a positive whole number' })
  totalTicketCapacity?: number;

  /**
   * Decimal STRING, not a number — binary floating point cannot represent currency
   * exactly. The pattern also rejects negatives, satisfying FR-021 at the edge.
   */
  @IsString({ message: 'basePrice must be a decimal string such as "45.00"' })
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'basePrice must be a non-negative decimal string with at most 2 decimal places',
  })
  basePrice!: string;
}
