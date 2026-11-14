import { Module } from '@nestjs/common';
import { EventSeatingController } from './event-seating.controller';
import { SeatEventsService } from './seat-events.service';
import { SeatStreamController } from './seat-stream.controller';
import { VenueMapController } from './venue-map.controller';
import { VenueMapService } from './venue-map.service';

/**
 * Spec 015: the bus that carries seat changes to live viewers, and the stream they read. Spec 038:
 * `007`'s layout and seat map routes went with contract 2.0.0; layouts are the `layouts` module's.
 * An event's seating (`getEventSeating`, research R8) is read here and saved with the event; its
 * venue map (`getVenueMap`, `getVenueMapSection`, research R11) is read here too.
 */
@Module({
  controllers: [SeatStreamController, EventSeatingController, VenueMapController],
  providers: [SeatEventsService, VenueMapService],
  exports: [SeatEventsService],
})
export class SeatingModule {}
