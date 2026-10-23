import type { AddressInfo } from 'node:net';
import { expectSseEvent } from '../contract/expect-to-match-contract';
import { HoldSweeper } from '../../src/reservations/hold-sweeper';
import { anon, as, asAdmin } from '../setup/authed-request';
import { HOLDER, customer, event, holdSeats, venue } from '../setup/fixtures';
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

/**
 * Spec 015 US3 (FR-010, FR-014, FR-015, SC-002, SC-003; research R9, R16): the live seat stream,
 * read over real HTTP from a listening app by two viewers.
 */
describe('Live seat stream', () => {
  let ctx: TestContext;
  let base: string;
  let eventId: string;
  let sectionA: string;
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
    const venueId = await venue(ctx, 'Seat Hall');
    const layout = await asAdmin(ctx)
      .put(`/locations/${venueId}/layout`)
      .send({ sections: [{ name: 'A', rows: 3, seatsPerRow: 10 }] })
      .expect(200);
    sectionA = layout.body.sections[0].id;
    eventId = await event(ctx, venueId, { capacity: 30 });
    await asAdmin(ctx)
      .put(`/events/${eventId}/seating`)
      .send({ reservedSeating: true, sections: [] })
      .expect(200);
  });

  const seat = (row: number, s: number) => ({ sectionId: sectionA, row, seat: s });
  const token = (n: number, over: Partial<TokenOptions> = {}) =>
    tokenFor({ username: `customer${n}`, roles: ['customer'], ...over });
  const open = async (t: string, id = eventId) => {
    const reader = await StreamReader.open(`${base}/events/${id}/seats/stream`, t);
    readers.push(reader);
    return reader;
  };
  /** A `seats` event that sets every listed seat to `state`. */
  const changed =
    (state: string, ...seats: { row: number; seat: number }[]) =>
    (e: SseEvent): boolean => {
      if (e.event !== 'seats') return false;
      const changes = (e.data as { changes: { row: number; seat: number; state: string }[] })
        .changes;
      return seats.every((s) =>
        changes.some((c) => c.row === s.row && c.seat === s.seat && c.state === state),
      );
    };

  it('starts with a snapshot of the seat map', async () => {
    const reader = await open(await token(2));

    const first = await reader.next(() => true);

    expect(first.event).toBe('snapshot');
    expect(first.data).toMatchObject({
      eventId,
      reservedSeating: true,
      sections: [{ sectionId: sectionA, taken: [], reserved: [] }],
    });
  });

  it("tells a second viewer about another customer's reservation within 2 seconds", async () => {
    const viewer = await open(await token(2));
    await viewer.next((e) => e.event === 'snapshot');

    const started = Date.now();
    await (
      await customer(ctx, 1)
    )
      .post(`/events/${eventId}/reservation`)
      .send({ seats: [seat(1, 3), seat(1, 4)] })
      .expect(201);
    const seen = await viewer.next(changed('reserved', { row: 1, seat: 3 }, { row: 1, seat: 4 }));

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(seen.data).toEqual({
      eventId,
      changes: [
        { sectionId: sectionA, row: 1, seat: 3, state: 'reserved' },
        { sectionId: sectionA, row: 1, seat: 4, state: 'reserved' },
      ],
    });
  });

  it('sends open after a release, sold after an order, and open after the sweep', async () => {
    const viewer = await open(await token(2));
    await viewer.next((e) => e.event === 'snapshot');
    const buyer = await customer(ctx, 1);

    await buyer
      .post(`/events/${eventId}/reservation`)
      .send({ seats: [seat(1, 1)] })
      .expect(201);
    await buyer
      .post(`/events/${eventId}/reservation/release`)
      .send({ seats: [seat(1, 1)] })
      .expect(200);
    await viewer.next(changed('open', { row: 1, seat: 1 }));

    await buyer
      .post(`/events/${eventId}/reservation`)
      .send({ seats: [seat(2, 2)] })
      .expect(201);
    await buyer
      .post(`/events/${eventId}/orders`)
      .send({ holderName: HOLDER, quantity: 1, seats: [seat(2, 2)] })
      .expect(201);
    await viewer.next(changed('sold', { row: 2, seat: 2 }));

    await holdSeats(ctx.prisma, {
      eventId,
      customerSub: subFor('customer3'),
      seats: [{ section: 'A', row: 3, seat: 3 }],
      secondsAgo: 301,
    });
    await ctx.app.get(HoldSweeper).sweepOnce();
    await viewer.next(changed('open', { row: 3, seat: 3 }));
  });

  it('sends a fresh snapshot on reconnect', async () => {
    const first = await open(await token(2));
    await first.next((e) => e.event === 'snapshot');
    await (
      await customer(ctx, 1)
    )
      .post(`/events/${eventId}/reservation`)
      .send({ seats: [seat(1, 7)] })
      .expect(201);
    first.close();

    const again = await open(await token(2));
    const snap = await again.next((e) => e.event === 'snapshot');

    expect((snap.data as { sections: { reserved: unknown }[] }).sections[0].reserved).toEqual([
      { row: 1, seat: 7 },
    ]);
  });

  it('never names a customer in any event', async () => {
    const viewer = await open(await token(2));
    await (
      await customer(ctx, 1)
    )
      .post(`/events/${eventId}/reservation`)
      .send({ seats: [seat(1, 1)] })
      .expect(201);
    await viewer.next(changed('reserved', { row: 1, seat: 1 }));
    const second = await open(await token(3));
    await second.next((e) => e.event === 'snapshot');

    const all = JSON.stringify([...viewer.events, ...second.events]);
    expect(all).not.toContain(subFor('customer1'));
    expect(all).not.toContain('customer1');
  });

  it('is open to any signed-in user, including an admin', async () => {
    const reader = await open(ctx.adminToken);
    expect((await reader.next(() => true)).event).toBe('snapshot');
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

  it('is 404 for an unknown event', async () => {
    await as(ctx, await token(1))
      .get('/events/00000000-0000-4000-8000-000000000000/seats/stream')
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
    await reader.next((e) => e.event === 'snapshot');

    await reader.untilEnded(6_000);

    expect(reader.ended).toBe(true);
    expect(reader.endedAt).toBeGreaterThanOrEqual(exp * 1000 - 50);
    expect(reader.endedAt - exp * 1000).toBeLessThan(1_000);
  });

  it('ends every stream when the event is deleted, and a reconnect is 404', async () => {
    const reader = await open(await token(2));
    await reader.next((e) => e.event === 'snapshot');

    await asAdmin(ctx).delete(`/events/${eventId}`).expect(204);
    await reader.untilEnded(2_000);

    expect(reader.ended).toBe(true);
    await as(ctx, await token(2))
      .get(`/events/${eventId}/seats/stream`)
      .expect(404);
  });
});
