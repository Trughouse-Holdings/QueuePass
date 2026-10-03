import { Module } from '@nestjs/common';
import { LayoutController } from './layout.controller';
import { LayoutService } from './layout.service';

/** Spec 007: venue seating layouts, reserved seating per event, and seat maps. */
@Module({
  controllers: [LayoutController],
  providers: [LayoutService],
  exports: [LayoutService],
})
export class SeatingModule {}
