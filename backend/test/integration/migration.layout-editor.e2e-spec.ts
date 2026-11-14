import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

/**
 * Spec 039 data-model.md, research R6, R8, R9 (T003): on a database migrated up to the migration
 * before `layout_editor`, a venue with an imported layout of two sections and a carried-over
 * "Standard" layout, inserted with SQL; then the migration. Every layout starts at revision 1;
 * every section's origin is its label point, its angle 0, no generator; `DRAWN` is a layout
 * source; the six per-row unique keys are deferrable constraints, checked at once unless deferred;
 * the new CHECKs refuse what they must.
 */
const PRISMA_DIR = path.resolve(__dirname, '../../prisma');
const NEW_MIGRATION = readdirSync(path.join(PRISMA_DIR, 'migrations')).find((d) =>
  d.endsWith('_layout_editor'),
);

function deploy(schemaDir: string, url: string): void {
  execFileSync(
    'npx',
    ['prisma', 'migrate', 'deploy', '--schema', path.join(schemaDir, 'schema.prisma')],
    {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      shell: process.platform === 'win32',
    },
  );
}

const id = () => randomUUID();

describe('migration layout_editor (039)', () => {
  const dbName = `migration_layout_editor_${randomUUID().slice(0, 8)}`;
  const admin = new PrismaClient();
  let url: string;
  let db: PrismaClient;
  let work: string;

  const venueId = id();
  const imported = { layout: id(), level: id(), left: id(), right: id() };
  const standard = { layout: id(), level: id(), section: id() };
  const rows = { a: id(), b: id() };

  const sql = (text: string) => db.$executeRawUnsafe(text);
  type Row = Record<string, unknown>;
  const query = <T = Row>(text: string) => db.$queryRawUnsafe<T[]>(text);

  beforeAll(async () => {
    expect(NEW_MIGRATION).toBeDefined();
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    const base = new URL(process.env.DATABASE_URL as string);
    base.pathname = `/${dbName}`;
    url = base.toString();

    // A copy of prisma/ with every migration before layout_editor and none from it on.
    work = mkdtempSync(path.join(tmpdir(), 'qp-migration-'));
    const migrations = path.join(PRISMA_DIR, 'migrations');
    cpSync(PRISMA_DIR, work, {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(migrations, src);
        if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return true;
        const dir = rel.split(path.sep)[0];
        return dir === 'migration_lock.toml' || dir < (NEW_MIGRATION as string);
      },
    });
    deploy(work, url);
    db = new PrismaClient({ datasourceUrl: url });

    await sql(`
      INSERT INTO "Location" ("id", "name", "address", "seatingCapacity", "timeZone",
                              "timeZoneSource", "updatedAt")
      VALUES ('${venueId}', 'Arena', '1 Main St', 4, 'America/New_York', 'DEFAULT', now())`);
    await sql(`
      INSERT INTO "Layout" ("id", "locationId", "name", "source", "floorKind", "floorOutline",
                            "width", "height", "seatCount", "updatedAt")
      VALUES ('${imported.layout}', '${venueId}', 'Imported', 'FILE', 'NONE', NULL, 200, 120, 4, now()),
             ('${standard.layout}', '${venueId}', 'Standard', 'LINES', 'NONE', NULL, 20, 20, 2, now())`);
    await sql(`
      INSERT INTO "PriceLevel" ("id", "layoutId", "name", "rank", "color")
      VALUES ('${imported.level}', '${imported.layout}', 'Front', 1, 'violet'),
             ('${standard.level}', '${standard.layout}', 'Main', 1, 'blue')`);
    const box = (x: number) => `'[[${x - 20},40],[${x + 20},40],[${x + 20},80],[${x - 20},80]]'`;
    await sql(`
      INSERT INTO "Section" ("id", "layoutId", "name", "levelId", "outline", "labelX", "labelY",
                             "position", "updatedAt")
      VALUES ('${imported.left}', '${imported.layout}', 'Left', '${imported.level}', ${box(50)}, 50, 60, 0, now()),
             ('${imported.right}', '${imported.layout}', 'Right', '${imported.level}', ${box(150)}, 150, 60, 1, now()),
             ('${standard.section}', '${standard.layout}', 'Main', '${standard.level}',
              '[[0,0],[10,0],[10,10],[0,10]]', 5, 5, 0, now())`);
    await sql(`
      INSERT INTO "SeatRow" ("id", "sectionId", "number", "label")
      VALUES ('${rows.a}', '${imported.left}', 1, 'A'), ('${rows.b}', '${imported.left}', 2, 'B')`);
    await sql(`
      INSERT INTO "Seat" ("id", "rowId", "sectionId", "number", "label", "x", "y")
      VALUES ('${id()}', '${rows.a}', '${imported.left}', 1, '1', 45, 50),
             ('${id()}', '${rows.a}', '${imported.left}', 2, '2', 55, 50),
             ('${id()}', '${rows.b}', '${imported.left}', 1, '1', 45, 70),
             ('${id()}', '${rows.b}', '${imported.left}', 2, '2', 55, 70)`);

    deploy(PRISMA_DIR, url);
  }, 300_000);

  afterAll(async () => {
    await db?.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.$disconnect();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('starts every layout at revision 1', async () => {
    const layouts = await query<{ revision: number }>(`SELECT "revision" FROM "Layout"`);
    expect(layouts).toHaveLength(2);
    expect(layouts.every((l) => l.revision === 1)).toBe(true);
  });

  it('gives every section its label point as origin, angle 0 and no generator', async () => {
    const sections = await query<{
      id: string;
      originX: number;
      originY: number;
      angle: number;
      generator: unknown;
    }>(`SELECT "id"::text AS id, "originX", "originY", "angle", "generator" FROM "Section"
        ORDER BY "labelX"`);
    expect(sections.map((s) => [s.id, s.originX, s.originY, s.angle, s.generator])).toEqual([
      [standard.section, 5, 5, 0, null],
      [imported.left, 50, 60, 0, null],
      [imported.right, 150, 60, 0, null],
    ]);
  });

  it('makes DRAWN a layout source', async () => {
    const values = await query<{ v: string }>(
      `SELECT unnest(enum_range(NULL::"LayoutSource"))::text AS v`,
    );
    expect(values.map((r) => r.v)).toEqual(['FILE', 'LINES', 'DRAWN']);
  });

  it('makes the six per-row unique keys deferrable constraints, checked at once by default', async () => {
    const names = [
      'price_level_rank_unique',
      'Section_layoutId_position_key',
      'seat_row_number_unique',
      'seat_row_label_unique',
      'seat_number_unique',
      'seat_label_unique',
    ];
    const found = await query<{
      conname: string;
      contype: string;
      condeferrable: boolean;
      condeferred: boolean;
    }>(`SELECT conname, contype::text AS contype, condeferrable, condeferred FROM pg_constraint
        WHERE conname IN (${names.map((n) => `'${n}'`).join(', ')}) ORDER BY conname`);
    expect(found).toEqual(
      [...names].sort().map((conname) => ({
        conname,
        contype: 'u',
        condeferrable: true,
        condeferred: false,
      })),
    );
  });

  it('refuses two rows swapping labels at once, and allows it with the constraint deferred', async () => {
    const swap = (deferred: boolean) =>
      db.$transaction(async (tx) => {
        if (deferred) await tx.$executeRawUnsafe(`SET CONSTRAINTS seat_row_label_unique DEFERRED`);
        await tx.$executeRawUnsafe(`UPDATE "SeatRow" SET "label" = 'B' WHERE "id" = '${rows.a}'`);
        await tx.$executeRawUnsafe(`UPDATE "SeatRow" SET "label" = 'A' WHERE "id" = '${rows.b}'`);
      });
    // A raw unique violation names its key, not its constraint.
    const LABEL_KEY = /23505[\s\S]*\("sectionId", label\)/;
    await expect(swap(false)).rejects.toThrow(LABEL_KEY);
    await swap(true);
    const labels = await query<{ id: string; label: string }>(
      `SELECT "id"::text AS id, "label" FROM "SeatRow" ORDER BY "number"`,
    );
    expect(labels).toEqual([
      { id: rows.a, label: 'B' },
      { id: rows.b, label: 'A' },
    ]);
    // And a duplicate is still refused at commit.
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET CONSTRAINTS seat_row_label_unique DEFERRED`);
        await tx.$executeRawUnsafe(`UPDATE "SeatRow" SET "label" = 'A' WHERE "id" = '${rows.a}'`);
      }),
    ).rejects.toThrow(/Unique constraint failed|23505/);
  });

  describe('the new CHECKs', () => {
    const update = (table: string, set: string, where: string) =>
      sql(`UPDATE "${table}" SET ${set} WHERE "id" = '${where}'`);

    it.each([
      ['an angle of -180', `"angle" = -180`, /section_angle_range/],
      ['an origin x of 5,001', `"originX" = 5001`, /section_origin_range/],
      ['an origin y of -1', `"originY" = -1`, /section_origin_range/],
      [
        'a generator that is not an object',
        `"generator" = '[]'::jsonb`,
        /section_generator_object/,
      ],
    ])('refuse %s', async (_what, set, constraint) => {
      await expect(update('Section', set, imported.right)).rejects.toThrow(constraint);
    });

    it('accept an angle of 180, origins on the edges and a generator object', async () => {
      await update(
        'Section',
        `"angle" = 180, "originX" = 5000, "originY" = 0, "generator" = '{"rows": 1}'::jsonb`,
        imported.right,
      );
    });

    it('refuse a revision of 0', async () => {
      await expect(update('Layout', `"revision" = 0`, imported.layout)).rejects.toThrow(
        /layout_revision_positive/,
      );
    });
  });
});
