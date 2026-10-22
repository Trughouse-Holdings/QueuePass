import { Module } from '@nestjs/common';
import { SeatingModule } from '../seating/seating.module';
import { TiersController } from './tiers.controller';
import { TiersService } from './tiers.service';

@Module({
  imports: [SeatingModule],
  controllers: [TiersController],
  providers: [TiersService],
  exports: [TiersService],
})
export class TiersModule {}
