import { IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

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

  /**
   * Spec 020 FR-020 (research R15): days, `YYYY-MM-DD`, both included, matched against each
   * event's start date in its venue's zone. Not combinable with `from`/`to`.
   */
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'fromDate must be a date, YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'fromDate must be a date, YYYY-MM-DD' })
  fromDate?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'toDate must be a date, YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'toDate must be a date, YYYY-MM-DD' })
  toDate?: string;
}
