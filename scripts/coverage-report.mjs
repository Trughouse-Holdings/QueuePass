// Spec 011 FR-005 to FR-007 (research R11): print each workspace's line coverage from the
// coverage-summary.json that this run's `npm test` wrote, and append the same table to the
// GitHub Actions step summary when GITHUB_STEP_SUMMARY is set. Report only: a workspace below
// 80% is marked, never failed (010-test-coverage enforces the floor through the test runners'
// thresholds). Exits 1, naming the workspace, when a summary is missing, unreadable, or counts
// no lines, because that workspace's coverage was not measured.
//
//   node scripts/coverage-report.mjs          print the table (root script coverage:report)
//   node scripts/coverage-report.mjs --clean  delete every workspace's coverage/ (start of npm test)
import { appendFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKSPACES = [
  'packages/shared',
  'backend',
  'admin-app',
  'customer-app',
  'booth-app',
  'scripts/seed',
];

const FLOOR = 80;
const NOTE = 'The 80% floor is not enforced until 010-test-coverage is merged.';
const SUMMARY_FILE = join('coverage', 'coverage-summary.json');

export function cleanCoverage(rootDir) {
  for (const workspace of WORKSPACES) {
    rmSync(join(rootDir, workspace, 'coverage'), { recursive: true, force: true });
  }
}

// One row per workspace: { workspace, lines } with istanbul's total.lines, or
// { workspace, notMeasured } with the reason.
export function readSummaries(rootDir) {
  return WORKSPACES.map((workspace) => {
    const path = join(rootDir, workspace, SUMMARY_FILE);
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      return { workspace, notMeasured: `${workspace}/coverage/coverage-summary.json is missing` };
    }
    let lines;
    try {
      lines = JSON.parse(text).total.lines;
    } catch {
      return {
        workspace,
        notMeasured: `${workspace}/coverage/coverage-summary.json is unreadable`,
      };
    }
    if (
      typeof lines?.total !== 'number' ||
      typeof lines.covered !== 'number' ||
      typeof lines.pct !== 'number'
    ) {
      return { workspace, notMeasured: `${workspace}/coverage/coverage-summary.json has no lines` };
    }
    if (lines.total === 0) {
      return { workspace, notMeasured: `counts no lines (its coverage include matches nothing)` };
    }
    return { workspace, lines };
  });
}

function cells(row) {
  if (row.notMeasured) return ['not measured', '', row.notMeasured];
  const { pct, covered, total } = row.lines;
  return [`${pct.toFixed(2)}%`, `${covered} / ${total}`, pct < FLOOR ? `below ${FLOOR}%` : ''];
}

export function formatTable(rows) {
  const header = ['Workspace', 'Lines', 'Covered / total', ''];
  const body = rows.map((row) => [row.workspace, ...cells(row)]);
  const widths = header.map((_, i) => Math.max(...[header, ...body].map((r) => r[i].length)));
  const line = (r) =>
    r
      .map((cell, i) => (i === 1 || i === 2 ? cell.padStart(widths[i]) : cell.padEnd(widths[i])))
      .join('  ')
      .trimEnd();
  return ['Line coverage by workspace', '', line(header), ...body.map(line), '', NOTE].join('\n');
}

export function formatMarkdown(rows) {
  return [
    '### Line coverage by workspace',
    '',
    '| Workspace | Lines | Covered / total | |',
    '| --- | ---: | ---: | --- |',
    ...rows.map((row) => `| ${[row.workspace, ...cells(row)].join(' | ')} |`),
    '',
    NOTE,
    '',
  ].join('\n');
}

export function run({ rootDir, stepSummaryPath }) {
  const rows = readSummaries(rootDir);
  console.log(formatTable(rows));
  if (stepSummaryPath) appendFileSync(stepSummaryPath, formatMarkdown(rows));
  const notMeasured = rows.filter((row) => row.notMeasured);
  for (const row of notMeasured) {
    console.error(`Coverage not measured for ${row.workspace}: ${row.notMeasured}`);
  }
  return notMeasured.length > 0 ? 1 : 0;
}

function main() {
  const rootDir = fileURLToPath(new URL('..', import.meta.url));
  if (process.argv.includes('--clean')) {
    cleanCoverage(rootDir);
    process.exit(0);
  }
  process.exit(run({ rootDir, stepSummaryPath: process.env.GITHUB_STEP_SUMMARY }));
}

// Run main only when executed directly, not when imported by the tests. Compare real paths, so
// a linked checkout or another spelling of the path still runs it (case-insensitive on Windows).
function isMain() {
  if (!process.argv[1]) return false;
  const normalise = (path) => {
    const real = realpathSync(path);
    return process.platform === 'win32' ? real.toLowerCase() : real;
  };
  try {
    return normalise(process.argv[1]) === normalise(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) main();
