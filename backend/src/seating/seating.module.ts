import { Module } from '@nestjs/common';
import { LayoutController } from './layout.controller';
import { LayoutService } from './layout.service';
import { SeatMapController } from './seat-map.controller';
import { SeatMapService } from './seat-map.service';

/** Spec 007: venue seating layouts, reserved seating per event, and seat maps. */
@Module({
  controllers: [LayoutController, SeatMapController],
  providers: [LayoutService, SeatMapService],
  exports: [LayoutService, SeatMapService],
})
export class SeatingModule {}
