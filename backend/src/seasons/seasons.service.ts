import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SeatEventsService } from '../seating/seat-events.service';

/** Spec 041: Seasons, their events and prices, put on sale, cancelled (research R2–R6, R10). */
@Injectable()
export class SeasonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seatEvents: SeatEventsService,
  ) {}
}
