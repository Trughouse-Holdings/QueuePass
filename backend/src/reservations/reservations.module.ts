import { Module } from '@nestjs/common';
import { SeatingModule } from '../seating/seating.module';
import { HOLD_SWEEP_INTERVAL_MS, HoldSweeper } from './hold-sweeper';
import { MeReservationsController } from './me-reservations.controller';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

/** Spec 015: seat reservations, releasing them, and the sweep that ends run-out ones. */
@Module({
  imports: [SeatingModule],
  controllers: [ReservationsController, MeReservationsController],
  providers: [
    ReservationsService,
    HoldSweeper,
    // Research R4: one second, so viewers see a run-out reservation open within 2 (SC-003).
    { provide: HOLD_SWEEP_INTERVAL_MS, useValue: 1000 },
  ],
})
export class ReservationsModule {}
