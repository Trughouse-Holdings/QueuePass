// Spec 037 (research R12, tasks T004): `npm run rust:setup` makes a machine with `rustup` ready
// to build and test the Rust Admin app: `rustup show` in admin-rust-app/ installs the pinned
// toolchain with its target and components, and the pinned prebuilt `trunk` and `cargo-llvm-cov`
// land in ~/.cargo/bin only when missing or at another version. The commands and the download are
// fakes here, so this runs in milliseconds and touches nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { TOOLS, assetUrl, hostTriple, main, needsInstall } from '../rust-setup.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('the two tools are pinned to exact versions', () => {
  assert.deepEqual(
    TOOLS.map((tool) => [tool.name, tool.version]),
    [
      ['trunk', '0.22.1'],
      ['cargo-llvm-cov', '0.9.1'],
    ],
  );
});

test('hostTriple maps the CI runner and the team machines to release targets', () => {
  assert.equal(hostTriple('linux', 'x64'), 'x86_64-unknown-linux-gnu');
  assert.equal(hostTriple('linux', 'arm64'), 'aarch64-unknown-linux-gnu');
  assert.equal(hostTriple('darwin', 'arm64'), 'aarch64-apple-darwin');
  assert.equal(hostTriple('darwin', 'x64'), 'x86_64-apple-darwin');
  assert.throws(() => hostTriple('win32', 'x64'), /not supported/);
});

test('assetUrl names the prebuilt release file of each tool', () => {
  const [trunk, cov] = TOOLS;
  assert.equal(
    assetUrl(trunk, 'x86_64-unknown-linux-gnu'),
    'https://github.com/trunk-rs/trunk/releases/download/v0.22.1/trunk-x86_64-unknown-linux-gnu.tar.gz',
  );
  assert.equal(
    assetUrl(cov, 'aarch64-apple-darwin'),
    'https://github.com/taiki-e/cargo-llvm-cov/releases/download/v0.9.1/cargo-llvm-cov-aarch64-apple-darwin.tar.gz',
  );
});

test('needsInstall: missing or another version installs; the pinned version does not', () => {
  const [trunk, cov] = TOOLS;
  assert.equal(needsInstall(trunk, null), true);
  assert.equal(needsInstall(trunk, 'trunk 0.21.0'), true);
  assert.equal(needsInstall(trunk, 'trunk 0.22.1'), false);
  assert.equal(needsInstall(cov, 'cargo-llvm-cov 0.9.1'), false);
  assert.equal(needsInstall(cov, 'cargo-llvm-cov 0.9.10'), true);
});

function fakeDeps({ versions = {}, rustup = 0 } = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      platform: 'linux',
      arch: 'x64',
      home: '/home/runner',
      run: async (command, args, options = {}) => {
        calls.push(`${command} ${args.join(' ')}${options.cwd ? ` @${options.cwd}` : ''}`);
        return command === 'rustup' ? rustup : 0;
      },
      version: async (binary) => versions[binary] ?? null,
      install: async (url, binDir, name) => {
        calls.push(`install ${name} from ${url} into ${binDir}`);
      },
      log: () => {},
      error: () => {},
    },
  };
}

test('main runs rustup show in admin-rust-app, then installs only what is missing', async () => {
  const { calls, deps } = fakeDeps({ versions: { 'cargo-llvm-cov': 'cargo-llvm-cov 0.9.1' } });
  assert.equal(await main(deps), 0);
  assert.equal(calls[0], `rustup show @${join(ROOT, 'admin-rust-app')}`);
  assert.deepEqual(calls.slice(1), [
    'install trunk from https://github.com/trunk-rs/trunk/releases/download/v0.22.1/trunk-x86_64-unknown-linux-gnu.tar.gz into /home/runner/.cargo/bin',
  ]);
});

test('main installs nothing when both pinned versions are there', async () => {
  const { calls, deps } = fakeDeps({
    versions: { trunk: 'trunk 0.22.1', 'cargo-llvm-cov': 'cargo-llvm-cov 0.9.1' },
  });
  assert.equal(await main(deps), 0);
  assert.equal(calls.length, 1);
});

test('main stops with a non-zero code, installing nothing, when rustup fails', async () => {
  const { calls, deps } = fakeDeps({ rustup: 1 });
  assert.equal(await main(deps), 1);
  assert.equal(calls.length, 1);
});

test('the root ci script runs rust:setup right after prisma:generate (R12)', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['rust:setup'], 'node scripts/rust-setup.mjs');
  const parts = pkg.scripts.ci.split(' && ');
  assert.equal(parts[0], 'npm run prisma:generate --workspace @queuepass/backend');
  assert.equal(parts[1], 'npm run rust:setup');
});
