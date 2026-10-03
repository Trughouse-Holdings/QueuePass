import { Module } from '@nestjs/common';
import { MeOrdersController } from './me-orders.controller';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  controllers: [OrdersController, MeOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
