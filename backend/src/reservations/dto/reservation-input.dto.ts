import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { SeatChoiceDto } from '../../orders/dto/create-order.dto';

/** Spec 015 FR-003. Mirrors ReservationInput in contracts/openapi.yaml. */
export class ReservationInputDto {
  @IsArray({ message: 'seats must be a list' })
  @ArrayMinSize(1, { message: 'seats must list at least 1 seat' })
  @ArrayMaxSize(10, { message: 'seats must list at most 10 seats' })
  @ValidateNested({ each: true })
  @Type(() => SeatChoiceDto)
  seats!: SeatChoiceDto[];
}
