import { IsString, Length } from 'class-validator';

/** Spec 017 FR-008. Mirrors EntryLookupInput in contracts/openapi.yaml. */
export class EntryLookupDto {
  @IsString({ message: 'code must be a string' })
  @Length(1, 64, { message: 'code must be between 1 and 64 characters' })
  code!: string;
}
