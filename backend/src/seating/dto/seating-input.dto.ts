import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsUUID, ValidateNested } from 'class-validator';

class SectionTierDto {
  @IsUUID('all', { message: 'sectionId must be a UUID' })
  sectionId!: string;

  @IsUUID('all', { message: 'tierId must be a UUID' })
  tierId!: string;
}

/** Spec 007 FR-002, FR-004. Mirrors SeatingInput in contracts/openapi.yaml. */
export class SeatingInputDto {
  @IsBoolean({ message: 'reservedSeating must be true or false' })
  reservedSeating!: boolean;

  @IsArray({ message: 'sections must be a list' })
  @ValidateNested({ each: true })
  @Type(() => SectionTierDto)
  sections!: SectionTierDto[];
}
