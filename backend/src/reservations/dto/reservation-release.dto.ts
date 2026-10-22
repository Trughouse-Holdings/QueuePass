import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, ValidateNested } from 'class-validator';
import { SeatChoiceDto } from '../../orders/dto/create-order.dto';

/** Spec 015 FR-007. Mirrors ReservationRelease in contracts/openapi.yaml: omit seats for all. */
export class ReservationReleaseDto {
  @IsOptional()
  @IsArray({ message: 'seats must be a list' })
  @ArrayMinSize(1, { message: 'seats must list at least 1 seat' })
  @ArrayMaxSize(10, { message: 'seats must list at most 10 seats' })
  @ValidateNested({ each: true })
  @Type(() => SeatChoiceDto)
  seats?: SeatChoiceDto[];
}
