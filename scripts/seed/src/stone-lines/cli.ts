import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { greyOf } from './facets';
import {
  SETTINGS,
  decode,
  differences,
  encodeLines,
  linesImage,
  sourceText,
  type LineSettings,
} from './lines';

/**
 * Spec 027 research R3 (FR-010, SC-004): makes the lines image from Keycloak's stones image, or
 * with --check confirms the committed one is what it makes (the same decoded pixels and text).
 *
 *   npm run stone-lines --workspace @queuepass/seed -- [--check] <keycloak-bg.png>
 *
 * The input path is resolved against the folder npm was run from (INIT_CWD); the output is
 * keycloak/themes/queuepass/login/resources/img/stone-lines.png in the repository. `--out <path>`
 * names another output (resolved as the input), for tests.
 */

/** Research R1: Keycloak 26.0.8's keycloak-bg.png, the one image the lines are made from. */
export const SOURCE = {
  name: 'keycloak-bg.png',
  version: '26.0.8',
  sha256: '0825175291be11f7689e8718295e422bb6fa4f8fefccc5610292b720c701ac4e',
};

/** The committed lines image, relative to the repository root. */
export const OUTPUT = 'keycloak/themes/queuepass/login/resources/img/stone-lines.png';

export interface Io {
  env: Record<string, string | undefined>;
  cwd: string;
  readFile(path: string): Uint8Array;
  writeFile(path: string, bytes: Uint8Array): void;
  log(message: string): void;
  error(message: string): void;
}

const nodeIo: Io = {
  env: process.env,
  cwd: process.cwd(),
  readFile: (path) => readFileSync(path),
  writeFile: (path, bytes) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  },
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

/** The repository root: the nearest folder at or above `from` whose package.json has workspaces. */
export function repositoryRoot(from: string): string {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const manifest = resolve(dir, 'package.json');
    if (existsSync(manifest) && 'workspaces' in JSON.parse(readFileSync(manifest, 'utf8'))) {
      return dir;
    }
    if (dirname(dir) === dir) throw new Error(`no repository root at or above ${from}`);
  }
}

/** A path given on the command line, resolved against the folder npm was run from. */
export function resolveArgument(path: string, io: Pick<Io, 'env' | 'cwd'>): string {
  return resolve(io.env['INIT_CWD'] ?? io.cwd, path);
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const USAGE = 'usage: stone-lines [--check] [--out <path>] <keycloak-bg.png>';

/** Runs the command; returns its exit code. */
export function main(
  argv: string[],
  io: Io = nodeIo,
  source: typeof SOURCE = SOURCE,
  settings: LineSettings = SETTINGS,
): number {
  let check = false;
  let out: string | undefined;
  const inputs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--check') check = true;
    else if (arg === '--out' && argv[i + 1] !== undefined) out = argv[++i];
    else if (arg.startsWith('-')) {
      io.error(USAGE);
      return 2;
    } else inputs.push(arg);
  }
  if (inputs.length !== 1) {
    io.error(USAGE);
    return 2;
  }

  const input = resolveArgument(inputs[0]!, io);
  const bytes = io.readFile(input);
  const got = sha256(bytes);
  if (got !== source.sha256) {
    io.error(
      `${input} has SHA-256 ${got}; expected ${source.sha256}, Keycloak ${source.version}'s ` +
        `${source.name}. The lines are made only from that image (spec 027 research R1, R3).`,
    );
    return 1;
  }

  const image = linesImage(greyOf(decode(bytes)), settings, sourceText(source, settings));
  const fresh = encodeLines(image);
  const target = out ? resolveArgument(out, io) : resolve(repositoryRoot(io.cwd), OUTPUT);

  if (!check) {
    io.writeFile(target, fresh);
    io.log(`wrote ${target}`);
    return 0;
  }
  let committed: Uint8Array;
  try {
    committed = io.readFile(target);
  } catch {
    io.error(`${target}: no image to check; run the command without --check to make it`);
    return 1;
  }
  const found = differences(decode(committed), decode(fresh));
  if (found.length > 0) {
    io.error(`${target} is not what the generator makes from ${input}:`);
    for (const line of found) io.error(`  ${line}`);
    return 1;
  }
  io.log(`${target}: the same pixels and Source chunk as a fresh run`);
  return 0;
}

const isEntrypoint =
  process.argv[1] !== undefined && /stone-lines[/\\]cli\.ts$/.test(process.argv[1]);

if (isEntrypoint) process.exit(main(process.argv.slice(2)));
