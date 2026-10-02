import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** Spec 005 FR-001. Mirrors OrderInput in contracts/openapi.yaml. */
export class CreateOrderDto {
  @IsOptional()
  @IsUUID('all', { message: 'tierId must be a UUID' })
  tierId?: string;

  @IsInt({ message: 'quantity must be a whole number' })
  @Min(1, { message: 'quantity must be between 1 and 10' })
  @Max(10, { message: 'quantity must be between 1 and 10' })
  quantity!: number;
}
