// Spec 027 research R8 (FR-004, FR-006, FR-008, FR-009, SC-002, SC-005): measures what a person
// sees on a sign-in page: the realm header against the lightest and the darkest pixel of the
// stones behind it, and every text, text field edge, and focus ring on the card against the
// lightest and the darkest pixel of the card behind it. Each is measured from a screenshot of what
// is behind it alone (the backdrop, or the card with its content hidden), taken at the scroll
// position the boxes were read at. Screenshots are decoded in a blank page with createImageBitmap
// and a canvas, so no image library is needed.
import type { BrowserContext, Page } from '@playwright/test';

export type Rgb = [number, number, number];

/** A box in window coordinates (CSS pixels). */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A text, field, or focus ring to check, and where. */
export interface Target {
  kind: 'text' | 'edge' | 'ring';
  /** What is behind it: the stones (the realm header) or the card (everything else). */
  on: 'stones' | 'card';
  /** What it is, for the failure message. */
  name: string;
  color: Rgb;
  /** The pixels behind it: its own box for text, rings around the box for edges and rings. */
  box: Box;
  /** Rings: from `inner` to `outer` pixels outside `box`. */
  inner?: number;
  outer?: number;
}

/** WCAG 2.1 relative luminance. */
export function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!;
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** `rgb(…)` or `rgba(…)` as computed by the browser; refuses a color that is not opaque. */
export function parseColor(css: string): Rgb {
  const m =
    /^rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)(?:,\s*([\d.]+))?\)$/.exec(
      css.trim(),
    );
  if (!m) throw new Error(`not an rgb() color: ${css}`);
  if (m[4] !== undefined && Number(m[4]) < 1) throw new Error(`not opaque: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** What the page shows: the realm header, the card's texts, and its fields. */
interface Found {
  header: { name: string; color: string; box: Box }[];
  texts: { name: string; color: string; box: Box }[];
  fields: { name: string; edge: string; box: Box }[];
  /** Visible text in main that is neither on the card nor the header. */
  stray: string[];
}

/**
 * The realm header (scrolled into view, in window coordinates), every visible text on the card
 * (not inside a field, button, or notice), and every text field (both in page coordinates).
 */
export async function findTargets(page: Page): Promise<Found> {
  return page.evaluate(async () => {
    // A field's edge is measured at rest: when focused, its focus ring is what is measured. The
    // shared field style eases its edge color, so wait for that to end.
    (document.activeElement as HTMLElement | null)?.blur();
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
    const visible = (el: Element) =>
      el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) &&
      el.getBoundingClientRect().width > 0;
    // On the card: page coordinates, matched against a full-page screenshot of the card.
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
    };
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${
        el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''
      } "${(el.textContent ?? '').trim().slice(0, 40)}"`;

    // The header's own text, not its block (which spans the column): where the letters are.
    const textBox = (el: Element) => {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const header = [...document.querySelectorAll('.qp-realm')]
      .filter(visible)
      .map((el) => ({ name: describe(el), color: getComputedStyle(el).color, box: textBox(el) }));
    // Texts on the card only: they are measured against a shot of the card (review round 1, 5).
    const textSelector = [
      'h1',
      'h2',
      '.qp-audience',
      '.qp-required',
      'label',
      'a',
      'p',
      '#input-error',
    ]
      .map((s) => `.qp-card ${s}`)
      .join(', ');
    const texts = [...document.querySelectorAll(textSelector)]
      .filter((el) => !el.closest('.banner, button, .btn'))
      .filter((el) => (el.textContent ?? '').trim() !== '' && visible(el))
      .map((el) => ({ name: describe(el), color: getComputedStyle(el).color, box: box(el) }));
    // Any other visible text in main would be on the stones, measured against nothing.
    const stray = [...document.querySelectorAll('main *')]
      .filter((el) => !el.closest('.qp-card, .qp-realm'))
      .filter((el) =>
        [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim()),
      )
      .filter(visible)
      .map(describe);
    const fields = [
      ...document.querySelectorAll<HTMLInputElement>(
        '.qp-card input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox])',
      ),
    ]
      .filter(visible)
      .map((el) => {
        const style = getComputedStyle(el);
        return { name: `input#${el.id}`, edge: style.borderTopColor, box: box(el) };
      });
    return { header, texts, fields, stray };
  });
}

/**
 * Tabs through every control from the start of the page, and returns each focused control in
 * `main` with its box and its focus ring's color, while it is focused.
 */
export async function findRings(
  page: Page,
): Promise<{ name: string; color: string; style: string; width: number; box: Box }[]> {
  // Start from the top of the page: a focusable spot before everything else (a blur alone leaves
  // Chromium's sequential focus starting point on the blurred control).
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const start = document.createElement('span');
    start.id = 'qp-test-tab-start';
    start.tabIndex = -1;
    document.body.prepend(start);
    start.focus();
  });
  const out: { name: string; color: string; style: string; width: number; box: Box }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    const got = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || !el.closest('main')) return null;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const name = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${
        el.getAttribute('aria-label') ? ` [${el.getAttribute('aria-label')}]` : ''
      }`;
      return {
        name,
        color: s.outlineColor,
        style: s.outlineStyle,
        width: parseFloat(s.outlineWidth),
        // Page coordinates, as the card's other targets.
        box: { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height },
      };
    });
    if (!got) {
      if (out.length > 0) break;
      continue;
    }
    if (seen.has(got.name)) break;
    seen.add(got.name);
    out.push(got);
  }
  await page.evaluate(() => document.getElementById('qp-test-tab-start')?.remove());
  return out;
}

/** A screenshot of the window with the page's content hidden: the backdrop alone. */
export async function backdropShot(page: Page, extraCss = ''): Promise<Buffer> {
  const style = await page.addStyleTag({
    content: `main, .qp-band { visibility: hidden !important; } ${extraCss}`,
  });
  const shot = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  await style.evaluate((el) => (el as Element).remove());
  return shot;
}

/** The lightest and darkest pixel of each region, from a PNG decoded in `blank`. */
export async function extremes(
  blank: Page,
  png: Buffer,
  regions: { box: Box; inner?: number; outer?: number }[],
): Promise<{ light: Rgb; dark: Rgb; count: number }[]> {
  return blank.evaluate(
    async ({ b64, regions }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      const lum = (i: number) => {
        const f = (v: number) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(data[i]!) + 0.7152 * f(data[i + 1]!) + 0.0722 * f(data[i + 2]!);
      };
      return regions.map(({ box, inner, outer }) => {
        const ringed = outer !== undefined;
        const grow = ringed ? outer! : 0;
        const x0 = Math.max(0, Math.floor(box.x - grow));
        const y0 = Math.max(0, Math.floor(box.y - grow));
        const x1 = Math.min(width, Math.ceil(box.x + box.width + grow));
        const y1 = Math.min(height, Math.ceil(box.y + box.height + grow));
        let light = -1;
        let dark = -1;
        let lightL = -1;
        let darkL = 2;
        let count = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            if (ringed) {
              // Distance outside the box (0 inside it).
              const dx = Math.max(box.x - (x + 0.5), x + 0.5 - (box.x + box.width), 0);
              const dy = Math.max(box.y - (y + 0.5), y + 0.5 - (box.y + box.height), 0);
              const d = Math.max(dx, dy);
              if (d < (inner ?? 0) || d > outer! || d === 0) continue;
            }
            const i = (y * width + x) * 4;
            const l = lum(i);
            count++;
            if (l > lightL) {
              lightL = l;
              light = i;
            }
            if (l < darkL) {
              darkL = l;
              dark = i;
            }
          }
        }
        const rgb = (i: number): [number, number, number] =>
          i < 0 ? [0, 0, 0] : [data[i]!, data[i + 1]!, data[i + 2]!];
        return { light: rgb(light), dark: rgb(dark), count };
      });
    },
    { b64: png.toString('base64'), regions },
  );
}

/** The commonest pixel color in `box` of a PNG decoded in `blank`. */
export async function commonest(blank: Page, png: Buffer, box: Box): Promise<Rgb> {
  return blank.evaluate(
    async ({ b64, box }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(box.x, box.y, box.width, box.height);
      const counts = new Map<number, number>();
      for (let i = 0; i < data.length; i += 4) {
        const key = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const [key] = [...counts].sort((a, b) => b[1] - a[1])[0]!;
      return [(key >> 16) & 255, (key >> 8) & 255, key & 255] as [number, number, number];
    },
    { b64: png.toString('base64'), box },
  );
}

/** How two screenshots of the same size differ: in the columns given, and elsewhere. */
export async function compareColumns(
  blank: Page,
  a: Buffer,
  b: Buffer,
  same: (x: number) => boolean,
): Promise<{ sameColumnsDiffer: number; otherColumnsDiffer: number }> {
  const columns = await blank.evaluate(
    async ({ a64, b64 }) => {
      const decode = async (s: string) => {
        const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [x, y] = await Promise.all([decode(a64), decode(b64)]);
      // For each column, how many of its pixels differ.
      const diff = new Array<number>(x.width).fill(0);
      for (let i = 0; i < x.data.length; i += 4) {
        if (
          x.data[i] !== y.data[i] ||
          x.data[i + 1] !== y.data[i + 1] ||
          x.data[i + 2] !== y.data[i + 2]
        ) {
          diff[(i / 4) % x.width]!++;
        }
      }
      return diff;
    },
    { a64: a.toString('base64'), b64: b.toString('base64') },
  );
  let sameColumnsDiffer = 0;
  let otherColumnsDiffer = 0;
  columns.forEach((n, x) => {
    if (same(x)) sameColumnsDiffer += n;
    else otherColumnsDiffer += n;
  });
  return { sameColumnsDiffer, otherColumnsDiffer };
}

/** A blank page in `context` to decode screenshots in, away from the page being measured. */
export async function blankPage(context: BrowserContext): Promise<Page> {
  const blank = await context.newPage();
  await blank.goto('about:blank');
  return blank;
}

/** A full-page screenshot with the card's content, the header and the band hidden: the card alone. */
export async function cardShot(page: Page): Promise<Buffer> {
  const style = await page.addStyleTag({
    content: `.qp-band, .qp-realm, .qp-card * { visibility: hidden !important; }`,
  });
  // The whole page, so a card taller than the window is measured all the way down.
  const shot = await page.screenshot({ animations: 'disabled', caret: 'hide', fullPage: true });
  await style.evaluate((el) => (el as Element).remove());
  return shot;
}

/**
 * Every contrast failure on the page as it is now (research R8): the realm header 4.5:1 against
 * the lightest and darkest pixel of the backdrop behind it; on the card, texts 4.5:1, field edges
 * 3:1, and focus rings 3:1 against the lightest and darkest pixel of the card behind them. Returns
 * one line per failure; empty when all pass. It fails, too, when what it must measure is not there
 * (the heading, the audience line, both labels and fields, and after a wrong password its message),
 * so a changed page cannot pass by measuring nothing (review round 1, 4).
 */
export async function contrastFailures(
  page: Page,
  blank: Page,
  { wrongPassword = false } = {},
): Promise<string[]> {
  // No field in its hover state: the mouse rests where it last clicked.
  await page.mouse.move(0, 0);
  const found = await findTargets(page);
  const rings = await findRings(page);
  const targets: Target[] = [
    ...found.header.map((t) => ({
      kind: 'text' as const,
      on: 'stones' as const,
      name: t.name,
      color: parseColor(t.color),
      box: t.box,
    })),
    ...found.texts.map((t) => ({
      kind: 'text' as const,
      on: 'card' as const,
      name: t.name,
      color: parseColor(t.color),
      box: t.box,
    })),
    ...found.fields.map((f) => ({
      kind: 'edge' as const,
      on: 'card' as const,
      name: f.name,
      color: parseColor(f.edge),
      box: f.box,
      inner: 0,
      outer: 3,
    })),
    ...rings.map((r) => ({
      kind: 'ring' as const,
      on: 'card' as const,
      name: r.name,
      color: parseColor(r.color),
      box: r.box,
      inner: 2,
      outer: 8,
    })),
  ];
  const failures: string[] = [];
  if (found.header.length !== 1) failures.push(`${found.header.length} realm headers, not 1`);
  for (const s of found.stray) failures.push(`text outside the card and the header: ${s}`);
  const measured = (re: RegExp) => found.texts.filter((t) => re.test(t.name)).length;
  const floors: [string, RegExp, number][] = [
    ['the heading', /^h1\b/, 1],
    ['the audience line', /\.qp-audience\b/, 1],
    ['the two labels', /^label\b/, 2],
    ...(wrongPassword
      ? ([['the wrong-password message', /#input-error\b/, 1]] as [string, RegExp, number][])
      : []),
  ];
  for (const [what, re, n] of floors) {
    if (measured(re) < n) failures.push(`${what} not measured (${measured(re)} of ${n})`);
  }
  for (const want of ['input#username', 'input#password']) {
    if (!found.fields.some((f) => f.name === want)) failures.push(`no field edge for ${want}`);
  }
  const names = rings.map((r) => r.name);
  for (const want of ['input#username', 'input#password', 'input#kc-login']) {
    if (!names.includes(want)) failures.push(`no focus ring found on ${want} (focused: ${names})`);
  }
  if (!names.some((n) => n.startsWith('button'))) {
    failures.push(`no focus ring found on the Show button (focused: ${names})`);
  }
  for (const r of rings) {
    if (r.style === 'none' || r.width < 2) {
      failures.push(`${r.name}: focus ring ${r.style} ${r.width}px, not a visible ring`);
    }
  }
  const shots = { stones: await backdropShot(page), card: await cardShot(page) };
  for (const on of ['stones', 'card'] as const) {
    const these = targets.filter((t) => t.on === on);
    const regions = await extremes(blank, shots[on], these);
    these.forEach((t, i) => {
      const { light, dark, count } = regions[i]!;
      if (count === 0) {
        failures.push(`${t.kind} ${t.name}: no ${on} pixels at ${JSON.stringify(t.box)}`);
        return;
      }
      const min = t.kind === 'text' ? 4.5 : 3;
      for (const [what, bg] of [
        ['lightest', light],
        ['darkest', dark],
      ] as const) {
        const ratio = contrast(t.color, bg);
        if (ratio < min) {
          failures.push(
            `${t.kind} ${t.name}: rgb(${t.color}) on the ${what} ${on} pixel rgb(${bg}) is ` +
              `${ratio.toFixed(2)}:1, under ${min}:1`,
          );
        }
      }
    });
  }
  return failures;
}
