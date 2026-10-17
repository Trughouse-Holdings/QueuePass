import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Reservation } from '@queuepass/shared';
import type { Response } from 'express';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Roles } from '../auth/roles.decorator';
import { ReservationInputDto } from './dto/reservation-input.dto';
import { ReservationReleaseDto } from './dto/reservation-release.dto';
import { ReservationsService } from './reservations.service';

/** Implements reserveSeats and releaseSeats in contracts/openapi.yaml (spec 015). */
@Controller('events/:id/reservation')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  /** `201` for a new reservation, `200` when the seats were added to the active one. */
  @Post()
  @Roles('customer')
  @HttpCode(HttpStatus.CREATED)
  async reserve(
    @Param('id', ParseUUIDPipe) eventId: string,
    @Body() dto: ReservationInputDto,
    @CurrentPrincipal() principal: Principal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Reservation> {
    const { status, reservation } = await this.reservations.reserve(principal, eventId, dto);
    res.status(status);
    return reservation;
  }

  @Post('release')
  @Roles('customer')
  @HttpCode(HttpStatus.OK)
  release(
    @Param('id', ParseUUIDPipe) eventId: string,
    @Body() dto: ReservationReleaseDto,
    @CurrentPrincipal() principal: Principal,
  ): Promise<{ reservation: Reservation | null }> {
    return this.reservations.release(principal, eventId, dto);
  }
}
