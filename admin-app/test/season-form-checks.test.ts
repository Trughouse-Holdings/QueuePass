import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/client';
import {
  SEASON_MSG,
  fieldOrder,
  firstErrorKey,
  pickableEvents,
  placeSeasonErrors,
  previewSeason,
  seasonStatusText,
  sportTeamText,
  toSeasonInput,
  type PickerEvent,
  type SeasonDraft,
  type SeasonPreviewContext,
} from '../src/pages/season-form-checks';

/**
 * Spec 041 (T017; FR-002 to FR-006, FR-009, FR-010, FR-017, FR-018; research R4, R11): the Season
 * form's checks as previews of the Backend's rules (which stay authoritative), keyed by the
 * Backend's own field paths, so a preview and a refusal land in the same place.
 */
const ZONE = 'America/New_York';
const VENUE = '11111111-1111-4111-8111-111111111111';
const LAYOUT = '33333333-3333-4333-8333-333333333333';
const LOWER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UPPER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const draft = (over: Partial<SeasonDraft> = {}): SeasonDraft => ({
  name: 'Spring Hoops',
  locationId: VENUE,
  layout: LAYOUT,
  sport: 'BASKETBALL',
  team: 'Test Team',
  salesEndAt: '2026-12-10T18:00',
  singleSalesOpenAt: '',
  maxPassesPerCustomer: '',
  eventIds: ['e1', 'e2'],
  prices: { [LOWER]: '100.00', [UPPER]: '60.00' },
  ...over,
});

const ctx = (over: Partial<SeasonPreviewContext> = {}): SeasonPreviewContext => ({
  zone: ZONE,
  events: [
    { id: 'e1', name: 'Game 1', startsAt: '2026-12-11T00:00:00Z', status: 'SCHEDULED' },
    { id: 'e2', name: 'Game 2', startsAt: '2026-12-18T00:00:00Z', status: 'SCHEDULED' },
  ],
  levels: [
    { id: LOWER, name: 'Lower', rank: 1 },
    { id: UPPER, name: 'Upper', rank: 2 },
  ],
  tierNames: [],
  complete: false,
  ...over,
});

describe('previewSeason', () => {
  it('finds nothing wrong with a complete seated Season', () => {
    expect(previewSeason(draft(), ctx({ complete: true }))).toEqual(new Map());
  });

  it('marks each required field: name, venue, layout, pass sales end', () => {
    const errors = previewSeason(
      draft({ name: '  ', locationId: '', layout: '', salesEndAt: '' }),
      ctx(),
    );
    expect(errors.get('name')).toBe(SEASON_MSG.name);
    expect(errors.get('locationId')).toBe(SEASON_MSG.venue);
    expect(errors.get('layoutId')).toBe(SEASON_MSG.layout);
    expect(errors.get('salesEndAt')).toBe(SEASON_MSG.salesEnd);
  });

  it('refuses a name over 100 characters', () => {
    expect(previewSeason(draft({ name: 'x'.repeat(101) }), ctx()).has('name')).toBe(true);
    expect(previewSeason(draft({ name: 'x'.repeat(100) }), ctx()).has('name')).toBe(false);
  });

  it('asks for sport and team together: both or neither', () => {
    expect(previewSeason(draft({ team: '' }), ctx()).get('team')).toBe(SEASON_MSG.team);
    expect(previewSeason(draft({ sport: '' }), ctx()).get('sport')).toBe(SEASON_MSG.sport);
    expect(previewSeason(draft({ sport: '', team: '' }), ctx())).toEqual(new Map());
  });

  it('takes passes per customer from 1 to 10, or blank', () => {
    for (const bad of ['0', '11', '2.5', 'x']) {
      expect(
        previewSeason(draft({ maxPassesPerCustomer: bad }), ctx()).get('maxPassesPerCustomer'),
      ).toBe(SEASON_MSG.passes);
    }
    for (const good of ['', '1', '10']) {
      expect(previewSeason(draft({ maxPassesPerCustomer: good }), ctx()).size).toBe(0);
    }
  });

  it('refuses a sales end after the first event starts, naming it, and single sales after it', () => {
    // Game 1 starts at 7:00 PM Eastern on Dec 10.
    expect(previewSeason(draft({ salesEndAt: '2026-12-10T19:00' }), ctx()).size).toBe(0);
    const late = previewSeason(draft({ salesEndAt: '2026-12-10T19:01' }), ctx());
    expect(late.get('salesEndAt')).toContain('Game 1');
    const presale = previewSeason(draft({ singleSalesOpenAt: '2026-12-10T18:01' }), ctx());
    expect(presale.get('singleSalesOpenAt')).toBe(SEASON_MSG.presale);
    expect(previewSeason(draft({ singleSalesOpenAt: '2026-12-10T18:00' }), ctx()).size).toBe(0);
  });

  it('ignores a cancelled event when finding the first start', () => {
    const events = ctx().events.map((e, i) => (i === 0 ? { ...e, status: 'CANCELLED' } : e));
    expect(previewSeason(draft({ salesEndAt: '2026-12-15T12:00' }), ctx({ events })).size).toBe(0);
  });

  it('says a skipped local time is skipped', () => {
    const errors = previewSeason(draft({ salesEndAt: '2026-03-08T02:30' }), ctx({ events: [] }));
    expect(errors.get('salesEndAt')).toMatch(/2:30 AM/);
  });

  it('refuses a malformed price, keyed by its level', () => {
    const errors = previewSeason(draft({ prices: { [LOWER]: '1.234', [UPPER]: '-1' } }), ctx());
    expect(errors.get(`prices.${LOWER}`)).toBe(SEASON_MSG.price);
    expect(errors.get(`prices.${UPPER}`)).toBe(SEASON_MSG.price);
  });

  it('lets a draft save with a level unpriced, but not one on sale or being put on sale', () => {
    const one = draft({ prices: { [LOWER]: '100.00' } });
    expect(previewSeason(one, ctx()).size).toBe(0);
    expect(previewSeason(one, ctx({ complete: true })).get(`prices.${UPPER}`)).toBe(
      'Give Upper a price.',
    );
  });

  it('asks for at least 2 events not cancelled to put a Season on sale, not to save one', () => {
    expect(previewSeason(draft({ eventIds: ['e1'] }), ctx({ complete: true })).size).toBe(0);
    expect(
      previewSeason(draft({ eventIds: ['e1'] }), ctx({ complete: true, publishing: true })).get(
        'eventIds',
      ),
    ).toBe(SEASON_MSG.twoEvents);
  });

  it('asks a general-admission Season for at least one priced name to stay sellable', () => {
    const ga = draft({ layout: 'ga', prices: {} });
    const gaCtx = ctx({ levels: [], tierNames: ['General'], complete: true });
    expect(previewSeason(ga, gaCtx).get('prices')).toBe(SEASON_MSG.oneName);
    expect(
      previewSeason(draft({ layout: 'ga', prices: { 'tier:general': '50' } }), gaCtx).size,
    ).toBe(0);
  });
});

describe('fieldOrder and firstErrorKey', () => {
  it('runs top to bottom, the price boxes in order, so focus goes to the first at fault', () => {
    expect(fieldOrder([LOWER, UPPER])).toEqual([
      'name',
      'locationId',
      'layoutId',
      'sport',
      'team',
      'salesEndAt',
      'singleSalesOpenAt',
      'maxPassesPerCustomer',
      'eventIds',
      `prices.${LOWER}`,
      `prices.${UPPER}`,
      'prices',
    ]);
    const errors = new Map([
      [`prices.${UPPER}`, 'x'],
      ['salesEndAt', 'y'],
    ]);
    expect(firstErrorKey(errors, [LOWER, UPPER])).toBe('salesEndAt');
    expect(firstErrorKey(new Map([['other', 'z']]), [])).toBe('other');
    expect(firstErrorKey(new Map(), [])).toBeNull();
  });
});

describe('toSeasonInput', () => {
  it('sends the times in the venue offset, the levels priced in rank order, blanks as null', () => {
    const { input, priceKeys } = toSeasonInput(
      draft({
        prices: { [UPPER]: ' 60 ', [LOWER]: '' },
        maxPassesPerCustomer: '4',
        singleSalesOpenAt: '2026-12-01T10:00',
      }),
      ctx(),
    );
    expect(input).toEqual({
      name: 'Spring Hoops',
      sport: 'BASKETBALL',
      team: 'Test Team',
      locationId: VENUE,
      layoutId: LAYOUT,
      salesEndAt: '2026-12-10T18:00:00-05:00',
      singleSalesOpenAt: '2026-12-01T10:00:00-05:00',
      maxPassesPerCustomer: 4,
      eventIds: ['e1', 'e2'],
      prices: [{ levelId: UPPER, price: '60' }],
    });
    expect(priceKeys).toEqual([`prices.${UPPER}`]);
  });

  it('sends general admission as a null layout and names by their offered spelling', () => {
    const { input, priceKeys } = toSeasonInput(
      draft({ layout: 'ga', sport: '', team: '', prices: { 'tier:general': '50.00' } }),
      ctx({ levels: [], tierNames: ['General', 'VIP'] }),
    );
    expect(input).toMatchObject({
      layoutId: null,
      sport: null,
      team: null,
      singleSalesOpenAt: null,
      maxPassesPerCustomer: null,
      prices: [{ tierName: 'General', price: '50.00' }],
    });
    expect(priceKeys).toEqual(['prices.tier:general']);
  });
});

describe('placeSeasonErrors', () => {
  const refusal = (status: number, error: object) =>
    new ApiError(status, { error } as ConstructorParameters<typeof ApiError>[1]);
  const sent = { eventIds: ['e1', 'e2'], priceKeys: [`prices.${UPPER}`, 'prices.tier:vip'] };

  it('places each 400 field by its path, entries by index, without the path in the message', () => {
    const placed = placeSeasonErrors(
      refusal(400, {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed.',
        details: {
          fields: [
            'name must be between 1 and 100 characters',
            'eventIds.1 Game 2 is at another venue',
            `prices.${LOWER} Give Lower a price.`,
            'prices.1 Show 18 has no ticket type named VIP',
            'prices must price at least one ticket type name',
            'something else entirely',
          ],
        },
      }),
      sent,
    );
    expect(placed.fields.get('name')).toEqual(['name must be between 1 and 100 characters']);
    expect(placed.fields.get('eventIds')).toEqual(['Game 2 is at another venue']);
    expect(placed.fields.get(`prices.${LOWER}`)).toEqual(['Give Lower a price.']);
    expect(placed.fields.get('prices.tier:vip')).toEqual(['Show 18 has no ticket type named VIP']);
    expect(placed.fields.get('prices')).toEqual([
      'prices must price at least one ticket type name',
    ]);
    expect(placed.unmapped).toEqual(['something else entirely']);
  });

  it('places a 409 naming its field: an event in another Season, passes sold, a time', () => {
    const inSeason = placeSeasonErrors(
      refusal(409, {
        code: 'EVENT_IN_SEASON',
        message: 'Game 2 is already in Winter.',
        details: { field: 'eventIds.1', seasonId: 'x', seasonName: 'Winter' },
      }),
      sent,
    );
    expect(inSeason.fields.get('eventIds')).toEqual(['Game 2 is already in Winter.']);
    const passes = placeSeasonErrors(
      refusal(409, {
        code: 'SEASON_HAS_PASSES',
        message: 'Passes have been sold.',
        details: { field: 'layoutId', passesSold: 1 },
      }),
      sent,
    );
    expect(passes.fields.get('layoutId')).toEqual(['Passes have been sold.']);
    const offset = placeSeasonErrors(
      refusal(400, {
        code: 'UTC_OFFSET_MISMATCH',
        message: 'salesEndAt is stated with offset +00:00.',
        details: { field: 'salesEndAt' },
      }),
      sent,
    );
    expect(offset.fields.get('salesEndAt')).toEqual(['salesEndAt is stated with offset +00:00.']);
  });

  it('keeps a refusal that names no field as a general message', () => {
    const placed = placeSeasonErrors(
      refusal(409, { code: 'SEASON_CANCELLED', message: 'Winter is cancelled.' }),
      sent,
    );
    expect(placed.fields.size).toBe(0);
    expect(placed.unmapped).toEqual(['Winter is cancelled.']);
    expect(placeSeasonErrors(null, sent).unmapped).toEqual([]);
  });
});

describe('pickableEvents (R11)', () => {
  const NOW = Date.parse('2026-12-01T12:00:00Z');
  const ev = (id: string, over: Partial<PickerEvent> = {}): PickerEvent => ({
    id,
    name: id,
    locationId: VENUE,
    layoutId: LAYOUT,
    status: 'SCHEDULED',
    startsAt: '2026-12-11T00:00:00Z',
    season: null,
    ...over,
  });

  it('lists upcoming scheduled events at the venue on the layout not in another Season, by start', () => {
    const events = [
      ev('later', { startsAt: '2026-12-20T00:00:00Z' }),
      ev('ok'),
      ev('elsewhere', { locationId: 'other' }),
      ev('other-layout', { layoutId: 'other' }),
      ev('ga', { layoutId: null }),
      ev('cancelled', { status: 'CANCELLED' }),
      ev('started', { startsAt: '2026-12-01T12:00:00Z' }),
      ev('taken', { season: { id: 'other-season', name: 'Winter' } }),
      ev('mine', { season: { id: 'this', name: 'This' } }),
    ];
    const picked = pickableEvents(events, {
      locationId: VENUE,
      layoutId: LAYOUT,
      seasonId: 'this',
      now: NOW,
      keep: [],
    });
    expect(picked.map((e) => e.id)).toEqual(['mine', 'ok', 'later']);
  });

  it('lists general-admission events for a general-admission Season, and keeps chosen ones', () => {
    const events = [
      ev('ga', { layoutId: null }),
      ev('seated'),
      ev('old', { layoutId: null, status: 'CANCELLED' }),
    ];
    const picked = pickableEvents(events, {
      locationId: VENUE,
      layoutId: null,
      seasonId: null,
      now: NOW,
      keep: ['old'],
    });
    expect(picked.map((e) => e.id).sort()).toEqual(['ga', 'old']);
  });
});

describe('seasonStatusText and sportTeamText (FR-018)', () => {
  const NOW = Date.parse('2026-12-01T12:00:00Z');
  const s = (over: object) => ({
    status: 'ON_SALE' as const,
    salesEndAt: '2026-12-10T23:00:00Z',
    singleSalesOpenAt: null as string | null,
    timeZone: ZONE,
    ...over,
  });

  it('says Draft, On sale, Presale until …, Sales ended, Cancelled', () => {
    expect(seasonStatusText(s({ status: 'DRAFT' }), NOW)).toBe('Draft');
    expect(seasonStatusText(s({}), NOW)).toBe('On sale');
    expect(seasonStatusText(s({ singleSalesOpenAt: '2026-12-04T15:00:00Z' }), NOW)).toBe(
      'Presale until Dec 4, 2026, 10:00 AM EST',
    );
    expect(seasonStatusText(s({ singleSalesOpenAt: '2026-11-30T15:00:00Z' }), NOW)).toBe('On sale');
    expect(seasonStatusText(s({ salesEndAt: '2026-12-01T12:00:00Z' }), NOW)).toBe('Sales ended');
    expect(seasonStatusText(s({ status: 'CANCELLED' }), NOW)).toBe('Cancelled');
  });

  it('shows the sport and team together, or a dash', () => {
    expect(sportTeamText({ sport: 'BASKETBALL', team: 'Louisville Cardinals' })).toBe(
      'Basketball · Louisville Cardinals',
    );
    expect(sportTeamText({ sport: null, team: null })).toBe('—');
  });
});
