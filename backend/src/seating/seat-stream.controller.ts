import { Controller, Param, ParseUUIDPipe, Sse, type MessageEvent } from '@nestjs/common';
import type { SeatMapChange, VenueMap } from '@queuepass/shared';
import { Observable, Subscriber, interval, takeUntil, timer } from 'rxjs';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Roles } from '../auth/roles.decorator';
import { SeatEventsService } from './seat-events.service';
import { VenueMapService } from './venue-map.service';

/** Research R9: a ping every 15 seconds keeps idle connections open through proxies. */
const PING_MS = 15_000;

/**
 * Implements streamSeatMap in contracts/openapi.yaml (spec 015 FR-010; research R9): a
 * Server-Sent Events stream of the event's seat map, and a `ping`. Never a customer's identity
 * (FR-014). It ends when the token expires, so it never outlives the token it was opened with
 * (Constitution V), when the event is deleted, and (spec 038 research R12) when the event's layout
 * or prices change or its layout is edited: viewers then reconnect and read the new map.
 *
 * Spec 038 (research R12): the stream begins with `venueMap`, the event's venue map with the
 * `seq` it was read at, then every `seats` change from the bus with its own `seq`. It subscribes
 * to the bus before it reads the map and sends what arrived meanwhile after it; the viewer skips
 * the changes whose `seq` the map already has, so none is lost or counted twice.
 */
@Controller('events/:id/seats')
export class SeatStreamController {
  constructor(
    private readonly seatEvents: SeatEventsService,
    private readonly venueMaps: VenueMapService,
  ) {}

  /** Any signed-in user, like the venue map. */
  @Sse('stream')
  @Roles()
  async stream(
    @Param('id', ParseUUIDPipe) eventId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<Observable<MessageEvent>> {
    const seats = (change: SeatMapChange): MessageEvent => ({ type: 'seats', data: change });
    // Subscribed first: what changes while the map is read is kept and sent after it.
    let viewer: Subscriber<MessageEvent> | null = null;
    let ended = false;
    const meanwhile: SeatMapChange[] = [];
    const changes = this.seatEvents.changes(eventId).subscribe({
      next: (change) => (viewer ? viewer.next(seats(change)) : meanwhile.push(change)),
      complete: () => (viewer ? viewer.complete() : (ended = true)),
    });

    // Before any byte is streamed, so an unknown or general-admission event is a plain 404.
    let map: VenueMap;
    try {
      map = await this.venueMaps.map(eventId);
    } catch (err) {
      changes.unsubscribe();
      throw err;
    }

    const tokenExpiry = timer(Math.max(0, principal.expiresAt * 1000 - Date.now()));
    return new Observable<MessageEvent>((subscriber) => {
      subscriber.next({ type: 'venueMap', data: map });
      for (const change of meanwhile.splice(0)) subscriber.next(seats(change));
      if (ended) {
        subscriber.complete();
        return () => changes.unsubscribe();
      }
      viewer = subscriber;
      const pings = interval(PING_MS).subscribe(() => subscriber.next({ type: 'ping', data: {} }));
      return () => {
        changes.unsubscribe();
        pings.unsubscribe();
      };
    }).pipe(takeUntil(tokenExpiry));
  }
}
