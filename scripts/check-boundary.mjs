// Constitution I / spec 001 FR-033: no front end may contain database access code or a
// database driver. Fails naming the file and the match (research R12). Spec 037 (research R11):
// the Rust Admin app too, through its Cargo manifests and its `core` and `app` sources. Spec 040
// (research R12): and the Rust Customer app, the same way.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APPS = ['admin-app', 'customer-app', 'booth-app'];
const FORBIDDEN_DEPS = [
  '@prisma/client',
  'prisma',
  'pg',
  'postgres',
  'mysql2',
  'typeorm',
  'sequelize',
  'knex',
];
const FORBIDDEN_TEXT = ['DATABASE_URL', 'postgres://', 'postgresql://', '@prisma/client'];
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/** Spec 037: the Rust apps' Cargo manifests and sources; spec 040 adds the Rust Customer app. */
export const RUST_APPS = ['admin-rust-app', 'customer-rust-app'];
const RUST_MANIFESTS = ['Cargo.toml', 'core/Cargo.toml', 'app/Cargo.toml'];
const RUST_SOURCES = ['core/src', 'app/src'];
export const RUST_FORBIDDEN_CRATES = [
  'sqlx',
  'diesel',
  'postgres',
  'tokio-postgres',
  'sea-orm',
  'prisma-client-rust',
];
const RUST_FORBIDDEN_TEXT = [
  ...FORBIDDEN_TEXT,
  'sqlx::',
  'diesel::',
  'tokio_postgres',
  'sea_orm',
  'prisma_client_rust',
];

function walk(dir, needles, failures) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, needles, failures);
    else {
      const text = readFileSync(path, 'utf8');
      for (const needle of needles) {
        if (text.includes(needle)) failures.push(`${path}: contains "${needle}"`);
      }
    }
  }
}

/**
 * The crates a Cargo manifest names in any dependency table (`[dependencies]`,
 * `[dev-dependencies]`, `[build-dependencies]`, `[workspace.dependencies]`, and their
 * `[target.….dependencies]` forms), by key and by `package = "…"` rename.
 */
export function cargoDependencies(text) {
  const crates = [];
  // 'list': a dependencies table, one crate a key; 'one': `[dependencies.<crate>]`, one crate's
  // own table (review finding 5), where only `package = "…"` names another.
  let mode = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const table = /^\[([^\]]+)\]$/.exec(line);
    if (table) {
      const name = table[1].trim();
      const one =
        /(^|\.)(dependencies|dev-dependencies|build-dependencies)\."?([A-Za-z0-9_-]+)"?$/.exec(
          name,
        );
      if (one) {
        crates.push(one[3]);
        mode = 'one';
      } else {
        mode = /(^|\.)(dependencies|dev-dependencies|build-dependencies)$/.test(name)
          ? 'list'
          : null;
      }
      continue;
    }
    if (!mode) continue;
    const key = /^"?([A-Za-z0-9_-]+)"?\s*(=|\.)/.exec(line);
    if (mode === 'list' && key) crates.push(key[1]);
    const renamed = /package\s*=\s*"([A-Za-z0-9_-]+)"/.exec(line);
    if (renamed) crates.push(renamed[1]);
  }
  return crates;
}

/** Every package `Cargo.lock` lists, the crates pulled in through others included. */
export function cargoLockPackages(text) {
  return [...text.matchAll(/^name = "([A-Za-z0-9_-]+)"$/gm)].map((m) => m[1]);
}

/** Every boundary failure under `root`, as `path: reason` lines. */
export function boundaryFailures(root) {
  const failures = [];
  for (const app of APPS) {
    const dir = join(root, app);
    if (!existsSync(dir)) continue;
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    for (const field of DEP_FIELDS) {
      for (const dep of Object.keys(pkg[field] ?? {})) {
        if (FORBIDDEN_DEPS.includes(dep))
          failures.push(`${app}/package.json: ${field} lists "${dep}"`);
      }
    }
    if (existsSync(join(dir, 'src'))) walk(join(dir, 'src'), FORBIDDEN_TEXT, failures);
  }

  for (const app of RUST_APPS) {
    const rust = join(root, app);
    if (!existsSync(rust)) continue;
    for (const manifest of RUST_MANIFESTS) {
      const path = join(rust, manifest);
      if (!existsSync(path)) continue;
      for (const crate of new Set(cargoDependencies(readFileSync(path, 'utf8')))) {
        if (RUST_FORBIDDEN_CRATES.includes(crate))
          failures.push(`${app}/${manifest}: lists "${crate}"`);
      }
    }
    const lock = join(rust, 'Cargo.lock');
    if (existsSync(lock)) {
      for (const crate of new Set(cargoLockPackages(readFileSync(lock, 'utf8')))) {
        if (RUST_FORBIDDEN_CRATES.includes(crate))
          failures.push(`${app}/Cargo.lock: pulls in "${crate}"`);
      }
    }
    for (const sources of RUST_SOURCES) {
      const dir = join(rust, sources);
      if (existsSync(dir)) walk(dir, RUST_FORBIDDEN_TEXT, failures);
    }
  }
  return failures;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const failures = boundaryFailures('.');
  if (failures.length > 0) {
    console.error('[boundary] front ends must reach data only through the Backend API:');
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  const checked = [...APPS, ...RUST_APPS].filter((a) => existsSync(a));
  console.log(`[boundary] ${checked.join(', ')}: no database access`);
}
