import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsPositive, IsString, Length } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Partial update — every field optional, same rules as create when supplied.
 * Written out rather than derived from CreateLocationDto via @nestjs/mapped-types,
 * which ships ESM-only and cannot load under the CommonJS test runner.
 */
export class UpdateLocationDto {
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'name must be a string' })
  @Length(1, 200, { message: 'name must be between 1 and 200 characters' })
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'address must be a string' })
  @Length(1, 500, { message: 'address must be between 1 and 500 characters' })
  address?: string;

  @IsOptional()
  @IsInt({ message: 'seatingCapacity must be a whole number' })
  @IsPositive({ message: 'seatingCapacity must be a positive whole number' })
  seatingCapacity?: number;
}
