import { Transform } from 'class-transformer';
import { IsInt, IsPositive, IsString, Length, Matches } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Spec 004 FR-001. Mirrors TicketTierInput in contracts/openapi.yaml. */
export class CreateTierDto {
  @Transform(trim)
  @IsString({ message: 'name must be a string' })
  @Length(1, 100, { message: 'name must be between 1 and 100 characters' })
  name!: string;

  /** Decimal STRING, never a number, so no cent is lost. */
  @IsString({ message: 'price must be a decimal string such as "45.00"' })
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'price must be a non-negative decimal string with at most 2 decimal places',
  })
  price!: string;

  @IsInt({ message: 'quantity must be a whole number' })
  @IsPositive({ message: 'quantity must be a positive whole number' })
  quantity!: number;
}
