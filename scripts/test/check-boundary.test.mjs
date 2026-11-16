// Constitution I, spec 037 (research R11, tasks T016): the boundary check covers the Rust Admin
// app too. It fails when a Cargo manifest of admin-rust-app lists a database crate, or when its
// `core` or `app` sources hold database code. Each case builds a small tree in a temporary folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  boundaryFailures,
  cargoDependencies,
  RUST_APPS,
  RUST_FORBIDDEN_CRATES,
} from '../check-boundary.mjs';

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'qp-boundary-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const CLEAN_RUST = {
  'admin-rust-app/package.json': '{ "name": "@queuepass/admin-rust-app" }',
  'admin-rust-app/Cargo.toml':
    '[workspace]\nmembers = ["core", "app"]\n\n[workspace.dependencies]\nserde = "1"\n',
  'admin-rust-app/core/Cargo.toml':
    '[package]\nname = "admin-rust-core"\n\n[dependencies]\nserde.workspace = true\nreqwest = { version = "0.12", default-features = false }\n',
  'admin-rust-app/app/Cargo.toml':
    '[package]\nname = "admin-rust-app"\n\n[dependencies]\nleptos = "0.8"\n',
  'admin-rust-app/core/src/lib.rs': 'pub fn ping() -> &\'static str { "ok" }\n',
  'admin-rust-app/app/src/main.rs': 'fn main() {}\n',
};

test('names exactly the database crates of research R11', () => {
  assert.deepEqual(RUST_FORBIDDEN_CRATES, [
    'sqlx',
    'diesel',
    'postgres',
    'tokio-postgres',
    'sea-orm',
    'prisma-client-rust',
  ]);
});

test('a Rust Admin app with no database crate or code passes', () => {
  const root = tree(CLEAN_RUST);
  try {
    assert.deepEqual(boundaryFailures(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [manifest, section] of [
  ['admin-rust-app/Cargo.toml', '[workspace.dependencies]'],
  ['admin-rust-app/core/Cargo.toml', '[dependencies]'],
  ['admin-rust-app/core/Cargo.toml', '[dev-dependencies]'],
  ['admin-rust-app/app/Cargo.toml', '[target.\'cfg(target_arch = "wasm32")\'.dependencies]'],
]) {
  for (const crate of RUST_FORBIDDEN_CRATES) {
    test(`fails when ${manifest} lists ${crate} under ${section}`, () => {
      const root = tree({
        ...CLEAN_RUST,
        [manifest]: `${CLEAN_RUST[manifest]}\n${section}\n${crate} = { version = "1" }\n`,
      });
      try {
        const failures = boundaryFailures(root);
        assert.equal(failures.length, 1, failures.join('\n'));
        assert.match(failures[0], new RegExp(`${manifest}: lists "${crate}"`));
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
}

for (const section of ['[dependencies.sqlx]', "[target.'cfg(unix)'.dev-dependencies.sqlx]"]) {
  test(`fails on a crate's own table, ${section}`, () => {
    const root = tree({
      ...CLEAN_RUST,
      'admin-rust-app/core/Cargo.toml': `${CLEAN_RUST['admin-rust-app/core/Cargo.toml']}\n${section}\nversion = "0.8"\n`,
    });
    try {
      assert.match(boundaryFailures(root).join('\n'), /core\/Cargo\.toml: lists "sqlx"/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('fails on a renamed crate in its own table ([dependencies.db] package = "sqlx")', () => {
  assert.deepEqual(cargoDependencies('[dependencies.db]\npackage = "sqlx"\nversion = "1"\n'), [
    'db',
    'sqlx',
  ]);
});

test('fails when Cargo.lock pulls in a database crate through another crate', () => {
  const root = tree({
    ...CLEAN_RUST,
    'admin-rust-app/Cargo.lock':
      'version = 4\n\n[[package]]\nname = "serde"\n\n[[package]]\nname = "tokio-postgres"\nversion = "0.7.0"\n',
  });
  try {
    assert.match(boundaryFailures(root).join('\n'), /Cargo\.lock: pulls in "tokio-postgres"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails on a renamed database crate (package = "sqlx")', () => {
  const root = tree({
    ...CLEAN_RUST,
    'admin-rust-app/core/Cargo.toml': `${CLEAN_RUST['admin-rust-app/core/Cargo.toml']}db = { package = "sqlx", version = "0.8" }\n`,
  });
  try {
    assert.match(boundaryFailures(root).join('\n'), /core\/Cargo\.toml: lists "sqlx"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [file, text] of [
  ['admin-rust-app/core/src/db.rs', 'const URL: &str = "postgres://qp@localhost/qp";'],
  ['admin-rust-app/app/src/env.rs', 'let url = env!("DATABASE_URL");'],
  ['admin-rust-app/core/src/api/query.rs', 'use sqlx::PgPool;'],
]) {
  test(`fails on database code in ${file}`, () => {
    const root = tree({ ...CLEAN_RUST, [file]: text });
    try {
      const failures = boundaryFailures(root);
      assert.equal(failures.length, 1, failures.join('\n'));
      // Spec 040 (R14, Windows): `walk` joins paths with the platform's separator.
      assert.match(failures[0], new RegExp(file.replaceAll('/', '[\\\\/]')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

// Spec 040 (research R12, tasks T014): the Rust Customer app's manifests, lock file, and sources
// are scanned the same way.
const CLEAN_CUSTOMER_RUST = Object.fromEntries(
  Object.entries(CLEAN_RUST).map(([path, text]) => [
    path.replace('admin-rust-app/', 'customer-rust-app/'),
    text.replaceAll('admin-rust', 'customer-rust'),
  ]),
);

test('scans both Rust apps', () => {
  assert.deepEqual(RUST_APPS, ['admin-rust-app', 'customer-rust-app']);
});

test('both Rust apps with no database crate or code pass', () => {
  const root = tree({ ...CLEAN_RUST, ...CLEAN_CUSTOMER_RUST });
  try {
    assert.deepEqual(boundaryFailures(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const manifest of ['Cargo.toml', 'core/Cargo.toml', 'app/Cargo.toml']) {
  for (const crate of RUST_FORBIDDEN_CRATES) {
    test(`fails when customer-rust-app/${manifest} lists ${crate}`, () => {
      const path = `customer-rust-app/${manifest}`;
      const root = tree({
        ...CLEAN_RUST,
        ...CLEAN_CUSTOMER_RUST,
        [path]: `${CLEAN_CUSTOMER_RUST[path]}\n[dependencies]\n${crate} = { version = "1" }\n`,
      });
      try {
        const failures = boundaryFailures(root);
        assert.equal(failures.length, 1, failures.join('\n'));
        assert.equal(failures[0], `${path}: lists "${crate}"`);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
}

test("fails when the Rust Customer app's Cargo.lock pulls in a database crate", () => {
  const root = tree({
    ...CLEAN_CUSTOMER_RUST,
    'customer-rust-app/Cargo.lock': 'version = 4\n\n[[package]]\nname = "diesel"\n',
  });
  try {
    assert.deepEqual(boundaryFailures(root), ['customer-rust-app/Cargo.lock: pulls in "diesel"']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [file, text] of [
  ['customer-rust-app/core/src/db.rs', 'const URL: &str = "postgresql://qp@localhost/qp";'],
  ['customer-rust-app/app/src/env.rs', 'let url = env!("DATABASE_URL");'],
  ['customer-rust-app/core/src/orm.rs', 'use sea_orm::Database;'],
]) {
  test(`fails on database code in ${file}`, () => {
    const root = tree({ ...CLEAN_CUSTOMER_RUST, [file]: text });
    try {
      const failures = boundaryFailures(root);
      assert.equal(failures.length, 1, failures.join('\n'));
      assert.match(failures[0], new RegExp(file.replaceAll('/', '[\\\\/]')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('the repository itself passes', () => {
  assert.deepEqual(boundaryFailures(join(import.meta.dirname, '..', '..')), []);
});
