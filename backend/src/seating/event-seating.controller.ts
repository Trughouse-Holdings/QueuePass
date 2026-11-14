import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import type { EventSeating } from '@queuepass/shared';
import { Roles } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { readEventSeating } from './event-seating';

/**
 * Spec 038 (research R8): `getEventSeating`, what the Admin app's Seating section edits: the
 * event's layout, its levels with seats and prices, and the seats off sale as compacted selectors.
 * An admin's read: who buys is never in it, but prices not yet on sale are.
 */
@Controller('events/:id/seating')
export class EventSeatingController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Roles('queuepass-admin')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<EventSeating> {
    return readEventSeating(this.prisma, id);
  }
}
