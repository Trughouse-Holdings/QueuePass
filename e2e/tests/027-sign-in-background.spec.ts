// Spec 027 quickstart S1 (research R1, R2, R4, R7, R8; FR-001–FR-005, FR-010, SC-001): Keycloak's
// stones behind every app's sign-in page, the lines between them in the app's lighter accent, the
// same in both schemes, the realm header, and Keycloak's card with the app's accent as its top edge.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { APPS, type AppName } from '../fixtures/apps';
import { signInHeading, submitSignIn } from '../fixtures/sign-in';
import {
  backdropShot,
  blankPage,
  commonest,
  compareColumns,
  contrast,
  contrastFailures,
  parseColor,
  type Rgb,
} from '../fixtures/backdrop';

/** In the page: hold the lines at full strength, still, for measuring (research R10). */
function freezeLinesAtPeak(): void {
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    // The lines and their glow at full strength, still (research R5, R10).
    style.textContent =
      '.qp-stones::before, .qp-glow { animation: none !important; opacity: 1 !important; }' +
      ' .qp-glow { display: block !important; }';
    document.head.append(style);
  });
}

/** A color under the full shade, --stone-scrim, black at 60% (research R5). */
const shaded = (c: Rgb): Rgb => c.map((v) => Math.round(v * 0.4)) as Rgb;

/** Research R1: Keycloak 26.0.8's keycloak-bg.png, the image the lines were made from. */
const KEYCLOAK_BG_SHA256 = '0825175291be11f7689e8718295e422bb6fa4f8fefccc5610292b720c701ac4e';

const AUDIENCE: Record<AppName, string> = {
  admin: 'For administrators managing venues, events, and sales.',
  customer: 'For customers buying and viewing tickets.',
  booth: 'For gate agents checking tickets in at the door.',
};

const SCHEMES = ['light', 'dark'] as const;

/** What S1 reads from the open sign-in page. */
async function backdrop(page: Page) {
  return page.evaluate(async () => {
    const stones = document.querySelector('.qp-stones');
    if (!stones) return null;
    const style = getComputedStyle(stones);
    const lines = getComputedStyle(stones, '::before');
    const url = /url\("?([^")]+)"?\)/.exec(style.backgroundImage)?.[1] ?? '';
    const bytes = await (await fetch(url)).arrayBuffer();
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const image = new Image();
    image.src = url;
    await image.decode();
    // Probes styled with the tokens, so resolved colors are compared, not token strings.
    const resolve = (value: string) => {
      const probe = document.createElement('span');
      probe.style.color = value;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const cards = [...document.querySelectorAll('.qp-card')];
    const card = cards[0];
    const cardStyle = card ? getComputedStyle(card) : null;
    const header = document.querySelector('.qp-realm') as HTMLElement | null;
    return {
      url,
      digest,
      width: image.naturalWidth,
      linesColor: lines.backgroundColor,
      linesMask: lines.maskImage || lines.getPropertyValue('-webkit-mask-image'),
      stoneAccent: resolve('var(--stone-accent)'),
      accent: resolve('var(--accent)'),
      ariaHidden: stones.getAttribute('aria-hidden'),
      cards: cards.length,
      cardWidth: card?.getBoundingClientRect().width ?? 0,
      cardEdge: cardStyle ? `${cardStyle.borderTopWidth} ${cardStyle.borderTopColor}` : '',
      cardHoldsH1: !!card?.querySelector('h1'),
      // How far the heading sits inside the card's left edge, and the card's own padding: the
      // card pads itself once (card--padded; review round 1, 1).
      h1Inset: card
        ? card.querySelector('h1')!.getBoundingClientRect().left -
          card.getBoundingClientRect().left -
          parseFloat(cardStyle!.borderLeftWidth)
        : -1,
      cardPadding: cardStyle ? parseFloat(cardStyle.paddingLeft) : -1,
      header: header?.innerText ?? null,
      headerHidden: header?.getAttribute('aria-hidden') ?? null,
      headerBeforeCard:
        !!header &&
        !!card &&
        !!(header.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
}

test("027 S1: each app's sign-in page shows the stones with its accent in the lines, the QUEUEPASS header, and its card", async ({
  browser,
}) => {
  const lineColors: Record<string, string> = {};
  for (const app of Object.keys(APPS) as AppName[]) {
    for (const colorScheme of SCHEMES) {
      await test.step(`${app}, ${colorScheme}`, async () => {
        const context = await browser.newContext({ colorScheme });
        const page = await context.newPage();
        await page.goto(APPS[app].url);
        await expect(signInHeading(page, app)).toBeVisible();
        await expect(page).toHaveTitle(`Sign in to ${APPS[app].name}`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        await expect(page.getByText(AUDIENCE[app], { exact: true })).toBeVisible();

        const got = await backdrop(page);
        expect(got, 'the .qp-stones element').not.toBeNull();
        expect(got!.url).toMatch(/\/login\/keycloak\/img\/keycloak-bg\.png$/);
        // FR-010: the Dockerfile's 26.0 tag floats; the lines match only this image.
        expect(got!.digest).toBe(KEYCLOAK_BG_SHA256);
        expect(got!.width).toBe(1920);
        expect(got!.linesColor).toBe(got!.stoneAccent);
        expect(got!.linesMask).toContain('stone-lines.png');
        expect(got!.ariaHidden).toBe('true');
        // FR-004 (implementation session 2): Keycloak's card, its top edge in the app's accent,
        // holding the one heading, under the realm header.
        expect(got!.cards).toBe(1);
        expect(got!.cardWidth).toBeGreaterThan(0);
        expect(got!.cardWidth).toBeLessThanOrEqual(500);
        expect(got!.cardEdge).toBe(`4px ${got!.accent}`);
        expect(got!.cardHoldsH1).toBe(true);
        expect(Math.abs(got!.h1Inset - got!.cardPadding)).toBeLessThanOrEqual(1);
        expect(got!.header).toBe('QUEUEPASS');
        expect(got!.headerHidden).toBe('true');
        expect(got!.headerBeforeCard).toBe(true);
        lineColors[`${app} ${colorScheme}`] = got!.linesColor;
        await context.close();
      });
    }
  }
  // The lines are each app's own, and the same in both schemes (FR-003, FR-007).
  for (const app of Object.keys(APPS)) {
    expect(lineColors[`${app} light`]).toBe(lineColors[`${app} dark`]);
  }
  expect(new Set(Object.keys(APPS).map((app) => lineColors[`${app} light`])).size).toBe(3);
});

/** SC-002's five window sizes. */
const SIZES = [
  [360, 800],
  [768, 1024],
  [1280, 800],
  [1920, 1080],
  [2560, 1440],
] as const;

/** A name no account has: a wrong sign-in that touches no test account. */
const NO_SUCH_USER = 'no-such-user-027';

/**
 * Opens `app`'s sign-in page in its own context at `width`×`height` in `colorScheme`, checks the
 * first page and the page after a wrong password, and returns every failure (empty when none).
 */
async function checkReadable(
  browser: Browser,
  app: AppName,
  colorScheme: 'light' | 'dark',
  [width, height]: readonly [number, number],
  { blockStones = false, fade = false } = {},
): Promise<string[]> {
  const context = await browser.newContext({
    colorScheme,
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  // R10: the lines pulse; measure them held at their peak, the brightest they get (R5's bound),
  // on every page this context opens.
  await context.addInitScript(freezeLinesAtPeak);
  // Counted, so S6 fails if the pattern stops matching and the stones load after all (review
  // round 1, 3).
  let aborted = 0;
  if (blockStones) {
    await context.route('**/keycloak-bg.png', (route) => {
      aborted++;
      return route.abort();
    });
  }
  const page = await context.newPage();
  const blank = await blankPage(context);
  const failures: string[] = [];
  try {
    await page.goto(APPS[app].url);
    await expect(signInHeading(page, app)).toBeVisible();
    for (const when of ['first page', 'after a wrong password'] as const) {
      if (when === 'after a wrong password') {
        await submitSignIn(page, NO_SUCH_USER, 'wrong');
        await expect(page.getByText('Invalid username or password.')).toBeVisible();
      }
      const found = await contrastFailures(page, blank, {
        wrongPassword: when === 'after a wrong password',
      });
      failures.push(...found.map((f) => `${when}: ${f}`));
      if (width === 360) {
        const [scrollWidth, innerWidth] = await page.evaluate(() => [
          document.documentElement.scrollWidth,
          window.innerWidth,
        ]);
        if (scrollWidth > innerWidth) {
          failures.push(`${when}: scrolls sideways (${scrollWidth} > ${innerWidth})`);
        }
      }
    }
    if (fade) {
      // FR-004: more than 400 px either side of the center, the stones and lines are unshaded;
      // at the center the shade darkens them.
      const shaded = await backdropShot(page);
      const bare = await backdropShot(page, '.qp-stones::after { display: none !important; }');
      const center = width / 2;
      const { sameColumnsDiffer, otherColumnsDiffer } = await compareColumns(
        blank,
        shaded,
        bare,
        (x) => Math.abs(x + 0.5 - center) > 400,
      );
      if (sameColumnsDiffer > 0) {
        failures.push(`the shade reaches beyond 400 px of the center (${sameColumnsDiffer} px)`);
      }
      if (otherColumnsDiffer === 0) failures.push('no shade behind the form');
    }
    if (blockStones) {
      // FR-009: the plain stone grey shows, with the lines and the shade still drawn on it.
      const probe = await page.evaluate(() => {
        const span = document.createElement('span');
        span.style.color = 'var(--stone-base)';
        document.body.append(span);
        const base = getComputedStyle(span).color;
        span.remove();
        const stones = document.querySelector('.qp-stones');
        return {
          base,
          body: getComputedStyle(document.body).backgroundColor,
          lines: stones ? getComputedStyle(stones, '::before').maskImage : '',
          shade: stones ? getComputedStyle(stones, '::after').backgroundImage : '',
        };
      });
      if (probe.body !== probe.base) failures.push(`page color ${probe.body}, not ${probe.base}`);
      if (!probe.lines.includes('stone-lines.png')) failures.push('no lines over the grey');
      if (!probe.shade.includes('gradient')) failures.push('no shade over the grey');
      if (aborted === 0) failures.push("Keycloak's image was never requested, so never blocked");
      // What shows at the window's left edge is the plain grey, not stones: unshaded from 800 px
      // wide, under the full shade below 560 px (R5).
      const want = width >= 800 ? parseColor(probe.base) : shaded(parseColor(probe.base));
      const got = await commonest(blank, await backdropShot(page), {
        x: 0,
        y: 0,
        width: Math.min(100, width),
        height,
      });
      if (got.some((c, i) => Math.abs(c - want[i]!) > 1)) {
        failures.push(`the left edge is mostly rgb(${got}), not the grey rgb(${want})`);
      }
    }
  } finally {
    await context.close();
  }
  return failures;
}

test('027 S3: the header on the stones and every text, field edge and focus ring on the card meet their contrast at five window sizes, light and dark', async ({
  browser,
}) => {
  // R8: 60 page states at about 3–5 s each.
  test.setTimeout(10 * 60_000);
  for (const app of Object.keys(APPS) as AppName[]) {
    for (const colorScheme of SCHEMES) {
      for (const size of SIZES) {
        await test.step(`${app}, ${colorScheme}, ${size.join('×')}`, async () => {
          const failures = await checkReadable(browser, app, colorScheme, size, {
            fade: size[0] === 1920,
          });
          expect(failures).toEqual([]);
        });
      }
    }
  }
});

test('027 S6: with the stones image blocked, the sign-in page stays readable', async ({
  browser,
}) => {
  // R8: 8 page states. The Ticket Booth's lines are the brightest.
  test.setTimeout(3 * 60_000);
  for (const colorScheme of SCHEMES) {
    for (const size of [SIZES[0], SIZES[3]]) {
      await test.step(`booth, ${colorScheme}, ${size.join('×')}, no stones`, async () => {
        const failures = await checkReadable(browser, 'booth', colorScheme, size, {
          blockStones: true,
        });
        expect(failures).toEqual([]);
      });
    }
  }
});

/** The lines layer's animation and the glow's, as computed now (research R10). */
async function pulse(page: Page) {
  return page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('.qp-stones')!, '::before');
    const glowEl = document.querySelector('.qp-glow');
    const g = glowEl ? getComputedStyle(glowEl) : null;
    // The two running animations' clocks, to see they run in step.
    const pulses = document
      .getAnimations()
      .filter((a) => (a as CSSAnimation).animationName === 'qp-lines-pulse');
    const clocks = pulses.map((a) => Number(a.currentTime));
    // Which layer each runs on, and whether it runs (review round 3, nit 1).
    const targets = pulses
      .map((a) => {
        const effect = a.effect as KeyframeEffect;
        return `${(effect.target as Element).className}${effect.pseudoElement ?? ''}:${a.playState}`;
      })
      .sort();
    return {
      name: s.animationName,
      duration: s.animationDuration,
      timing: s.animationTimingFunction,
      count: s.animationIterationCount,
      direction: s.animationDirection,
      opacity: Number(s.opacity),
      glow: g && {
        display: g.display,
        filter: g.filter,
        name: g.animationName,
        duration: g.animationDuration,
        timing: g.animationTimingFunction,
        count: g.animationIterationCount,
        direction: g.animationDirection,
        opacity: Number(g.opacity),
      },
      clocks,
      targets,
    };
  });
}

/** The look at rest: no animation, the lines at Mahdi's dim level, no glow (R10). */
async function expectAtRest(page: Page): Promise<void> {
  const rest = await pulse(page);
  expect(rest.name).toBe('none');
  expect(rest.opacity).toBeCloseTo(160 / 255, 3);
  expect(rest.glow?.display).toBe('none');
}

/** The pause button's colors, its panel's, and their geometry, with the button focused. */
async function pauseLook(page: Page) {
  await page.locator('#kc-login').focus();
  await page.keyboard.press('Tab');
  return page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('.qp-motion__toggle')!;
    const b = getComputedStyle(button);
    const panel = getComputedStyle(button.parentElement!);
    const r = button.getBoundingClientRect();
    return {
      focused: document.activeElement === button,
      text: b.color,
      panel: panel.backgroundColor,
      ring: b.outlineColor,
      ringStyle: b.outlineStyle,
      ringWidth: b.outlineWidth,
      // The app's --stone-accent, as the lines are drawn in it.
      accent: getComputedStyle(document.querySelector('.qp-stones')!, '::before').backgroundColor,
      ringReach: parseFloat(b.outlineOffset) + parseFloat(b.outlineWidth),
      padding: Math.min(
        ...['top', 'right', 'bottom', 'left'].map((side) =>
          parseFloat(panel.getPropertyValue(`padding-${side}`)),
        ),
      ),
      width: r.width,
      height: r.height,
    };
  });
}

test('027 S9: the lines pulse, and the pause button stops them, is remembered, and is gone under reduced motion', async ({
  browser,
}) => {
  // R10: three apps, each through a handful of reloads and contexts.
  test.setTimeout(2 * 60_000);
  for (const app of Object.keys(APPS) as AppName[]) {
    await test.step(`${app}: pulse, pause, remember`, async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(APPS[app].url);
      await expect(signInHeading(page, app)).toBeVisible();

      // FR-013: a 3 s eased cycle, running on the lines and on their 6 px glow, in step.
      const running = await pulse(page);
      const timing = {
        name: 'qp-lines-pulse',
        duration: '1.5s',
        timing: 'ease-in-out',
        count: 'infinite',
        direction: 'alternate',
      };
      expect(running).toMatchObject(timing);
      expect(running.glow).toMatchObject({ ...timing, display: 'block', filter: 'blur(6px)' });
      expect(running.clocks).toHaveLength(2);
      expect(Math.abs(running.clocks[0]! - running.clocks[1]!)).toBeLessThan(50);
      expect(running.targets).toEqual(['qp-glow:running', 'qp-stones::before:running']);
      // Three samples, so a symmetric pair around the turn cannot look still (review round 2, 16);
      // the glow's opacity follows the lines' at each (review round 3, nit 1).
      const samples = [running];
      for (let i = 0; i < 2; i++) {
        await page.waitForTimeout(350);
        samples.push(await pulse(page));
      }
      expect(new Set(samples.map((s) => s.opacity)).size).toBeGreaterThanOrEqual(2);
      for (const s of samples) {
        expect(Math.abs(s.glow!.opacity - s.opacity)).toBeLessThan(0.05);
      }

      // Last in the Tab order: right after Sign In.
      const toggle = page.locator('.qp-motion__toggle');
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveText('Pause animation');
      // The name alone carries the state: no aria-pressed (review round 2, must 1).
      await expect(toggle).not.toHaveAttribute('aria-pressed');
      await expect(toggle).toHaveAccessibleName('Pause animation');
      await page.locator('#kc-login').focus();
      await page.keyboard.press('Tab');
      await expect(toggle).toBeFocused();

      // Pressed: paused, its name switched, the lines at rest with no glow (session 4).
      await page.keyboard.press('Enter');
      await expect(toggle).toHaveText('Play animation');
      await expect(toggle).toHaveAccessibleName('Play animation');
      await expect(toggle).not.toHaveAttribute('aria-pressed');
      await expectAtRest(page);

      // Remembered across a reload, and undone: a remembered pause never starts moving.
      await page.reload();
      await expect(toggle).toHaveText('Play animation');
      await expectAtRest(page);
      await toggle.click();
      await expect(toggle).toHaveText('Pause animation');
      await expect(toggle).toHaveAccessibleName('Pause animation');
      await page.reload();
      await expect(toggle).toHaveText('Pause animation');
      expect((await pulse(page)).name).toBe('qp-lines-pulse');

      // WCAG 1.4.3, 1.4.11, 2.5.8: on its own panel, its ring drawn on the panel.
      const look = await pauseLook(page);
      expect(look.focused).toBe(true);
      expect(contrast(parseColor(look.text), parseColor(look.panel))).toBeGreaterThanOrEqual(4.5);
      // The theme's ring, not the browser's own (review round 2, 6).
      expect(look.ringStyle).toBe('solid');
      expect(look.ringWidth).toBe('3px');
      expect(look.ring).toBe(look.accent);
      expect(contrast(parseColor(look.ring), parseColor(look.panel))).toBeGreaterThanOrEqual(3);
      expect(look.padding).toBeGreaterThan(look.ringReach);
      expect(look.width).toBeGreaterThanOrEqual(24);
      expect(look.height).toBeGreaterThanOrEqual(24);
      expect(errors).toEqual([]);
      await context.close();
    });

    await test.step(`${app}: storage refused`, async () => {
      const context = await browser.newContext();
      await context.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new Error('storage refused');
          },
        });
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(APPS[app].url);
      const toggle = page.locator('.qp-motion__toggle');
      await expect(toggle).toHaveText('Pause animation');
      await toggle.click();
      await expect(toggle).toHaveText('Play animation');
      await expectAtRest(page);
      // Nothing was remembered (review round 2, 15).
      await page.reload();
      await expect(toggle).toHaveText('Pause animation');
      expect((await pulse(page)).name).toBe('qp-lines-pulse');
      expect(errors).toEqual([]);
      await context.close();
    });

    await test.step(`${app}: reduced motion and forced colors`, async () => {
      const context = await browser.newContext({ reducedMotion: 'reduce' });
      const page = await context.newPage();
      await page.goto(APPS[app].url);
      await expect(signInHeading(page, app)).toBeVisible();
      await expectAtRest(page);
      await expect(page.locator('.qp-motion__toggle')).toBeHidden();
      await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'active' });
      await expect(page.locator('.qp-motion__toggle')).toBeHidden();
      await context.close();
    });
  }
});
