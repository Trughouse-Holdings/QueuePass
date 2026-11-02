import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { decode, encode } from 'fast-png';
import { findFacets, greyOf, type GreyImage } from '../src/stone-lines/facets';
import {
  SETTINGS,
  SOURCE_KEY,
  differences,
  encodeLines,
  lineAlpha,
  linesImage,
  sourceText,
  type LineSettings,
} from '../src/stone-lines/lines';
import {
  OUTPUT,
  SOURCE,
  main,
  repositoryRoot,
  resolveArgument,
  type Io,
} from '../src/stone-lines/cli';

/**
 * Spec 027 research R3, R8 (FR-010, SC-004): the generator of the lines image, on small images
 * made here. No test writes to, or overwrites, the committed stone-lines.png: the command's
 * files go to a temporary folder, or to a fake that only records the path.
 */

const W = 40;
const H = 30;

/** Two flat facets, `left` and `right`, split by a slanting seam one anti-aliased pixel wide. */
function twoFacets(left: number, right: number): GreyImage {
  const grey = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const seam = 12 + Math.floor(y / 2);
    for (let x = 0; x < W; x++) {
      // On the seam, a grey between the two that changes along it, as anti-aliasing does.
      const t = ((y * 7) % 9) / 10 + 0.05;
      grey[y * W + x] = x < seam ? left : x > seam ? right : Math.round(left + (right - left) * t);
    }
  }
  return { width: W, height: H, grey };
}

const crisp: LineSettings = { minArea: 20, minStep: 2, widen: 0, soften: 0, strength: 255 };

/** The 8-connected groups of pixels whose alpha is above 0. */
function groups(alpha: Uint8Array, width: number): number[][] {
  const seen = new Uint8Array(alpha.length);
  const out: number[][] = [];
  for (let s = 0; s < alpha.length; s++) {
    if (!alpha[s] || seen[s]) continue;
    const group: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      group.push(p);
      const x = p % width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const q = p + dy * width + dx;
          const qx = x + dx;
          if (qx < 0 || qx >= width || q < 0 || q >= alpha.length) continue;
          if (alpha[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    out.push(group);
  }
  return out;
}

describe('the facets (facets.ts)', () => {
  it('gives every seam pixel to one of the two facets', () => {
    const { label, grey } = findFacets(twoFacets(100, 110), 20);
    expect(grey).toEqual([100, 110]);
    expect([...label].every((l) => l === 0 || l === 1)).toBe(true);
  });

  it('refuses an image with no flat region as large as minArea', () => {
    expect(() => findFacets(twoFacets(100, 110), 10_000)).toThrow(/no flat region/);
  });

  it('reads the grey of an RGB image and refuses one that is not grey', () => {
    const rgb = new Uint8Array([7, 7, 7, 9, 9, 9]);
    expect(greyOf({ width: 2, height: 1, data: rgb, depth: 8, channels: 3 }).grey).toEqual(
      new Uint8Array([7, 9]),
    );
    const colored = new Uint8Array([7, 7, 7, 9, 8, 9]);
    expect(() => greyOf({ width: 2, height: 1, data: colored, depth: 8, channels: 3 })).toThrow(
      /\(1, 0\) is not grey/,
    );
    expect(() =>
      greyOf({ width: 1, height: 1, data: new Uint16Array(1), depth: 16, channels: 1 }),
    ).toThrow(/8-bit/);
    expect(() =>
      greyOf({ width: 1, height: 1, data: new Uint8Array(5), depth: 8, channels: 5 }),
    ).toThrow(/channel/);
  });
});

describe('the lines (lines.ts)', () => {
  it('draws one continuous line along an anti-aliased seam, with no gap', () => {
    const alpha = lineAlpha(twoFacets(100, 110), crisp);
    const found = groups(alpha, W);
    expect(found).toHaveLength(1);
    // It reaches every row, next to the seam.
    const rows = new Set(found[0]!.map((p) => Math.floor(p / W)));
    expect(rows.size).toBe(H);
    for (const p of found[0]!) {
      expect(Math.abs((p % W) - (12 + Math.floor(Math.floor(p / W) / 2)))).toBeLessThanOrEqual(2);
    }
  });

  it('draws no line between facets closer than minStep', () => {
    expect(lineAlpha(twoFacets(100, 101), crisp).some((a) => a > 0)).toBe(false);
  });

  it('widens the line and softens its edge as the settings say', () => {
    const count = (s: LineSettings, a: number) =>
      lineAlpha(twoFacets(100, 110), s).filter((v) => v === a).length;
    const thin = count(crisp, 255);
    expect(count({ ...crisp, widen: 1 }, 255)).toBeGreaterThan(thin);
    expect(count({ ...crisp, soften: 50 }, 128)).toBeGreaterThan(0);
    expect(count({ ...crisp, soften: 50 }, 255)).toBe(thin);
    expect(count({ ...crisp, strength: 160 }, 160)).toBe(thin);
  });

  it('makes a grey and alpha image, grey 255 wherever alpha is above 0, with one Source chunk', () => {
    const image = linesImage(twoFacets(100, 110), crisp, 'from the test');
    expect([image.width, image.height, image.channels, image.depth]).toEqual([W, H, 2, 8]);
    for (let i = 0; i < W * H; i++) {
      if (image.data[i * 2 + 1]! > 0) expect(image.data[i * 2]).toBe(255);
    }
    expect(image.text).toEqual({ [SOURCE_KEY]: 'from the test' });
    expect(decode(encodeLines(image)).text).toEqual({ Source: 'from the test' });
  });

  it('encodes the same image to the same bytes twice in one process', () => {
    const image = linesImage(twoFacets(100, 110), crisp, 'from the test');
    expect(Buffer.from(encodeLines(image)).equals(Buffer.from(encodeLines(image)))).toBe(true);
  });

  it('records the source and every setting in the Source text', () => {
    const text = sourceText(SOURCE, SETTINGS);
    expect(text).toContain(SOURCE.sha256);
    expect(text).toContain('Keycloak 26.0.8');
    for (const [key, value] of Object.entries(SETTINGS)) expect(text).toContain(`${key}=${value}`);
  });

  it('names what differs between two images', () => {
    const a = decode(encodeLines(linesImage(twoFacets(100, 110), crisp, 'a')));
    const b = decode(encodeLines(linesImage(twoFacets(100, 110), crisp, 'a')));
    expect(differences(a, b)).toEqual([]);
    const small = decode(encodeLines(linesImage(twoFacets(100, 110), crisp, 'a')));
    expect(differences(a, { ...small, width: 3 })).toEqual(['width: expected 40, got 3']);
  });
});

describe('the command (cli.ts)', () => {
  /** A synthetic stones image as an RGB PNG, and the source record of its SHA-256. */
  const png = encode({
    width: W,
    height: H,
    data: rgbOf(twoFacets(100, 110)),
    channels: 3,
    depth: 8,
  });
  const source = { ...SOURCE, sha256: createHash('sha256').update(png).digest('hex') };
  const dir = mkdtempSync(join(tmpdir(), 'stone-lines-'));
  const input = join(dir, 'stones.png');
  writeFileSync(input, png);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function rgbOf(img: GreyImage): Uint8Array {
    const rgb = new Uint8Array(img.grey.length * 3);
    img.grey.forEach((v, i) => rgb.set([v, v, v], i * 3));
    return rgb;
  }

  /** Real files, the console recorded. */
  function io(env: Record<string, string> = {}): Io & { out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    return {
      env,
      cwd: process.cwd(),
      readFile: (p) => readFileSync(p),
      writeFile: (p, bytes) => writeFileSync(p, bytes),
      log: (m) => out.push(m),
      error: (m) => err.push(m),
      out,
      err,
    };
  }

  it('writes the lines image to --out, and --check then passes on it', () => {
    const target = join(dir, 'lines.png');
    expect(main([input, '--out', target], io(), source, crisp)).toBe(0);
    const written = decode(readFileSync(target));
    expect(written.text).toEqual({ Source: sourceText(source, crisp) });
    const check = io();
    expect(main(['--check', input, '--out', target], check, source, crisp)).toBe(0);
    expect(check.out.join('\n')).toMatch(/the same pixels and Source chunk/);
  });

  it('--check fails, naming the pixel, on an image with one pixel changed', () => {
    const target = join(dir, 'one-pixel.png');
    main([input, '--out', target], io(), source, crisp);
    const image = decode(readFileSync(target));
    const data = new Uint8Array(image.data);
    data[2 * (5 * W + 3) + 1] ^= 0xff;
    writeFileSync(target, encode({ ...image, data, channels: 2, depth: 8 }));
    const check = io();
    expect(main(['--check', input, '--out', target], check, source, crisp)).toBe(1);
    expect(check.err.join('\n')).toMatch(/pixels: 1 values differ, the first at \(3, 5\)/);
  });

  it('--check fails, naming the chunk, on an image with another Source chunk', () => {
    const target = join(dir, 'other-source.png');
    main([input, '--out', target], io(), source, crisp);
    const image = decode(readFileSync(target));
    writeFileSync(
      target,
      encode({ ...image, channels: 2, depth: 8, text: { Source: 'elsewhere' } }),
    );
    const check = io();
    expect(main(['--check', input, '--out', target], check, source, crisp)).toBe(1);
    expect(check.err.join('\n')).toMatch(/text chunk Source: expected "elsewhere"/);
  });

  it('--check fails when there is no image to check', () => {
    const check = io();
    expect(main(['--check', input, '--out', join(dir, 'missing.png')], check, source, crisp)).toBe(
      1,
    );
    expect(check.err.join('\n')).toMatch(/missing\.png/);
  });

  it("refuses an input that is not Keycloak's image, naming the SHA-256 it expected", () => {
    const run = io();
    expect(main([input, '--out', join(dir, 'never.png')], run)).toBe(1);
    expect(run.err.join('\n')).toContain(`expected ${SOURCE.sha256}`);
    expect(run.err.join('\n')).toContain(source.sha256);
  });

  it.each([[[]], [['a.png', 'b.png']], [['--nope', 'a.png']]])(
    'prints its usage for %j',
    (argv) => {
      const run = io();
      expect(main(argv, run)).toBe(2);
      expect(run.err.join('\n')).toMatch(/^usage: stone-lines/);
    },
  );

  it('resolves the input against INIT_CWD, the folder npm was run from', () => {
    expect(resolveArgument('bg.png', { env: { INIT_CWD: dir }, cwd: '/elsewhere' })).toBe(
      resolve(dir, 'bg.png'),
    );
    expect(resolveArgument('bg.png', { env: {}, cwd: dir })).toBe(resolve(dir, 'bg.png'));
    const run = io({ INIT_CWD: dir });
    expect(main(['stones.png', '--out', 'from-init-cwd.png'], run, source, crisp)).toBe(0);
    expect(run.out.join('\n')).toContain(join(dir, 'from-init-cwd.png'));
  });

  it('writes to the committed path under the repository root by default (recorded, not written)', () => {
    // Vitest runs each workspace from its own folder (scripts/seed/).
    const root = resolve(process.cwd(), '../..');
    expect(repositoryRoot(process.cwd())).toBe(root);
    const written: string[] = [];
    const run: Io = { ...io(), writeFile: (p) => written.push(p) };
    expect(main([input], run, source, crisp)).toBe(0);
    expect(written).toEqual([resolve(root, OUTPUT)]);
  });

  it('refuses to guess a repository root where there is none', () => {
    expect(() => repositoryRoot(tmpdir())).toThrow(/no repository root/);
  });
});
