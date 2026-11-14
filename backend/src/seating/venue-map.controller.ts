import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import type { VenueMap, VenueMapSection } from '@queuepass/shared';
import { Roles } from '../auth/roles.decorator';
import { VenueMapService } from './venue-map.service';

/**
 * Implements getVenueMap and getVenueMapSection in contracts/openapi.yaml (spec 038 research R11):
 * any signed-in user, as the seat stream. The answer is the same for every caller and never says
 * who holds or bought a seat (FR-028).
 */
@Controller('events/:id/venue-map')
export class VenueMapController {
  constructor(private readonly venueMaps: VenueMapService) {}

  @Get()
  @Roles()
  map(@Param('id', ParseUUIDPipe) eventId: string): Promise<VenueMap> {
    return this.venueMaps.map(eventId);
  }

  @Get('sections/:sectionId')
  @Roles()
  section(
    @Param('id', ParseUUIDPipe) eventId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
  ): Promise<VenueMapSection> {
    return this.venueMaps.section(eventId, sectionId);
  }
}
