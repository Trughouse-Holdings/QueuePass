import { Module } from '@nestjs/common';
import { CLOCK, systemClock } from '../common/clock';
import { PrismaModule } from '../prisma/prisma.module';
import { EntryController } from './entry.controller';
import { EntryKeyController } from './entry-key.controller';
import { EntryService } from './entry.service';

/**
 * Spec 017 (#40): gate check-in. Its own module: its own routes and role (plan.md). Spec 018
 * (#41) adds live codes here, and the Backend's clock they are judged by (research R3).
 */
@Module({
  imports: [PrismaModule],
  controllers: [EntryController, EntryKeyController],
  providers: [EntryService, { provide: CLOCK, useValue: systemClock }],
})
export class EntryModule {}
