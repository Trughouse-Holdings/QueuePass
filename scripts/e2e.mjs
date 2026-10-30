// Spec 022 (research R3, FR-013): `npm run e2e [-- <playwright args>]`, the one command that runs
// the browser tests. It removes any leftover `qpe2e` stack; refuses while the stack's ports are
// still in use (someone else's stack); starts a fresh one from clean data exactly as `docker compose up --build` builds it, with
// the address stand-in of e2e/stack/docker-compose.e2e.yml (FR-010); loads the README's demo
// data; runs Playwright; keeps every service's log when something failed; and always removes the
// stack and its volumes (SC-006), also on Ctrl-C, SIGTERM, or a hang-up. Exit code: Playwright's, or 1 when the ports are busy or the
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

/** The signals that end a run early; each still removes the stack (review round 1, M1). */
export const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/** True when something accepts a TCP connection on the port at `host` (within a second). */
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

/** True when the port answers on either loopback, IPv4 or IPv6 (review round 1, minor 6). */
export async function listening(port, connect = tcpConnect) {
  const [v4, v6] = await Promise.all([connect(port, '127.0.0.1'), connect(port, '::1')]);
  return v4 || v6;
}

/** The ports, in the order given, whose `connect` succeeds. */
export async function busyPorts(ports, connect = listening) {
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

/**
 * Runs a command with the terminal's stdio; resolves its exit code. `track` sees the child.
 * `detached` puts it in its own process group, so a Ctrl-C at the terminal does not reach it.
 */
function runCommand(command, args, { track, quiet = false, detached = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: quiet ? 'ignore' : 'inherit',
      detached,
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

/**
 * The whole run. `deps` replaces the commands, the port check, and the output in tests.
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const run = deps.run ?? runCommand;
  const busy = deps.busy ?? (() => busyPorts(E2E_PORTS));
  const error = deps.error ?? ((text) => console.error(text));
  const log = deps.log ?? ((text) => console.log(text));
  const keepLogs = deps.saveLogs ?? saveLogs;
  const down = (opts) => run('docker', [...COMPOSE, 'down', '-v', '--remove-orphans'], opts);

  // A leftover `qpe2e` stack from a killed run (spec edge case, FR-013) goes first, with its data,
  // so the port check below only ever finds someone else's stack (review round 1, M1).
  await down({ quiet: true });
  const ports = await busy();
  if (ports.length > 0) {
    error(portsMessage(ports));
    return 1;
  }

  let child = null;
  const track = (c) => (child = c);
  let interrupted = false;
  const onSignal = (signal) => {
    if (interrupted) return;
    interrupted = true;
    error(`\nnpm run e2e: ${signal}, stopping and removing the ${PROJECT} stack…`);
    child?.kill(signal);
  };
  for (const signal of SIGNALS) process.on(signal, onSignal);
  // After a hang-up the terminal is gone; writing to it must not end the run before clean-up.
  const ignore = () => undefined;
  process.stdout.on('error', ignore);
  process.stderr.on('error', ignore);

  let code = 1;
  const started = Date.now();
  const minutes = () => `${((Date.now() - started) / 60_000).toFixed(1)} min`;
  try {
    log(`npm run e2e: building and starting the ${PROJECT} stack from clean data…`);
    const up = await run(
      'docker',
      [...COMPOSE, 'up', '--build', '--detach', '--wait', '--wait-timeout', '600'],
      { track },
    );
    if (interrupted) return 130;
    if (up !== 0) {
      error('npm run e2e: the stack did not start. The seed job said:');
      await run('docker', [...COMPOSE, 'logs', '--no-color', 'seed'], { track });
      return 1;
    }
    log(`npm run e2e: stack healthy after ${minutes()}; loading the demo data…`);
    const demo = await run(
      'docker',
      [...COMPOSE, 'exec', '-T', 'backend', 'node', 'backend/dist/scripts/demo-data.js'],
      { track },
    );
    if (interrupted) return 130;
    if (demo !== 0) {
      error('npm run e2e: the demo data did not load.');
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
    if (code !== 0) await keepLogs();
    log(`npm run e2e: removing the ${PROJECT} stack and its volumes…`);
    // Its own process group, and the handlers stay on meanwhile: a second Ctrl-C cannot stop
    // the removal partway (review round 1, minor 7).
    await down({ quiet: true, detached: true });
    log(`npm run e2e: done in ${minutes()}.`);
    for (const signal of SIGNALS) process.off(signal, onSignal);
    process.stdout.off('error', ignore);
    process.stderr.off('error', ignore);
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
