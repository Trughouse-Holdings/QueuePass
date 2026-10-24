import { IsString, Length } from 'class-validator';

/**
 * Spec 017 FR-008. Mirrors EntryLookupInput in contracts/openapi.yaml. Up to 80 characters from
 * spec 018, so a live code has room (research R4).
 */
export class EntryLookupDto {
  @IsString({ message: 'code must be a string' })
  @Length(1, 80, { message: 'code must be between 1 and 80 characters' })
  code!: string;
}
