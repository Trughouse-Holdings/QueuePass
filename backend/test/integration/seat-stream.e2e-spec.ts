import type { AddressInfo } from 'node:net';
import { expectSseEvent } from '../contract/expect-to-match-contract';
import type { SeatMapChange, VenueMap } from '@queuepass/shared';
import { HoldSweeper } from '../../src/reservations/hold-sweeper';
import { anon, as, asAdmin } from '../setup/authed-request';
import {
  HOLDER,
  customer,
  event,
  seatedEvent,
  venue,
  type InsertedLayout,
} from '../setup/fixtures';
import { createTestApp, TestContext } from '../setup/test-app';
import { resetDb } from '../setup/reset-db';
import { subFor, tokenFor, type TokenOptions } from '../setup/tokens';

interface SseEvent {
  event: string;
  data: unknown;
}

/**
 * A reader of the seat stream over real HTTP, as the browser reads it: `fetch` with the bearer
 * token and `Accept: text/event-stream`, nothing else (research R9). Every event it receives is
 * validated against the contract's `x-sse-events`.
 */
class StreamReader {
  readonly events: SseEvent[] = [];
  ended = false;
  endedAt = 0;
  private readonly controller = new AbortController();
  private waiters: (() => void)[] = [];

  static async open(url: string, token: string): Promise<StreamReader> {
    const reader = new StreamReader();
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      signal: reader.controller.signal,
    });
    if (res.status !== 200 || !res.body) throw new Error(`stream answered ${res.status}`);
    void reader.read(res.body);
    return reader;
  }

  private async read(body: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of body) {
        buffer += decoder.decode(chunk, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          let name = 'message';
          const data: string[] = [];
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) name = line.slice(6).trim();
            else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
          }
          const parsed: unknown = JSON.parse(data.join('\n'));
          expectSseEvent('streamSeatMap', name, parsed);
          this.events.push({ event: name, data: parsed });
          this.wake();
        }
      }
    } catch {
      // Aborted by close().
    }
    this.ended = true;
    this.endedAt = Date.now();
    this.wake();
  }

  private wake(): void {
    const waiting = this.waiters;
    this.waiters = [];
    for (const w of waiting) w();
  }

  /** The first event (from `from` on) matching `match`, within `ms`. */
  async next(match: (e: SseEvent) => boolean, ms = 2_000, from = 0): Promise<SseEvent> {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = this.events.slice(from).find(match);
      if (found) return found;
      if (this.ended) throw new Error(`stream ended; got ${JSON.stringify(this.events)}`);
      const left = deadline - Date.now();
      if (left <= 0)
        throw new Error(`no matching event in ${ms} ms; got ${JSON.stringify(this.events)}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  async untilEnded(ms: number): Promise<void> {
    const deadline = Date.now() + ms;
    while (!this.ended && Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, deadline - Date.now());
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  close(): void {
    this.controller.abort();
  }
}

/** Counts of a venue map by section and level, as a client keeps them. */
type Counts = Record<string, Record<string, Record<string, number>>>;

function countsOf(map: VenueMap): Counts {
  const counts: Counts = {};
  for (const s of map.sections) {
    counts[s.sectionId] = {};
    for (const c of s.counts) {
      counts[s.sectionId][c.levelId] = {
        open: c.open,
        reserved: c.reserved,
        sold: c.sold,
        offSale: c.offSale,
      };
    }
  }
  return counts;
}

/** Research R12: a change applies to a map only when its seq is greater than the map's. */
function apply(counts: Counts, mapSeq: number, messages: SeatMapChange[]): Counts {
  const next: Counts = JSON.parse(JSON.stringify(counts));
  for (const m of messages) {
    if (m.seq <= mapSeq) continue;
    for (const c of m.changes) {
      const level = next[c.sectionId][c.levelId];
      level[c.from] -= 1;
      level[c.state] += 1;
    }
  }
  return next;
}

/**
 * Spec 038 US3 (FR-023, SC-004; research R12): the live seat stream, read over real HTTP from a
 * listening app. It begins with the event's venue map (`venueMap`, with its `seq`); each change of
 * seats is a `seats` message with the next `seq` and, per seat, its new state, the state it left
 * and its level, so a viewer keeps the map's counts without counting a change twice. Before 038:
 * spec 015 US3 (FR-010, FR-014, FR-015, research R9, R16).
 */
describe('Live seat stream (038 US3)', () => {
  let ctx: TestContext;
  let base: string;
  let venueId: string;
  let eventId: string;
  let layout: InsertedLayout;
  const readers: StreamReader[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    const { port } = ctx.app.getHttpServer().address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  afterEach(() => {
    for (const r of readers.splice(0)) r.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    venueId = await venue(ctx, 'Seat Hall');
    ({ eventId, layout } = await seatedEvent(ctx, venueId, {
      sections: [
        { name: 'A', rows: 3, seatsPerRow: 10, level: 'Front' },
        { name: 'B', rows: 1, seatsPerRow: 10, level: 'Back' },
      ],
      levels: [
        { name: 'Front', price: '95.00' },
        { name: 'Back', price: '60.00' },
      ],
    }));
  });

  const seat = (row: number, s: number, section = 'A') => ({
    sectionId: layout.sections[section],
    row,
    seat: s,
  });
  const token = (n: number, over: Partial<TokenOptions> = {}) =>
    tokenFor({ username: `customer${n}`, roles: ['customer'], ...over });
  const open = async (t: string, id = eventId) => {
    const reader = await StreamReader.open(`${base}/events/${id}/seats/stream`, t);
    readers.push(reader);
    return reader;
  };
  const hold = async (n: number, seats: object[]) =>
    (await customer(ctx, n)).post(`/events/${eventId}/reservation`).send({ seats });
  const venueMap = async (): Promise<VenueMap> =>
    (await asAdmin(ctx).get(`/events/${eventId}/venue-map`).expect(200)).body;
  const seatsOf = (r: StreamReader): SeatMapChange[] =>
    r.events.filter((e) => e.event === 'seats').map((e) => e.data as SeatMapChange);
  /** A `seats` message that sets every listed seat (of section A unless named) to `state`. */
  const changed =
    (state: string, ...seats: { row: number; seat: number; sectionId?: string }[]) =>
    (e: SseEvent): boolean => {
      if (e.event !== 'seats') return false;
      const changes = (e.data as SeatMapChange).changes;
      return seats.every((s) =>
        changes.some(
          (c) =>
            c.sectionId === (s.sectionId ?? layout.sections.A) &&
            c.row === s.row &&
            c.seat === s.seat &&
            c.state === state,
        ),
      );
    };

  it('begins with the venue map and its seq, no snapshot', async () => {
    await hold(1, [seat(1, 1)]).then((r) => expect(r.status).toBe(201));
    const reader = await open(await token(2));

    const first = await reader.next(() => true);

    expect(first.event).toBe('venueMap');
    expect(first.data).toEqual(await venueMap());
    expect((first.data as VenueMap).seq).toBe(1);
    expect(reader.events.some((e) => e.event === 'snapshot')).toBe(false);
  });

  it("tells a second viewer about another customer's hold within 2 seconds, with seq, from and levelId", async () => {
    const viewer = await open(await token(2));
    const map = (await viewer.next((e) => e.event === 'venueMap')).data as VenueMap;

    const started = Date.now();
    await hold(1, [seat(1, 3), seat(1, 4, 'B')]).then((r) => expect(r.status).toBe(201));
    const seen = await viewer.next(changed('reserved', seat(1, 3), seat(1, 4, 'B')));

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(seen.data).toEqual({
      eventId,
      seq: map.seq + 1,
      changes: [
        { ...seat(1, 3), state: 'reserved', from: 'open', levelId: layout.levels.Front },
        { ...seat(1, 4, 'B'), state: 'reserved', from: 'open', levelId: layout.levels.Back },
      ],
    });
  });

  it('sends hold, release, purchase, expiry and an off-sale save, each with a seq one greater than the last', async () => {
    const viewer = await open(await token(2));
    const map = (await viewer.next((e) => e.event === 'venueMap')).data as VenueMap;
    const buyer = await customer(ctx, 1);
    const front = layout.levels.Front;

    // Hold, then release.
    await buyer
      .post(`/events/${eventId}/reservation`)
      .send({ seats: [seat(1, 1)] })
      .expect(201);
    await buyer
      .post(`/events/${eventId}/reservation/release`)
      .send({ seats: [seat(1, 1)] })
      .expect(200);
    await viewer.next(changed('open', { row: 1, seat: 1 }));
    // Hold, then buy (2 seq).
    await buyer
      .post(`/events/${eventId}/reservation`)
      .send({ seats: [seat(2, 2)] })
      .expect(201);
    await buyer
      .post(`/events/${eventId}/orders`)
      .send({ holderName: HOLDER, quantity: 1, seats: [seat(2, 2)] })
      .expect(201);
    await viewer.next(changed('sold', { row: 2, seat: 2 }));
    // A hold of another customer that runs out, ended by the sweep.
    await (
      await customer(ctx, 3)
    )
      .post(`/events/${eventId}/reservation`)
      .send({ seats: [seat(3, 3)] })
      .expect(201);
    await ctx.prisma.$executeRaw`
      UPDATE "SeatReservation"
      SET "createdAt" = "createdAt" - interval '6 minutes',
          "expiresAt" = "expiresAt" - interval '6 minutes'
      WHERE "eventId" = ${eventId}::uuid AND "endedAt" IS NULL`;
    await ctx.app.get(HoldSweeper).sweepOnce();
    await viewer.next(changed('open', { row: 3, seat: 3 }));
    // An admin takes a seat off sale.
    await asAdmin(ctx)
      .patch(`/events/${eventId}`)
      .send({ offSale: [seat(1, 9)] })
      .expect(200);
    await viewer.next(changed('offSale', { row: 1, seat: 9 }));

    const messages = seatsOf(viewer);
    expect(messages.map((m) => m.seq)).toEqual(
      Array.from({ length: 7 }, (_, i) => map.seq + 1 + i),
    );
    expect(messages.map((m) => m.changes)).toEqual([
      [{ ...seat(1, 1), state: 'reserved', from: 'open', levelId: front }],
      [{ ...seat(1, 1), state: 'open', from: 'reserved', levelId: front }],
      [{ ...seat(2, 2), state: 'reserved', from: 'open', levelId: front }],
      [{ ...seat(2, 2), state: 'sold', from: 'reserved', levelId: front }],
      [{ ...seat(3, 3), state: 'reserved', from: 'open', levelId: front }],
      [{ ...seat(3, 3), state: 'open', from: 'reserved', levelId: front }],
      [{ ...seat(1, 9), state: 'offSale', from: 'open', levelId: front }],
    ]);
    // The stream is kept through the off-sale save, and the counts add up.
    expect(viewer.ended).toBe(false);
    expect(apply(countsOf(map), map.seq, messages)).toEqual(countsOf(await venueMap()));
  });

  it('sends sold seats as open when the event is cancelled', async () => {
    const buyer = await customer(ctx, 1);
    await buyer
      .post(`/events/${eventId}/reservation`)
      .send({ seats: [seat(1, 5)] })
      .expect(201);
    await buyer
      .post(`/events/${eventId}/orders`)
      .send({ holderName: HOLDER, quantity: 1, seats: [seat(1, 5)] })
      .expect(201);
    await hold(2, [seat(1, 6)]).then((r) => expect(r.status).toBe(201));
    const viewer = await open(await token(3));
    const map = (await viewer.next((e) => e.event === 'venueMap')).data as VenueMap;

    await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);
    const seen = await viewer.next(changed('open', { row: 1, seat: 5 }, { row: 1, seat: 6 }));

    expect((seen.data as SeatMapChange).seq).toBe(map.seq + 1);
    expect((seen.data as SeatMapChange).changes).toEqual(
      expect.arrayContaining([
        { ...seat(1, 5), state: 'open', from: 'sold', levelId: layout.levels.Front },
        { ...seat(1, 6), state: 'open', from: 'reserved', levelId: layout.levels.Front },
      ]),
    );
  });

  it('never counts a change twice: a hold during the connect is in the map or has a greater seq (10 trials)', async () => {
    for (let trial = 0; trial < 10; trial++) {
      const t = await token(20 + trial);
      const [viewer] = await Promise.all([
        open(t),
        hold(trial + 1, [seat(1 + (trial % 3), 1 + trial)]).then((r) => expect(r.status).toBe(201)),
      ]);
      const map = (await viewer.next((e) => e.event === 'venueMap')).data as VenueMap;
      // A fence: once this hold's change arrives, every earlier one has.
      await hold(trial + 1, [seat(1, trial + 1, 'B')]).then((r) => expect(r.status).toBe(200));
      await viewer.next(changed('reserved', seat(1, trial + 1, 'B')), 2_000);

      const first = viewer.events.findIndex((e) => e.event === 'venueMap');
      expect(first).toBe(0);
      expect(apply(countsOf(map), map.seq, seatsOf(viewer))).toEqual(countsOf(await venueMap()));
      viewer.close();
    }
  });

  it('ends the stream on a price change, a layout change and a layout edit, and a reconnect reads the new map', async () => {
    const prices = (front: string) => [
      { levelId: layout.levels.Front, price: front },
      { levelId: layout.levels.Back, price: '60.00' },
    ];
    const byPrice = await open(await token(2));
    await byPrice.next((e) => e.event === 'venueMap');
    await asAdmin(ctx)
      .patch(`/events/${eventId}`)
      .send({ levelPrices: prices('99.00') })
      .expect(200);
    await byPrice.untilEnded(2_000);
    expect(byPrice.ended).toBe(true);
    const again = await open(await token(2));
    const fresh = (await again.next((e) => e.event === 'venueMap')).data as VenueMap;
    expect(fresh.levels[0].price).toBe('99.00');

    // A lines edit of the layout the event uses (no seat sold or held).
    await asAdmin(ctx)
      .put(`/layouts/${layout.id}`)
      .send({
        levels: [
          { name: 'Front', color: 'violet' },
          { name: 'Back', color: 'blue' },
        ],
        sections: [
          { name: 'A', rows: 3, seatsPerRow: 10, level: 'Front' },
          { name: 'B', rows: 2, seatsPerRow: 10, level: 'Back' },
        ],
      })
      .expect(200);
    await again.untilEnded(2_000);
    expect(again.ended).toBe(true);

    // Another layout for the event.
    const byLayout = await open(await token(2));
    await byLayout.next((e) => e.event === 'venueMap');
    const other = await seatedEvent(ctx, venueId, {
      sections: [{ name: 'Club', rows: 1, seatsPerRow: 4 }],
    });
    await asAdmin(ctx)
      .patch(`/events/${eventId}`)
      .send({
        layoutId: other.layout.id,
        levelPrices: [{ levelId: other.layout.levels.Standard, price: '45.00' }],
      })
      .expect(200);
    await byLayout.untilEnded(2_000);
    expect(byLayout.ended).toBe(true);
  });

  it('delivers at least 19 of 20 holds to a second viewer within 2 seconds (SC-004)', async () => {
    const viewer = await open(await token(30));
    await viewer.next((e) => e.event === 'venueMap');
    let onTime = 0;
    for (let i = 0; i < 20; i++) {
      const target = { row: 1 + Math.floor(i / 10), seat: 1 + (i % 10) };
      const started = Date.now();
      await hold(1 + Math.floor(i / 10), [seat(target.row, target.seat)]);
      try {
        await viewer.next(changed('reserved', target), 2_000);
        if (Date.now() - started < 2_000) onTime += 1;
      } catch {
        // Late or lost: counted as a miss.
      }
    }
    expect(onTime).toBeGreaterThanOrEqual(19);
  });

  it('never names a customer in any message', async () => {
    const viewer = await open(await token(2));
    await hold(1, [seat(1, 1)]);
    await viewer.next(changed('reserved', { row: 1, seat: 1 }));
    const second = await open(await token(3));
    await second.next((e) => e.event === 'venueMap');

    const all = JSON.stringify([...viewer.events, ...second.events]);
    expect(all).not.toContain(subFor('customer1'));
    expect(all).not.toContain('customer1');
  });

  it('is open to any signed-in user, including an admin', async () => {
    const reader = await open(ctx.adminToken);
    expect((await reader.next(() => true)).event).toBe('venueMap');
  });

  it('is 401 without a token, and with an expired, wrongly signed, or wrong-audience token', async () => {
    await anon(ctx).get(`/events/${eventId}/seats/stream`).expect(401);
    for (const bad of [
      await token(1, { expiresIn: -120 }),
      await token(1, { rogue: true }),
      await token(1, { aud: 'some-other-api' }),
    ]) {
      await as(ctx, bad).get(`/events/${eventId}/seats/stream`).expect(401);
    }
  });

  it('is 404 for an unknown event and for a general-admission event', async () => {
    await as(ctx, await token(1))
      .get('/events/00000000-0000-4000-8000-000000000000/seats/stream')
      .expect(404);
    const ga = await event(ctx, venueId, { capacity: 10 });
    await as(ctx, await token(1))
      .get(`/events/${ga}/seats/stream`)
      .expect(404);
  });

  it("passes a CORS preflight from the Customer app's origin asking only for authorization", async () => {
    const origin = 'http://localhost:5174';
    const preflight = await fetch(`${base}/events/${eventId}/seats/stream`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    });
    expect(preflight.status).toBeLessThan(300);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
    expect(preflight.headers.get('access-control-allow-headers')).toMatch(/authorization/i);

    const res = await fetch(`${base}/events/${eventId}/seats/stream`, {
      headers: {
        Origin: origin,
        Authorization: `Bearer ${await token(1)}`,
        Accept: 'text/event-stream',
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    await res.body?.cancel();
  });

  it("ends within 1 second after the token's exp", async () => {
    const t = await token(1, { expiresIn: 3 });
    const exp = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).exp as number;
    const reader = await open(t);
    await reader.next((e) => e.event === 'venueMap');

    await reader.untilEnded(6_000);

    expect(reader.ended).toBe(true);
    expect(reader.endedAt).toBeGreaterThanOrEqual(exp * 1000 - 50);
    expect(reader.endedAt - exp * 1000).toBeLessThan(1_000);
  });

  it('ends every stream when the event is deleted, and a reconnect is 404', async () => {
    const reader = await open(await token(2));
    await reader.next((e) => e.event === 'venueMap');

    await asAdmin(ctx).delete(`/events/${eventId}`).expect(204);
    await reader.untilEnded(2_000);

    expect(reader.ended).toBe(true);
    await as(ctx, await token(2))
      .get(`/events/${eventId}/seats/stream`)
      .expect(404);
  });
});
