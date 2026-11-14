import { HttpException } from '@nestjs/common';
import {
  assertNoTierIdsOnCreate,
  eventCapacity,
  planEventSetup,
  planEventUpdate,
  type SetupInput,
  type UpdateSetupInput,
} from '../../src/events/event-setup';

/**
 * Spec 031 research R4 steps 4, 5 and R9: the planner, pure, every branch. Spec 038 (T009a): `007`'s
 * section-to-type mapping is retired with contract 2.0.0; its cases went, and T020 tests an
 * event's layout, level prices and off-sale seats.
 */
describe('planEventSetup (031)', () => {
  const plain = { name: 'Plain Hall', seatingCapacity: 500 };
  const input = (over: Partial<SetupInput> = {}): SetupInput => ({
    name: 'Season Opener',
    ...over,
  });

  /** The refusal's status and body, or a failure if it did not throw. */
  const refusal = (fn: () => unknown): { status: number; body: unknown } => {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const e = err as HttpException;
      return { status: e.getStatus(), body: e.getResponse() };
    }
    throw new Error('expected a refusal');
  };
  const messages = (fn: () => unknown): string[] => {
    const r = refusal(fn);
    expect(r.status).toBe(400);
    return (r.body as { message: string[] }).message;
  };

  describe('without the new fields', () => {
    it('never throws and plans nothing', () => {
      expect(planEventSetup(input(), plain)).toEqual({ tiers: [] });
      expect(planEventSetup(input({ tiers: [] }), plain)).toEqual({ tiers: [] });
    });
  });

  describe('step 4, each ticket type', () => {
    it('refuses a name repeated ignoring case and spaces, at the later type', () => {
      const r = refusal(() =>
        planEventSetup(
          input({
            tiers: [
              { name: 'Floor', price: '80.00', quantity: 1 },
              { name: 'Balcony', price: '60.00', quantity: 1 },
              { name: ' FLOOR ', price: '60.00', quantity: 1 },
            ],
          }),
          plain,
        ),
      );
      expect(r).toEqual({
        status: 409,
        body: {
          error: {
            code: 'TIER_NAME_TAKEN',
            message:
              "Ticket type 3, 'FLOOR', has the same name as ticket type 1, 'Floor'. " +
              'Give each ticket type its own name.',
            details: { field: 'tiers.2.name' },
          },
        },
      });
    });

    it('needs a quantity', () => {
      expect(
        messages(() => planEventSetup(input({ tiers: [{ name: 'A', price: '1.00' }] }), plain)),
      ).toEqual(['tiers.0.quantity is required for a tier']);
    });

    it('checks the types in order: the first broken rule wins', () => {
      const r = refusal(() =>
        planEventSetup(
          input({
            tiers: [
              { name: 'Front', price: '1.00', quantity: 1 },
              { name: 'front', price: '1.00', quantity: 1 },
              { name: 'Back', price: '1.00' },
            ],
          }),
          plain,
        ),
      );
      expect(r.status).toBe(409);
    });
  });

  describe('step 5, the ticket types together', () => {
    it('refuses quantities over the typed capacity', () => {
      const r = refusal(() =>
        planEventSetup(
          input({
            totalTicketCapacity: 400,
            tiers: [
              { name: 'A', price: '1.00', quantity: 300 },
              { name: 'B', price: '1.00', quantity: 200 },
            ],
          }),
          plain,
        ),
      );
      expect(r).toEqual({
        status: 409,
        body: {
          error: {
            code: 'CAPACITY_EXCEEDED',
            message: 'Season Opener has 400 tickets, but its ticket types add up to 500.',
            details: { field: 'tiers', totalTicketCapacity: 400, tierTotal: 500 },
          },
        },
      });
    });

    it("uses the venue's capacity when none is typed, and allows exactly it", () => {
      const fits = planEventSetup(
        input({
          tiers: [
            { name: 'A', price: '1.00', quantity: 300 },
            { name: 'B', price: '1.00', quantity: 200 },
          ],
        }),
        plain,
      );
      expect(fits.tiers.map((t) => t.quantity)).toEqual([300, 200]);
      expect(
        refusal(() =>
          planEventSetup(input({ tiers: [{ name: 'A', price: '1.00', quantity: 501 }] }), plain),
        ).status,
      ).toBe(409);
    });
  });

  // Code review round 1, N1: one source of truth for the capacity.
  it("takes the event's capacity: typed, else the venue's", () => {
    expect(eventCapacity(input({ totalTicketCapacity: 40 }), plain)).toBe(40);
    expect(eventCapacity(input(), plain)).toBe(500);
  });

  it('checks the ticket types against the capacity it is given', () => {
    const tiers = [{ name: 'A', price: '1.00', quantity: 300 }];
    expect(refusal(() => planEventSetup(input({ tiers }), plain, 299)).status).toBe(409);
    expect(planEventSetup(input({ tiers }), plain, 300).tiers).toHaveLength(1);
  });
});

/** Spec 035 (research R8): ids, removals, and sold-ticket rules on an update. */
describe('planEventUpdate (035)', () => {
  const emptyCounts = {
    tierlessSold: 0,
    soldByTier: new Map<string, number>(),
    ordersByTier: new Map<string, number>(),
  };
  const ctx = (over: Partial<UpdateSetupInput> = {}): UpdateSetupInput => ({
    eventName: 'Season Opener',
    existingTiers: [
      { id: 't-floor', name: 'Floor' },
      { id: 't-balcony', name: 'Balcony' },
    ],
    counts: emptyCounts,
    venue: { name: 'Plain Hall', seatingCapacity: 500 },
    capacity: 500,
    ...over,
  });
  const messages = (fn: () => unknown): string[] => {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const e = err as HttpException;
      expect(e.getStatus()).toBe(400);
      return (e.getResponse() as { message: string[] }).message;
    }
    throw new Error('expected a refusal');
  };

  it('keeps a type, adds a type, and lists a removal', () => {
    const plan = planEventUpdate(
      {
        name: 'Season Opener',
        tiers: [
          { id: 't-floor', name: 'Floor', price: '80.00', quantity: 300 },
          { name: 'Gallery', price: '40.00', quantity: 50 },
        ],
      },
      ctx(),
    );
    expect(plan.tiers.map((t) => [t.id, t.name, t.quantity])).toEqual([
      ['t-floor', 'Floor', 300],
      [undefined, 'Gallery', 50],
    ]);
    expect(plan.removed).toEqual([{ id: 't-balcony', name: 'Balcony' }]);
  });

  it('refuses a repeated id', () => {
    expect(
      messages(() =>
        planEventUpdate(
          {
            name: 'Season Opener',
            tiers: [
              { id: 't-floor', name: 'Floor', price: '80.00', quantity: 300 },
              { id: 't-floor', name: 'Also', price: '60.00', quantity: 200 },
            ],
          },
          ctx(),
        ),
      ),
    ).toEqual(['tiers.1.id lists a ticket type already listed in this request']);
  });

  it('refuses an unknown id', () => {
    expect(
      messages(() =>
        planEventUpdate(
          {
            name: 'Season Opener',
            tiers: [{ id: 't-missing', name: 'X', price: '10.00', quantity: 1 }],
          },
          ctx(),
        ),
      ),
    ).toEqual(['tiers.0.id is not a ticket type of this event']);
  });

  it('refuses id on create', () => {
    expect(
      messages(() =>
        assertNoTierIdsOnCreate({
          name: 'Season Opener',
          tiers: [{ id: 't-floor', name: 'Floor', price: '80.00', quantity: 300 }],
        }),
      ),
    ).toEqual(['tiers.0.id is not allowed when scheduling']);
  });
});
