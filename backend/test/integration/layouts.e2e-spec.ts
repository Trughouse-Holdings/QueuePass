import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { LAYOUT_LIMITS, LEVEL_COLORS } from '@queuepass/shared';
import { gridLayout, seatPlace } from '../../src/layouts/layout-lines';
import { LayoutsService } from '../../src/layouts/layouts.service';
import { asAdmin } from '../setup/authed-request';
import {
  event,
  holdSeats,
  insertLayout,
  layoutRefs,
  seatEventOn,
  sellSeats,
  venue,
  windowAt,
} from '../setup/fixtures';
import { resetDb } from '../setup/reset-db';
import { createTestApp, TestContext } from '../setup/test-app';
import { subFor } from '../setup/tokens';

/**
 * Spec 038 US1 (FR-001–FR-009; research R5, R6, R7; contracts/README.md): a venue's layouts,
 * imported from a layout file or made from section lines; renamed, edited, duplicated, deleted;
 * locked while a scheduled event using one has sold or held seats; the venue's seating capacity
 * its largest layout's. Every response through `asAdmin` is checked against the contract.
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const fixture = (name: string): Json =>
  JSON.parse(readFileSync(join(__dirname, '../fixtures/layouts', name), 'utf8'));
const SMALL = fixture('small.json');
const BAD = fixture('bad.json');

const CLUB = {
  name: 'Club room',
  levels: [
    { name: 'Front', color: 'violet' },
    { name: 'Back', color: 'teal' },
  ],
  sections: [
    { name: 'Floor A', rows: 10, seatsPerRow: 20, level: 'Front' },
    { name: 'Floor B', rows: 10, seatsPerRow: 20, level: 'Back' },
  ],
};

/** A layout file of `sections` sections, each of `rows` rows of `seats` seats, as runs. */
function gridFile(opts: {
  name?: string;
  sections?: number;
  rows?: number;
  seats?: number;
  levels?: number;
  outlinePoints?: number;
  rowLabel?: string;
}): Json {
  const levelCount = opts.levels ?? 1;
  const points = opts.outlinePoints ?? 4;
  const outline =
    points === 4
      ? [
          [10, 10],
          [4990, 10],
          [4990, 4990],
          [10, 4990],
        ]
      : Array.from({ length: points }, (_, i) => [
          Math.round(2500 + 2000 * Math.cos((2 * Math.PI * i) / points)),
          Math.round(2500 + 2000 * Math.sin((2 * Math.PI * i) / points)),
        ]);
  return {
    format: 1,
    name: opts.name ?? 'Grid',
    floor: { kind: 'NONE' },
    size: { width: 5000, height: 5000 },
    levels: Array.from({ length: levelCount }, (_, i) => ({
      key: `l${i + 1}`,
      name: `Level ${i + 1}`,
      rank: i + 1,
      color: LEVEL_COLORS[i % LEVEL_COLORS.length],
    })),
    sections: Array.from({ length: opts.sections ?? 1 }, (_, s) => ({
      name: `S${s + 1}`,
      level: 'l1',
      outline,
      rows: Array.from({ length: opts.rows ?? 1 }, (_, r) => ({
        label: r === 0 && opts.rowLabel ? opts.rowLabel : String(r + 1),
        seats: {
          first: 1,
          count: opts.seats ?? 1,
          from: [1000, 1000 + r * 2],
          to: [4000, 1000 + r * 2],
        },
      })),
    })),
  };
}

describe('Venue layouts (038 US1)', () => {
  let ctx: TestContext;
  let venueId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    venueId = await venue(ctx, 'KFC Yum! Center');
  });

  const importFile = (file: Json, name?: string, at = venueId) =>
    asAdmin(ctx)
      .post(`/locations/${at}/layouts/import`)
      .send({ ...(name !== undefined ? { name } : {}), file });
  const createLines = (body: Json, at = venueId) =>
    asAdmin(ctx).post(`/locations/${at}/layouts`).send(body);
  const update = (layoutId: string, body: Json) =>
    asAdmin(ctx).put(`/layouts/${layoutId}`).send(body);
  const remove = (layoutId: string) => asAdmin(ctx).delete(`/layouts/${layoutId}`);
  const duplicate = (layoutId: string, body?: Json) => {
    const req = asAdmin(ctx).post(`/layouts/${layoutId}/duplicate`);
    return body ? req.send(body) : req;
  };
  const getLayout = (layoutId: string) => asAdmin(ctx).get(`/layouts/${layoutId}`);
  const getSection = (layoutId: string, sectionId: string) =>
    asAdmin(ctx).get(`/layouts/${layoutId}/sections/${sectionId}`);
  const capacity = async (id = venueId) =>
    (await ctx.prisma.location.findUniqueOrThrow({ where: { id } })).seatingCapacity;
  const layoutCount = () => ctx.prisma.layout.count();

  /** A Club room layout with one scheduled event on it, priced Front 50, Back 30. */
  async function clubWithEvent(
    opts: { offSale?: [string, number, number][]; maxTicketsPerCustomer?: number } = {},
  ) {
    const created = await createLines(CLUB).expect(201);
    const refs = await layoutRefs(ctx, created.body.id);
    const eventId = await event(ctx, venueId, {
      name: 'Cardinals vs. Duke',
      ...(opts.maxTicketsPerCustomer !== undefined
        ? { maxTicketsPerCustomer: opts.maxTicketsPerCustomer }
        : {}),
    });
    await seatEventOn(
      ctx,
      eventId,
      refs,
      { Front: '50.00', Back: '30.00' },
      (opts.offSale ?? []).map(([s, r, n]) => refs.seat(s, r, n)),
    );
    return { layoutId: created.body.id as string, refs, eventId };
  }

  describe('importVenueLayout', () => {
    it('saves small.json: counts, FILE, levels by rank, outlines, label points and levels per section', async () => {
      const res = await importFile(SMALL).expect(201);
      const body = res.body;
      expect(body).toMatchObject({
        locationId: venueId,
        name: 'Small court',
        source: 'FILE',
        floorKind: 'COURT',
        floorOutline: SMALL.floor.outline,
        size: { width: 200, height: 120 },
        seatCount: 61,
        sectionCount: 3,
        levelCount: 2,
        eventsUsing: 0,
        locked: false,
        latestPrices: null,
      });
      expect(body.levels.map((l: Json) => [l.name, l.rank, l.color, l.seatCount])).toEqual([
        ['Front', 1, 'violet', 36],
        ['Back', 2, 'teal', 25],
      ]);
      const [front, back] = body.levels.map((l: Json) => l.id);
      expect(
        body.sections.map((s: Json) => [s.name, s.rowCount, s.seatCount, s.levelId, s.levelIds]),
      ).toEqual([
        ['A', 3, 21, front, [front, back]],
        ['B', 3, 19, back, [front, back]],
        ['C', 3, 21, front, [front]],
      ]);
      expect(body.sections.map((s: Json) => s.outline)).toEqual(
        SMALL.sections.map((s: Json) => s.outline),
      );
      // B has its own label point; A and C, rectangles, are labelled at their centroids.
      expect(body.sections.map((s: Json) => s.labelAt)).toEqual([
        [35, 87.5],
        [100, 18],
        [165, 87.5],
      ]);
      const list = await asAdmin(ctx).get(`/locations/${venueId}/layouts`).expect(200);
      expect(list.body).toHaveLength(1);
      expect(await capacity()).toBe(61);
    });

    it("gives a section's rows front first, each seat with its resolved level and accessible mark", async () => {
      const body = (await importFile(SMALL).expect(201)).body;
      const [front, back] = body.levels.map((l: Json) => l.id);
      const [a, b] = body.sections;

      const sb = (await getSection(body.id, b.id).expect(200)).body;
      expect(sb).toMatchObject({ layoutId: body.id, sectionId: b.id, name: 'B' });
      expect(sb.rows.map((r: Json) => [r.number, r.label, r.seats.length])).toEqual([
        [1, '1', 7],
        [2, '2', 5],
        [3, '3', 7],
      ]);
      expect(sb.rows[0].seats.map((s: Json) => s.at)).toEqual(
        [76, 84, 92, 100, 108, 116, 124].map((x) => [x, 55]),
      );
      expect(sb.rows[1].seats).toEqual([
        { number: 1, label: '1', at: [80, 45], levelId: back, accessible: true },
        { number: 2, label: '2', at: [90, 45], levelId: back, accessible: false },
        { number: 3, label: '3', at: [100, 45], levelId: front, accessible: false },
        { number: 4, label: '4', at: [110, 45], levelId: back, accessible: false },
        { number: 5, label: '5', at: [120, 45], levelId: back, accessible: false },
      ]);
      // The bent run starts and ends where it says and passes the bend halfway.
      const bent = sb.rows[2].seats;
      expect(bent[0].at).toEqual([76, 35]);
      expect(bent[6].at).toEqual([124, 35]);
      expect(bent[3].at[0]).toBeCloseTo(100, 3);
      expect(bent[3].at[1]).toBeCloseTo(30, 3);

      const sa = (await getSection(body.id, a.id).expect(200)).body;
      expect(sa.rows.map((r: Json) => [...new Set(r.seats.map((s: Json) => s.levelId))])).toEqual([
        [front],
        [front],
        [back],
      ]);
    });

    it('404s a section of another layout and an unknown layout', async () => {
      const one = (await importFile(SMALL).expect(201)).body;
      const two = (await importFile(SMALL, 'Second').expect(201)).body;
      await getSection(one.id, two.sections[0].id).expect(404);
      await getLayout('00000000-0000-4000-8000-000000000000').expect(404);
      await asAdmin(ctx).get('/locations/00000000-0000-4000-8000-000000000000/layouts').expect(404);
    });

    it('refuses bad.json with every problem, where it is and what it is, and saves nothing', async () => {
      const res = await importFile(BAD).expect(400);
      expect(res.body.error.code).toBe('LAYOUT_FILE_INVALID');
      const problems: { path: string; message: string }[] = res.body.error.details.problems;
      expect(res.body.error.details.more).toBe(0);
      expect(problems).toContainEqual({
        path: 'file.sections[0].rows[0].seats[2]',
        message: 'Section 104, row F: seat 7 appears twice',
      });
      expect(problems).toContainEqual({
        path: 'file.sections[1].name',
        message: 'Section 104 appears twice',
      });
      expect(problems).toContainEqual({
        path: 'file.sections[1].level',
        message: 'Section 104: level "upper" is not in the file',
      });
      expect(problems).toContainEqual({
        path: 'file.sections[2].rows[0].seats.count',
        message: 'Section 105, row A: 201 seats; a row has at most 200',
      });
      expect(problems).toContainEqual({
        path: 'file.sections[3].outline[1]',
        message: 'Section 106: outline point 2 (520, 10) is outside the map (500 × 200)',
      });
      expect(problems.map((p) => p.path)).toContain('file.sections[3].outline[2]');
      expect(problems).toHaveLength(6);
      expect(await layoutCount()).toBe(0);
      expect(await ctx.prisma.seat.count()).toBe(0);
    });

    it('lists at most 50 problems and says how many more', async () => {
      const file = gridFile({ sections: 1, rows: 1, seats: 1 });
      file.sections[0].rows = Array.from({ length: 60 }, () => ({
        label: 'TOOLONG',
        seats: { first: 1, count: 1, from: [10, 10], to: [10, 10] },
      }));
      const res = await importFile(file).expect(400);
      expect(res.body.error.code).toBe('LAYOUT_FILE_INVALID');
      expect(res.body.error.details.problems).toHaveLength(50);
      expect(res.body.error.details.more).toBeGreaterThan(0);
    });

    const limits: [string, Json, Json, string][] = [
      [
        '100 sections / 101',
        gridFile({ sections: 100 }),
        gridFile({ sections: 101 }),
        'file.sections',
      ],
      ['100 rows / 101', gridFile({ rows: 100 }), gridFile({ rows: 101 }), 'file.sections[0].rows'],
      [
        '200 seats a row / 201',
        gridFile({ seats: 200 }),
        gridFile({ seats: 201 }),
        'file.sections[0].rows[0].seats.count',
      ],
      ['12 levels / 13', gridFile({ levels: 12 }), gridFile({ levels: 13 }), 'file.levels'],
      [
        '64 outline points / 65',
        gridFile({ outlinePoints: 64 }),
        gridFile({ outlinePoints: 65 }),
        'file.sections[0].outline',
      ],
      [
        'a name of 50 characters / 51',
        gridFile({ name: 'N'.repeat(50) }),
        gridFile({ name: 'N'.repeat(51) }),
        'file.name',
      ],
      [
        'a row label of 5 characters / 6',
        gridFile({ rowLabel: 'ABCDE' }),
        gridFile({ rowLabel: 'ABCDEF' }),
        'file.sections[0].rows[0].label',
      ],
    ];
    it.each(limits)('takes %s refused', async (_label, ok, over, path) => {
      await importFile(ok).expect(201);
      const res = await importFile(over).expect(400);
      expect(res.body.error.code).toBe('LAYOUT_FILE_INVALID');
      expect(res.body.error.details.problems.map((p: Json) => p.path)).toContain(path);
      expect(await layoutCount()).toBe(1);
    });

    // FR-004, research R5: rows and seats are written set-based, a statement each, so the reset's
    // four Yum! Center imports stay well inside their transaction's limit and spec 029 SC-002's 10
    // seconds (about 1.25 s for this file with `createMany` batches; about 0.9 s set-based).
    it("imports the largest Yum! Center file, Basketball's 22,090 seats, well under its transaction's limit", async () => {
      const file = JSON.parse(
        readFileSync(
          join(__dirname, '../../src/scripts/layouts/yum-center-basketball.json'),
          'utf8',
        ),
      );
      const started = Date.now();
      const layout = await ctx.app.get(LayoutsService).importFile(venueId, { file });
      const ms = Date.now() - started;
      expect(layout.seatCount).toBe(22_090);
      expect(await ctx.prisma.seat.count()).toBe(22_090);
      expect(await ctx.prisma.seatRow.count({ where: { section: { layoutId: layout.id } } })).toBe(
        file.sections.reduce((n: number, s: Json) => n + s.rows.length, 0),
      );
      // A third of the 15 seconds every other layout write has; the import's own is 60 (IMPORT_TX).
      expect(ms).toBeLessThan(5_000);
    }, 60_000);

    it('takes 30,000 seats and refuses 30,001', async () => {
      const ok = gridFile({ name: 'Full', sections: 2, rows: 100, seats: 150 });
      const res = await importFile(ok).expect(201);
      expect(res.body.seatCount).toBe(LAYOUT_LIMITS.maxSeats);
      expect(await ctx.prisma.seat.count()).toBe(30_000);
      const over = gridFile({ name: 'Over', sections: 3, rows: 100, seats: 150 });
      over.sections[2].rows = [over.sections[2].rows[0]];
      over.sections[2].rows[0].seats.count = 1;
      const refused = await importFile(over).expect(400);
      expect(refused.body.error.details.problems).toEqual([
        { path: 'file.sections', message: '30,001 seats; a layout has at most 30,000' },
      ]);
      expect(await layoutCount()).toBe(1);
    }, 60_000);

    it('takes a body just under 4 MB, refuses one over it, and keeps the default limit elsewhere', async () => {
      const server = ctx.app.getHttpServer();
      const padded = (bytes: number): string => {
        const base = JSON.stringify({ file: { ...SMALL, notes: '' } });
        return JSON.stringify({ file: { ...SMALL, notes: 'x'.repeat(bytes - base.length) } });
      };
      const under = padded(LAYOUT_LIMITS.maxImportBytes - 10);
      expect(Buffer.byteLength(under)).toBe(LAYOUT_LIMITS.maxImportBytes - 10);
      await asAdmin(ctx)
        .post(`/locations/${venueId}/layouts/import`)
        .set('Content-Type', 'application/json')
        .send(under)
        .expect(201);

      // The contract declares no 413 for importVenueLayout (it says the body may be up to 4 MB),
      // so this response is checked here, not against the contract.
      const over = padded(LAYOUT_LIMITS.maxImportBytes + 10);
      const refused = await request(server)
        .post(`/locations/${venueId}/layouts/import`)
        .set('Authorization', `Bearer ${ctx.adminToken}`)
        .set('Content-Type', 'application/json')
        .send(over);
      expect(refused.status).toBe(413);
      expect(refused.body.error.code).toBe('VALIDATION_FAILED');
      expect(await layoutCount()).toBe(1);

      const big = JSON.stringify({
        name: 'Big venue',
        street: '1 Arena Plaza',
        city: 'Louisville',
        state: 'KY',
        zip: '40202',
        seatingCapacity: 100,
        notes: 'x'.repeat(200 * 1024),
      });
      const elsewhere = await request(server)
        .post('/locations')
        .set('Authorization', `Bearer ${ctx.adminToken}`)
        .set('Content-Type', 'application/json')
        .send(big);
      expect(elsewhere.status).toBe(413);
    }, 30_000);

    it("uses the request's name in place of the file's, so one file imports twice", async () => {
      const one = await importFile(SMALL, 'Basketball').expect(201);
      expect(one.body.name).toBe('Basketball');
      const two = await importFile(SMALL, '  Basketball (playoffs) ').expect(201);
      expect(two.body.name).toBe('Basketball (playoffs)');
      expect(await layoutCount()).toBe(2);
    });

    it('refuses a name another layout of the venue has, ignoring case: 409 LAYOUT_NAME_TAKEN', async () => {
      const first = await importFile(SMALL).expect(201);
      const res = await importFile(SMALL, 'SMALL COURT').expect(409);
      expect(res.body.error).toMatchObject({
        code: 'LAYOUT_NAME_TAKEN',
        details: { layoutId: first.body.id },
      });
      expect(res.body.error.message).toContain('KFC Yum! Center');
      const lines = await createLines({ ...CLUB, name: 'small court' }).expect(409);
      expect(lines.body.error.code).toBe('LAYOUT_NAME_TAKEN');
      // Another venue may use the name.
      const other = await venue(ctx, 'Rupp Arena');
      await importFile(SMALL, undefined, other).expect(201);
      expect(await layoutCount()).toBe(2);
    });
  });

  describe('createVenueLayout', () => {
    it('makes Floor A, 10 × 20, Front and Floor B, 10 × 20, Back: 400 seats on the R6 grid', async () => {
      const res = await createLines(CLUB).expect(201);
      expect(res.body).toMatchObject({
        name: 'Club room',
        source: 'LINES',
        floorKind: 'NONE',
        floorOutline: null,
        seatCount: 400,
        sectionCount: 2,
        levelCount: 2,
        eventsUsing: 0,
        locked: false,
      });
      expect(res.body.levels.map((l: Json) => [l.name, l.rank, l.color, l.seatCount])).toEqual([
        ['Front', 1, 'violet', 200],
        ['Back', 2, 'teal', 200],
      ]);
      const grid = gridLayout(CLUB.sections);
      expect(res.body.size).toEqual(grid.size);
      expect(res.body.sections.map((s: Json) => [s.name, s.outline, s.labelAt])).toEqual([
        ['Floor A', grid.sections[0].outline, grid.sections[0].labelAt],
        ['Floor B', grid.sections[1].outline, grid.sections[1].labelAt],
      ]);
      const b = res.body.sections[1];
      const seats = (await getSection(res.body.id, b.id).expect(200)).body;
      expect(seats.rows.map((r: Json) => r.label)).toEqual(
        Array.from({ length: 10 }, (_, i) => String(i + 1)),
      );
      for (const row of seats.rows) {
        expect(row.seats.map((s: Json) => s.label)).toEqual(
          Array.from({ length: 20 }, (_, i) => String(i + 1)),
        );
        for (const s of row.seats) {
          expect(s.at).toEqual(seatPlace(grid.sections[1], row.number, s.number));
          expect(s.levelId).toBe(res.body.levels[1].id);
        }
      }
      expect(await capacity()).toBe(400);
    });

    it.each([
      [
        'a section level not in levels',
        { sections: [{ name: 'A', rows: 1, seatsPerRow: 1, level: 'Middle' }] },
      ],
      [
        'two sections with one name, ignoring case',
        {
          sections: [
            { name: 'Floor', rows: 1, seatsPerRow: 1, level: 'Front' },
            { name: ' FLOOR', rows: 1, seatsPerRow: 1, level: 'Front' },
          ],
        },
      ],
      [
        'two levels with one name, ignoring case',
        {
          levels: [
            { name: 'Front', color: 'violet' },
            { name: 'front ', color: 'teal' },
          ],
        },
      ],
      [
        'more than 30,000 seats',
        {
          sections: [
            { name: 'A', rows: 100, seatsPerRow: 200, level: 'Front' },
            { name: 'B', rows: 100, seatsPerRow: 200, level: 'Front' },
          ],
        },
      ],
      [
        '13 levels',
        {
          levels: Array.from({ length: 13 }, (_, i) => ({
            name: `L${i}`,
            color: LEVEL_COLORS[i % 12],
          })),
        },
      ],
      ['a blank name', { name: '   ' }],
    ])('refuses %s with 400 and saves nothing', async (_label, change) => {
      const res = await createLines({ ...CLUB, ...change }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(await layoutCount()).toBe(0);
    });

    it("refuses a layout that would lower the venue's capacity below a scheduled general-admission event's", async () => {
      await event(ctx, venueId, { name: 'Big Night', capacity: 500 });
      const res = await createLines(CLUB).expect(409);
      expect(res.body.error.code).toBe('CAPACITY_EXCEEDED');
      expect(res.body.error.message).toContain('Big Night');
      expect(res.body.error.details.conflictingEvent).toMatchObject({ name: 'Big Night' });
      expect(await layoutCount()).toBe(0);
      expect(await capacity()).toBe(22090);
    });
  });

  describe('updateVenueLayout', () => {
    it('renames, refusing a name another layout has', async () => {
      const club = (await createLines(CLUB).expect(201)).body;
      await importFile(SMALL).expect(201);
      const res = await update(club.id, { name: ' Club room (VIP) ' }).expect(200);
      expect(res.body.name).toBe('Club room (VIP)');
      expect(res.body.seatCount).toBe(400);
      const taken = await update(club.id, { name: 'small COURT' }).expect(409);
      expect(taken.body.error.code).toBe('LAYOUT_NAME_TAKEN');
      // Its own name in another case is no clash.
      await update(club.id, { name: 'CLUB ROOM (vip)' }).expect(200);
    });

    it('refuses section lines for an imported layout, and lines without levels', async () => {
      const file = (await importFile(SMALL).expect(201)).body;
      const res = await update(file.id, { levels: CLUB.levels, sections: CLUB.sections }).expect(
        400,
      );
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      const club = (await createLines(CLUB).expect(201)).body;
      await update(club.id, { sections: CLUB.sections }).expect(400);
      await update(club.id, {}).expect(400);
    });

    it('keeps the ids of what is unchanged, with the prices and off-sale seats on them, and deletes what is gone', async () => {
      const { layoutId, refs, eventId } = await clubWithEvent({ offSale: [['Floor A', 1, 1]] });
      const before = await ctx.prisma.seat.findMany({
        where: { section: { layoutId, name: 'Floor A' } },
        select: { id: true },
      });

      // Floor A grows by two rows; Floor B goes; Floor C, in Back, is new.
      const edited = await update(layoutId, {
        levels: CLUB.levels,
        sections: [
          { name: 'Floor A', rows: 12, seatsPerRow: 20, level: 'Front' },
          { name: 'Floor C', rows: 5, seatsPerRow: 5, level: 'Back' },
        ],
      }).expect(200);
      expect(edited.body.seatCount).toBe(265);
      expect(edited.body.levels.map((l: Json) => l.id)).toEqual([
        refs.levels.Front,
        refs.levels.Back,
      ]);
      expect(edited.body.sections[0].id).toBe(refs.sections['Floor A']);
      const after = await layoutRefs(ctx, layoutId);
      for (let row = 1; row <= 10; row++) {
        for (let seat = 1; seat <= 20; seat++) {
          expect(after.seat('Floor A', row, seat)).toBe(refs.seat('Floor A', row, seat));
        }
      }
      expect(await ctx.prisma.seat.count({ where: { id: { in: before.map((s) => s.id) } } })).toBe(
        200,
      );
      expect(await ctx.prisma.section.count({ where: { id: refs.sections['Floor B'] } })).toBe(0);

      // The event keeps its prices and its off-sale seat; the new seats (rows 11-12 and Floor
      // C) are off sale for it; its capacity, base price and price range follow.
      const prices = await ctx.prisma.eventLevelPrice.findMany({ where: { eventId } });
      expect(prices.map((p) => [p.levelId, p.price.toFixed(2)]).sort()).toEqual(
        [
          [refs.levels.Front, '50.00'],
          [refs.levels.Back, '30.00'],
        ].sort(),
      );
      const offSale = new Set(
        (await ctx.prisma.eventOffSaleSeat.findMany({ where: { eventId } })).map((o) => o.seatId),
      );
      expect(offSale.size).toBe(1 + 40 + 25);
      expect(offSale.has(refs.seat('Floor A', 1, 1))).toBe(true);
      expect(offSale.has(after.seat('Floor A', 11, 1))).toBe(true);
      expect(offSale.has(after.seat('Floor C', 5, 5))).toBe(true);
      const ev = (await asAdmin(ctx).get(`/events/${eventId}`).expect(200)).body;
      expect(ev).toMatchObject({
        totalTicketCapacity: 199,
        basePrice: '50.00',
        priceMax: '50.00',
      });

      // Back goes too: its price goes with it.
      await update(layoutId, {
        levels: [CLUB.levels[0]],
        sections: [{ name: 'Floor A', rows: 12, seatsPerRow: 20, level: 'Front' }],
      }).expect(200);
      expect(await ctx.prisma.priceLevel.count({ where: { id: refs.levels.Back } })).toBe(0);
      expect(await ctx.prisma.eventLevelPrice.count({ where: { eventId } })).toBe(1);
      expect(await ctx.prisma.eventOffSaleSeat.count({ where: { eventId } })).toBe(41);
    });

    it('recomputes the base price when a section moves to a priced level', async () => {
      const { layoutId, eventId } = await clubWithEvent();
      await update(layoutId, {
        levels: CLUB.levels,
        sections: [
          { name: 'Floor A', rows: 10, seatsPerRow: 20, level: 'Back' },
          { name: 'Floor B', rows: 10, seatsPerRow: 20, level: 'Back' },
        ],
      }).expect(200);
      const ev = (await asAdmin(ctx).get(`/events/${eventId}`).expect(200)).body;
      expect(ev).toMatchObject({ totalTicketCapacity: 400, basePrice: '30.00', priceMax: '30.00' });
    });

    it.each([
      [
        'a section moves to a level the event has no price for',
        {},
        {
          levels: [...CLUB.levels, { name: 'Middle', color: 'blue' }],
          sections: [
            { name: 'Floor A', rows: 10, seatsPerRow: 20, level: 'Front' },
            { name: 'Floor B', rows: 10, seatsPerRow: 20, level: 'Middle' },
          ],
        },
        /no price for Middle/,
      ],
      [
        'no seat would be on sale',
        { offSale: Array.from({ length: 20 }, (_, i) => ['Floor B', 1, i + 1]) },
        {
          levels: CLUB.levels,
          sections: [{ name: 'Floor B', rows: 1, seatsPerRow: 20, level: 'Back' }],
        },
        /no seat on sale/,
      ],
      [
        'its limit per customer would be above its seats on sale',
        { maxTicketsPerCustomer: 10 },
        {
          levels: CLUB.levels,
          sections: [{ name: 'Floor A', rows: 1, seatsPerRow: 5, level: 'Front' }],
        },
        /limit of 10 tickets per customer/,
      ],
    ] as [string, Json, Json, RegExp][])(
      'refuses a lines edit when %s for an event using it: 409 LAYOUT_IN_USE naming it',
      async (_label, setup, lines, why) => {
        const { layoutId, eventId } = await clubWithEvent(setup);
        const before = await ctx.prisma.seat.count();
        const res = await update(layoutId, lines).expect(409);
        expect(res.body.error.code).toBe('LAYOUT_IN_USE');
        expect(res.body.error.details.events).toEqual([
          { id: eventId, name: 'Cardinals vs. Duke' },
        ]);
        expect(res.body.error.message).toContain('Cardinals vs. Duke');
        expect(res.body.error.message).toMatch(why);
        expect(await ctx.prisma.seat.count()).toBe(before);
      },
    );

    it('lets a carried-over layout of 20 levels keep 20 in a lines edit, not 21', async () => {
      const names = Array.from({ length: 20 }, (_, i) => `Section ${i + 1}`);
      const carried = await insertLayout(ctx, venueId, {
        levels: names,
        sections: names.map((name) => ({ name, level: name, rows: 1, seatsPerRow: 2 })),
      });
      const levels = names.map((name, i) => ({ name, color: LEVEL_COLORS[i % 12] }));
      const sections = names.map((name) => ({ name, rows: 1, seatsPerRow: 3, level: name }));
      const res = await update(carried.id, { levels, sections }).expect(200);
      expect(res.body.levelCount).toBe(20);
      expect(res.body.seatCount).toBe(60);
      expect(res.body.levels.map((l: Json) => l.id)).toEqual(names.map((n) => carried.levels[n]));
      const more = [...levels, { name: 'Extra', color: 'brown' }];
      const refused = await update(carried.id, { levels: more, sections }).expect(400);
      expect(refused.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('reorders the levels of a layout by the order sent', async () => {
      const club = (await createLines(CLUB).expect(201)).body;
      const res = await update(club.id, {
        levels: [CLUB.levels[1], CLUB.levels[0]],
        sections: CLUB.sections,
      }).expect(200);
      expect(res.body.levels.map((l: Json) => [l.id, l.name, l.rank])).toEqual([
        [club.levels[1].id, 'Back', 1],
        [club.levels[0].id, 'Front', 2],
      ]);
    });
  });

  describe('locked layouts', () => {
    const rename = { name: 'Renamed' };
    const edit = {
      levels: CLUB.levels,
      sections: [...CLUB.sections, { name: 'Floor C', rows: 1, seatsPerRow: 5, level: 'Back' }],
    };

    async function expectLocked(layoutId: string, eventId: string) {
      for (const res of [
        await update(layoutId, rename),
        await update(layoutId, edit),
        await remove(layoutId),
      ]) {
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('LAYOUT_IN_USE');
        expect(res.body.error.details.events).toEqual([
          { id: eventId, name: 'Cardinals vs. Duke' },
        ]);
        expect(res.body.error.message).toContain('Cardinals vs. Duke');
      }
      const listed = (await asAdmin(ctx).get(`/locations/${venueId}/layouts`).expect(200)).body;
      expect(listed[0]).toMatchObject({ locked: true, eventsUsing: 1 });
      expect((await getLayout(layoutId).expect(200)).body.locked).toBe(true);
    }

    it('refuses rename, edit and delete while a scheduled event using it has a valid ticket', async () => {
      const { layoutId, refs, eventId } = await clubWithEvent();
      await sellSeats(ctx, eventId, refs, [
        { section: 'Floor A', row: 1, seat: 1, levelName: 'Front', price: '50.00' },
      ]);
      await expectLocked(layoutId, eventId);

      // Cancelled, its tickets are void: rename and edit go through; delete never does.
      await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);
      await update(layoutId, rename).expect(200);
      await update(layoutId, edit).expect(200);
      const res = await remove(layoutId).expect(409);
      expect(res.body.error.code).toBe('LAYOUT_IN_USE');
      expect(res.body.error.details.events).toEqual([{ id: eventId, name: 'Cardinals vs. Duke' }]);
      expect(await layoutCount()).toBe(1);
    });

    it('refuses rename, edit and delete while a scheduled event using it has a live hold', async () => {
      const { layoutId, refs, eventId } = await clubWithEvent();
      await holdSeats(ctx.prisma, {
        eventId,
        customerSub: subFor('customer1'),
        seats: [{ section: 'Floor A', row: 1, seat: 2, seatId: refs.seat('Floor A', 1, 2) }],
      });
      await expectLocked(layoutId, eventId);
    });

    it('duplicates a locked layout: always 201, "(copy)" then "(copy 2)", new ids, unlocked', async () => {
      const { layoutId, refs, eventId } = await clubWithEvent();
      await sellSeats(ctx, eventId, refs, [
        { section: 'Floor A', row: 1, seat: 1, levelName: 'Front', price: '50.00' },
      ]);
      const original = (await getLayout(layoutId).expect(200)).body;
      const copy = (await duplicate(layoutId).expect(201)).body;
      expect(copy).toMatchObject({
        name: 'Club room (copy)',
        source: 'LINES',
        seatCount: 400,
        sectionCount: 2,
        levelCount: 2,
        eventsUsing: 0,
        locked: false,
        latestPrices: null,
      });
      expect(copy.id).not.toBe(layoutId);
      const ids = (b: Json) => [
        ...b.levels.map((l: Json) => l.id),
        ...b.sections.map((s: Json) => s.id),
      ];
      expect(ids(copy).filter((id) => ids(original).includes(id))).toEqual([]);
      const strip = (b: Json) => ({
        levels: b.levels.map(({ id: _id, ...rest }: Json) => rest),
        sections: b.sections.map(({ id: _id, levelId: _l, levelIds: _ls, ...rest }: Json) => rest),
        size: b.size,
      });
      expect(strip(copy)).toEqual(strip(original));
      const seatsOf = async (b: Json, i: number) =>
        (await getSection(b.id, b.sections[i].id).expect(200)).body.rows.map((r: Json) =>
          r.seats.map((s: Json) => [r.label, s.label, s.at, s.accessible]),
        );
      expect(await seatsOf(copy, 1)).toEqual(await seatsOf(original, 1));

      const second = (await duplicate(layoutId).expect(201)).body;
      expect(second.name).toBe('Club room (copy 2)');
      const named = await duplicate(layoutId, { name: 'Playoffs' }).expect(201);
      expect(named.body.name).toBe('Playoffs');
      const taken = await duplicate(layoutId, { name: 'playoffs' }).expect(409);
      expect(taken.body.error.code).toBe('LAYOUT_NAME_TAKEN');

      // The copy can be changed while the original can't.
      await update(copy.id, { name: 'Club room (open)' }).expect(200);
      await remove(copy.id).expect(204);
    });

    it('duplicates an imported layout with its own levels on rows and seats', async () => {
      const file = (await importFile(SMALL).expect(201)).body;
      const copy = (await duplicate(file.id).expect(201)).body;
      expect(copy).toMatchObject({ name: 'Small court (copy)', source: 'FILE', seatCount: 61 });
      expect(copy.levels.map((l: Json) => l.seatCount)).toEqual([36, 25]);
      expect(copy.sections[1].labelAt).toEqual([100, 18]);
      const rowOf = (b: Json) =>
        getSection(b.id, b.sections[1].id)
          .expect(200)
          .then((r) => r.body.rows[1].seats.map((s: Json) => [s.label, s.accessible]));
      expect(await rowOf(copy)).toEqual(await rowOf(file));
      const front = copy.levels[0].id;
      const seats = (await getSection(copy.id, copy.sections[1].id).expect(200)).body;
      expect(seats.rows[1].seats[2].levelId).toBe(front);
    });

    it('refuses to delete a layout a scheduled event without sales uses', async () => {
      const { layoutId, eventId } = await clubWithEvent();
      const res = await remove(layoutId).expect(409);
      expect(res.body.error).toMatchObject({
        code: 'LAYOUT_IN_USE',
        details: { events: [{ id: eventId, name: 'Cardinals vs. Duke' }] },
      });
    });
  });

  describe('deleteVenueLayout', () => {
    it('deletes a layout no event uses, its levels, sections, rows and seats with it', async () => {
      const file = (await importFile(SMALL).expect(201)).body;
      await remove(file.id).expect(204);
      expect(await layoutCount()).toBe(0);
      expect(await ctx.prisma.priceLevel.count()).toBe(0);
      expect(await ctx.prisma.section.count()).toBe(0);
      expect(await ctx.prisma.seatRow.count()).toBe(0);
      expect(await ctx.prisma.seat.count()).toBe(0);
      await remove(file.id).expect(404);
    });

    it("refuses a delete that would lower the venue's capacity below a scheduled general-admission event's", async () => {
      const club = (await createLines(CLUB).expect(201)).body;
      await importFile(SMALL).expect(201);
      await event(ctx, venueId, { name: 'Big Night', capacity: 100 });
      const res = await remove(club.id).expect(409);
      expect(res.body.error.code).toBe('CAPACITY_EXCEEDED');
      expect(res.body.error.message).toContain('Big Night');
      expect(await layoutCount()).toBe(2);
      expect(await capacity()).toBe(400);
    });
  });

  describe("the venue's seating capacity", () => {
    it('is the largest layout, on create, import, edit, duplicate and delete, and kept after the last', async () => {
      const club = (await createLines(CLUB).expect(201)).body;
      expect(await capacity()).toBe(400);
      const file = (await importFile(SMALL).expect(201)).body;
      expect(await capacity()).toBe(400);
      await update(club.id, {
        levels: CLUB.levels,
        sections: [{ name: 'Floor A', rows: 5, seatsPerRow: 10, level: 'Front' }],
      }).expect(200);
      expect(await capacity()).toBe(61);
      const copy = (await duplicate(file.id).expect(201)).body;
      expect(await capacity()).toBe(61);
      await remove(file.id).expect(204);
      expect(await capacity()).toBe(61);
      await remove(copy.id).expect(204);
      expect(await capacity()).toBe(50);
      await remove(club.id).expect(204);
      expect(await capacity()).toBe(50);
      // With no layouts left, it can be typed again.
      await asAdmin(ctx).patch(`/locations/${venueId}`).send({ seatingCapacity: 900 }).expect(200);
    });

    it("refuses an edit that would drop it below a scheduled general-admission event's capacity", async () => {
      const club = (await createLines(CLUB).expect(201)).body;
      await event(ctx, venueId, { name: 'Big Night', capacity: 300 });
      const res = await update(club.id, {
        levels: CLUB.levels,
        sections: [{ name: 'Floor A', rows: 10, seatsPerRow: 20, level: 'Front' }],
      }).expect(409);
      expect(res.body.error.code).toBe('CAPACITY_EXCEEDED');
      expect(res.body.error.details.conflictingEvent).toMatchObject({ name: 'Big Night' });
      expect(await capacity()).toBe(400);
      expect((await getLayout(club.id).expect(200)).body.seatCount).toBe(400);
    });
  });

  describe('listVenueLayouts and getVenueLayout', () => {
    it('lists layouts by name ignoring case, with the scheduled events using each and whether it is locked', async () => {
      const lines = (name: string) => ({
        ...CLUB,
        name,
        sections: [{ name: 'A', rows: 1, seatsPerRow: 4, level: 'Front' }],
      });
      await createLines(lines('beta')).expect(201);
      const gamma = (await createLines(lines('Gamma')).expect(201)).body;
      await createLines(lines('Alpha')).expect(201);
      const refs = await layoutRefs(ctx, gamma.id);
      const sold = await event(ctx, venueId, { name: 'Sold', capacity: 4 });
      await seatEventOn(ctx, sold, refs, { Front: '10.00' });
      await sellSeats(ctx, sold, refs, [
        { section: 'A', row: 1, seat: 1, levelName: 'Front', price: '10.00' },
      ]);
      const cancelled = await event(ctx, venueId, { name: 'Off', capacity: 4 });
      await seatEventOn(ctx, cancelled, refs, { Front: '10.00' });
      await asAdmin(ctx).post(`/events/${cancelled}/cancel`).expect(200);

      const res = await asAdmin(ctx).get(`/locations/${venueId}/layouts`).expect(200);
      expect(res.body.map((l: Json) => [l.name, l.eventsUsing, l.locked, l.seatCount])).toEqual([
        ['Alpha', 0, false, 4],
        ['beta', 0, false, 4],
        ['Gamma', 1, true, 4],
      ]);
      const empty = await venue(ctx, 'Rupp Arena');
      expect((await asAdmin(ctx).get(`/locations/${empty}/layouts`).expect(200)).body).toEqual([]);
    });

    it('gives latestPrices from the most recently created scheduled event on it, else null (contract)', async () => {
      const { layoutId, refs, eventId } = await clubWithEvent();
      expect((await getLayout(layoutId).expect(200)).body.latestPrices).toMatchObject({
        eventId,
        eventName: 'Cardinals vs. Duke',
      });
      // Created later and starting sooner: its prices are the latest.
      const later = await event(ctx, venueId, { name: 'Exhibition', ...windowAt(30) });
      await seatEventOn(ctx, later, refs, { Front: '70.00', Back: '45.50' });
      // A cancelled event created last counts for nothing.
      const cancelled = await event(ctx, venueId, { name: 'Called off' });
      await seatEventOn(ctx, cancelled, refs, { Front: '1.00', Back: '1.00' });
      await asAdmin(ctx).post(`/events/${cancelled}/cancel`).expect(200);

      const body = (await getLayout(layoutId).expect(200)).body;
      expect(body.latestPrices).toEqual({
        eventId: later,
        eventName: 'Exhibition',
        startsAt: expect.any(String),
        prices: [
          { levelId: refs.levels.Front, price: '70.00' },
          { levelId: refs.levels.Back, price: '45.50' },
        ],
      });
      expect(body.eventsUsing).toBe(2);
    });
  });
});
