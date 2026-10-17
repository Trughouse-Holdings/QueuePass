import { Module } from '@nestjs/common';
import { SeatingModule } from '../seating/seating.module';
import { AvailabilityService } from './availability.service';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [SeatingModule],
  controllers: [EventsController],
  providers: [EventsService, AvailabilityService],
  exports: [EventsService],
})
export class EventsModule {}
