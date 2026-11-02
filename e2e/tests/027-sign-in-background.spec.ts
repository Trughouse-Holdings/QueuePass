// Spec 027 quickstart S1 (research R1, R2, R4, R7, R8; FR-001–FR-005, FR-010, SC-001): Keycloak's
// stones behind every app's sign-in page, the lines between them in the app's lighter accent, the
// same in both schemes, the realm header, and Keycloak's card with the app's accent as its top edge.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { APPS, type AppName } from '../fixtures/apps';
import { signInHeading, submitSignIn } from '../fixtures/sign-in';
import { blankPage, compareColumns, backdropShot, contrastFailures } from '../fixtures/backdrop';

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
  if (blockStones) await context.route('**/keycloak-bg.png', (route) => route.abort());
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
      const found = await contrastFailures(page, blank);
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
