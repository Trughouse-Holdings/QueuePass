#!/usr/bin/env node
// Spec 037 (T065, SC-004, research R7): the React Admin app's own output for the export
// fixtures, which the Rust `core` tests compare against. Run once, and again whenever the React
// export code or a fixture changes; the generated files are committed:
//
//   npx tsx scripts/export-parity-fixtures.mjs
//
// It imports `admin-app/src/export/*.ts` as they are, without changing them. Two loader hooks
// make that work outside Vite: `@queuepass/shared` resolves to this tree's
// `packages/shared/src` (not a possibly stale `dist`), and the PDF writer's `?url` font imports
// resolve to a stub, as only its pure layout is called here. Every time is passed in (made-at
// times and zones are fixture inputs), so the output does not depend on the clock or the
// device's zone.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as prettier from 'prettier';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FIXTURES = join(ROOT, 'admin-rust-app/core/tests/fixtures/export');
const EXPECTED = join(FIXTURES, 'expected');
const SHARED_SRC = pathToFileURL(join(ROOT, 'packages/shared/src/')).href;

// The shared package has no `"type": "module"` (its `dist` is built for both module systems),
// so its sources are marked as ES modules here; otherwise their `export *` lines are lost.
const HOOKS = `
const SHARED_SRC = ${JSON.stringify(SHARED_SRC)};
export async function resolve(specifier, context, next) {
  if (specifier.endsWith('?url')) {
    return { url: 'data:text/javascript,export default "font-stub"', shortCircuit: true };
  }
  const target = specifier === '@queuepass/shared' ? SHARED_SRC + 'index.ts' : specifier;
  const resolved = await next(target, context);
  return resolved.url.startsWith(SHARED_SRC) ? { ...resolved, format: 'module' } : resolved;
}
export async function load(url, context, next) {
  if (/\\.ttf(\\?|$)/.test(url)) {
    return { format: 'module', source: 'export default "font-stub";', shortCircuit: true };
  }
  return next(url, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(HOOKS)}`, import.meta.url);

const src = (file) => pathToFileURL(join(ROOT, 'admin-app/src/export', file)).href;
const { attendeeTable } = await import(src('attendee-rows.ts'));
const { salesTable } = await import(src('sales-rows.ts'));
const { toCsv } = await import(src('csv.ts'));
const { fileName, slug } = await import(src('file-name.ts'));
const { madeLines } = await import(src('made.ts'));
const { fontGlyphs, pdfLayout } = await import(src('pdf.ts'));

const REGULAR = new Uint8Array(
  readFileSync(join(ROOT, 'admin-app/src/export/fonts/NotoSans-Regular.ttf')),
);
const GLYPHS = fontGlyphs(REGULAR);

// The JSON is written as the repository's Prettier settings format it, so `format:check` passes.
const PRETTIER = await prettier.resolveConfig(join(EXPECTED, 'any.json'));
const json = (value) => prettier.format(JSON.stringify(value), { ...PRETTIER, parser: 'json' });
const out = (name, content) => writeFileSync(join(EXPECTED, name), content);
mkdirSync(EXPECTED, { recursive: true });

/** The table a fixture describes, made as the React pages make it. */
function tableOf(input) {
  switch (input.kind) {
    case 'attendees':
      return attendeeTable(
        input.event,
        input.orders,
        input.madeAt,
        input.madeBy,
        input.adminZone,
        input.keptCheckedIn,
      );
    case 'sales':
      return salesTable(input.report, input.madeBy, input.adminZone);
    case 'table':
      return input.table;
    default:
      throw new Error(`Unknown fixture kind: ${input.kind}`);
  }
}

/** The file names the pages give each download (`Attendees.tsx`, `Reports.tsx`). */
function fileNamesOf(input) {
  const names = {};
  for (const ext of ['csv', 'xlsx', 'pdf']) {
    names[ext] =
      input.kind === 'attendees'
        ? fileName(
            'attendees',
            input.event.name,
            new Date(input.madeAt).toISOString(),
            input.adminZone,
            ext,
          )
        : fileName('sales-report', null, input.report.generatedAt, input.adminZone, ext);
  }
  return names;
}

for (const file of readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.json'))
  .sort()) {
  const name = file.replace(/\.json$/, '');
  const input = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
  const table = tableOf(input);
  out(`${name}.table.json`, await json(table));
  out(`${name}.csv`, new Uint8Array(await toCsv(table).arrayBuffer()));
  out(`${name}.pdf-layout.json`, await json(pdfLayout(table, GLYPHS)));
  if (input.kind !== 'table') out(`${name}.file-names.json`, await json(fileNamesOf(input)));
}

// The font's characters: the Rust PDF writer must replace exactly the same ones with `?`.
out('glyphs.json', await json([...GLYPHS].sort((a, b) => a - b)));

// File-name slugs (research R8 of spec 023): NFKD, marks dropped, and the 60-character cut.
const SLUG_NAMES = [
  'Export Test, Café',
  '  Zoë’s  Night — Part 2!! ',
  '山田 — !!',
  `${'a'.repeat(59)} bcd`,
  'b'.repeat(61),
  'Ångström Ⅻ ﬁnale ½',
  'Season Opener',
  'Ελένη Пётр',
  '--Leading and trailing--',
  'Crème brûlée & Co. — Ünïcödé',
];
out('slugs.json', await json(SLUG_NAMES.map((n) => ({ name: n, slug: slug(n) }))));

// Made-at lines and file-name stamps in the admin's zone (X4), for every US zone and a spread
// of others (whole, half, and three-quarter hour offsets; southern daylight saving; UTC).
const ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Adak',
  'Pacific/Honolulu',
  'America/Halifax',
  'America/St_Johns',
  'America/Puerto_Rico',
  'America/Mexico_City',
  'America/Havana',
  'America/Sao_Paulo',
  'America/Indiana/Indianapolis',
  'America/Boise',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Moscow',
  'Africa/Abidjan',
  'Africa/Lagos',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Riyadh',
  'Australia/Adelaide',
  'Australia/Sydney',
  'Pacific/Auckland',
  'Pacific/Chatham',
  'Pacific/Kiritimati',
  'UTC',
  'Etc/UTC',
  'GMT',
];
const INSTANTS = [
  '2026-01-15T12:00:00.000Z',
  '2026-07-15T23:59:00.000Z',
  '2026-03-08T07:30:00.000Z',
  '2026-11-01T06:30:00.000Z',
];
const zones = [];
for (const zone of ZONES) {
  for (const at of INSTANTS) {
    const made = madeLines(at, 'admin1', zone);
    zones.push({
      zone,
      at,
      madeAt: made.madeAt,
      lines: made.lines,
      fileName: fileName('sales-report', null, at, zone, 'csv'),
    });
  }
}
out('made-zones.json', await json(zones));

console.log(`Wrote ${readdirSync(EXPECTED).length} files to ${EXPECTED}`);
