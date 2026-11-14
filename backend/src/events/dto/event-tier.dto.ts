import { IsUUID, ValidateIf } from 'class-validator';
import { CreateTierDto } from '../../tiers/dto/create-tier.dto';

/**
 * Spec 031 (research R2, R9): one ticket type in `createEvent` (`EventTierInput`), the fields and
 * messages of `CreateTierDto` (spec 038: `007`'s `sectionIds` went with contract 2.0.0). Every decorator has
 * its own message starting with its property name, so each entry reads `tiers.<i>.<field> …`
 * (research R3); `null` is refused, not skipped (`@ValidateIf`, as #117).
 */
export class EventTierDto extends CreateTierDto {
  /**
   * Spec 035 (research R8): optional, only on `updateEvent`; `createLocked` refuses it
   * (`tiers.<i>.id is not allowed when scheduling`). Not `null`.
   */
  @ValidateIf((o: EventTierDto) => o.id !== undefined)
  @IsUUID('all', { message: 'id must be a ticket type id (UUID)' })
  id?: string;
}
