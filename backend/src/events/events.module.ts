import { Module } from '@nestjs/common';
import { CLOCK, systemClock } from '../common/clock';
import { SeatingModule } from '../seating/seating.module';
import { AvailabilityService } from './availability.service';
import { EventImagesController } from './event-images.controller';
import { EventImagesService } from './event-images.service';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [SeatingModule],
  controllers: [EventsController, EventImagesController],
  providers: [
    EventsService,
    AvailabilityService,
    EventImagesService,
    // Spec 030 research R2: the event list's "now", which tests set to an event's exact end.
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [EventsService, EventImagesService],
})
export class EventsModule {}
