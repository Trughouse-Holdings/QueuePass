import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { EntryResult, EntryTicket } from '@queuepass/shared';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Roles } from '../auth/roles.decorator';
import { AdmitDto } from './dto/admit.dto';
import { EntryLookupDto } from './dto/entry-lookup.dto';
import { EntryService } from './entry.service';

/**
 * Implements lookupEntryTicket and admitTicket in contracts/openapi.yaml (spec 017, #40). Both
 * gate-agent only (FR-016, Constitution V); the code travels in a request body, not a path, so it
 * stays out of access logs (research R6).
 */
@Controller('events/:id/entry')
export class EntryController {
  constructor(private readonly entry: EntryService) {}

  @Post('lookup')
  @Roles('gate-agent')
  @HttpCode(HttpStatus.OK)
  lookup(
    @Param('id', ParseUUIDPipe) eventId: string,
    @Body() dto: EntryLookupDto,
  ): Promise<EntryTicket> {
    return this.entry.lookup(eventId, dto.code);
  }

  @Post('admit')
  @Roles('gate-agent')
  @HttpCode(HttpStatus.OK)
  admit(
    @Param('id', ParseUUIDPipe) eventId: string,
    @Body() dto: AdmitDto,
    @CurrentPrincipal() agent: Principal,
  ): Promise<EntryResult> {
    return this.entry.admit(eventId, dto.ticketId, dto.wholeOrder, agent);
  }
}
