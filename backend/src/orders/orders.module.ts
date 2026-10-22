import { Module } from '@nestjs/common';
import { SeatingModule } from '../seating/seating.module';
import { MeOrdersController } from './me-orders.controller';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [SeatingModule],
  controllers: [OrdersController, MeOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
