import { Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  controllers: [EventsController],
  providers: [EventsService, AvailabilityService],
  exports: [EventsService],
})
export class EventsModule {}
