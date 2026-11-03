import type { DecodedPng } from 'fast-png';

/**
 * Spec 027 research R2, R3: Keycloak's stones image is flat facets of one grey each, with a pixel
 * or two of anti-aliasing along their edges. This finds the facets, so the lines between them can
 * be drawn (lines.ts).
 */

/** A one-channel 8-bit image. */
export interface GreyImage {
  width: number;
  height: number;
  grey: Uint8Array;
}

/** Every pixel's facet, and each facet's grey. */
export interface Facets {
  /** The facet of each pixel, row by row: an index into `grey`. */
  label: Int32Array;
  /** The grey of each facet. */
  grey: number[];
}

/** The grey channel of an 8-bit grey or RGB(A) image; refuses one whose pixels are not grey. */
export function greyOf(
  png: Pick<DecodedPng, 'width' | 'height' | 'data' | 'depth' | 'channels'>,
): GreyImage {
  if (png.depth !== 8) throw new Error(`expected an 8-bit image, got ${png.depth}-bit`);
  const { width, height, data, channels } = png;
  if (channels < 1 || channels > 4) throw new Error(`unexpected channel count ${channels}`);
  const colors = channels >= 3 ? 3 : 1;
  const grey = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const v = data[i * channels]!;
    for (let c = 1; c < colors; c++) {
      if (data[i * channels + c] !== v) {
        throw new Error(`pixel (${i % width}, ${Math.floor(i / width)}) is not grey`);
      }
    }
    grey[i] = v;
  }
  return { width, height, grey };
}

/**
 * The facets of `img`: each 4-connected region of one grey with at least `minArea` pixels is a
 * facet; every other pixel (the anti-aliasing along the edges) goes to the facet nearest it,
 * found breadth first from all facets at once, so the facets cover the image with no gap.
 */
export function findFacets(img: GreyImage, minArea: number): Facets {
  const { width, height, grey: px } = img;
  const n = width * height;
  const region = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const regionGrey: number[] = [];
  const stack = new Int32Array(n);

  // 1. 4-connected regions of one grey.
  for (let start = 0; start < n; start++) {
    if (region[start] !== -1) continue;
    const id = sizes.length;
    const v = px[start]!;
    let top = 0;
    let size = 0;
    stack[top++] = start;
    region[start] = id;
    while (top > 0) {
      const p = stack[--top]!;
      size++;
      const x = p % width;
      const neighbors = [
        x > 0 ? p - 1 : -1,
        x < width - 1 ? p + 1 : -1,
        p >= width ? p - width : -1,
        p < n - width ? p + width : -1,
      ];
      for (const q of neighbors) {
        if (q >= 0 && region[q] === -1 && px[q] === v) {
          region[q] = id;
          stack[top++] = q;
        }
      }
    }
    sizes.push(size);
    regionGrey.push(v);
  }

  // 2. The large regions are the facets, numbered in the order they were found.
  const facetOf = new Int32Array(sizes.length).fill(-1);
  const grey: number[] = [];
  sizes.forEach((size, id) => {
    if (size >= minArea) {
      facetOf[id] = grey.length;
      grey.push(regionGrey[id]!);
    }
  });
  if (grey.length === 0) throw new Error(`no flat region of ${minArea} pixels or more`);

  // 3. Every other pixel to its nearest facet, breadth first.
  const label = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let p = 0; p < n; p++) {
    const f = facetOf[region[p]!]!;
    if (f >= 0) {
      label[p] = f;
      queue[tail++] = p;
    }
  }
  while (head < tail) {
    const p = queue[head++]!;
    const x = p % width;
    const neighbors = [
      x > 0 ? p - 1 : -1,
      x < width - 1 ? p + 1 : -1,
      p >= width ? p - width : -1,
      p < n - width ? p + width : -1,
    ];
    for (const q of neighbors) {
      if (q >= 0 && label[q] === -1) {
        label[q] = label[p]!;
        queue[tail++] = q;
      }
    }
  }
  return { label, grey };
}
