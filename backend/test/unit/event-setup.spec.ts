import { BadRequestException, HttpException } from '@nestjs/common';
import {
  assertNoTierIdsOnCreate,
  eventCapacity,
  planEventSetup,
  planEventUpdate,
  seatingCapacity,
  type SetupInput,
  type UpdateSetupInput,
} from '../../src/events/event-setup';

/** Spec 031 research R4 steps 2, 4, 5 and R9: the planner, pure, every branch. */
describe('planEventSetup (031)', () => {
  const venue = { name: 'Seated Hall', seatingCapacity: 60 };
  const plain = { name: 'Plain Hall', seatingCapacity: 500 };
  const sections = [
    { id: 'front', name: 'front', rows: 1, seatsPerRow: 10 },
    { id: 'middle', name: 'middle', rows: 2, seatsPerRow: 10 },
    { id: 'back', name: 'back', rows: 3, seatsPerRow: 10 },
  ];
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
      expect(planEventSetup(input(), plain, [])).toEqual({
        reservedSeating: false,
        capacityFromLayout: null,
        tiers: [],
      });
      expect(planEventSetup(input({ tiers: [], reservedSeating: false }), plain, [])).toEqual({
        reservedSeating: false,
        capacityFromLayout: null,
        tiers: [],
      });
      expect(seatingCapacity(input(), plain, [])).toBeNull();
    });
  });

  describe('step 2, seating', () => {
    it('refuses reserved seating without a layout, naming the venue', () => {
      expect(messages(() => seatingCapacity(input({ reservedSeating: true }), plain, []))).toEqual([
        'reservedSeating needs a seating layout; Plain Hall has none',
      ]);
      expect(() => planEventSetup(input({ reservedSeating: true }), plain, [])).toThrow(
        BadRequestException,
      );
    });

    it('refuses a typed capacity with reserved seating', () => {
      expect(
        messages(() =>
          seatingCapacity(
            input({ reservedSeating: true, totalTicketCapacity: 60 }),
            venue,
            sections,
          ),
        ),
      ).toEqual([
        "totalTicketCapacity is set by the venue's seating layout while reserved seating is on",
      ]);
    });

    it("takes the capacity from the layout's total", () => {
      expect(seatingCapacity(input({ reservedSeating: true }), venue, sections)).toBe(60);
      expect(planEventSetup(input({ reservedSeating: true }), venue, sections)).toEqual({
        reservedSeating: true,
        capacityFromLayout: 60,
        tiers: [],
      });
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
          [],
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

    it('needs a quantity without reserved seating', () => {
      expect(
        messages(() => planEventSetup(input({ tiers: [{ name: 'A', price: '1.00' }] }), plain, [])),
      ).toEqual(['tiers.0.quantity is required for a tier']);
    });

    it('refuses a quantity with reserved seating', () => {
      expect(
        messages(() =>
          planEventSetup(
            input({ reservedSeating: true, tiers: [{ name: 'A', price: '1.00', quantity: 5 }] }),
            venue,
            sections,
          ),
        ),
      ).toEqual([
        "tiers.0.quantity must be omitted: it follows this tier's sections while reserved seating is on",
      ]);
    });

    it('refuses a non-empty sectionIds without reserved seating; [] is fine', () => {
      const [message] = messages(() =>
        planEventSetup(
          input({
            tiers: [
              { name: 'A', price: '1.00', quantity: 5, sectionIds: [] },
              { name: 'B', price: '1.00', quantity: 5, sectionIds: ['front'] },
            ],
          }),
          plain,
          [],
        ),
      );
      expect(message).toMatch(/^tiers\.1\.sectionIds /);
      expect(
        planEventSetup(
          input({ tiers: [{ name: 'A', price: '1.00', quantity: 5, sectionIds: [] }] }),
          plain,
          [],
        ).tiers,
      ).toEqual([{ name: 'A', price: '1.00', quantity: 5, sectionIds: [] }]);
    });

    it('refuses a section not in the layout, saying to reload', () => {
      expect(
        messages(() =>
          planEventSetup(
            input({
              reservedSeating: true,
              tiers: [{ name: 'A', price: '1.00', sectionIds: ['x'] }],
            }),
            venue,
            sections,
          ),
        ),
      ).toEqual([
        "tiers.0.sectionIds lists a section that is not in Seated Hall's seating layout. " +
          'Reload the form to see its sections.',
      ]);
    });

    it('refuses a section an earlier type sells, naming both', () => {
      expect(
        messages(() =>
          planEventSetup(
            input({
              reservedSeating: true,
              tiers: [
                { name: 'Front', price: '1.00', sectionIds: ['front'] },
                { name: 'Rest', price: '1.00', sectionIds: ['middle', 'front'] },
              ],
            }),
            venue,
            sections,
          ),
        ),
      ).toEqual([
        "tiers.1.sectionIds lists section front, which ticket type 1, 'Front', already sells. " +
          'A section sells one ticket type.',
      ]);
    });

    it('refuses a section listed twice in one type', () => {
      expect(
        messages(() =>
          planEventSetup(
            input({
              reservedSeating: true,
              tiers: [{ name: 'Front', price: '1.00', sectionIds: ['front', 'front'] }],
            }),
            venue,
            sections,
          ),
        ),
      ).toEqual(['tiers.0.sectionIds lists a section more than once']);
    });

    it('checks the types in order: the first broken rule wins', () => {
      const r = refusal(() =>
        planEventSetup(
          input({
            reservedSeating: true,
            tiers: [
              { name: 'Front', price: '1.00', sectionIds: ['front'] },
              { name: 'front', price: '1.00', sectionIds: [] },
              { name: 'Back', price: '1.00', sectionIds: ['nowhere'] },
            ],
          }),
          venue,
          sections,
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
          [],
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
        [],
      );
      expect(fits.tiers.map((t) => t.quantity)).toEqual([300, 200]);
      expect(
        refusal(() =>
          planEventSetup(
            input({ tiers: [{ name: 'A', price: '1.00', quantity: 501 }] }),
            plain,
            [],
          ),
        ).status,
      ).toBe(409);
    });
  });

  it('sums each seated type’s seats from its sections, 0 for none', () => {
    const plan = planEventSetup(
      input({
        reservedSeating: true,
        tiers: [
          { name: ' Front ', price: '120.00', sectionIds: ['front'] },
          { name: 'Rest', price: '70.00', sectionIds: ['middle', 'back'] },
          { name: 'None', price: '10.00' },
        ],
      }),
      venue,
      sections,
    );
    expect(plan).toEqual({
      reservedSeating: true,
      capacityFromLayout: 60,
      tiers: [
        { name: 'Front', price: '120.00', quantity: 10, sectionIds: ['front'] },
        { name: 'Rest', price: '70.00', quantity: 50, sectionIds: ['middle', 'back'] },
        { name: 'None', price: '10.00', quantity: 0, sectionIds: [] },
      ],
    });
  });

  // Code review round 1, N1: one source of truth for the capacity.
  it("takes the event's capacity: the layout's, else typed, else the venue's", () => {
    expect(eventCapacity(input({ reservedSeating: true }), venue, sections)).toBe(60);
    expect(eventCapacity(input({ totalTicketCapacity: 40 }), plain, [])).toBe(40);
    expect(eventCapacity(input(), plain, [])).toBe(500);
  });

  it('checks the ticket types against the capacity it is given', () => {
    const tiers = [{ name: 'A', price: '1.00', quantity: 300 }];
    expect(refusal(() => planEventSetup(input({ tiers }), plain, [], 299)).status).toBe(409);
    expect(planEventSetup(input({ tiers }), plain, [], 300).tiers).toHaveLength(1);
  });
});

/** Spec 035 (research R8): ids, removals, and sold-ticket rules on an update. */
describe('planEventUpdate (035)', () => {
  const emptyCounts = {
    eventSold: 0,
    tierlessSold: 0,
    soldByTier: new Map<string, number>(),
    ordersByTier: new Map<string, number>(),
    soldBySection: new Map<string, number>(),
  };
  const ctx = (over: Partial<UpdateSetupInput> = {}): UpdateSetupInput => ({
    eventName: 'Season Opener',
    reservedSeatingBefore: false,
    existingTiers: [
      { id: 't-floor', name: 'Floor' },
      { id: 't-balcony', name: 'Balcony' },
    ],
    existingMappings: [],
    counts: emptyCounts,
    venue: { name: 'Plain Hall', seatingCapacity: 500 },
    sections: [],
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
        reservedSeating: false,
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

  it('refuses remapping a sold section as EVENT_HAS_ORDERS, not quantity-below-sold', () => {
    const seated = ctx({
      reservedSeatingBefore: true,
      existingTiers: [
        { id: 't-front', name: 'Front' },
        { id: 't-standard', name: 'Standard' },
      ],
      existingMappings: [
        { sectionId: 'front', sectionName: 'front', tierId: 't-front' },
        { sectionId: 'middle', sectionName: 'middle', tierId: 't-standard' },
      ],
      counts: {
        ...emptyCounts,
        eventSold: 1,
        soldByTier: new Map([['t-front', 1]]),
        soldBySection: new Map([['front', 1]]),
      },
      venue: { name: 'Seated Hall', seatingCapacity: 30 },
      sections: [
        { id: 'front', name: 'front', rows: 1, seatsPerRow: 10 },
        { id: 'middle', name: 'middle', rows: 1, seatsPerRow: 10 },
        { id: 'back', name: 'back', rows: 1, seatsPerRow: 10 },
      ],
      capacity: 30,
    });
    try {
      planEventUpdate(
        {
          name: 'Season Opener',
          reservedSeating: true,
          tiers: [
            { id: 't-front', name: 'Front', price: '120.00', sectionIds: [] },
            { id: 't-standard', name: 'Standard', price: '70.00', sectionIds: ['front', 'middle'] },
          ],
        },
        seated,
      );
      throw new Error('expected a refusal');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const e = err as HttpException;
      expect(e.getStatus()).toBe(409);
      expect(e.getResponse()).toMatchObject({
        error: {
          code: 'EVENT_HAS_ORDERS',
          details: { field: 'tiers.1.sectionIds' },
        },
      });
    }
  });
});
