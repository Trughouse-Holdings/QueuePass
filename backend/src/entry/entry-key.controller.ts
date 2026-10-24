import { Controller, Get, Header, Param, ParseUUIDPipe } from '@nestjs/common';
import type { TicketEntryKey } from '@queuepass/shared';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Roles } from '../auth/roles.decorator';
import { EntryService } from './entry.service';

/**
 * Implements getTicketEntryKey in contracts/openapi.yaml (spec 018, #41; research R5): the key a
 * ticket's buyer makes its live codes with. Customer only and owner only (FR-003); never cached.
 * Under `/me` because it is the caller's own ticket, in the entry module because it exists only
 * for entry (plan.md).
 */
@Controller('me/tickets/:ticketId/entry-key')
export class EntryKeyController {
  constructor(private readonly entry: EntryService) {}

  @Get()
  @Roles('customer')
  @Header('Cache-Control', 'no-store')
  entryKey(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<TicketEntryKey> {
    return this.entry.entryKey(ticketId, principal);
  }
}
