import { Module } from '@nestjs/common';
import { SeatEventsService } from './seat-events.service';
import { SeatStreamController } from './seat-stream.controller';

/**
 * Spec 015: the bus that carries seat changes to live viewers, and the stream they read. Spec 038:
 * `007`'s layout and seat map routes went with contract 2.0.0; layouts are the `layouts` module's.
 */
@Module({
  controllers: [SeatStreamController],
  providers: [SeatEventsService],
  exports: [SeatEventsService],
})
export class SeatingModule {}
