import { Module } from '@nestjs/common';
import { ATTEMPT_CLOCK, monotonicClock } from './attempt-limits.clock';
import { ATTEMPT_LIMITS, attemptLimitsFromEnv } from './attempt-limits.config';
import { AttemptLimitsService } from './attempt-limits.service';

/**
 * Spec 026 (research R1, R2, R5): the attempt allowances. Provides its own monotonic clock and
 * reads its settings once, at start-up, so a wrong value stops the Backend (FR-017): the buy pair
 * and, since spec 033 (research R5), the hold pair.
 */
@Module({
  providers: [
    AttemptLimitsService,
    { provide: ATTEMPT_LIMITS, useFactory: () => attemptLimitsFromEnv(process.env) },
    { provide: ATTEMPT_CLOCK, useValue: monotonicClock },
  ],
  exports: [AttemptLimitsService],
})
export class AttemptLimitsModule {}
