import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID, ValidateIf } from 'class-validator';
import { CreateTierDto } from '../../tiers/dto/create-tier.dto';

/**
 * Spec 031 (research R2, R9): one ticket type in `createEvent` (`EventTierInput`), the fields and
 * messages of `CreateTierDto` and the sections it sells with reserved seating. Every decorator has
 * its own message starting with its property name, so each entry reads `tiers.<i>.<field> …`
 * (research R3); `null` is refused, not skipped (`@ValidateIf`, as #117).
 */
export class EventTierDto extends CreateTierDto {
  @ValidateIf((o: EventTierDto) => o.sectionIds !== undefined)
  @IsArray({ message: 'sectionIds must be a list of section ids' })
  @ArrayMaxSize(50, { message: 'sectionIds may list at most 50 sections' })
  @ArrayUnique({ message: 'sectionIds lists a section more than once' })
  @IsUUID('all', { each: true, message: 'sectionIds must hold section ids (UUIDs)' })
  sectionIds?: string[];
}
