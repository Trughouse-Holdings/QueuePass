import { Module } from '@nestjs/common';
import { SeatingModule } from '../seating/seating.module';
import { SeasonsController } from './seasons.controller';
import { SeasonsService } from './seasons.service';

/** Spec 041: the Season resource (research R3). Cancelling publishes freed seats (R10). */
@Module({
  imports: [SeatingModule],
  controllers: [SeasonsController],
  providers: [SeasonsService],
  exports: [SeasonsService],
})
export class SeasonsModule {}
