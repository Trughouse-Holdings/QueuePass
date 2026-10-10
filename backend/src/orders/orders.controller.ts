import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Roles } from '../auth/roles.decorator';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderResponse, OrdersService } from './orders.service';

/** Implements createOrder and listAttendees in contracts/openapi.yaml (specs 005, 006). */
@Controller('events/:id')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /**
   * The buyer is always the signed-in customer: nothing in the body can name someone else.
   * A repeated `requestId` returns the earlier order with 200 instead of 201 (spec 006 FR-005).
   */
  @Post('orders')
  @Roles('customer')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('id', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateOrderDto,
    @CurrentPrincipal() buyer: Principal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderResponse> {
    const { order, replayed } = await this.orders.create(eventId, dto, buyer);
    if (replayed) res.status(HttpStatus.OK);
    return order;
  }

  @Get('attendees')
  @Roles('queuepass-admin')
  attendees(@Param('id', ParseUUIDPipe) eventId: string): Promise<OrderResponse[]> {
    return this.orders.attendees(eventId);
  }
}
