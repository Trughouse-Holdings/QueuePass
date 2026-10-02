import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * GET /events filters (spec 002 `locationId`; spec 004 FR-006 `q`, `from`, `to`). Unknown
 * parameters are refused by the global ValidationPipe (forbidNonWhitelisted).
 */
export class ListEventsQuery {
  @IsOptional()
  @IsUUID('all', { message: 'locationId must be a UUID' })
  locationId?: string;

  @IsOptional()
  @IsString({ message: 'q must be a string' })
  @MaxLength(200, { message: 'q must be at most 200 characters' })
  q?: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'from must be an ISO-8601 timestamp' })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'to must be an ISO-8601 timestamp' })
  to?: string;
}
