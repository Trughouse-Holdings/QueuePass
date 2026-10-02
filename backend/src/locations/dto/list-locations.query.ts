import { IsOptional, IsString, MaxLength } from 'class-validator';

/** GET /locations filter (spec 004 FR-007). */
export class ListLocationsQuery {
  @IsOptional()
  @IsString({ message: 'q must be a string' })
  @MaxLength(200, { message: 'q must be at most 200 characters' })
  q?: string;
}
