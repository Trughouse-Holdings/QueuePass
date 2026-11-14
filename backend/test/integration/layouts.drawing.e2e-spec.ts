import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { LAYOUT_LIMITS, LEVEL_COLORS, outlineAround, SIZE_MARGIN } from '@queuepass/shared';
import { centroid } from '../../src/layouts/layout-file';
import { asAdmin } from '../setup/authed-request';
import { event, holdSeats, layoutRefs, seatEventOn, sellSeats, venue } from '../setup/fixtures';
import { drawingToInput, NEW_DRAWING_SEATS, newDrawing } from '../setup/layout-drawing';
import { resetDb } from '../setup/reset-db';
import { createTestApp, TestContext } from '../setup/test-app';
import { subFor } from '../setup/tokens';

/**
 * Spec 039 FR-019–FR-024, research R3–R5, R8, R9, R16 (T005): the layout editor's whole-layout
 * read (`getLayoutDrawing`) and saves (`createLayoutDrawing`, `saveLayoutDrawing`), against real
 * PostgreSQL. Every response through `asAdmin` is checked against the contract.
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Pt = [number, number];
const SMALL = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/layouts/small.json'), 'utf8'),
) as Json;

describe('Layout drawings (039)', () => {
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
    venueId = await venue(ctx, 'Riverside Arena');
  });

  const read = (layoutId: string) => asAdmin(ctx).get(`/layouts/${layoutId}/drawing`);
  const save = (layoutId: string, body: Json) =>
    asAdmin(ctx).put(`/layouts/${layoutId}/drawing`).send(body);
  const create = (body: Json, at = venueId) =>
    asAdmin(ctx).post(`/locations/${at}/layouts/drawing`).send(body);
  const importFile = (file: Json, name?: string) =>
    asAdmin(ctx)
      .post(`/locations/${venueId}/layouts/import`)
      .send({ ...(name ? { name } : {}), file });
  const layoutCount = () => ctx.prisma.layout.count();
  const drawn = async (): Promise<Json> => (await create(newDrawing()).expect(201)).body;
  const drawing = async (layoutId: string): Promise<Json> =>
    (await read(layoutId).expect(200)).body;
  /** What the editor would send for a layout it just read, unchanged. */
  const roundTrip = async (layoutId: string): Promise<Json> =>
    drawingToInput((await drawing(layoutId)) as never) as Json;
  const problems = (res: request.Response): { path: string; message: string }[] =>
    res.body.error.details.problems;

  /** Nothing about the layouts changed: the same rows in every layout table. */
  const snapshot = async () => ({
    layouts: await ctx.prisma.layout.findMany({ orderBy: { id: 'asc' } }),
    levels: await ctx.prisma.priceLevel.findMany({ orderBy: { id: 'asc' } }),
    sections: await ctx.prisma.section.findMany({ orderBy: { id: 'asc' } }),
    rows: await ctx.prisma.seatRow.findMany({ orderBy: { id: 'asc' } }),
    seats: await ctx.prisma.seat.findMany({ orderBy: { id: 'asc' } }),
    prices: await ctx.prisma.eventLevelPrice.findMany({ orderBy: { levelId: 'asc' } }),
    offSale: await ctx.prisma.eventOffSaleSeat.findMany({ orderBy: { seatId: 'asc' } }),
  });

  /** `count` sections of `rows` rows of `seats` seats, as a drawing body, every place inside. */
  function grid(opts: {
    sections?: number;
    rows?: number;
    seats?: number;
    levels?: number;
    name?: string;
  }): Json {
    const levels = opts.levels ?? 1;
    return {
      name: opts.name ?? 'Grid',
      floor: { kind: 'NONE' },
      levels: Array.from({ length: levels }, (_, i) => ({
        key: `l${i + 1}`,
        name: `Level ${i + 1}`,
        color: LEVEL_COLORS[i % LEVEL_COLORS.length],
      })),
      sections: Array.from({ length: opts.sections ?? 1 }, (_, s) => {
        const x0 = 10 + (s % 10) * 480;
        const y0 = 10 + Math.floor(s / 10) * 480;
        return {
          name: `S${s + 1}`,
          level: 'l1',
          origin: [x0, y0],
          angle: 0,
          rows: Array.from({ length: opts.rows ?? 1 }, (_, r) => ({
            label: String(r + 1),
            seats: Array.from({ length: opts.seats ?? 1 }, (_, i) => ({
              label: String(i + 1),
              at: [x0 + 2 * i, y0 + 2 * r],
            })),
          })),
        };
      }),
    };
  }

  // ------------------------------------------------------------------------------------- read

  describe('getLayoutDrawing', () => {
    it('returns an imported layout seat by seat: ids, own levels, accessible, origin = label point, angle 0', async () => {
      const imported = (await importFile(SMALL).expect(201)).body;
      const d = await drawing(imported.id);
      expect(d).toMatchObject({
        id: imported.id,
        locationId: venueId,
        name: 'Small court',
        source: 'FILE',
        revision: 1,
        locked: false,
        lockedBy: [],
        floor: { kind: 'COURT', outline: SMALL.floor.outline },
        size: { width: 200, height: 120 },
      });
      const [front, back] = imported.levels.map((l: Json) => l.id);
      expect(d.levels).toEqual([
        { id: front, name: 'Front', rank: 1, color: 'violet' },
        { id: back, name: 'Back', rank: 2, color: 'teal' },
      ]);
      expect(d.sections.map((s: Json) => [s.id, s.name, s.levelId])).toEqual(
        imported.sections.map((s: Json) => [s.id, s.name, s.levelId]),
      );
      for (const [i, s] of d.sections.entries()) {
        expect(s.origin).toEqual(imported.sections[i].labelAt);
        expect(s.angle).toBe(0);
        expect(s.generator).toBeNull();
        expect(s.outline).toEqual(imported.sections[i].outline);
      }
      // Section A's row 3 has its own level; B's row 2 seat 1 is accessible and seat 3 has its own.
      const [a, b] = d.sections;
      expect(a.rows.map((r: Json) => r.levelId)).toEqual([undefined, undefined, back]);
      expect(b.rows[1].seats.map((s: Json) => [s.label, s.levelId, s.accessible])).toEqual([
        ['1', undefined, true],
        ['2', undefined, undefined],
        ['3', front, undefined],
        ['4', undefined, undefined],
        ['5', undefined, undefined],
      ]);
      // Every row and seat with its id, as stored.
      const seats = await ctx.prisma.seat.findMany({ where: { section: { layoutId: d.id } } });
      const sent = d.sections.flatMap((s: Json) =>
        s.rows.flatMap((r: Json) => r.seats.map((x: Json) => x.id)),
      );
      expect([...sent].sort()).toEqual(seats.map((s) => s.id).sort());
      expect(b.rows[0].seats.map((s: Json) => s.at)).toEqual(
        [76, 84, 92, 100, 108, 116, 124].map((x) => [x, 55]),
      );
    });

    it('says a layout is locked, and by which event, while an event on it has a valid ticket', async () => {
      const imported = (await importFile(SMALL).expect(201)).body;
      const refs = await layoutRefs(ctx, imported.id);
      const eventId = await event(ctx, venueId, { name: 'Cardinals vs. Duke', capacity: 10 });
      await seatEventOn(ctx, eventId, refs, { Front: '50.00', Back: '30.00' });
      await sellSeats(ctx, eventId, refs, [
        { section: 'A', row: 1, seat: 1, levelName: 'Front', price: '50.00' },
      ]);
      const d = await drawing(imported.id);
      expect(d.locked).toBe(true);
      expect(d.lockedBy).toEqual([{ id: eventId, name: 'Cardinals vs. Duke' }]);
    });

    it('404s an unknown layout', async () => {
      await read('00000000-0000-4000-8000-000000000000').expect(404);
    });
  });

  // ----------------------------------------------------------------------------------- create

  describe('createLayoutDrawing', () => {
    it('saves a new DRAWN layout: counts, outlines around the seats, names at their centroids, the size', async () => {
      const body = newDrawing();
      const res = await create(body).expect(201);
      expect(res.body).toMatchObject({
        locationId: venueId,
        name: 'Drawn',
        source: 'DRAWN',
        floorKind: 'COURT',
        floorOutline: body.floor.outline,
        seatCount: NEW_DRAWING_SEATS,
        sectionCount: 3,
        levelCount: 2,
        eventsUsing: 0,
        locked: false,
      });
      expect(res.body.levels.map((l: Json) => [l.name, l.rank, l.color])).toEqual([
        ['Front', 1, 'red'],
        ['Back', 2, 'teal'],
      ]);
      let maxX = 0;
      let maxY = 0;
      for (const [i, s] of res.body.sections.entries()) {
        const rows = body.sections[i].rows.map((r) => r.seats.map((x) => x.at as Pt));
        const want = outlineAround(rows);
        expect(s.outline).toHaveLength(want.length);
        s.outline.forEach((p: Pt, j: number) => {
          expect(p[0]).toBeCloseTo(want[j][0], 6);
          expect(p[1]).toBeCloseTo(want[j][1], 6);
        });
        const c = centroid(want);
        expect(s.labelAt[0]).toBeCloseTo(c[0], 3);
        expect(s.labelAt[1]).toBeCloseTo(c[1], 3);
        for (const p of [...rows.flat(), ...want]) {
          maxX = Math.max(maxX, p[0]);
          maxY = Math.max(maxY, p[1]);
        }
      }
      for (const p of body.floor.outline as Pt[]) {
        maxX = Math.max(maxX, p[0]);
        maxY = Math.max(maxY, p[1]);
      }
      expect(res.body.size).toEqual({
        width: Math.ceil(maxX + SIZE_MARGIN),
        height: Math.ceil(maxY + SIZE_MARGIN),
      });
      expect(await ctx.prisma.location.findUniqueOrThrow({ where: { id: venueId } })).toMatchObject(
        { seatingCapacity: NEW_DRAWING_SEATS },
      );
    });

    it('numbers rows and seats by order, keeps own levels, accessible marks, origin, angle and generator', async () => {
      const body = newDrawing();
      body.sections[0].angle = 30;
      body.sections[0].generator = {
        rows: 3,
        seatsPerRow: [4],
        rowLabels: 'LETTERS',
        firstRow: 'A',
        firstSeat: 1,
        direction: 'LEFT_TO_RIGHT',
        curve: 0,
      };
      // Labels need not follow numbers: row 1 is "C" here, and seats run 4, 3, 2, 1.
      body.sections[0].rows = [...body.sections[0].rows].reverse();
      body.sections[0].rows[0].seats = body.sections[0].rows[0].seats.map((s, i, all) => ({
        ...s,
        label: String(all.length - i),
      }));
      const created = (await create(body).expect(201)).body;
      const d = await drawing(created.id);
      const [front, back] = d.levels.map((l: Json) => l.id);
      const s101 = d.sections[0];
      expect(s101).toMatchObject({ name: '101', levelId: back, origin: [50, 60], angle: 30 });
      expect(s101.generator).toEqual(body.sections[0].generator);
      expect(s101.rows.map((r: Json) => [r.label, r.levelId])).toEqual([
        ['C', undefined],
        ['B', undefined],
        ['A', front],
      ]);
      expect(s101.rows[0].seats.map((s: Json) => s.label)).toEqual(['4', '3', '2', '1']);
      const rows = await ctx.prisma.seatRow.findMany({
        where: { sectionId: s101.id },
        orderBy: { number: 'asc' },
        include: { seats: { orderBy: { number: 'asc' } } },
      });
      expect(rows.map((r) => [r.number, r.label])).toEqual([
        [1, 'C'],
        [2, 'B'],
        [3, 'A'],
      ]);
      expect(rows[0].seats.map((s) => [s.number, s.label])).toEqual([
        [1, '4'],
        [2, '3'],
        [3, '2'],
        [4, '1'],
      ]);
      expect(d.sections[1].rows[2].seats[2].levelId).toBe(back);
      expect(d.sections[2].rows[0].seats.map((s: Json) => s.accessible === true)).toEqual([
        true,
        false,
        false,
        false,
        false,
      ]);
      expect(d).toMatchObject({ source: 'DRAWN', revision: 1 });
    });

    it('ignores ids and revision in the body', async () => {
      const body: Json = newDrawing();
      const fake = randomUUID();
      body.revision = 7;
      body.levels[0].id = fake;
      body.sections[0].id = randomUUID();
      body.sections[0].rows[0].id = randomUUID();
      body.sections[0].rows[0].seats[0].id = randomUUID();
      const created = (await create(body).expect(201)).body;
      const d = await drawing(created.id);
      expect(d.revision).toBe(1);
      expect(d.levels[0].id).not.toBe(fake);
      expect(d.sections[0].id).not.toBe(body.sections[0].id);
    });

    it('refuses a name another layout of the venue has, ignoring case (409 LAYOUT_NAME_TAKEN)', async () => {
      await drawn();
      const body = newDrawing();
      body.name = 'DRAWN';
      const res = await create(body).expect(409);
      expect(res.body.error.code).toBe('LAYOUT_NAME_TAKEN');
      expect(await layoutCount()).toBe(1);
    });

    it('404s an unknown venue', async () => {
      await create(newDrawing(), '00000000-0000-4000-8000-000000000000').expect(404);
    });
  });

  // ----------------------------------------------------------------------------------- limits

  describe('limits, on both sides', () => {
    const refused = async (body: Json, path: string, message?: string) => {
      const res = await create(body).expect(400);
      expect(res.body.error.code).toBe('LAYOUT_FILE_INVALID');
      expect(problems(res).map((p) => p.path)).toContain(path);
      if (message) expect(problems(res)).toContainEqual({ path, message });
      expect(await layoutCount()).toBe(0);
    };

    it('100 sections, 100 rows, 200 seats a row, 12 levels, a 50-character name, a 5-character label', async () => {
      await create(grid({ name: 'Sections', sections: 100 })).expect(201);
      await create(grid({ name: 'Rows', rows: 100 })).expect(201);
      await create(grid({ name: 'Seats', seats: 200 })).expect(201);
      await create(grid({ name: 'Levels', levels: 12 })).expect(201);
      const long = grid({ name: 'N'.repeat(50) });
      long.sections[0].rows[0].label = 'ABCDE';
      long.sections[0].rows[0].seats[0].label = '12345';
      await create(long).expect(201);
    }, 60_000);

    it('refuses 101 sections, 101 rows, 201 seats a row, 13 levels, a 51-character name, a 6-character label', async () => {
      await refused(grid({ sections: 101 }), 'sections', '101 sections; a layout has at most 100');
      await refused(grid({ rows: 101 }), 'sections[0].rows');
      await refused(grid({ seats: 201 }), 'sections[0].rows[0].seats');
      await refused(grid({ levels: 13 }), 'levels');
      await refused(grid({ name: 'N'.repeat(51) }), 'name');
      const row = grid({});
      row.sections[0].rows[0].label = 'ABCDEF';
      await refused(row, 'sections[0].rows[0].label');
      const seat = grid({});
      seat.sections[0].rows[0].seats[0].label = '123456';
      await refused(seat, 'sections[0].rows[0].seats[0].label');
    });

    it('takes 30,000 seats and refuses 30,001', async () => {
      const full = grid({ name: 'Full', sections: 100, rows: 2, seats: 150 });
      const res = await create(full).expect(201);
      expect(res.body.seatCount).toBe(LAYOUT_LIMITS.maxSeats);
      const over = grid({ name: 'Over', sections: 100, rows: 2, seats: 150 });
      over.sections[99].rows[1].seats.push({
        label: '151',
        at: [10 + 9 * 480 + 300, 10 + 9 * 480 + 2],
      });
      const refusal = await create(over).expect(400);
      expect(problems(refusal)).toEqual([
        { path: 'sections', message: '30,001 seats; a layout has at most 30,000' },
      ]);
      expect(await layoutCount()).toBe(1);
    }, 60_000);
  });

  // --------------------------------------------------------------------------------- problems

  describe('problems', () => {
    it('lists every problem with where it is: names, labels, keys, places, control characters', async () => {
      const body: Json = newDrawing();
      body.sections[2].name = '101 ';
      body.sections[0].rows[1].label = 'A';
      body.sections[0].rows[2].seats[1].label = '1';
      body.sections[1].level = 'nope';
      body.sections[1].rows[0].seats[0].at = [-0.1, 50];
      body.sections[1].rows[0].seats[1].at = [50, 5000.1];
      body.levels[1].name = 'A\u0001';
      const res = await create(body).expect(400);
      expect(res.body.error.code).toBe('LAYOUT_FILE_INVALID');
      expect(problems(res)).toEqual(
        expect.arrayContaining([
          { path: 'sections[2].name', message: 'Section 101 appears twice' },
          { path: 'sections[0].rows[1].label', message: 'Section 101, row A appears twice' },
          {
            path: 'sections[0].rows[2].seats[1].label',
            message: 'Section 101, row C: seat 1 appears twice',
          },
          { path: 'sections[1].level', message: 'Section 102: level "nope" is not in the layout' },
          {
            path: 'sections[1].rows[0].seats[0].at',
            message: 'Section 102, row A: seat 1 (-0.1, 50) is outside the map (0 to 5,000)',
          },
          {
            path: 'sections[1].rows[0].seats[1].at',
            message: 'Section 102, row A: seat 2 (50, 5000.1) is outside the map (0 to 5,000)',
          },
          {
            path: 'levels[1].name',
            message: 'Level "b": the name has a control character',
          },
        ]),
      );
      expect(await layoutCount()).toBe(0);
    });

    it('keeps the first 50 problems and counts the rest', async () => {
      const body = grid({ seats: 60 });
      for (const s of body.sections[0].rows[0].seats) s.label = 'x';
      const res = await create(body).expect(400);
      expect(problems(res)).toHaveLength(50);
      expect(res.body.error.details.more).toBe(9);
    });

    it('refuses an unknown field anywhere, a bad generator and a floor without an outline', async () => {
      const body: Json = newDrawing();
      body.sections[0].rows[0].seats[0].colour = 'red';
      body.sections[0].generator = { rows: 0 };
      body.floor = { kind: 'RING' };
      const res = await create(body).expect(400);
      expect(problems(res).map((p) => p.path)).toEqual(
        expect.arrayContaining([
          'sections[0].rows[0].seats[0].colour',
          'sections[0].generator',
          'floor.outline',
        ]),
      );
      const top = await create({ ...newDrawing(), extra: 1 }).expect(400);
      expect(top.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses a layout with no section or no level', async () => {
      const none = { ...newDrawing(), sections: [] };
      const res = await create(none).expect(400);
      expect(problems(res).map((p) => p.path)).toContain('sections');
      const noLevels = { ...newDrawing(), levels: [] };
      expect(problems(await create(noLevels).expect(400)).map((p) => p.path)).toContain('levels');
    });
  });

  // ------------------------------------------------------------------------- save keeps by id

  describe('saveLayoutDrawing keeps by id (R4)', () => {
    const ids = (d: Json) => ({
      levels: d.levels.map((l: Json) => l.id),
      sections: d.sections.map((s: Json) => s.id),
      rows: d.sections.flatMap((s: Json) => s.rows.map((r: Json) => r.id)),
      seats: d.sections.flatMap((s: Json) =>
        s.rows.flatMap((r: Json) => r.seats.map((x: Json) => x.id)),
      ),
    });

    it('keeps every id across a move, a turn, a relabel, a repaint and a level rename', async () => {
      const layout = await drawn();
      const before = await drawing(layout.id);
      const body = drawingToInput(before as never) as Json;
      const s101 = body.sections[0];
      s101.origin = [s101.origin[0] + 10, s101.origin[1] + 5];
      s101.angle = 15;
      for (const r of s101.rows) {
        for (const seat of r.seats) seat.at = [seat.at[0] + 10, seat.at[1] + 5];
      }
      s101.rows[1].label = 'BB';
      const back = before.levels[1].id;
      s101.rows[0].seats[0].level = back;
      body.levels[0].name = 'Courtside';
      const res = await save(layout.id, body).expect(200);
      expect(res.body.revision).toBeUndefined();
      const after = await drawing(layout.id);
      expect(ids(after)).toEqual(ids(before));
      expect(after.revision).toBe(2);
      expect(after.levels[0].name).toBe('Courtside');
      expect(after.sections[0]).toMatchObject({ origin: [60, 65], angle: 15 });
      expect(after.sections[0].rows[1].label).toBe('BB');
      expect(after.sections[0].rows[0].seats[0].levelId).toBe(back);
      expect(after.sections[0].rows[0].seats[0].at).toEqual([57, 65]);
    });

    it('commits two rows exchanging labels, two levels exchanging ranks and names, and two sections exchanging names, each in one save', async () => {
      const layout = await drawn();
      let body = await roundTrip(layout.id);
      const [a, b] = body.sections[0].rows;
      [a.label, b.label] = [b.label, a.label];
      await save(layout.id, body).expect(200);
      let d = await drawing(layout.id);
      expect(d.sections[0].rows.map((r: Json) => r.label)).toEqual(['B', 'A', 'C']);

      body = await roundTrip(layout.id);
      body.levels = [body.levels[1], body.levels[0]];
      [body.levels[0].name, body.levels[1].name] = [body.levels[1].name, body.levels[0].name];
      const levelIds = body.levels.map((l: Json) => l.id);
      await save(layout.id, body).expect(200);
      d = await drawing(layout.id);
      expect(d.levels.map((l: Json) => [l.id, l.rank, l.name])).toEqual([
        [levelIds[0], 1, 'Front'],
        [levelIds[1], 2, 'Back'],
      ]);

      body = await roundTrip(layout.id);
      [body.sections[0].name, body.sections[1].name] = [
        body.sections[1].name,
        body.sections[0].name,
      ];
      // And the two seats of a row exchanging labels and order, and two sections their order.
      const row = body.sections[2].rows[0];
      [row.seats[0], row.seats[1]] = [row.seats[1], row.seats[0]];
      [row.seats[0].label, row.seats[1].label] = [row.seats[1].label, row.seats[0].label];
      body.sections = [body.sections[1], body.sections[0], body.sections[2]];
      await save(layout.id, body).expect(200);
      d = await drawing(layout.id);
      expect(d.sections.map((s: Json) => s.name)).toEqual(['101', '102', '103']);
      expect(d.revision).toBe(4);
    });

    it('deletes what is not sent, makes what has no id, numbers by order', async () => {
      const layout = await drawn();
      const before = await drawing(layout.id);
      const body = await roundTrip(layout.id);
      const gone = body.sections[0].rows[0].seats.shift();
      body.sections[0].rows[0].seats.push({ label: '9', at: [70, 60] });
      body.sections.splice(2, 1);
      body.sections.push({
        name: '104',
        level: body.levels[0].key,
        origin: [30, 150],
        angle: 0,
        rows: [{ label: 'A', seats: [{ label: '1', at: [30, 150] }] }],
      });
      const res = await save(layout.id, body).expect(200);
      expect(res.body.seatCount).toBe(NEW_DRAWING_SEATS - 5 + 1);
      expect(await ctx.prisma.seat.findUnique({ where: { id: gone.id } })).toBeNull();
      expect(
        await ctx.prisma.section.findUnique({ where: { id: before.sections[2].id } }),
      ).toBeNull();
      const row = await ctx.prisma.seatRow.findUniqueOrThrow({
        where: { id: before.sections[0].rows[0].id },
        include: { seats: { orderBy: { number: 'asc' } } },
      });
      expect(row.seats.map((s) => [s.number, s.label])).toEqual([
        [1, '2'],
        [2, '3'],
        [3, '4'],
        [4, '9'],
      ]);
      expect(row.seats[3].id).not.toBe(gone.id);
    });

    it('refuses an id of another layout, a row under another section and a seat under another row', async () => {
      const layout = await drawn();
      const other = await drawing(
        (await create({ ...newDrawing(), name: 'Other' }).expect(201)).body.id,
      );
      const before = await snapshot();
      const body = await roundTrip(layout.id);
      body.sections[0].id = other.sections[0].id;
      body.sections[1].rows[0].id = body.sections[2].rows[0].id;
      body.sections[1].rows[1].seats[0].id = body.sections[1].rows[2].seats[0].id;
      body.levels[0].id = other.levels[0].id;
      const res = await save(layout.id, body).expect(400);
      expect(res.body.error.code).toBe('LAYOUT_FILE_INVALID');
      expect(problems(res).map((p) => p.path)).toEqual(
        expect.arrayContaining([
          'levels[0].id',
          'sections[0].id',
          'sections[1].rows[0].id',
          'sections[1].rows[1].seats[0].id',
        ]),
      );
      expect(await snapshot()).toEqual(before);
    });

    it('refuses an id sent twice', async () => {
      const layout = await drawn();
      const body = await roundTrip(layout.id);
      body.sections[0].rows[0].seats[1].id = body.sections[0].rows[0].seats[0].id;
      const res = await save(layout.id, body).expect(400);
      expect(problems(res).map((p) => p.path)).toContain('sections[0].rows[0].seats[1].id');
    });
  });

  // ------------------------------------------------------------------- revision and source

  describe('revision and source (R4, R9)', () => {
    it('raises the revision by one; refuses the old one with 409 LAYOUT_CHANGED and saves nothing', async () => {
      const layout = await drawn();
      const body = await roundTrip(layout.id);
      await save(layout.id, body).expect(200);
      expect((await drawing(layout.id)).revision).toBe(2);
      const before = await snapshot();
      body.name = 'Stale';
      const res = await save(layout.id, body).expect(409);
      expect(res.body.error.code).toBe('LAYOUT_CHANGED');
      expect(res.body.error.details).toEqual({ revision: 2 });
      expect(res.body.error.message).toBe(
        'Drawn was changed since you opened it; nothing was saved.',
      );
      expect(await snapshot()).toEqual(before);
    });

    it('refuses a save without a revision (400)', async () => {
      const layout = await drawn();
      const body = await roundTrip(layout.id);
      delete body.revision;
      await save(layout.id, body).expect(400);
    });

    it('makes a LINES layout DRAWN and keeps a FILE layout FILE', async () => {
      const lines = (
        await asAdmin(ctx)
          .post(`/locations/${venueId}/layouts`)
          .send({
            name: 'Club room',
            levels: [{ name: 'Front', color: 'violet' }],
            sections: [{ name: 'A', rows: 2, seatsPerRow: 3, level: 'Front' }],
          })
          .expect(201)
      ).body;
      expect(lines.source).toBe('LINES');
      const saved = await save(lines.id, await roundTrip(lines.id)).expect(200);
      expect(saved.body.source).toBe('DRAWN');
      // Section lines no longer apply.
      const refusedLines = await asAdmin(ctx)
        .put(`/layouts/${lines.id}`)
        .send({
          levels: [{ name: 'Front', color: 'violet' }],
          sections: [{ name: 'A', rows: 2, seatsPerRow: 3, level: 'Front' }],
        })
        .expect(400);
      expect(refusedLines.body.error.code).toBe('VALIDATION_FAILED');

      const file = (await importFile(SMALL).expect(201)).body;
      const kept = await save(file.id, await roundTrip(file.id)).expect(200);
      expect(kept.body.source).toBe('FILE');
    });

    it('raises the revision on a rename by updateVenueLayout', async () => {
      const layout = await drawn();
      await asAdmin(ctx).put(`/layouts/${layout.id}`).send({ name: 'Renamed' }).expect(200);
      expect((await drawing(layout.id)).revision).toBe(2);
    });

    it('starts a duplicate at revision 1, keeping origin, angle and generator', async () => {
      const body = newDrawing();
      body.sections[0].angle = -45;
      body.sections[0].generator = {
        rows: 3,
        seatsPerRow: [4],
        rowLabels: 'LETTERS',
        firstRow: 'A',
        firstSeat: 1,
        direction: 'RIGHT_TO_LEFT',
        curve: 10,
      };
      const layout = (await create(body).expect(201)).body;
      await asAdmin(ctx).put(`/layouts/${layout.id}`).send({ name: 'Renamed' }).expect(200);
      const copy = (await asAdmin(ctx).post(`/layouts/${layout.id}/duplicate`).expect(201)).body;
      const d = await drawing(copy.id);
      expect(d.revision).toBe(1);
      expect(d.source).toBe('DRAWN');
      expect(d.sections[0]).toMatchObject({ origin: [50, 60], angle: -45 });
      expect(d.sections[0].generator).toEqual(body.sections[0].generator);
    });
  });

  // ----------------------------------------------------------------------------------- locks

  describe('locked layouts (038 FR-006)', () => {
    async function withEvent() {
      const layout = await drawn();
      const refs = await layoutRefs(ctx, layout.id);
      const eventId = await event(ctx, venueId, { name: 'Cardinals vs. Duke', capacity: 10 });
      await seatEventOn(ctx, eventId, refs, { Front: '50.00', Back: '30.00' });
      return { layout, refs, eventId };
    }

    it('refuses a save while an event on it has a valid ticket, naming the event', async () => {
      const { layout, refs, eventId } = await withEvent();
      const body = await roundTrip(layout.id);
      await sellSeats(ctx, eventId, refs, [
        { section: '101', row: 1, seat: 1, levelName: 'Front', price: '50.00' },
      ]);
      const before = await snapshot();
      const res = await save(layout.id, body).expect(409);
      expect(res.body.error.code).toBe('LAYOUT_IN_USE');
      expect(res.body.error.details.events).toEqual([{ id: eventId, name: 'Cardinals vs. Duke' }]);
      expect(await snapshot()).toEqual(before);
    });

    it('refuses a save while an event on it has a live hold', async () => {
      const { layout, refs, eventId } = await withEvent();
      await holdSeats(ctx.prisma, {
        eventId,
        customerSub: subFor('customer1'),
        seats: [{ section: '101', row: 1, seat: 2, seatId: refs.seat('101', 1, 2) }],
      });
      const res = await save(layout.id, await roundTrip(layout.id)).expect(409);
      expect(res.body.error.code).toBe('LAYOUT_IN_USE');
    });

    it("is not locked by a cancelled event's void ticket", async () => {
      const { layout, refs, eventId } = await withEvent();
      await sellSeats(ctx, eventId, refs, [
        { section: '101', row: 1, seat: 1, levelName: 'Front', price: '50.00' },
      ]);
      await asAdmin(ctx).post(`/events/${eventId}/cancel`).expect(200);
      const body = await roundTrip(layout.id);
      body.sections[0].rows[0].seats.shift();
      await save(layout.id, body).expect(200);
      const ticket = await ctx.prisma.ticket.findFirstOrThrow({ where: { eventId } });
      expect(ticket).toMatchObject({ status: 'VOID', seatId: null, seatSection: '101' });
    });
  });

  // -------------------------------------------------------------------- events on the layout

  describe('events on the layout (FR-021, FR-022)', () => {
    async function priced(opts: { max?: number } = {}) {
      const layout = await drawn();
      const refs = await layoutRefs(ctx, layout.id);
      const eventId = await event(ctx, venueId, {
        name: 'Cardinals vs. Duke',
        capacity: 20,
        ...(opts.max !== undefined ? { maxTicketsPerCustomer: opts.max } : {}),
      });
      const offSeat = refs.seat('102', 1, 1);
      await seatEventOn(ctx, eventId, refs, { Front: '50.00', Back: '30.00' }, [offSeat]);
      return { layout, refs, eventId, offSeat };
    }
    const eventRow = (id: string) => ctx.prisma.event.findUniqueOrThrow({ where: { id } });

    it('keeps prices and off-sale seats across a move and a relabel; a new seat goes off sale; capacity and base price follow', async () => {
      const { layout, eventId, offSeat } = await priced();
      const body = await roundTrip(layout.id);
      body.sections[1].origin = [150, 125];
      for (const r of body.sections[1].rows) {
        r.label = `${r.label}1`;
        for (const s of r.seats) s.at = [s.at[0] + 10, s.at[1] + 5];
      }
      body.sections[0].rows[0].seats.push({ label: '5', at: [60, 60] });
      await save(layout.id, body).expect(200);
      expect(await ctx.prisma.eventLevelPrice.count({ where: { eventId } })).toBe(2);
      const off = await ctx.prisma.eventOffSaleSeat.findMany({ where: { eventId } });
      const newSeat = await ctx.prisma.seat.findFirstOrThrow({
        where: { label: '5', row: { label: 'A', section: { name: '101' } } },
      });
      expect(off.map((o) => o.seatId).sort()).toEqual([offSeat, newSeat.id].sort());
      const e = await eventRow(eventId);
      expect(e.totalTicketCapacity).toBe(NEW_DRAWING_SEATS + 1 - 2);
      expect(e.basePrice.toFixed(2)).toBe('30.00');
    });

    it('deletes the off-sale entry with its seat, and a price with its level', async () => {
      const { layout, eventId } = await priced();
      const body = await roundTrip(layout.id);
      body.sections[1].rows[0].seats.shift();
      // Back's seats move to Front, and Back goes.
      const [front, back] = body.levels;
      for (const s of body.sections) {
        if (s.level === back.key) s.level = front.key;
        for (const r of s.rows) {
          delete r.level;
          for (const seat of r.seats) delete seat.level;
        }
      }
      body.levels = [front];
      await save(layout.id, body).expect(200);
      expect(await ctx.prisma.eventOffSaleSeat.count({ where: { eventId } })).toBe(0);
      expect(
        (await ctx.prisma.eventLevelPrice.findMany({ where: { eventId } })).map((p) =>
          p.price.toFixed(2),
        ),
      ).toEqual(['50.00']);
      const e = await eventRow(eventId);
      expect(e.totalTicketCapacity).toBe(NEW_DRAWING_SEATS - 1);
      expect(e.basePrice.toFixed(2)).toBe('50.00');
    });

    it('refuses, naming the event and why, a new level with no price, no seat on sale, or a limit above the seats on sale', async () => {
      const { layout, eventId, offSeat } = await priced({ max: 20 });
      const before = await snapshot();

      const unpriced = await roundTrip(layout.id);
      unpriced.levels.push({ key: 'upper', name: 'Upper', color: 'green' });
      unpriced.sections[0].level = 'upper';
      for (const r of unpriced.sections[0].rows) delete r.level;
      let res = await save(layout.id, unpriced).expect(409);
      expect(res.body.error.code).toBe('LAYOUT_IN_USE');
      expect(res.body.error.details.events).toEqual([{ id: eventId, name: 'Cardinals vs. Duke' }]);
      expect(res.body.error.message).toContain('"Cardinals vs. Duke"');
      expect(res.body.error.message).toContain('no price for Upper');

      const none = await roundTrip(layout.id);
      const keep = none.sections[1];
      keep.rows = [
        { ...keep.rows[0], seats: keep.rows[0].seats.filter((s: Json) => s.id === offSeat) },
      ];
      none.sections = [keep];
      res = await save(layout.id, none).expect(409);
      expect(res.body.error.message).toContain('no seat on sale');

      const few = await roundTrip(layout.id);
      few.sections = [few.sections[2]];
      res = await save(layout.id, few).expect(409);
      expect(res.body.error.message).toContain('limit of 20 tickets per customer');

      expect(await snapshot()).toEqual(before);
    });

    it("ends the event's seat stream after the commit (viewers reload)", async () => {
      const { layout, eventId } = await priced();
      const ended: string[] = [];
      const seatEvents = ctx.app.get(
        (await import('../../src/seating/seat-events.service')).SeatEventsService,
      );
      const spy = jest.spyOn(seatEvents, 'end').mockImplementation((id: string) => {
        ended.push(id);
      });
      try {
        await save(layout.id, await roundTrip(layout.id)).expect(200);
      } finally {
        spy.mockRestore();
      }
      expect(ended).toEqual([eventId]);
    });
  });

  // -------------------------------------------------------------------------------- capacity

  it("refuses a save that lowers the venue's largest layout below a scheduled general-admission event's capacity", async () => {
    const layout = await drawn();
    await event(ctx, venueId, { name: 'Big Night', capacity: 30 });
    const body = await roundTrip(layout.id);
    body.sections = [body.sections[0]];
    const res = await save(layout.id, body).expect(409);
    expect(res.body.error.code).toBe('CAPACITY_EXCEEDED');
    expect(res.body.error.details.conflictingEvent).toMatchObject({ name: 'Big Night' });
  });

  // ------------------------------------------------------------------------------- body size

  it('takes a body just under 4 MB on both write routes, refuses one over it, and keeps the default elsewhere', async () => {
    const server = ctx.app.getHttpServer();
    const padded = (body: Json, bytes: number): string => {
      const text = JSON.stringify(body);
      return text + ' '.repeat(bytes - Buffer.byteLength(text));
    };
    const under = Math.round(3.9 * 1024 * 1024);
    const over = Math.round(4.1 * 1024 * 1024);

    const created = await asAdmin(ctx)
      .post(`/locations/${venueId}/layouts/drawing`)
      .set('Content-Type', 'application/json')
      .send(padded(newDrawing(), under))
      .expect(201);
    const body = await roundTrip(created.body.id);
    await asAdmin(ctx)
      .put(`/layouts/${created.body.id}/drawing`)
      .set('Content-Type', 'application/json')
      .send(padded(body, under))
      .expect(200);

    for (const [method, url] of [
      ['post', `/locations/${venueId}/layouts/drawing`],
      ['put', `/layouts/${created.body.id}/drawing`],
    ] as const) {
      const client = request(server);
      const res = await (method === 'post' ? client.post(url) : client.put(url))
        .set('Authorization', `Bearer ${ctx.adminToken}`)
        .set('Content-Type', 'application/json')
        .send(padded({ ...body, name: 'Too big' }, over));
      expect(res.status).toBe(413);
    }
    const elsewhere = await request(server)
      .put(`/layouts/${created.body.id}`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .set('Content-Type', 'application/json')
      .send(padded({ name: 'Renamed' }, 200 * 1024));
    expect(elsewhere.status).toBe(413);
    expect(await layoutCount()).toBe(1);
  }, 30_000);
});
