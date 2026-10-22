import { Module } from '@nestjs/common';
import { LayoutController } from './layout.controller';
import { LayoutService } from './layout.service';
import { SeatEventsService } from './seat-events.service';
import { SeatMapController } from './seat-map.controller';
import { SeatMapService } from './seat-map.service';
import { SeatStreamController } from './seat-stream.controller';

/**
 * Spec 007: venue seating layouts, reserved seating per event, and seat maps. Spec 015: the bus
 * that carries seat changes to live viewers, and the stream they read.
 */
@Module({
  controllers: [LayoutController, SeatMapController, SeatStreamController],
  providers: [LayoutService, SeatMapService, SeatEventsService],
  exports: [LayoutService, SeatMapService, SeatEventsService],
})
export class SeatingModule {}
