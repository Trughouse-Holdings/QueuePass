// Spec 020 (research R21, tasks T058): scripts/run-host.mjs runs the Backend and the three apps
// from the host (quickstart path B), each child with its whole environment set explicitly.
// `--print` shows the plan without starting anything; this test reads it and checks every value
// against docker-compose.yml's defaults, with localhost in place of the service names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'run-host.mjs');

/** Runs the script with --print; returns its blocks: { kind, name, command, env }. */
function plan(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, '--print', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 20_000,
  });
  assert.equal(r.status, 0, r.stderr);
  const blocks = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    const head = /^(setup|child) ([\w-]+): (.+)$/.exec(line);
    if (head) {
      blocks.push({ kind: head[1], name: head[2], command: head[3], env: {} });
      continue;
    }
    const kv = /^ {4}([A-Z_]+)=(.*)$/.exec(line);
    if (kv && blocks.length > 0) blocks.at(-1).env[kv[1]] = kv[2];
  }
  return blocks;
}
const find = (blocks, name) => {
  const b = blocks.find((x) => x.name === name);
  assert.ok(b, `no ${name} in the plan`);
  return b;
};

/** docker-compose.yml's value for a service variable, `${X:-default}` resolved, hosts local. */
const compose = parse(readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8'));
function composeValue(service, key, where = 'environment') {
  const raw =
    where === 'args'
      ? compose.services[service].build.args[key]
      : compose.services[service].environment[key];
  return String(raw)
    .replace(/\$\{[A-Z_]+:-([^}]*)\}/g, '$1')
    .replace('@database:', '@localhost:')
    .replace('http://keycloak:', 'http://localhost:');
}

test('--print starts nothing and lists the setup steps in order', () => {
  const blocks = plan('--backend-tz', 'America/Los_Angeles');
  const setup = blocks.filter((b) => b.kind === 'setup').map((b) => b.name);
  assert.deepEqual(setup, [
    'shared-build',
    'prisma-generate',
    'migrate-deploy',
    'seed',
    'backend-build',
  ]);
  assert.match(find(blocks, 'shared-build').command, /build --workspace @queuepass\/shared/);
  assert.match(find(blocks, 'prisma-generate').command, /prisma:generate/);
  assert.match(find(blocks, 'migrate-deploy').command, /prisma:deploy/);
  assert.match(find(blocks, 'seed').command, /seed --workspace @queuepass\/seed/);
});

test('demo data only with --demo-data, after the Backend is built', () => {
  const setup = plan('--backend-tz', 'America/Los_Angeles', '--demo-data')
    .filter((b) => b.kind === 'setup')
    .map((b) => b.name);
  assert.deepEqual(setup.slice(-2), ['backend-build', 'demo-data']);
  assert.ok(setup.indexOf('demo-data') > setup.indexOf('seed'));
});

test('the seed talks to Keycloak on localhost', () => {
  const seed = find(plan(), 'seed');
  assert.equal(seed.env.KEYCLOAK_URL, 'http://localhost:8080');
  assert.equal(seed.env.KEYCLOAK_HEALTH_URL, 'http://localhost:9000');
  for (const key of [
    'KEYCLOAK_ADMIN',
    'KEYCLOAK_ADMIN_PASSWORD',
    'KEYCLOAK_REALM',
    'SEED_USER_PASSWORD',
  ]) {
    assert.equal(seed.env[key], composeValue('seed', key), key);
  }
});

test("the Backend has compose's environment on localhost, and TZ from --backend-tz", () => {
  const backend = find(plan('--backend-tz', 'America/Los_Angeles'), 'backend');
  assert.match(backend.command, /start:prod --workspace @queuepass\/backend/);
  for (const key of [
    'DATABASE_URL',
    'PORT',
    'OIDC_ISSUER',
    'OIDC_JWKS_URL',
    'OIDC_AUDIENCE',
    'CORS_ORIGINS',
    'ADDRESS_GEOCODER_URL',
  ]) {
    assert.equal(backend.env[key], composeValue('backend', key), key);
  }
  assert.match(backend.env.OIDC_JWKS_URL, /^http:\/\/localhost:8080\//);
  assert.match(backend.env.DATABASE_URL, /@localhost:5432\//);
  assert.equal(backend.env.TZ, 'America/Los_Angeles');
});

test('migrate deploy and demo data use the Backend database and address service (q1)', () => {
  const blocks = plan('--backend-tz', 'America/Los_Angeles', '--demo-data');
  const backend = find(blocks, 'backend');
  for (const step of ['migrate-deploy', 'demo-data']) {
    const env = find(blocks, step).env;
    assert.equal(env.DATABASE_URL, backend.env.DATABASE_URL, step);
    assert.equal(env.ADDRESS_GEOCODER_URL, backend.env.ADDRESS_GEOCODER_URL, step);
  }
});

test('--geocoder-url points the Backend and demo data elsewhere (S11, P1)', () => {
  const blocks = plan('--demo-data', '--geocoder-url', 'http://127.0.0.1:9');
  assert.equal(find(blocks, 'backend').env.ADDRESS_GEOCODER_URL, 'http://127.0.0.1:9');
  assert.equal(find(blocks, 'demo-data').env.ADDRESS_GEOCODER_URL, 'http://127.0.0.1:9');
});

test('each app gets its API, sign-in authority, and own client id, on its own port', () => {
  const blocks = plan();
  for (const [app, port] of [
    ['admin-app', '5173'],
    ['customer-app', '5174'],
    ['booth-app', '5175'],
  ]) {
    const child = find(blocks, app);
    assert.match(
      child.command,
      new RegExp(`dev --workspace @queuepass/${app} -- --port ${port} --strictPort`),
    );
    for (const key of ['VITE_API_BASE_URL', 'VITE_OIDC_AUTHORITY', 'VITE_OIDC_CLIENT_ID']) {
      assert.equal(child.env[key], composeValue(app, key, 'args'), `${app} ${key}`);
    }
  }
  assert.deepEqual(
    blocks.filter((b) => b.kind === 'child').map((b) => b.name),
    ['backend', 'admin-app', 'customer-app', 'booth-app'],
  );
});

test('refuses an unknown argument', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--print', '--nope'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
});

// Review round 1, m3: when /health never answers, the Backend child is stopped before the
// script gives up, not left running.
test('stops the Backend when /health never answers', async () => {
  const { run } = await import('../run-host.mjs');
  const started = [];
  const backend = {
    name: 'backend',
    // `|| exit 1` keeps the shell as the parent on every platform, a process tree like npm's
    // (issue: Ubuntu's sh left the Node child running and CI waited 30 minutes).
    command: `"${process.execPath}" -e "setInterval(() => {}, 1000)" || exit 1`,
    env: {},
  };
  await assert.rejects(
    run(
      {},
      {
        plan: { setup: [], children: [backend] },
        healthUrl: 'http://127.0.0.1:9/health',
        healthTimeoutMs: 1500,
        onStart: (child) => started.push(child),
        quiet: true,
      },
    ),
    /did not answer/,
  );
  assert.equal(started.length, 1);
  const child = started[0];
  // The output pipe closes only once every process in the tree has exited, the shell and the
  // Node process under it. At most 5 s: a process left running fails the test instead of
  // hanging it.
  const closed = await Promise.race([
    new Promise((resolve) => {
      if (child.stdout.closed) resolve(true);
      else child.stdout.once('close', () => resolve(true));
    }),
    new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
  ]);
  if (!closed) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
    child.stdout.destroy();
    child.stderr.destroy();
  }
  assert.ok(closed, 'the Backend still runs');
});
