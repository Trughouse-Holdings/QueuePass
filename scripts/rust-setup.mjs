#!/usr/bin/env node
// Spec 037 (research R12): `npm run rust:setup` readies a machine that has `rustup` to build and
// test the Rust Admin app. `rustup show` in admin-rust-app/ installs the toolchain its
// rust-toolchain.toml pins, with the WebAssembly target and the coverage, format, and lint
// components. Then the pinned prebuilt `trunk` and `cargo-llvm-cov` are downloaded into
// ~/.cargo/bin, only when missing or at another version. It is a part of the root `ci` script, so
// spec 011's workflow shape holds (one named step per part, no cache step).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

export const TOOLS = [
  { name: 'trunk', version: '0.22.1', repo: 'trunk-rs/trunk' },
  { name: 'cargo-llvm-cov', version: '0.9.1', repo: 'taiki-e/cargo-llvm-cov' },
];

const TRIPLES = {
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
};

export function hostTriple(platform, arch) {
  const triple = TRIPLES[`${platform}-${arch}`];
  if (!triple) throw new Error(`rust:setup: ${platform} ${arch} is not supported`);
  return triple;
}

export function assetUrl(tool, triple) {
  return `https://github.com/${tool.repo}/releases/download/v${tool.version}/${tool.name}-${triple}.tar.gz`;
}

/** `--version` output, or null when the tool is missing. */
export function needsInstall(tool, versionOutput) {
  if (!versionOutput) return true;
  return !new RegExp(`(^|\\s)v?${tool.version.replaceAll('.', '\\.')}(\\s|$)`).test(
    versionOutput.trim(),
  );
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', () => resolve(127));
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

function version(binary, binDir) {
  return new Promise((resolve) => {
    const args = binary === 'cargo-llvm-cov' ? ['llvm-cov', '--version'] : ['--version'];
    const command = binary === 'cargo-llvm-cov' ? join(binDir, 'cargo') : join(binDir, binary);
    let out = '';
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.on('data', (chunk) => (out += chunk));
    child.on('error', () => resolve(null));
    child.on('exit', (code) => resolve(code === 0 ? out : null));
  });
}

async function install(url, binDir, name) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`rust:setup: ${name}: ${url} answered ${response.status}`);
  mkdirSync(binDir, { recursive: true });
  const tar = spawn('tar', ['-xzf', '-', '-C', binDir, name], {
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  const done = new Promise((resolve, reject) => {
    tar.on('error', reject);
    tar.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`rust:setup: unpacking ${name} failed`)),
    );
  });
  await pipeline(Readable.fromWeb(response.body), tar.stdin);
  await done;
}

export async function main(deps = {}) {
  const {
    platform = process.platform,
    arch = process.arch,
    home = homedir(),
    log = (text) => console.log(text),
    error = (text) => console.error(text),
  } = deps;
  const binDir = join(home, '.cargo', 'bin');
  const runCommand = deps.run ?? run;
  const versionOf = deps.version ?? ((binary) => version(binary, binDir));
  const installTool = deps.install ?? install;

  const code = await runCommand('rustup', ['show'], { cwd: join(ROOT, 'admin-rust-app') });
  if (code !== 0) {
    error('rust:setup: `rustup show` failed. Install rustup first: https://rustup.rs');
    return code;
  }
  const triple = hostTriple(platform, arch);
  for (const tool of TOOLS) {
    if (!needsInstall(tool, await versionOf(tool.name))) continue;
    log(`rust:setup: installing ${tool.name} ${tool.version}`);
    await installTool(assetUrl(tool, triple), binDir, tool.name);
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err.message);
      process.exit(1);
    },
  );
}
