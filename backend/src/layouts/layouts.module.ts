import { Module } from '@nestjs/common';
import { SeatingModule } from '../seating/seating.module';
import { LayoutsController } from './layouts.controller';
import { LayoutsService } from './layouts.service';

/** Spec 038 US1: a venue's layouts (research R4–R7). */
@Module({
  imports: [SeatingModule],
  controllers: [LayoutsController],
  providers: [LayoutsService],
})
export class LayoutsModule {}
