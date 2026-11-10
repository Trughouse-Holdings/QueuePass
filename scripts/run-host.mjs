// Spec 020 (research R21, tasks T058): the running-system gate's host-run path (quickstart path B),
// for a machine whose images do not build. The database and Keycloak run in Docker (their own
// compose project, `docker compose -p qp020gate up -d database keycloak`); this script runs the
// rest from the host, each child with its whole environment set here, values as in
// docker-compose.yml's defaults with `localhost` in place of the service names.
//
//   node scripts/run-host.mjs --backend-tz America/Los_Angeles [--demo-data]
//                             [--geocoder-url http://127.0.0.1:9] [--print]
//
// Setup, in order: build @queuepass/shared, prisma generate, prisma migrate deploy, the Keycloak
// seed, build the Backend, and (with --demo-data) load the demo data. Then the Backend
// (start:prod), and, once http://localhost:3000/health answers, the three apps (vite on 5173,
// 5174, 5175, the exact redirect URIs of their OIDC clients). Output is prefixed by name; Ctrl+C
// stops all four. --print shows every step and child with its environment and starts nothing.
//
// Spec 029 (research R6): `--demo-reset` runs one step instead, the demo checkpoint (`npm run
// demo-reset --workspace @queuepass/backend`) with the Backend's environment, in a second
// terminal while the stack runs, and exits: no build, migration, seed, or child. The person gives
// the permission on the command line; this script passes it on and never sets it:
//
//   QUEUEPASS_ALLOW_RESET=1 node scripts/run-host.mjs --demo-reset
//
// It needs the Backend built (`npm run build --workspace @queuepass/backend`) and says so if not.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

const KEYCLOAK = 'http://localhost:8080';
// Spec 028 (research R8, data-model.md): every app realm is under this base; each app signs in
// through its own realm.
const REALMS = `${KEYCLOAK}/realms`;
const API = 'http://localhost:3000';

/** Spec 029 FR-002: the compiled reset, which `--demo-reset` needs and never builds. */
const RESET_SCRIPT = fileURLToPath(
  new URL('../backend/dist/scripts/demo-reset.js', import.meta.url),
);

function parseArgs(argv) {
  const o = {
    print: false,
    demoData: false,
    demoReset: false,
    backendTz: undefined,
    geocoderUrl: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--print') o.print = true;
    else if (a === '--demo-data') o.demoData = true;
    else if (a === '--demo-reset') o.demoReset = true;
    else if (a === '--backend-tz') o.backendTz = argv[++i];
    else if (a === '--geocoder-url') o.geocoderUrl = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (o.demoReset && o.demoData) {
    throw new Error(
      '--demo-reset and --demo-data cannot be used together: the reset loads the demo data.',
    );
  }
  return o;
}

/** Every step and child, with the environment each one is given (on top of the parent's). */
export function plan(options) {
  const backendEnv = {
    DATABASE_URL: 'postgresql://queuepass:queuepass@localhost:5432/queuepass?schema=public',
    PORT: '3000',
    OIDC_ISSUER_BASE: REALMS,
    OIDC_JWKS_BASE: REALMS,
    OIDC_AUDIENCE: 'queuepass-api',
    CORS_ORIGINS: 'http://localhost:5173,http://localhost:5174,http://localhost:5175',
    ADDRESS_GEOCODER_URL: options.geocoderUrl ?? 'https://geocoding.geo.census.gov',
    ...(options.backendTz ? { TZ: options.backendTz } : {}),
  };
  if (options.demoReset) {
    // Spec 029 research R6: the one step, with the Backend child's environment; the person's
    // QUEUEPASS_ALLOW_RESET comes through the parent environment, never set or defaulted here.
    return {
      setup: [
        {
          name: 'demo-reset',
          command: 'npm run demo-reset --workspace @queuepass/backend',
          env: { ...backendEnv },
        },
      ],
      children: [],
    };
  }
  const db = {
    DATABASE_URL: backendEnv.DATABASE_URL,
    ADDRESS_GEOCODER_URL: backendEnv.ADDRESS_GEOCODER_URL,
  };
  const setup = [
    { name: 'shared-build', command: 'npm run build --workspace @queuepass/shared', env: {} },
    {
      name: 'prisma-generate',
      command: 'npm run prisma:generate --workspace @queuepass/backend',
      env: {},
    },
    {
      name: 'migrate-deploy',
      command: 'npm run prisma:deploy --workspace @queuepass/backend',
      env: db,
    },
    {
      name: 'seed',
      command: 'npm run seed --workspace @queuepass/seed',
      env: {
        KEYCLOAK_URL: KEYCLOAK,
        KEYCLOAK_HEALTH_URL: 'http://localhost:9000',
        KEYCLOAK_ADMIN: 'admin',
        KEYCLOAK_ADMIN_PASSWORD: 'admin',
        SEED_USER_PASSWORD: 'test123',
      },
    },
    { name: 'backend-build', command: 'npm run build --workspace @queuepass/backend', env: {} },
    ...(options.demoData
      ? [
          {
            name: 'demo-data',
            command: 'npm run demo-data --workspace @queuepass/backend',
            // The demo data boots the Backend's own module, so it gets the Backend's environment.
            env: backendEnv,
          },
        ]
      : []),
  ];
  const app = (name, port) => ({
    name,
    command: `npm run dev --workspace @queuepass/${name} -- --port ${port} --strictPort`,
    env: {
      VITE_API_BASE_URL: API,
      VITE_OIDC_AUTHORITY: `${REALMS}/queuepass-${name}`,
      VITE_OIDC_CLIENT_ID: name,
    },
  });
  const children = [
    {
      name: 'backend',
      command: 'npm run start:prod --workspace @queuepass/backend',
      env: backendEnv,
    },
    app('admin-app', 5173),
    app('customer-app', 5174),
    app('booth-app', 5175),
  ];
  return { setup, children };
}

function print({ setup, children }) {
  const block = (kind, s) =>
    [
      `${kind} ${s.name}: ${s.command}`,
      ...Object.entries(s.env).map(([k, v]) => `    ${k}=${v}`),
    ].join('\n');
  console.log(
    [...setup.map((s) => block('setup', s)), ...children.map((c) => block('child', c))].join('\n'),
  );
}

const childEnv = (env) => ({ ...process.env, ...env });

/** Prefixes each line of a child's output with its name. */
function pipe(name, stream, out) {
  let rest = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    const lines = (rest + chunk).split(/\r?\n/);
    rest = lines.pop() ?? '';
    for (const line of lines) out.write(`[${name}] ${line}\n`);
  });
  stream.on('end', () => rest && out.write(`[${name}] ${rest}\n`));
}

async function waitForHealth(url, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${url} did not answer within ${timeoutMs / 1000} s`);
}

/**
 * Runs the plan. `deps` exists for scripts/test/run-host.test.mjs: another plan, the health URL
 * and how long to wait for it, a callback per started child, quiet output, and (spec 029) the
 * compiled reset's path.
 */
export async function run(options, deps = {}) {
  const { setup, children } = deps.plan ?? plan(options);
  const healthUrl = deps.healthUrl ?? `${API}/health`;
  // Spec 029 FR-002: never rebuild; say so and stop when the Backend has not been built.
  if (options.demoReset && !existsSync(deps.resetScript ?? RESET_SCRIPT)) {
    throw new Error('Build the Backend first: npm run build --workspace @queuepass/backend');
  }
  for (const step of setup) {
    console.log(`\n=== ${step.name}: ${step.command}`);
    const r = spawnSync(step.command, {
      cwd: ROOT,
      env: childEnv(step.env),
      shell: true,
      stdio: 'inherit',
    });
    if (r.status !== 0) throw new Error(`${step.name} failed (exit ${r.status})`);
  }
  // Spec 029 research R6: reset mode ends after its step; no Backend, health wait, or SIGINT handler.
  if (options.demoReset) return;

  const running = [];
  const start = (c) => {
    // Elsewhere than Windows, its own process group, so stopping reaches the whole tree.
    const child = spawn(c.command, {
      cwd: ROOT,
      env: childEnv(c.env),
      shell: true,
      detached: process.platform !== 'win32',
    });
    if (!deps.quiet) {
      pipe(c.name, child.stdout, process.stdout);
      pipe(c.name, child.stderr, process.stderr);
      child.on('exit', (code) => console.log(`[${c.name}] exited (${code})`));
    } else {
      child.stdout.resume();
      child.stderr.resume();
    }
    running.push(child);
    deps.onStart?.(child);
  };
  const stopAll = () => {
    for (const child of running) {
      if (child.exitCode !== null) continue;
      // npm under a shell starts a process tree: on Windows only taskkill /T stops all of it;
      // elsewhere the signal goes to the child's process group (a shell such as Ubuntu's sh
      // does not pass SIGINT on to the command it runs).
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        try {
          process.kill(-child.pid, 'SIGINT');
        } catch {
          // The group is already gone.
        }
      }
    }
  };
  process.on('SIGINT', () => {
    console.log('\nStopping the Backend and the apps…');
    stopAll();
    process.exit(0);
  });

  const [backend, ...apps] = children;
  start(backend);
  try {
    await waitForHealth(healthUrl, deps.healthTimeoutMs);
  } catch (err) {
    // Review round 1, m3: never leave the Backend running when giving up.
    stopAll();
    throw err;
  }
  console.log(`[backend] healthy at ${healthUrl}`);
  for (const a of apps) start(a);
  console.log(
    'Admin http://localhost:5173 · Customer http://localhost:5174 · Booth http://localhost:5175 (Ctrl+C stops all four)',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.print) print(plan(options));
    else await run(options);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
