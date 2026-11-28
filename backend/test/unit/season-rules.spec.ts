import {
  eventProblems,
  fieldProblems,
  priceProblems,
  publishProblems,
  timeProblems,
  type SeasonRuleContext,
  type SeasonRuleEvent,
  type SeasonRuleInput,
} from '../../src/seasons/season-rules';

/**
 * Spec 041 (research R4, R16; FR-002 to FR-006, FR-009, FR-010): the Season's pure rules. Each
 * problem is a message whose first word is the field path the contract names, so the Admin apps
 * place it beside its field: `name`, `team`, `eventIds`, `eventIds.<i>`, `salesEndAt`,
 * `singleSalesOpenAt`, `prices`, `prices.<i>` (a sent entry, by index) and `prices.<levelId>` (a
 * level with no entry).
 */
const ZONE = 'America/New_York';
const NOW = new Date('2026-12-01T12:00:00Z');
const DAY = 86_400_000;
const VENUE = '11111111-1111-4111-8111-111111111111';
const OTHER_VENUE = '22222222-2222-4222-8222-222222222222';
const LAYOUT = '33333333-3333-4333-8333-333333333333';
const OTHER_LAYOUT = '44444444-4444-4444-8444-444444444444';
const LOWER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UPPER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ev = (id: string, over: Partial<SeasonRuleEvent> = {}): SeasonRuleEvent => ({
  id,
  name: `Game ${id}`,
  locationId: VENUE,
  layoutId: LAYOUT,
  status: 'SCHEDULED',
  startsAt: new Date(NOW.getTime() + 10 * DAY),
  tierNames: [],
  ...over,
});

const seated = (over: Partial<SeasonRuleInput> = {}): SeasonRuleInput => ({
  name: 'Spring Hoops',
  sport: 'BASKETBALL',
  team: 'Cardinals',
  locationId: VENUE,
  layoutId: LAYOUT,
  salesEndAt: new Date(NOW.getTime() + 5 * DAY),
  singleSalesOpenAt: null,
  maxPassesPerCustomer: null,
  eventIds: ['e1', 'e2'],
  prices: [
    { levelId: LOWER, price: '100.00' },
    { levelId: UPPER, price: '60.00' },
  ],
  ...over,
});

const ctxFor = (events: SeasonRuleEvent[], over: Partial<SeasonRuleContext> = {}) =>
  ({
    events: new Map(events.map((e) => [e.id, e])),
    alreadyIn: new Set<string>(),
    levels: [
      { id: LOWER, name: 'Lower', rank: 1 },
      { id: UPPER, name: 'Upper', rank: 2 },
    ],
    now: NOW,
    ...over,
  }) satisfies SeasonRuleContext;

const heads = (problems: string[]): string[] => problems.map((p) => p.split(' ')[0]!);

describe('fieldProblems (041 FR-002)', () => {
  it('accepts a complete Season', () => {
    expect(fieldProblems(seated())).toEqual([]);
  });

  it('refuses a name empty after trimming or over 100 characters', () => {
    expect(heads(fieldProblems(seated({ name: '   ' })))).toEqual(['name']);
    expect(heads(fieldProblems(seated({ name: 'x'.repeat(101) })))).toEqual(['name']);
    expect(fieldProblems(seated({ name: 'x'.repeat(100) }))).toEqual([]);
    expect(fieldProblems(seated({ name: 'x' }))).toEqual([]);
  });

  it('refuses a sport without a team beside team, and a team without a sport beside sport', () => {
    expect(heads(fieldProblems(seated({ team: null })))).toEqual(['team']);
    expect(heads(fieldProblems(seated({ team: '  ' })))).toEqual(['team']);
    expect(heads(fieldProblems(seated({ sport: null })))).toEqual(['sport']);
    expect(fieldProblems(seated({ sport: null, team: null }))).toEqual([]);
  });

  it('refuses a team over 100 characters', () => {
    expect(heads(fieldProblems(seated({ team: 'y'.repeat(101) })))).toEqual(['team']);
  });

  it('takes passes per customer from 1 to 10, or none', () => {
    expect(heads(fieldProblems(seated({ maxPassesPerCustomer: 0 })))).toEqual([
      'maxPassesPerCustomer',
    ]);
    expect(heads(fieldProblems(seated({ maxPassesPerCustomer: 11 })))).toEqual([
      'maxPassesPerCustomer',
    ]);
    expect(fieldProblems(seated({ maxPassesPerCustomer: 1 }))).toEqual([]);
    expect(fieldProblems(seated({ maxPassesPerCustomer: 10 }))).toEqual([]);
  });
});

describe('timeProblems (041 FR-006, R16)', () => {
  const events = [ev('e1'), ev('e2', { startsAt: new Date(NOW.getTime() + 20 * DAY) })];

  it('accepts a sales end at the first event start, and a presale at the sales end', () => {
    const start = events[0]!.startsAt;
    expect(
      timeProblems(seated({ salesEndAt: start, singleSalesOpenAt: start }), events, ZONE),
    ).toEqual([]);
  });

  it('refuses single tickets on sale after the sales end, beside singleSalesOpenAt', () => {
    const input = seated();
    const after = new Date(input.salesEndAt.getTime() + 1);
    expect(heads(timeProblems({ ...input, singleSalesOpenAt: after }, events, ZONE))).toEqual([
      'singleSalesOpenAt',
    ]);
  });

  it('refuses a sales end after the earliest event not cancelled starts, naming it', () => {
    const late = new Date(events[0]!.startsAt.getTime() + 1);
    const problems = timeProblems(seated({ salesEndAt: late }), events, ZONE);
    expect(heads(problems)).toEqual(['salesEndAt']);
    expect(problems[0]).toContain('Game e1');
  });

  it('ignores a cancelled event when finding the earliest start', () => {
    const cancelled = [{ ...events[0]!, status: 'CANCELLED' as const }, events[1]!];
    const late = new Date(events[0]!.startsAt.getTime() + DAY);
    expect(timeProblems(seated({ salesEndAt: late }), cancelled, ZONE)).toEqual([]);
  });

  it('has nothing to compare a sales end with when there are no events', () => {
    expect(
      timeProblems(seated({ salesEndAt: new Date(NOW.getTime() + 999 * DAY) }), [], ZONE),
    ).toEqual([]);
  });
});

describe('eventProblems (041 FR-003, FR-004)', () => {
  it('accepts upcoming scheduled events at the venue on the layout', () => {
    expect(eventProblems(seated(), ctxFor([ev('e1'), ev('e2')]))).toEqual([]);
  });

  it('names each event at fault by its index: another venue, another layout, general admission', () => {
    const ctx = ctxFor([
      ev('e1', { locationId: OTHER_VENUE }),
      ev('e2', { layoutId: OTHER_LAYOUT }),
      ev('e3', { layoutId: null }),
      ev('e4'),
    ]);
    const problems = eventProblems(seated({ eventIds: ['e1', 'e2', 'e3', 'e4'] }), ctx);
    expect(heads(problems)).toEqual(['eventIds.0', 'eventIds.1', 'eventIds.2']);
    expect(problems[0]).toContain('Game e1');
  });

  it('refuses a seated event in a general-admission Season', () => {
    const problems = eventProblems(
      seated({ layoutId: null, prices: [], eventIds: ['e1'] }),
      ctxFor([ev('e1')]),
    );
    expect(heads(problems)).toEqual(['eventIds.0']);
  });

  it('refuses an event that does not exist, a repeat, a cancelled one, and one that has started', () => {
    const ctx = ctxFor([
      ev('e1'),
      ev('e2', { status: 'CANCELLED' }),
      ev('e3', { startsAt: NOW }),
      ev('e4', { startsAt: new Date(NOW.getTime() + 1) }),
    ]);
    const problems = eventProblems(seated({ eventIds: ['e1', 'e1', 'e2', 'e3', 'e4', 'zz'] }), ctx);
    expect(heads(problems)).toEqual(['eventIds.1', 'eventIds.2', 'eventIds.3', 'eventIds.5']);
  });

  it('keeps an event already in the Season that has since been cancelled or started', () => {
    const ctx = ctxFor([ev('e1', { status: 'CANCELLED' }), ev('e2', { startsAt: NOW })], {
      alreadyIn: new Set(['e1', 'e2']),
    });
    expect(eventProblems(seated(), ctx)).toEqual([]);
  });

  it('still requires an event already in the Season to be at its venue on its layout', () => {
    const ctx = ctxFor([ev('e1', { locationId: OTHER_VENUE }), ev('e2')], {
      alreadyIn: new Set(['e1', 'e2']),
    });
    expect(heads(eventProblems(seated(), ctx))).toEqual(['eventIds.0']);
  });
});

describe('priceProblems (041 FR-009)', () => {
  const events = [ev('e1'), ev('e2')];

  it('accepts a price for every level', () => {
    expect(priceProblems(seated(), ctxFor(events), { complete: true })).toEqual([]);
  });

  it('lets a draft save with a level unpriced, but not a Season that must stay sellable', () => {
    const input = seated({ prices: [{ levelId: LOWER, price: '100.00' }] });
    expect(priceProblems(input, ctxFor(events), { complete: false })).toEqual([]);
    expect(heads(priceProblems(input, ctxFor(events), { complete: true }))).toEqual([
      `prices.${UPPER}`,
    ]);
  });

  it('names a sent entry at fault by its index: a level of no layout, repeated, or a name', () => {
    const input = seated({
      prices: [
        { levelId: LOWER, price: '100.00' },
        { levelId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', price: '1.00' },
        { levelId: LOWER, price: '90.00' },
        { tierName: 'General', price: '5.00' },
        { price: '5.00' },
        { levelId: UPPER, tierName: 'General', price: '5.00' },
      ],
    });
    expect(heads(priceProblems(input, ctxFor(events), { complete: false }))).toEqual([
      'prices.1',
      'prices.2',
      'prices.3',
      'prices.4',
      'prices.5',
    ]);
  });

  describe('general admission', () => {
    const ga = (over: Partial<SeasonRuleInput> = {}) =>
      seated({
        layoutId: null,
        prices: [{ tierName: 'General', price: '80.00' }],
        ...over,
      });
    const gaEvents = [
      ev('e1', { layoutId: null, tierNames: ['General', 'VIP'] }),
      ev('e2', { layoutId: null, tierNames: ['general'] }),
    ];

    it('accepts one priced name every event sells, ignoring case; other names stay single only', () => {
      expect(priceProblems(ga(), ctxFor(gaEvents, { levels: [] }), { complete: true })).toEqual([]);
    });

    it('refuses a name an event lacks, naming the event, and a name repeated ignoring case', () => {
      const input = ga({
        prices: [
          { tierName: 'General', price: '80.00' },
          { tierName: 'VIP', price: '200.00' },
          { tierName: 'GENERAL', price: '1.00' },
          { levelId: LOWER, price: '1.00' },
        ],
      });
      const problems = priceProblems(input, ctxFor(gaEvents, { levels: [] }), {
        complete: false,
      });
      expect(heads(problems)).toEqual(['prices.1', 'prices.2', 'prices.3']);
      expect(problems[0]).toContain('Game e2');
    });

    it('does not ask a cancelled event to sell the name', () => {
      const events2 = [gaEvents[0]!, { ...gaEvents[1]!, status: 'CANCELLED' as const }];
      const input = ga({ prices: [{ tierName: 'VIP', price: '200.00' }] });
      expect(priceProblems(input, ctxFor(events2, { levels: [] }), { complete: true })).toEqual([]);
    });

    it('needs at least one priced name to stay sellable', () => {
      const problems = priceProblems(ga({ prices: [] }), ctxFor(gaEvents, { levels: [] }), {
        complete: true,
      });
      expect(heads(problems)).toEqual(['prices']);
    });
  });
});

describe('publishProblems (041 FR-010)', () => {
  const events = [ev('e1'), ev('e2')];

  it('accepts a ready Season', () => {
    expect(publishProblems(seated(), ctxFor(events))).toEqual([]);
  });

  it('needs at least 2 events not cancelled', () => {
    expect(heads(publishProblems(seated({ eventIds: ['e1'] }), ctxFor(events)))).toEqual([
      'eventIds',
    ]);
    const oneCancelled = ctxFor([ev('e1'), ev('e2', { status: 'CANCELLED' })], {
      alreadyIn: new Set(['e1', 'e2']),
    });
    expect(heads(publishProblems(seated(), oneCancelled))).toEqual(['eventIds']);
  });

  it('needs the sales end in the future (the boundary itself is past)', () => {
    expect(heads(publishProblems(seated({ salesEndAt: NOW }), ctxFor(events)))).toEqual([
      'salesEndAt',
    ]);
    expect(
      publishProblems(seated({ salesEndAt: new Date(NOW.getTime() + 1) }), ctxFor(events)),
    ).toEqual([]);
  });

  it('needs every level priced, naming each unpriced level', () => {
    const problems = publishProblems(seated({ prices: [] }), ctxFor(events));
    expect(heads(problems)).toEqual([`prices.${LOWER}`, `prices.${UPPER}`]);
    expect(problems[0]).toContain('Lower');
  });
});
