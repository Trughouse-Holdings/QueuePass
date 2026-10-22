import { Injectable } from '@nestjs/common';
import type { SeatMapChange, SeatStateChange } from '@queuepass/shared';
import { Observable, Subject } from 'rxjs';

/**
 * Spec 015 research R9: the in-process bus that tells every viewer of an event which seats became
 * open, reserved, or sold. One RxJS `Subject` per event with viewers, dropped when its last viewer
 * leaves. Services publish only after their transaction commits, and a slow or broken viewer never
 * delays or fails the write that published (spec edge case "Many viewers"). The Compose stack runs
 * one Backend, so this reaches every viewer; several would need Postgres `LISTEN/NOTIFY`.
 */
@Injectable()
export class SeatEventsService {
  private readonly subjects = new Map<string, Subject<SeatMapChange>>();

  /** Sends the changes to every current viewer of the event. Does nothing for an empty list. */
  publish(eventId: string, changes: SeatStateChange[]): void {
    if (changes.length === 0) return;
    this.subjects.get(eventId)?.next({ eventId, changes });
  }

  /** Every change to the event's seats from now on, until `end(eventId)`. */
  changes(eventId: string): Observable<SeatMapChange> {
    return new Observable<SeatMapChange>((viewer) => {
      let subject = this.subjects.get(eventId);
      if (!subject) {
        subject = new Subject<SeatMapChange>();
        this.subjects.set(eventId, subject);
      }
      const subscription = subject.subscribe(viewer);
      return () => {
        subscription.unsubscribe();
        if (subject.observed) return;
        if (this.subjects.get(eventId) === subject) this.subjects.delete(eventId);
      };
    });
  }

  /**
   * Completes every stream of the event. Viewers reconnect at once and get a fresh snapshot, or a
   * 404 if the event was deleted (research R9, R11). Used when the map's shape changed (reserved
   * seating, section tiers, the layout) as well as on delete.
   */
  end(eventId: string): void {
    const subject = this.subjects.get(eventId);
    this.subjects.delete(eventId);
    subject?.complete();
  }
}
