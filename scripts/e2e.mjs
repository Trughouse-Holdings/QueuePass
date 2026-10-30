// Spec 022 (research R3, FR-013): `npm run e2e [-- <playwright args>]`, the one command that runs
// the browser tests. It refuses while the stack's ports are in use; removes any leftover `qpe2e`
// stack; starts a fresh one from clean data exactly as `docker compose up --build` builds it, with
// the address stand-in of e2e/stack/docker-compose.e2e.yml (FR-010); loads the README's demo
// data; runs Playwright; keeps every service's log when something failed; and always removes the
// stack and its volumes (SC-006). Exit code: Playwright's, or 1 when the ports are busy or the
// stack did not start.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Every port the Compose stack publishes; the sign-in clients allow only these (spec Assumptions). */
export const E2E_PORTS = [5173, 5174, 5175, 3000, 8080, 9000, 5432];

export const PROJECT = 'qpe2e';
export const COMPOSE = [
  'compose',
  '-p',
  PROJECT,
  '-f',
  'docker-compose.yml',
  '-f',
  'e2e/stack/docker-compose.e2e.yml',
];
const LOG_DIR = join(ROOT, 'e2e', 'test-results', 'stack-logs');

/** True when something accepts a TCP connection on the port (within a second). */
export function tcpConnect(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(1_000, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** The ports, in the order given, whose `connect` succeeds. */
export async function busyPorts(ports, connect = tcpConnect) {
  const open = await Promise.all(ports.map((p) => connect(p)));
  return ports.filter((_, i) => open[i]);
}

/** What to tell a teammate whose own stack (or anything else) holds the ports (FR-013). */
export function portsMessage(busy) {
  return [
    `npm run e2e: port${busy.length === 1 ? '' : 's'} ${busy.join(', ')} ${busy.length === 1 ? 'is' : 'are'} in use, so nothing was started.`,
    'The browser tests need the standard ports: the sign-in clients allow only those addresses.',
    'Stop your own stack first with `docker compose down` (add -v only to delete its data),',
    'or `docker compose -p <name> down` for a stack started under another project name;',
    '`docker ps` shows which containers hold the ports. Your stack and its data were not touched.',
  ].join('\n');
}

/** Runs a command with the terminal's stdio; resolves its exit code. `track` sees the child. */
function run(command, args, { track, quiet = false, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: quiet ? 'ignore' : 'inherit',
      env: env ?? process.env,
      shell: process.platform === 'win32',
    });
    track?.(child);
    child.once('error', (err) => {
      console.error(`npm run e2e: could not run ${command}: ${err.message}`);
      resolve(1);
    });
    child.once('exit', (code, signal) => {
      track?.(null);
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

/** Runs a command and returns its standard output (for `config --services` and `logs`). */
function capture(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.once('error', () => resolve(out));
    child.once('exit', () => resolve(out));
  });
}

async function saveLogs() {
  mkdirSync(LOG_DIR, { recursive: true });
  const services = (await capture('docker', [...COMPOSE, 'config', '--services']))
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => /^[\w-]+$/.test(s));
  for (const service of services) {
    const text = await capture('docker', [...COMPOSE, 'logs', '--no-color', service]);
    writeFileSync(join(LOG_DIR, `${service}.log`), text);
  }
  console.error(`npm run e2e: service logs saved to e2e/test-results/stack-logs/`);
}

export async function main(argv = process.argv.slice(2)) {
  const busy = await busyPorts(E2E_PORTS);
  if (busy.length > 0) {
    console.error(portsMessage(busy));
    return 1;
  }

  let child = null;
  const track = (c) => (child = c);
  let interrupted = false;
  const onSignal = (signal) => {
    if (interrupted) return;
    interrupted = true;
    console.error(`\nnpm run e2e: ${signal}, stopping and removing the ${PROJECT} stack…`);
    child?.kill(signal);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  let code = 1;
  const started = Date.now();
  const minutes = () => `${((Date.now() - started) / 60_000).toFixed(1)} min`;
  try {
    // A leftover from a killed run (spec edge case) goes first, with its data.
    await run('docker', [...COMPOSE, 'down', '-v', '--remove-orphans'], { track, quiet: true });
    if (interrupted) return 130;

    console.log(`npm run e2e: building and starting the ${PROJECT} stack from clean data…`);
    const up = await run(
      'docker',
      [...COMPOSE, 'up', '--build', '--detach', '--wait', '--wait-timeout', '600'],
      { track },
    );
    if (interrupted) return 130;
    if (up !== 0) {
      console.error('npm run e2e: the stack did not start. The seed job said:');
      await run('docker', [...COMPOSE, 'logs', '--no-color', 'seed'], { track });
      return 1;
    }
    console.log(`npm run e2e: stack healthy after ${minutes()}; loading the demo data…`);
    const demo = await run(
      'docker',
      [...COMPOSE, 'exec', '-T', 'backend', 'node', 'backend/dist/scripts/demo-data.js'],
      { track },
    );
    if (interrupted) return 130;
    if (demo !== 0) {
      console.error('npm run e2e: the demo data did not load.');
      return 1;
    }

    const install = [
      'playwright',
      'install',
      ...(process.env.CI ? ['--with-deps'] : []),
      'chromium',
    ];
    if ((await run('npx', install, { track })) !== 0) return 1;
    if (interrupted) return 130;

    code = await run('npx', ['playwright', 'test', '-c', 'e2e/playwright.config.ts', ...argv], {
      track,
    });
    if (interrupted) return 130;
    return code;
  } finally {
    if (code !== 0) await saveLogs();
    console.log(`npm run e2e: removing the ${PROJECT} stack and its volumes…`);
    await run('docker', [...COMPOSE, 'down', '-v', '--remove-orphans'], { quiet: true });
    console.log(`npm run e2e: done in ${minutes()}.`);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
