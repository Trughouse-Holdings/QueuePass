import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EntryController } from './entry.controller';
import { EntryService } from './entry.service';

/** Spec 017 (#40): gate check-in. Its own module: its own routes and role (plan.md). */
@Module({
  imports: [PrismaModule],
  controllers: [EntryController],
  providers: [EntryService],
})
export class EntryModule {}
