import { Module } from '@nestjs/common';
import { CLOCK, systemClock } from '../common/clock';
import { PrismaModule } from '../prisma/prisma.module';
import { CHECK_IN_RETENTION_INTERVAL_MS, CheckInRetention } from './check-in-retention';
import { EntryController } from './entry.controller';
import { EntryKeyController } from './entry-key.controller';
import { EntryService } from './entry.service';

/**
 * Spec 017 (#40): gate check-in. Its own module: its own routes and role (plan.md). Spec 018
 * (#41) adds live codes here, and the Backend's clock they are judged by (research R3). Spec 032
 * (research R5): the check-in retention job, every hour once `main.ts` starts it.
 */
@Module({
  imports: [PrismaModule],
  controllers: [EntryController, EntryKeyController],
  providers: [
    EntryService,
    { provide: CLOCK, useValue: systemClock },
    CheckInRetention,
    { provide: CHECK_IN_RETENTION_INTERVAL_MS, useValue: 3_600_000 },
  ],
})
export class EntryModule {}
