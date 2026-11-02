// Spec 027 quickstart S1 (research R1, R2, R4, R8; FR-001–FR-005, FR-010, SC-001): Keycloak's
// stones behind every app's sign-in page, the lines between them in the app's lighter accent, the
// same in both schemes, and no card.
import { expect, test, type Page } from '@playwright/test';
import { APPS, type AppName } from '../fixtures/apps';
import { signInHeading } from '../fixtures/sign-in';

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
    // A probe styled with the token, so two resolved colors are compared, not token strings.
    const probe = document.createElement('span');
    probe.style.color = 'var(--stone-accent)';
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    return {
      url,
      digest,
      width: image.naturalWidth,
      linesColor: lines.backgroundColor,
      linesMask: lines.maskImage || lines.getPropertyValue('-webkit-mask-image'),
      accent,
      ariaHidden: stones.getAttribute('aria-hidden'),
      cards: document.querySelectorAll('.card').length,
    };
  });
}

test("027 S1: each app's sign-in page shows the stones with its accent in the lines and no card", async ({
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
        expect(got!.linesColor).toBe(got!.accent);
        expect(got!.linesMask).toContain('stone-lines.png');
        expect(got!.ariaHidden).toBe('true');
        expect(got!.cards).toBe(0);
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
