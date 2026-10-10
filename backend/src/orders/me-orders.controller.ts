import { Controller, Get } from '@nestjs/common';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Roles } from '../auth/roles.decorator';
import { MyOrderResponse, OrdersService } from './orders.service';

/** Implements listMyOrders in contracts/openapi.yaml (spec 006 US3). */
@Controller('me')
export class MeOrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** The customer is the token's subject; there is no parameter that names one (FR-007). */
  @Get('orders')
  @Roles('customer')
  mine(@CurrentPrincipal() principal: Principal): Promise<MyOrderResponse[]> {
    return this.orders.mine(principal.sub);
  }
}
