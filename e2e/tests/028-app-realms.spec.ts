// Spec 028 quickstart S1 and S2 (research R10; FR-001 to FR-004, SC-002, SC-003): the three apps
// signed in as three users in one browser window, each through its own realm, each renewing on its
// own; logging out of one leaves the other two signed in through their next renewal.
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';
import {
  API_BASE,
  APPS,
  KEYCLOAK,
  adminFor,
  agentFor,
  customerFor,
  type AppName,
} from '../fixtures/apps';
import { APP_REALMS } from '../fixtures/realms';
import { signIn, signOut } from '../fixtures/sign-in';

const realmOf = (app: AppName): string => APP_REALMS.find((r) => r.app === app)!.realm;

/** The app's API requests that carry a token. */
const authorized = (req: Request): boolean =>
  req.url().startsWith(`${API_BASE}/`) && !!req.headers()['authorization'];

/** The access token's claims, read without verifying (the Backend verifies). */
function claimsOf(authorization: string): { iss?: string; preferred_username?: string } {
  const payload = authorization.replace(/^Bearer /, '').split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

/** Each app's sign-in and its token, as last sent to the API. */
interface Signed {
  page: Page;
  username: string;
  token: string;
}

/**
 * Signs in to `app` in `page` and returns the token its first API call carries, after checking it
 * is the user's own, from the app's own realm (FR-001).
 */
async function signInAndCall(page: Page, app: AppName, username: string): Promise<Signed> {
  const first = page.waitForRequest(authorized, { timeout: 30_000 });
  first.catch(() => undefined);
  // signIn waits for the app's own sign-in page first (FR-003): never the wrong-role page.
  await signIn(page, app, username);
  await expect(page.getByText("Your account can't use this app.")).toHaveCount(0);
  const token = (await first).headers()['authorization']!;
  expect(claimsOf(token), app).toMatchObject({
    iss: `${KEYCLOAK}/realms/${realmOf(app)}`,
    preferred_username: username,
  });
  return { page, username, token };
}

/** Makes the app call the API once, the way a person would. */
async function callOnce(context: BrowserContext, page: Page, app: AppName): Promise<void> {
  if (app === 'booth') {
    // The Booth's event list is fetched again every 30 seconds while it is shown (spec 025).
    await context.clock.runFor(30_000);
    return;
  }
  // Each app's own navigation, to the other of two pages that each load from the API.
  const [a, b] = app === 'admin' ? ['Events', 'Venues'] : ['Venues', 'Events'];
  const onA = new URL(page.url()).pathname.startsWith(app === 'admin' ? '/events' : '/venues');
  await page.getByRole('link', { name: onA ? b : a, exact: true }).click();
}

/**
 * The app's next API call carries a new access token, still its own user's: the renewal took, not
 * only the call (the Backend checks expiry in real time, so the old token would pass too).
 */
async function expectNewToken(context: BrowserContext, app: AppName, s: Signed): Promise<void> {
  let token = s.token;
  await expect(async () => {
    const sent = s.page.waitForRequest(authorized, { timeout: 5_000 });
    sent.catch(() => undefined);
    await callOnce(context, s.page, app);
    token = (await sent).headers()['authorization']!;
    expect(token, app).not.toBe(s.token);
  }).toPass({ timeout: 30_000 });
  expect(claimsOf(token), app).toMatchObject({
    iss: `${KEYCLOAK}/realms/${realmOf(app)}`,
    preferred_username: s.username,
  });
  s.token = token;
}

/** The app's refresh-token request to its own realm. */
const refreshOf =
  (app: AppName) =>
  (res: Response): boolean =>
    res.url() === `${KEYCLOAK}/realms/${realmOf(app)}/protocol/openid-connect/token` &&
    res.request().method() === 'POST' &&
    (res.request().postData() ?? '').includes('grant_type=refresh_token');

/**
 * Moves the window's clock past the renewal of every signed-in app (240 s after its last token,
 * research R10), and checks each renewed with its own realm, answered 200, and that each then
 * calls the API with a new token.
 */
async function renewAll(
  context: BrowserContext,
  signed: Partial<Record<AppName, Signed>>,
): Promise<void> {
  const apps = Object.keys(signed) as AppName[];
  const refreshes = apps.map((app) =>
    signed[app]!.page.waitForResponse(refreshOf(app), { timeout: 30_000 }),
  );
  for (const r of refreshes) r.catch(() => undefined);
  await context.clock.runFor('04:05');
  for (const [i, app] of apps.entries()) {
    expect((await refreshes[i])!.status(), `${app} renewal`).toBe(200);
  }
  for (const app of apps) await expectNewToken(context, app, signed[app]!);
}

test('028 S1/S2: three apps signed in as three users in one browser window stay signed in through their own renewals, and logging out of one leaves the others signed in', async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  // Code review round 2: 11 to 19 are 026's, one per repeat. No index is free, so the two customers
  // are 001's (9 and 10), whose tests only sign in and out: a worker runs its tests one at a time,
  // and this test neither buys nor holds seats, so sharing them changes nothing either test sees.
  const users: Record<AppName, string> = {
    admin: adminFor(testInfo),
    customer: customerFor(testInfo, 9),
    booth: agentFor(testInfo, 2),
  };
  // One browser window: one context, one tab per app.
  const context = await browser.newContext();
  // R10: the clock is the context's; installed once, before the first page, never again.
  await context.clock.install();
  const pages: Record<AppName, Page> = {
    admin: await context.newPage(),
    customer: await context.newPage(),
    booth: await context.newPage(),
  };

  // Steps 1 to 3: Admin, then Customer, then the Booth, each on its own sign-in page (FR-003),
  // each calling the API as its own user (FR-001).
  const signed: Record<AppName, Signed> = {
    admin: await signInAndCall(pages.admin, 'admin', users.admin),
    customer: await signInAndCall(pages.customer, 'customer', users.customer),
    booth: await signInAndCall(pages.booth, 'booth', users.booth),
  };

  // Step 4: each app's own renewal (FR-002).
  await test.step('all three renew, each as its own user', () => renewAll(context, signed));

  // Steps 5 and 6: each app logs out in turn; the other two renew and keep calling the API as
  // their own users (FR-004, SC-002); then the app signs in again, as another user where the
  // fixtures give one.
  const again: Record<AppName, string> = {
    customer: customerFor(testInfo, 10),
    admin: users.admin,
    booth: agentFor(testInfo, 3),
  };
  for (const app of ['customer', 'admin', 'booth'] as const) {
    await test.step(`${app} logs out; the others stay signed in`, async () => {
      await signOut(pages[app], app);
      const others = Object.fromEntries(
        (Object.keys(signed) as AppName[]).filter((a) => a !== app).map((a) => [a, signed[a]]),
      );
      await renewAll(context, others);
      // The app that logged out is still on its own sign-in page, not signed back in by another.
      await expect(pages[app].getByRole('button', { name: 'Log out' })).toHaveCount(0);
      expect(new URL(pages[app].url()).origin).toBe(KEYCLOAK);
      signed[app] = await signInAndCall(pages[app], app, again[app]);
    });
  }

  // Every app ends signed in as the user it last signed in as.
  for (const app of Object.keys(APPS) as AppName[]) {
    await expect(pages[app].getByRole('button', { name: 'Log out' })).toBeVisible();
  }
  await context.close();
});
