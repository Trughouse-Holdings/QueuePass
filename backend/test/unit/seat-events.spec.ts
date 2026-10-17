import type { SeatMapChange, SeatStateChange } from '@queuepass/shared';
import { config } from 'rxjs';
import { SeatEventsService } from '../../src/seating/seat-events.service';

/** Spec 015 research R9: the in-process bus that carries seat changes to every viewer. */
describe('SeatEventsService', () => {
  const change = (seat: number): SeatStateChange => ({
    sectionId: '5b0d3c1e-8f2a-4c6b-9d1e-2a3b4c5d6e7f',
    row: 1,
    seat,
    state: 'reserved',
  });

  it("reaches every subscriber of the event, and none of another event's", () => {
    const bus = new SeatEventsService();
    const a1: SeatMapChange[] = [];
    const a2: SeatMapChange[] = [];
    const b: SeatMapChange[] = [];
    bus.changes('e-a').subscribe((c) => a1.push(c));
    bus.changes('e-a').subscribe((c) => a2.push(c));
    bus.changes('e-b').subscribe((c) => b.push(c));

    bus.publish('e-a', [change(3), change(4)]);

    const sent = { eventId: 'e-a', changes: [change(3), change(4)] };
    expect(a1).toEqual([sent]);
    expect(a2).toEqual([sent]);
    expect(b).toEqual([]);
  });

  it('stops reaching a subscriber that unsubscribes', () => {
    const bus = new SeatEventsService();
    const got: SeatMapChange[] = [];
    const sub = bus.changes('e-a').subscribe((c) => got.push(c));

    bus.publish('e-a', [change(1)]);
    sub.unsubscribe();
    bus.publish('e-a', [change(2)]);

    expect(got.map((c) => c.changes[0].seat)).toEqual([1]);
  });

  it('does nothing when the event has no subscribers, or the list is empty', () => {
    const bus = new SeatEventsService();
    expect(() => bus.publish('e-a', [change(1)])).not.toThrow();

    const got: SeatMapChange[] = [];
    bus.changes('e-a').subscribe((c) => got.push(c));
    bus.publish('e-a', []);
    expect(got).toEqual([]);
  });

  it("doesn't let a throwing subscriber stop the others", async () => {
    // RxJS reports a subscriber's own error here, on a timer, instead of to the publisher.
    const reported: unknown[] = [];
    const before = config.onUnhandledError;
    config.onUnhandledError = (err) => reported.push(err);
    try {
      const bus = new SeatEventsService();
      const got: SeatMapChange[] = [];
      bus.changes('e-a').subscribe(() => {
        throw new Error('viewer broke');
      });
      bus.changes('e-a').subscribe((c) => got.push(c));

      expect(() => bus.publish('e-a', [change(1)])).not.toThrow();
      bus.publish('e-a', [change(2)]);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(got.map((c) => c.changes[0].seat)).toEqual([1, 2]);
      expect(reported).toHaveLength(2);
    } finally {
      config.onUnhandledError = before;
    }
  });

  it("completes every stream of an event on end(), and not another event's", () => {
    const bus = new SeatEventsService();
    let aDone = 0;
    let bDone = 0;
    bus.changes('e-a').subscribe({ complete: () => (aDone += 1) });
    bus.changes('e-a').subscribe({ complete: () => (aDone += 1) });
    bus.changes('e-b').subscribe({ complete: () => (bDone += 1) });

    bus.end('e-a');

    expect(aDone).toBe(2);
    expect(bDone).toBe(0);
  });
});
