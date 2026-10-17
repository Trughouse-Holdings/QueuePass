import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { ReleasedSeats, Reservation } from '@queuepass/shared';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Roles } from '../auth/roles.decorator';
import { ReservationsService } from './reservations.service';

/**
 * Implements listMyReservations and releaseAllMyReservations in contracts/openapi.yaml (spec 015).
 * The customer is the token's subject; nothing in a request can name another.
 */
@Controller('me/reservations')
export class MeReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get()
  @Roles('customer')
  mine(@CurrentPrincipal() principal: Principal): Promise<Reservation[]> {
    return this.reservations.listMine(principal);
  }

  /** The Customer app calls it on logout (FR-008). */
  @Post('release')
  @Roles('customer')
  @HttpCode(HttpStatus.OK)
  releaseAll(@CurrentPrincipal() principal: Principal): Promise<ReleasedSeats> {
    return this.reservations.releaseAllMine(principal);
  }
}
