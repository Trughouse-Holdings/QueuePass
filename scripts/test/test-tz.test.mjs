// Spec 020 (research R20, tasks T004): scripts/test-tz.mjs runs the suites once per device zone,
// setting the zone from Node (a Git Bash `TZ=…` prefix does not reach Node on Windows). Its
// commands are replaced here by stubs that record what they saw, so this runs in a second.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_ZONES, main, suiteCommand } from '../test-tz.mjs';

const FOUR = ['America/New_York', 'UTC', 'America/Los_Angeles', 'Pacific/Honolulu'];

/** A child that appends one JSON line describing itself to STUB_LOG, and fails when told to. */
function stub(step) {
  const code = `
    const fs = require('node:fs');
    const line = {
      step: ${JSON.stringify(step)},
      intl: Intl.DateTimeFormat().resolvedOptions().timeZone,
      tz: process.env.TZ ?? null,
      qp: process.env.QP_TEST_TZ ?? null,
      calendar: process.env.CALENDAR_TEST_TZ ?? null,
    };
    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify(line) + '\\n');
    const fail = (process.env.STUB_FAIL ?? '').split(',');
    if (fail.includes(line.step + '@' + (line.qp ?? ''))) process.exit(3);
  `;
  return { command: process.execPath, args: ['-e', code] };
}

const stubs = {
  build: () => stub('build'),
  generate: () => stub('generate'),
  suite: (workspace) => stub(workspace),
};

/** Runs the script with stub commands; returns its exit code, the stub lines, and its output. */
async function run(argv, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'test-tz-'));
  const log = join(dir, 'log.jsonl');
  const saved = { ...process.env };
  Object.assign(process.env, { STUB_LOG: log, CALENDAR_TEST_TZ: 'Asia/Tokyo' }, env);
  const out = [];
  try {
    const code = await main(argv, { commands: stubs, log: (s) => out.push(s), quiet: true });
    const lines = existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l))
      : [];
    return { code, lines, output: out.join('\n') };
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the default zones are New York, UTC, Los Angeles, and Honolulu (R20)', () => {
  assert.deepEqual(DEFAULT_ZONES, FOUR);
});

test('each suite runs once per zone with QP_TEST_TZ and TZ set, and Node sees the zone', async () => {
  const { code, lines } = await run([]);
  assert.equal(code, 0);
  const suites = lines.filter((l) => l.step !== 'build' && l.step !== 'generate');
  assert.equal(suites.length, 4 * 5);
  for (const zone of FOUR) {
    const inZone = suites.filter((l) => l.qp === zone);
    assert.deepEqual(inZone.map((l) => l.step).sort(), [
      'admin-app',
      'backend',
      'booth-app',
      'customer-app',
      'shared',
    ]);
    for (const l of inZone) {
      assert.equal(l.tz, zone);
      assert.equal(l.intl, zone);
    }
  }
});

test('builds @queuepass/shared, then generates the Prisma client, before the first suite', async () => {
  const { lines } = await run([]);
  assert.deepEqual(
    lines.slice(0, 3).map((l) => l.step),
    ['build', 'generate', lines[2].step],
  );
  assert.equal(lines.filter((l) => l.step === 'build').length, 1);
  assert.equal(lines.filter((l) => l.step === 'generate').length, 1);
});

test("CALENDAR_TEST_TZ set in the parent reaches no child (019's override, R20)", async () => {
  const { lines } = await run([]);
  assert.ok(lines.length > 0);
  for (const l of lines) assert.equal(l.calendar, null, `${l.step} saw CALENDAR_TEST_TZ`);
});

test('--zones limits the zones', async () => {
  const { code, lines } = await run(['--zones', 'UTC,America/Chicago']);
  assert.equal(code, 0);
  const zones = [...new Set(lines.filter((l) => l.qp).map((l) => l.qp))];
  assert.deepEqual(zones, ['UTC', 'America/Chicago']);
});

test('--quick runs only the time tests: no Backend run, so no build or generate', async () => {
  const { code, lines } = await run(['--zones', 'UTC', '--quick']);
  assert.equal(code, 0);
  assert.deepEqual(
    lines.map((l) => l.step),
    ['shared', 'admin-app', 'customer-app', 'booth-app'],
  );
  assert.deepEqual(suiteCommand('shared', { quick: true }).args.slice(-1), [
    'test/time-zone.test.ts',
  ]);
  for (const app of ['admin-app', 'customer-app', 'booth-app']) {
    const { args } = suiteCommand(app, { quick: true });
    assert.ok(args.includes('.tz.test.tsx'), app);
    // Review round 1, m2: a renamed or missing time test must fail the run, not pass it.
    assert.ok(!args.includes('--passWithNoTests'), app);
  }
});

test('--backend-full adds the Backend full suite in each zone', async () => {
  const { lines } = await run(['--zones', 'America/Los_Angeles', '--backend-full']);
  assert.deepEqual(
    lines.filter((l) => l.qp).map((l) => l.step),
    ['shared', 'backend', 'admin-app', 'customer-app', 'booth-app', 'backend-full'],
  );
});

test('the Backend unit run uses jest.unit.config.ts; the full run uses the main config', () => {
  const unit = suiteCommand('backend', {});
  assert.ok(unit.args.includes('jest.unit.config.ts'), unit.args.join(' '));
  assert.ok(unit.cwd.replaceAll('\\', '/').endsWith('/backend'));
  const full = suiteCommand('backend-full', {});
  assert.ok(!full.args.includes('jest.unit.config.ts'));
  assert.ok(full.args.includes('--runInBand'));
});

test('exits non-zero when any run fails, and prints a zone × workspace table', async () => {
  const { code, output } = await run(['--zones', 'UTC,America/Los_Angeles'], {
    STUB_FAIL: 'customer-app@America/Los_Angeles',
  });
  assert.notEqual(code, 0);
  const rows = output.split('\n');
  const header = rows.find((r) => r.includes('shared') && r.includes('customer-app'));
  assert.ok(header, output);
  const utc = rows.find((r) => r.startsWith('UTC'));
  const la = rows.find((r) => r.startsWith('America/Los_Angeles'));
  assert.ok(utc && !utc.includes('FAIL'), utc);
  assert.ok(la && la.includes('FAIL'), la);
});

test('a failed build stops before any suite', async () => {
  const { code, lines } = await run(['--zones', 'UTC'], { STUB_FAIL: 'build@' });
  assert.notEqual(code, 0);
  assert.deepEqual(
    lines.map((l) => l.step),
    ['build'],
  );
});
