import { Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { EventImagesController } from './event-images.controller';
import { EventImagesService } from './event-images.service';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  controllers: [EventsController, EventImagesController],
  providers: [EventsService, AvailabilityService, EventImagesService],
  exports: [EventsService, EventImagesService],
})
export class EventsModule {}
