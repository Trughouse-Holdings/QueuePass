// Spec 011 (research R11, R13): the coverage report prints and publishes each workspace's line
// coverage, marks a workspace below 80% without failing (each workspace's own test run enforces the
// floor, spec 010 research R1 and R2, and the note says so), and fails naming a workspace whose
// coverage was not measured. Run by the root `npm test`.
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import {
  copyFileSync,
  existsSync,
  symlinkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WORKSPACES,
  cleanCoverage,
  formatMarkdown,
  formatTable,
  readSummaries,
  run,
} from '../coverage-report.mjs';

const NOTE = "The 80% floor is enforced by each workspace's test run (010-test-coverage).";

function tempRoot(t) {
  const dir = mkdtempSync(join(tmpdir(), 'qp-coverage-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function summaryPath(rootDir, workspace) {
  return join(rootDir, workspace, 'coverage', 'coverage-summary.json');
}

function writeRaw(rootDir, workspace, text) {
  mkdirSync(join(rootDir, workspace, 'coverage'), { recursive: true });
  writeFileSync(summaryPath(rootDir, workspace), text);
}

function writeSummary(rootDir, workspace, { covered, total, pct }) {
  const lines = { total, covered, skipped: 0, pct };
  writeRaw(rootDir, workspace, JSON.stringify({ total: { lines, statements: lines } }));
}

function writeAll(rootDir, lines = { covered: 85, total: 100, pct: 85 }) {
  for (const workspace of WORKSPACES) writeSummary(rootDir, workspace, lines);
}

// run() prints through console.log and console.error; capture both, silently.
function captureConsole(t) {
  const out = [];
  t.mock.method(console, 'log', (...args) => out.push(args.join(' ')));
  t.mock.method(console, 'error', (...args) => out.push(args.join(' ')));
  return out;
}

test('the six workspaces, in a fixed order', () => {
  assert.deepEqual(WORKSPACES, [
    'packages/shared',
    'backend',
    'admin-app',
    'customer-app',
    'booth-app',
    'scripts/seed',
  ]);
});

test('all six at 85%: six rows with percentage and covered/total lines, the note, exit 0', (t) => {
  const rootDir = tempRoot(t);
  writeAll(rootDir);
  const rows = readSummaries(rootDir);
  assert.equal(rows.length, 6);

  const table = formatTable(rows);
  for (const workspace of WORKSPACES) {
    const line = table.split('\n').find((l) => l.startsWith(workspace));
    assert.ok(line, `no row for ${workspace}`);
    assert.match(line, /85\.00%/);
    assert.match(line, /85 \/ 100/);
  }
  assert.ok(!table.includes('below 80%'));
  assert.ok(table.includes(NOTE));

  const markdown = formatMarkdown(rows);
  for (const workspace of WORKSPACES) assert.ok(markdown.includes(`| ${workspace} |`));
  assert.ok(markdown.includes(NOTE));

  const out = captureConsole(t);
  assert.equal(run({ rootDir }), 0);
  assert.ok(out.join('\n').includes(NOTE));
});

test('79.9% is marked below 80% and exactly 80% is not; still exit 0', (t) => {
  const rootDir = tempRoot(t);
  writeAll(rootDir);
  writeSummary(rootDir, 'backend', { covered: 799, total: 1000, pct: 79.9 });
  writeSummary(rootDir, 'booth-app', { covered: 80, total: 100, pct: 80 });
  const rows = readSummaries(rootDir);
  const lines = formatTable(rows).split('\n');
  assert.match(
    lines.find((l) => l.startsWith('backend')),
    /79\.90%.*799 \/ 1000.*below 80%/,
  );
  assert.ok(!lines.find((l) => l.startsWith('booth-app')).includes('below 80%'));
  assert.equal(lines.filter((l) => l.includes('below 80%')).length, 1);
  assert.match(formatMarkdown(rows), /\| backend \|.*below 80%/);

  captureConsole(t);
  assert.equal(run({ rootDir }), 0);
});

test('a missing, an unreadable, and a zero-line summary are each named as not measured, exit 1', (t) => {
  const rootDir = tempRoot(t);
  writeAll(rootDir);
  rmSync(summaryPath(rootDir, 'booth-app'));
  writeRaw(rootDir, 'admin-app', '{ not json');
  writeSummary(rootDir, 'scripts/seed', { covered: 0, total: 0, pct: 100 });

  const rows = readSummaries(rootDir);
  const notMeasured = rows.filter((row) => row.notMeasured).map((row) => row.workspace);
  assert.deepEqual(notMeasured, ['admin-app', 'booth-app', 'scripts/seed']);

  const lines = formatTable(rows).split('\n');
  for (const workspace of notMeasured) {
    assert.match(
      lines.find((l) => l.startsWith(workspace)),
      /not measured/,
    );
  }

  const out = captureConsole(t);
  assert.equal(run({ rootDir }), 1);
  const printed = out.join('\n');
  for (const workspace of notMeasured) {
    assert.match(printed, new RegExp(`not measured.*${workspace.replace('/', '\\/')}`));
  }
});

test("cleanCoverage removes every workspace's coverage folder, and an absent one is fine", (t) => {
  const rootDir = tempRoot(t);
  writeAll(rootDir);
  rmSync(join(rootDir, 'customer-app', 'coverage'), { recursive: true });
  mkdirSync(join(rootDir, 'backend', 'coverage', 'lcov-report'), { recursive: true });

  cleanCoverage(rootDir);
  for (const workspace of WORKSPACES) {
    assert.ok(!existsSync(join(rootDir, workspace, 'coverage')), `${workspace}/coverage remains`);
  }
  cleanCoverage(rootDir);
});

test('with a step summary path, the Markdown table is appended to that file', (t) => {
  const rootDir = tempRoot(t);
  writeAll(rootDir);
  const stepSummaryPath = join(rootDir, 'step-summary.md');
  writeFileSync(stepSummaryPath, '# Earlier step\n');

  captureConsole(t);
  assert.equal(run({ rootDir, stepSummaryPath }), 0);
  const written = readFileSync(stepSummaryPath, 'utf8');
  assert.ok(written.startsWith('# Earlier step\n'));
  assert.ok(written.includes(formatMarkdown(readSummaries(rootDir))));
});

test('without a step summary path, nothing is written', (t) => {
  const rootDir = tempRoot(t);
  writeAll(rootDir);
  const before = readdirSync(rootDir, { recursive: true }).sort();
  captureConsole(t);
  assert.equal(run({ rootDir }), 0);
  assert.equal(run({ rootDir, stepSummaryPath: '' }), 0);
  assert.deepEqual(readdirSync(rootDir, { recursive: true }).sort(), before);
});

// The script's own entry point, run as the check runs it (`node scripts/coverage-report.mjs`):
// a copy in a temporary repository root, so it reads that root's fixture summaries.
const SCRIPT = fileURLToPath(new URL('../coverage-report.mjs', import.meta.url));

function scriptInTempRoot(t) {
  const rootDir = tempRoot(t);
  mkdirSync(join(rootDir, 'scripts'));
  copyFileSync(SCRIPT, join(rootDir, 'scripts', 'coverage-report.mjs'));
  return rootDir;
}

function runScript(scriptPath, ...args) {
  const env = { ...process.env };
  delete env.GITHUB_STEP_SUMMARY;
  return spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8', env });
}

test('run directly, the script prints the table and exits 0, or 1 when a workspace is not measured', (t) => {
  const rootDir = scriptInTempRoot(t);
  writeAll(rootDir);
  const script = join(rootDir, 'scripts', 'coverage-report.mjs');

  const ok = runScript(script);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Line coverage by workspace/);
  assert.match(ok.stdout, /booth-app +85\.00% +85 \/ 100/);

  rmSync(summaryPath(rootDir, 'booth-app'));
  const missing = runScript(script);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /Line coverage by workspace/);
  assert.match(missing.stderr, /not measured for booth-app/);

  assert.equal(runScript(script, '--clean').status, 0);
  for (const workspace of WORKSPACES) {
    assert.ok(!existsSync(join(rootDir, workspace, 'coverage')), `${workspace}/coverage remains`);
  }
});

test('run through a linked checkout, the script still runs (not a silent exit 0)', (t) => {
  const rootDir = scriptInTempRoot(t);
  writeAll(rootDir);
  rmSync(summaryPath(rootDir, 'booth-app'));
  // A symbolic link (a junction on Windows, which needs no extra rights) to the root: Node
  // resolves the main module's real path, so import.meta.url and process.argv[1] differ.
  const link = join(tempRoot(t), 'linked-root');
  symlinkSync(rootDir, link, process.platform === 'win32' ? 'junction' : 'dir');
  const script = join(link, 'scripts', 'coverage-report.mjs');
  const result = runScript(script);
  assert.match(result.stdout, /Line coverage by workspace/);
  assert.equal(result.status, 1);
});
