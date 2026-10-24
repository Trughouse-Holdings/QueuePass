import { IsBoolean, IsUUID } from 'class-validator';

/** Spec 017 FR-015, FR-015a. Mirrors AdmitInput in contracts/openapi.yaml. */
export class AdmitDto {
  @IsUUID('all', { message: 'ticketId must be a UUID' })
  ticketId!: string;

  @IsBoolean({ message: 'wholeOrder must be true or false' })
  wholeOrder!: boolean;
}
