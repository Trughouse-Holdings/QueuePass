import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Spec 007 FR-001. Mirrors SectionInput in contracts/openapi.yaml. */
export class SectionInputDto {
  @Transform(trim)
  @IsString({ message: 'name must be a string' })
  @Length(1, 50, { message: 'name must be between 1 and 50 characters' })
  name!: string;

  @IsInt({ message: 'rows must be a whole number' })
  @Min(1, { message: 'rows must be between 1 and 100' })
  @Max(100, { message: 'rows must be between 1 and 100' })
  rows!: number;

  @IsInt({ message: 'seatsPerRow must be a whole number' })
  @Min(1, { message: 'seatsPerRow must be between 1 and 200' })
  @Max(200, { message: 'seatsPerRow must be between 1 and 200' })
  seatsPerRow!: number;
}

/** Spec 007 FR-001. Mirrors LayoutInput in contracts/openapi.yaml. */
export class LayoutInputDto {
  @IsArray({ message: 'sections must be a list' })
  @ArrayMinSize(1, { message: 'a layout needs at least 1 section' })
  @ArrayMaxSize(50, { message: 'a layout has at most 50 sections' })
  @ValidateNested({ each: true })
  @Type(() => SectionInputDto)
  sections!: SectionInputDto[];
}
