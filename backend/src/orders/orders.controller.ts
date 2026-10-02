import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Roles } from '../auth/roles.decorator';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderResponse, OrdersService } from './orders.service';

/** Implements createOrder and listAttendees in contracts/openapi.yaml (spec 005). */
@Controller('events/:id')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** The buyer is always the signed-in customer: nothing in the body can name someone else. */
  @Post('orders')
  @Roles('customer')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('id', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateOrderDto,
    @CurrentPrincipal() buyer: Principal,
  ): Promise<OrderResponse> {
    return this.orders.create(eventId, dto, buyer);
  }

  @Get('attendees')
  @Roles('queuepass-admin')
  attendees(@Param('id', ParseUUIDPipe) eventId: string): Promise<OrderResponse[]> {
    return this.orders.attendees(eventId);
  }
}
