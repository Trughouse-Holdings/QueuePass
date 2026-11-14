import {
  Controller,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import type { SeatMapChange } from '@queuepass/shared';
import { Observable, interval, takeUntil, timer } from 'rxjs';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Roles } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { SeatEventsService } from './seat-events.service';

/** Research R9: a ping every 15 seconds keeps idle connections open through proxies. */
const PING_MS = 15_000;

/**
 * Implements streamSeatMap in contracts/openapi.yaml (spec 015 FR-010; research R9): a
 * Server-Sent Events stream of the event's seat map: every `seats` change from the bus, and a
 * `ping`. Never a customer's identity (FR-014). It ends when the token expires, so it never
 * outlives the token it was opened with (Constitution V), and when the event is deleted.
 *
 * Spec 038 (contract 2.0.0): `007`'s `snapshot` is gone. Until T037 sends the `venueMap` first
 * (research R12), the stream sends nothing before the first change.
 */
@Controller('events/:id/seats')
export class SeatStreamController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seatEvents: SeatEventsService,
  ) {}

  /** Any signed-in user, like the seat map. */
  @Sse('stream')
  @Roles()
  async stream(
    @Param('id', ParseUUIDPipe) eventId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<Observable<MessageEvent>> {
    // Before any byte is streamed, so an unknown event is a plain 404.
    const exists = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(`No event exists with id ${eventId}.`);

    const tokenExpiry = timer(Math.max(0, principal.expiresAt * 1000 - Date.now()));
    return new Observable<MessageEvent>((viewer) => {
      const seats = (change: SeatMapChange): MessageEvent => ({ type: 'seats', data: change });
      const changes = this.seatEvents.changes(eventId).subscribe({
        next: (change) => viewer.next(seats(change)),
        complete: () => viewer.complete(),
      });
      const pings = interval(PING_MS).subscribe(() => viewer.next({ type: 'ping', data: {} }));
      return () => {
        changes.unsubscribe();
        pings.unsubscribe();
      };
    }).pipe(takeUntil(tokenExpiry));
  }
}
