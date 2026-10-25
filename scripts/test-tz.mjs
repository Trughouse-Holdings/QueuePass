// Spec 020 (research R20): runs the suites once per device zone, so no shown or stored event time
// can depend on the viewer's zone (SC-002). Usage, from the repository root:
//
//   npm run test:tz                                    # the four zones below
//   node scripts/test-tz.mjs --zones UTC,America/Chicago
//   node scripts/test-tz.mjs --quick                   # only the time tests (CI: Los Angeles)
//   node scripts/test-tz.mjs --zones America/Los_Angeles --backend-full
//
// Per zone: the `packages/shared`, `admin-app`, `customer-app`, and `booth-app` suites
// (`vitest run`), and the Backend's unit tests with backend/jest.unit.config.ts (no
// Testcontainers, so no Docker); `--backend-full` adds the Backend's full suite. Each child gets
// both QP_TEST_TZ (read by every Vitest config) and TZ, set from Node: on Windows a Git Bash
// `TZ=… npm test` prefix does not reach Node. CALENDAR_TEST_TZ (019) is removed from every
// child, so 019's calendar test runs in the zone reported here. `--quick` runs only
// packages/shared/test/time-zone.test.ts and each app's test/**/*.tz.test.tsx, with no Backend
// run (so no build or generate step). It prints a zone × workspace table and exits non-zero
// when any run failed.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const VITEST = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const JEST = join(ROOT, 'node_modules', 'jest', 'bin', 'jest.js');

export const DEFAULT_ZONES = ['America/New_York', 'UTC', 'America/Los_Angeles', 'Pacific/Honolulu'];

const DIRS = {
  shared: join(ROOT, 'packages', 'shared'),
  backend: join(ROOT, 'backend'),
  'backend-full': join(ROOT, 'backend'),
  'admin-app': join(ROOT, 'admin-app'),
  'customer-app': join(ROOT, 'customer-app'),
  'booth-app': join(ROOT, 'booth-app'),
};

/** The command that runs one workspace's suite (the default; tests replace it). */
export function suiteCommand(workspace, { quick = false } = {}) {
  const cwd = DIRS[workspace];
  const node = process.execPath;
  if (workspace === 'backend') {
    return { command: node, args: [JEST, '--config', 'jest.unit.config.ts', '--runInBand'], cwd };
  }
  if (workspace === 'backend-full') {
    return { command: node, args: [JEST, '--runInBand'], cwd };
  }
  if (!quick) return { command: node, args: [VITEST, 'run'], cwd };
  if (workspace === 'shared') {
    return { command: node, args: [VITEST, 'run', 'test/time-zone.test.ts'], cwd };
  }
  // A filter, not a glob: every test file whose path contains `.tz.test.tsx`.
  return { command: node, args: [VITEST, 'run', '--passWithNoTests', '.tz.test.tsx'], cwd };
}

const npm = (script) => ({ command: `npm run ${script}`, args: [], cwd: ROOT, shell: true });

const DEFAULT_COMMANDS = {
  // The Backend's Jest maps @queuepass/shared to its compiled dist/cjs.
  build: () => npm('build --workspace @queuepass/shared'),
  // A Backend unit test imports @prisma/client, which a fresh `npm ci` does not generate.
  generate: () => npm('prisma:generate --workspace @queuepass/backend'),
  suite: suiteCommand,
};

function parseArgs(argv) {
  const options = { zones: DEFAULT_ZONES, quick: false, backendFull: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--quick') options.quick = true;
    else if (arg === '--backend-full') options.backendFull = true;
    else if (arg === '--zones') {
      options.zones = (argv[++i] ?? '')
        .split(',')
        .map((z) => z.trim())
        .filter(Boolean);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.zones.length === 0) throw new Error('--zones needs at least one zone');
  return options;
}

/** The parent's environment without CALENDAR_TEST_TZ, plus `extra`. */
function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.CALENDAR_TEST_TZ;
  return env;
}

function runOne({ command, args, cwd, shell = false }, env, quiet) {
  const result = spawnSync(command, args, {
    cwd: cwd ?? ROOT,
    env,
    shell,
    stdio: quiet ? 'ignore' : 'inherit',
  });
  return result.status === 0;
}

function table(zones, workspaces, results) {
  const width = Math.max(...zones.map((z) => z.length), 'zone'.length);
  const cols = workspaces.map((w) =>
    Math.max(w.length, ...zones.map((z) => (results.get(`${z}|${w}`) ?? '-').length)),
  );
  const row = (first, cells) =>
    [first.padEnd(width), ...cells.map((c, i) => c.padEnd(cols[i]))].join('  ').trimEnd();
  return [
    row('zone', workspaces),
    ...zones.map((z) =>
      row(
        z,
        workspaces.map((w) => results.get(`${z}|${w}`) ?? '-'),
      ),
    ),
  ].join('\n');
}

/**
 * Runs everything; returns the exit code. `commands` and `log` exist for
 * scripts/test/test-tz.test.mjs; `quiet` hides the children's output.
 */
export async function main(
  argv = process.argv.slice(2),
  { commands = DEFAULT_COMMANDS, log = console.log, quiet = false } = {},
) {
  const options = parseArgs(argv);
  const workspaces = [
    'shared',
    ...(options.quick ? [] : ['backend']),
    'admin-app',
    'customer-app',
    'booth-app',
    ...(options.backendFull ? ['backend-full'] : []),
  ];
  const needsBackend = workspaces.some((w) => w.startsWith('backend'));

  if (needsBackend) {
    for (const step of ['build', 'generate']) {
      if (!runOne(commands[step](), childEnv(), quiet)) {
        log(`test:tz: the ${step} step failed; no suite was run.`);
        return 1;
      }
    }
  }

  const results = new Map();
  let failed = 0;
  for (const zone of options.zones) {
    for (const workspace of workspaces) {
      if (!quiet) log(`\n=== test:tz ${zone} ${workspace} ===`);
      const started = Date.now();
      const ok = runOne(
        commands.suite(workspace, { quick: options.quick }),
        childEnv({ QP_TEST_TZ: zone, TZ: zone }),
        quiet,
      );
      const seconds = Math.round((Date.now() - started) / 1000);
      results.set(`${zone}|${workspace}`, ok ? `pass ${seconds}s` : `FAIL ${seconds}s`);
      if (!ok) failed++;
    }
  }

  log('\ntest:tz results' + (options.quick ? ' (--quick: time tests only)' : '') + ':');
  log(table(options.zones, workspaces, results));
  log(failed === 0 ? 'All runs passed.' : `${failed} run(s) failed.`);
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(2);
    },
  );
}
