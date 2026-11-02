import { decode, encode, type DecodedPng } from 'fast-png';
import { findFacets, type Facets, type GreyImage } from './facets';

/**
 * Spec 027 research R2, R3 (FR-003, FR-010): the lines image. White everywhere, at `strength`
 * alpha (160, about 63%, the T010 choice) on the edges between the stones of Keycloak's image and
 * clear elsewhere, so the sign-in page can show the app's accent through it as a mask.
 */

export interface LineSettings {
  /** A flat region of at least this many pixels is a facet (a stone); smaller ones are edges. */
  minArea: number;
  /** Two facets whose greys differ by fewer levels than this get no line between them. */
  minStep: number;
  /** Pixels added on each side of the 2-pixel line (0 keeps it 2 pixels wide). */
  widen: number;
  /** The alpha, in percent of `strength`, of a 1-pixel softened edge around the line (0: none). */
  soften: number;
  /** The line's alpha (255: opaque). */
  strength: number;
}

/**
 * The settings the committed stone-lines.png is made with. minStep 1: every boundary between two
 * facets of different greys is a stone's edge (minStep 2 already drops visible edges). The rest
 * is the "dim" preview Mahdi chose (tasks T010; spec Clarifications, implementation session):
 * 2 px lines with a 1 px softened edge at half strength, at 160 of 255 (about 63%).
 */
export const SETTINGS: LineSettings = {
  minArea: 64,
  minStep: 1,
  widen: 0,
  soften: 50,
  strength: 160,
};

/** The one text chunk the image carries. */
export const SOURCE_KEY = 'Source';

/** The `Source` chunk: what the image was made from, and how. */
export function sourceText(
  source: { name: string; version: string; sha256: string },
  s: LineSettings,
): string {
  return (
    `${source.name}, Keycloak ${source.version}, SHA-256 ${source.sha256}; ` +
    `edges between facets by the QueuePass stone-lines generator, ` +
    `minArea=${s.minArea} minStep=${s.minStep} widen=${s.widen} soften=${s.soften}% strength=${s.strength}`
  );
}

/** 1 on each pixel with a 4-neighbor in another facet at least `minStep` greys away. */
export function boundaries(
  width: number,
  height: number,
  facets: Facets,
  minStep: number,
): Uint8Array {
  const { label, grey } = facets;
  const core = new Uint8Array(width * height);
  const apart = (p: number, q: number): boolean =>
    label[p] !== label[q] && Math.abs(grey[label[p]!]! - grey[label[q]!]!) >= minStep;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (x < width - 1 && apart(p, p + 1)) core[p] = core[p + 1] = 1;
      if (y < height - 1 && apart(p, p + width)) core[p] = core[p + width] = 1;
    }
  }
  return core;
}

/** Each pixel's alpha: the line, widened and softened as `s` says. */
export function lineAlpha(img: GreyImage, s: LineSettings): Uint8Array {
  const { width, height } = img;
  const core = boundaries(width, height, findFacets(img, s.minArea), s.minStep);
  const alpha = new Uint8Array(width * height);
  const soft = Math.round((s.strength * s.soften) / 100);
  const reach = s.widen + (soft > 0 ? 1 : 0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (core[p]) {
        alpha[p] = s.strength;
        continue;
      }
      if (reach === 0) continue;
      // The distance to the nearest line pixel, within `reach`.
      let best = Infinity;
      for (let dy = -reach; dy <= reach; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -reach; dx <= reach; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || !core[yy * width + xx]) continue;
          best = Math.min(best, Math.hypot(dx, dy));
        }
      }
      if (best <= s.widen) alpha[p] = s.strength;
      else if (best <= s.widen + 1 && soft > 0) alpha[p] = soft;
    }
  }
  return alpha;
}

/** The lines image of `img`: grey and alpha, grey 255 everywhere, with its `Source` chunk. */
export function linesImage(img: GreyImage, s: LineSettings, source: string) {
  const alpha = lineAlpha(img, s);
  const data = new Uint8Array(alpha.length * 2);
  for (let i = 0; i < alpha.length; i++) {
    data[i * 2] = 255;
    data[i * 2 + 1] = alpha[i]!;
  }
  return {
    width: img.width,
    height: img.height,
    data,
    depth: 8 as const,
    channels: 2,
    text: { [SOURCE_KEY]: source },
  };
}

/** PNG bytes of the lines image: always the same bytes for the same image, in one process. */
export function encodeLines(image: ReturnType<typeof linesImage>): Uint8Array {
  return encode(image, { zlib: { level: 9 } });
}

/** What differs between two decoded images (empty when the same): size, pixels, text chunks. */
export function differences(want: DecodedPng, got: DecodedPng): string[] {
  const out: string[] = [];
  for (const key of ['width', 'height', 'depth', 'channels'] as const) {
    if (want[key] !== got[key]) out.push(`${key}: expected ${want[key]}, got ${got[key]}`);
  }
  if (out.length === 0) {
    let count = 0;
    let first = -1;
    for (let i = 0; i < want.data.length; i++) {
      if (want.data[i] !== got.data[i]) {
        if (first < 0) first = i;
        count++;
      }
    }
    if (count > 0) {
      const pixel = Math.floor(first / want.channels);
      out.push(
        `pixels: ${count} values differ, the first at (${pixel % want.width}, ` +
          `${Math.floor(pixel / want.width)})`,
      );
    }
  }
  const keys = [...new Set([...Object.keys(want.text), ...Object.keys(got.text)])].sort();
  for (const key of keys) {
    if (want.text[key] !== got.text[key]) {
      out.push(
        `text chunk ${key}: expected ${JSON.stringify(want.text[key])}, got ${JSON.stringify(got.text[key])}`,
      );
    }
  }
  return out;
}

export { decode };
