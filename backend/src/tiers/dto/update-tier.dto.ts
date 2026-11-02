import { Transform } from 'class-transformer';
import { IsInt, IsPositive, IsString, Length, Matches, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Partial update — every field optional, same rules as create when supplied. Issue #117: each
 * may be left out but never sent as null; `@ValidateIf` (not `@IsOptional`) makes null a 400.
 */
export class UpdateTierDto {
  @ValidateIf((o: UpdateTierDto) => o.name !== undefined)
  @Transform(trim)
  @IsString({ message: 'name must be a string' })
  @Length(1, 100, { message: 'name must be between 1 and 100 characters' })
  name?: string;

  @ValidateIf((o: UpdateTierDto) => o.price !== undefined)
  @IsString({ message: 'price must be a decimal string such as "45.00"' })
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'price must be a non-negative decimal string with at most 2 decimal places',
  })
  price?: string;

  @ValidateIf((o: UpdateTierDto) => o.quantity !== undefined)
  @IsInt({ message: 'quantity must be a whole number' })
  @IsPositive({ message: 'quantity must be a positive whole number' })
  quantity?: number;
}
