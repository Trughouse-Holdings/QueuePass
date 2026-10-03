import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** Spec 005 FR-001, spec 006 FR-005. Mirrors OrderInput in contracts/openapi.yaml. */
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
}
