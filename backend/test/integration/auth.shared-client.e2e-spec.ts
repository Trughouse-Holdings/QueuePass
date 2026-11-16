import { SHARED_REALM_CLIENTS } from '@queuepass/shared';
import { as } from '../setup/authed-request';
import { event, HOLDER, seatedEvent, venue } from '../setup/fixtures';
import { resetDb } from '../setup/reset-db';
import { createTestApp, TestContext } from '../setup/test-app';
import { issuerFor, REALM, subFor, tokenFor, type TokenOptions } from '../setup/tokens';

/**
 * Spec 040 (contract sign-in-client.md, FR-004 to FR-008, research R3): the Rust Customer app has
 * its own client, `customer-rust-app`, in the Customer realm. Its tokens carry the Customer realm's
 * issuer and keys and `azp: customer-rust-app`, and the Backend trusts them exactly as the React
 * Customer app's (`azp: customer-app`) for the same `sub`: the same account, its orders and its
 * holds. The Backend reads neither `azp` nor the client ID, so this needs no Backend change.
 */
describe('Tokens from the Rust Customer app (spec 040)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
  });

  const RUST = 'customer-rust-app';
  const REACT = 'customer-app';
  const realm = REALM.customer;
  const customer1: TokenOptions = { username: 'customer1', roles: ['customer'], realm };
  const withAzp = (azp: string, opts: Partial<TokenOptions> = {}) =>
    tokenFor({ ...customer1, azp, ...opts });

  const expectUnauthenticated = (res: { status: number; body: { error?: unknown } }): void => {
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'A valid access token is required.',
    });
  };

  it('is a client of the Customer realm, from the shared table', () => {
    expect(SHARED_REALM_CLIENTS).toContainEqual({ app: 'customer-rust', realm, clientId: RUST });
  });

  it('gets 200 on a customer endpoint, GET /me/orders, as the same customer', async () => {
    await as(ctx, await withAzp(RUST))
      .get('/me/orders')
      .expect(200);
    const me = await as(ctx, await withAzp(RUST))
      .get('/me')
      .expect(200);
    expect(me.body).toEqual({
      sub: subFor('customer1'),
      username: 'customer1',
      roles: ['customer'],
    });
  });

  it('lists an order placed through the React Customer app, for the same sub (FR-004)', async () => {
    const eventId = await event(ctx, await venue(ctx));
    const placed = await as(ctx, await withAzp(REACT))
      .post(`/events/${eventId}/orders`)
      .send({ holderName: HOLDER, quantity: 2 })
      .expect(201);

    const mine = await as(ctx, await withAzp(RUST))
      .get('/me/orders')
      .expect(200);

    expect(mine.body.map((o: { id: string }) => o.id)).toEqual([placed.body.id]);
    expect(mine.body[0].tickets).toHaveLength(2);
  });

  it.each([
    [REACT, RUST],
    [RUST, REACT],
  ])('releases on logout, with %s, a reservation made with %s (FR-004)', async (made, released) => {
    const venueId = await venue(ctx, 'Seat Hall');
    const { eventId, layout } = await seatedEvent(ctx, venueId, {
      sections: [{ name: 'A', rows: 1, seatsPerRow: 5 }],
    });
    const sectionId = layout.sections.A!;
    await as(ctx, await withAzp(made))
      .post(`/events/${eventId}/reservation`)
      .send({ seats: [{ sectionId, row: 1, seat: 1 }] })
      .expect(201);

    const res = await as(ctx, await withAzp(released))
      .post('/me/reservations/release')
      .expect(200);

    expect(res.body).toEqual({ released: 1 });
    const holds = await ctx.prisma.seatHold.findMany({ where: { eventId } });
    expect(holds.map((h) => h.endReason)).toEqual(['LOGOUT']);
  });

  it('gets 403 with no customer role', async () => {
    for (const roles of [[], ['queuepass-admin'], ['gate-agent']]) {
      const res = await as(ctx, await withAzp(RUST, { roles })).get('/me/orders');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('gets 401 for a wrong audience', async () => {
    expectUnauthenticated(await as(ctx, await withAzp(RUST, { aud: 'account' })).get('/me/orders'));
  });

  it('gets 401 for an expired token', async () => {
    expectUnauthenticated(await as(ctx, await withAzp(RUST, { expiresIn: -60 })).get('/me/orders'));
  });

  it("gets 401 for another realm's key claiming the Customer issuer", async () => {
    for (const other of [REALM.admin, REALM.booth, REALM['admin-rust']]) {
      const token = await withAzp(RUST, { realm: other, iss: issuerFor(realm) });
      expectUnauthenticated(await as(ctx, token).get('/me/orders'));
    }
  });
});
