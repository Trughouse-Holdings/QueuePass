import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** Spec 007. Mirrors SeatChoice in contracts/openapi.yaml. */
export class SeatChoiceDto {
  @IsUUID('all', { message: 'sectionId must be a UUID' })
  sectionId!: string;

  @IsInt({ message: 'row must be a whole number' })
  @Min(1, { message: 'row must be at least 1' })
  row!: number;

  @IsInt({ message: 'seat must be a whole number' })
  @Min(1, { message: 'seat must be at least 1' })
  seat!: number;
}

/** Spec 005 FR-001, 006 FR-005, 007 FR-008. Mirrors OrderInput in contracts/openapi.yaml. */
export class CreateOrderDto {
  @IsOptional()
  @IsUUID('all', { message: 'tierId must be a UUID' })
  tierId?: string;

  @IsInt({ message: 'quantity must be a whole number' })
  @Min(1, { message: 'quantity must be between 1 and 10' })
  @Max(10, { message: 'quantity must be between 1 and 10' })
  quantity!: number;

  /** Spec 006 FR-005: one random id per confirmation; repeating it returns the same order. */
  @IsOptional()
  @IsUUID('all', { message: 'requestId must be a UUID' })
  requestId?: string;

  /** Spec 007 FR-008: required for reserved seating, one per ticket. */
  @IsOptional()
  @IsArray({ message: 'seats must be a list' })
  @ArrayMinSize(1, { message: 'seats must list at least 1 seat' })
  @ArrayMaxSize(10, { message: 'seats must list at most 10 seats' })
  @ValidateNested({ each: true })
  @Type(() => SeatChoiceDto)
  seats?: SeatChoiceDto[];
}
