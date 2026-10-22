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
import { SeatMapService } from './seat-map.service';

/** Research R9: a ping every 15 seconds keeps idle connections open through proxies. */
const PING_MS = 15_000;

/**
 * Implements streamSeatMap in contracts/openapi.yaml (spec 015 FR-010; research R9): a
 * Server-Sent Events stream of the event's seat map. A `snapshot` on connect, so a reconnect is
 * the catch-up; then every `seats` change from the bus; and a `ping`. Never a customer's identity
 * (FR-014). It ends when the token expires, so it never outlives the token it was opened with
 * (Constitution V), and when the event is deleted.
 */
@Controller('events/:id/seats')
export class SeatStreamController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seatMaps: SeatMapService,
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
      // Changes that arrive while the snapshot is read are sent after it; the snapshot may
      // already include them, and repeating a state is harmless.
      let ready = false;
      const early: SeatMapChange[] = [];
      const seats = (change: SeatMapChange): MessageEvent => ({ type: 'seats', data: change });
      const changes = this.seatEvents.changes(eventId).subscribe({
        next: (change) => (ready ? viewer.next(seats(change)) : early.push(change)),
        complete: () => viewer.complete(),
      });
      this.seatMaps.forEvent(eventId).then(
        (map) => {
          viewer.next({ type: 'snapshot', data: map });
          ready = true;
          for (const change of early.splice(0)) viewer.next(seats(change));
        },
        (err: unknown) => viewer.error(err),
      );
      const pings = interval(PING_MS).subscribe(() => viewer.next({ type: 'ping', data: {} }));
      return () => {
        changes.unsubscribe();
        pings.unsubscribe();
      };
    }).pipe(takeUntil(tokenExpiry));
  }
}
