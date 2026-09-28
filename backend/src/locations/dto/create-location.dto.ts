import { Transform } from 'class-transformer';
import { IsInt, IsPositive, IsString, Length } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateLocationDto {
  /** Trimmed before length-checking, so "   " fails rather than passing as length 3 (FR-012). */
  @Transform(trim)
  @IsString({ message: 'name must be a string' })
  @Length(1, 200, { message: 'name must be between 1 and 200 characters' })
  name!: string;

  @Transform(trim)
  @IsString({ message: 'address must be a string' })
  @Length(1, 500, { message: 'address must be between 1 and 500 characters' })
  address!: string;

  @IsInt({ message: 'seatingCapacity must be a whole number' })
  @IsPositive({ message: 'seatingCapacity must be a positive whole number' })
  seatingCapacity!: number;
}
