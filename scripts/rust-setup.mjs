#!/usr/bin/env node
// Spec 037 (research R12): `npm run rust:setup` readies a machine that has `rustup` to build and
// test the Rust apps. `rustup show` in admin-rust-app/ installs the toolchain its
// rust-toolchain.toml pins, with the WebAssembly target and the coverage, format, and lint
// components. Then the pinned prebuilt `trunk` and `cargo-llvm-cov` are downloaded into
// ~/.cargo/bin, only when missing or at another version. It is a part of the root `ci` script, so
// spec 011's workflow shape holds (one named step per part, no cache step).
//
// Spec 040 (research R14): `rustup show` runs in customer-rust-app/ too (the same pinned
// toolchain, so the second is instant), and Windows is supported: the release files there are
// .zip, unpacked with Windows' own bsdtar by its full path (from Git Bash the `tar` first on PATH
// is GNU tar, which cannot read a zip), and the binaries are `<tool>.exe`.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

export const TOOLS = [
  { name: 'trunk', version: '0.22.1', repo: 'trunk-rs/trunk' },
  { name: 'cargo-llvm-cov', version: '0.9.1', repo: 'taiki-e/cargo-llvm-cov' },
];

/** The Rust apps whose rust-toolchain.toml `rustup show` installs (spec 040: both). */
export const RUST_APPS = ['admin-rust-app', 'customer-rust-app'];

const TRIPLES = {
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
};

export function hostTriple(platform, arch) {
  const triple = TRIPLES[`${platform}-${arch}`];
  if (!triple) throw new Error(`rust:setup: ${platform} ${arch} is not supported`);
  return triple;
}

const isWindowsTriple = (triple) => triple.endsWith('-windows-msvc');

export function assetUrl(tool, triple) {
  const ext = isWindowsTriple(triple) ? 'zip' : 'tar.gz';
  return `https://github.com/${tool.repo}/releases/download/v${tool.version}/${tool.name}-${triple}.${ext}`;
}

/** The file a tool is installed as: `<tool>.exe` on Windows. */
export function binaryName(name, platform) {
  return platform === 'win32' ? `${name}.exe` : name;
}

/** The command and arguments that print a tool's version (`cargo llvm-cov` runs through cargo). */
export function versionCommand(binary, binDir, platform) {
  if (binary === 'cargo-llvm-cov') {
    return [join(binDir, binaryName('cargo', platform)), ['llvm-cov', '--version']];
  }
  return [join(binDir, binaryName(binary, platform)), ['--version']];
}

/** Windows' own bsdtar, by its full path, unpacking the one `.exe` from a downloaded zip. */
export function extractCommand(file, binDir, name, env = process.env) {
  const tar = join(env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe');
  return [tar, ['-xf', file, '-C', binDir, name]];
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

function version(binary, binDir, platform) {
  return new Promise((resolve) => {
    const [command, args] = versionCommand(binary, binDir, platform);
    let out = '';
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.on('data', (chunk) => (out += chunk));
    child.on('error', () => resolve(null));
    child.on('exit', (code) => resolve(code === 0 ? out : null));
  });
}

function exited(child, name) {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`rust:setup: unpacking ${name} failed`)),
    );
  });
}

async function install(url, binDir, name) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`rust:setup: ${name}: ${url} answered ${response.status}`);
  mkdirSync(binDir, { recursive: true });
  if (url.endsWith('.zip')) {
    // Windows: bsdtar reads a zip from a file, not from a pipe.
    const dir = mkdtempSync(join(tmpdir(), 'qp-rust-setup-'));
    try {
      const file = join(dir, 'asset.zip');
      await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
      const [command, args] = extractCommand(file, binDir, name);
      await exited(spawn(command, args, { stdio: 'inherit' }), name);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    return;
  }
  const tar = spawn('tar', ['-xzf', '-', '-C', binDir, name], {
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  const done = exited(tar, name);
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
  const versionOf = deps.version ?? ((binary) => version(binary, binDir, platform));
  const installTool = deps.install ?? install;

  for (const app of RUST_APPS) {
    const code = await runCommand('rustup', ['show'], { cwd: join(ROOT, app) });
    if (code !== 0) {
      error(
        `rust:setup: \`rustup show\` failed in ${app}. Install rustup first: https://rustup.rs`,
      );
      return code;
    }
  }
  const triple = hostTriple(platform, arch);
  for (const tool of TOOLS) {
    if (!needsInstall(tool, await versionOf(tool.name))) continue;
    log(`rust:setup: installing ${tool.name} ${tool.version}`);
    await installTool(assetUrl(tool, triple), binDir, binaryName(tool.name, platform));
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
