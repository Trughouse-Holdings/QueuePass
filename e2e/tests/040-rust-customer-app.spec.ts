// Spec 040 (quickstart S1, S2, S8; research R2, R3, R7, R13; FR-004 to FR-010, FR-016): the Rust
// Customer app beside the React one. Each test drives both Customer apps, so it is untagged and runs
// in the default project only; the shared Customer journeys run against the Rust app through the
// `customer-rust` project (`@customer`). Sessions' own 040 tests are in their own files (R13).
import {
  expect,
  test,
  type BrowserContext,
  type Frame,
  type Page,
  type Response,
  type Route,
} from '@playwright/test';
import { apiFor, buyTickets, createEvent, createVenue, seatedEvent } from '../fixtures/api';
import { API_BASE, APPS, KEYCLOAK, adminFor, agentFor, customerFor } from '../fixtures/apps';
import { PLACES, startsInHours, uniqueName } from '../fixtures/data';
import { signIn, signInHeading, signOut, submitSignIn } from '../fixtures/sign-in';

const REACT = APPS.customer;
const RUST = APPS['customer-rust'];

/** The Customer realm both Customer apps sign in through (research R3). */
const CUSTOMER_REALM = 'queuepass-customer-app';
const TOKEN_URL = `${KEYCLOAK}/realms/${CUSTOMER_REALM}/protocol/openid-connect/token`;

/** Spec 037 research R8: the red look tokens, light set (admin-rust-app/style/red.css). */
const RED = { bg: 'rgb(253, 236, 234)', surface: 'rgb(255, 247, 246)' };

/** The sign-in page's accent, and the shared theme's teal and red sets, as resolved colors. */
async function signInAccents(page: Page) {
  return page.evaluate(() => {
    const resolve = (value: string) => {
      const probe = document.createElement('span');
      probe.style.color = value;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const card = document.querySelector('.qp-card');
    return {
      accent: resolve('var(--accent)'),
      teal: resolve('var(--accent-tickets)'),
      red: resolve('var(--accent-rust)'),
      stoneAccent: resolve('var(--stone-accent)'),
      redStones: resolve('var(--stone-accent-rust)'),
      bodyClass: document.body.className,
      cardEdge: card ? getComputedStyle(card).borderTopColor : '',
    };
  });
}

/** `rgb(r, g, b)` with red the largest part: a red, not a teal. */
function isReddish(color: string): boolean {
  const [r, g, b] = (color.match(/\d+/g) ?? []).map(Number);
  return r > g && r > b;
}

/** What an app's origin keeps in the browser's storage once signed in. */
async function storageOf(page: Page): Promise<{ session: string[]; local: string[] }> {
  return page.evaluate(() => ({
    session: Object.keys(sessionStorage),
    local: Object.keys(localStorage),
  }));
}

/** The app's API requests that carry a token. */
const authorizedApiCalls = (page: Page): string[] => {
  const calls: string[] = [];
  page.on('request', (req) => {
    if (req.url().startsWith(`${API_BASE}/`) && req.headers()['authorization']) {
      calls.push(`${req.method()} ${req.url()}`);
    }
  });
  return calls;
};

test("040 S1: the Rust Customer app's sign-in is red and names it, and the customer is the same as in the React Customer app", async ({
  browser,
}, testInfo) => {
  // Index 9 is 001's and 028's sign-in-only customer: this test buys one ticket on an event of its
  // own and changes nothing those tests see (a worker runs its tests one at a time).
  const username = customerFor(testInfo, 9);
  const eventName = uniqueName(testInfo, 'react order');

  await test.step('set-up: an order placed through the React Customer app', async () => {
    const admin = await apiFor(browser, 'admin', adminFor(testInfo));
    const venue = await createVenue(admin.api, PLACES.chicago, uniqueName(testInfo, 'venue'));
    const event = await createEvent(admin.api, venue, {
      name: eventName,
      startsAt: startsInHours(24 * 8),
      endsAt: startsInHours(24 * 8 + 3),
      capacity: 20,
    });
    await admin.close();
    // The React Customer app's own token (client customer-app), as its Get tickets panel sends it.
    const customer = await apiFor(browser, 'customer', username);
    await buyTickets(customer.api, event, { quantity: 1, holderName: 'Jordan Lee' });
    await customer.close();
  });

  await test.step('the React Customer sign-in is unchanged: its name, in teal', async () => {
    const context = await browser.newContext({ colorScheme: 'light' });
    const page = await context.newPage();
    await page.goto(REACT.url);
    await expect(signInHeading(page, 'customer')).toBeVisible();
    await expect(page).toHaveTitle('Sign in to QueuePass Tickets');
    const got = await signInAccents(page);
    expect(got.bodyClass).toContain('qp-app--customer-app');
    expect(got.accent).toBe(got.teal);
    expect(got.cardEdge).toBe(got.teal);
    await context.close();
  });

  // A fresh window: no Keycloak session, so the Rust app's own sign-in page shows. It opens on
  // My tickets, so the return after sign-in (returnTo) is checked too.
  const context = await browser.newContext({ colorScheme: 'light' });
  const page = await context.newPage();

  await test.step('the Rust Customer sign-in names it, says who it is for, and is red', async () => {
    await page.goto(`${RUST.url}/my-tickets`);
    await expect(signInHeading(page, 'customer-rust')).toBeVisible();
    await expect(page).toHaveTitle('Sign in to QueuePass Tickets (Rust)');
    await expect(
      page.getByText('For customers buying and viewing tickets, Rust version', { exact: true }),
    ).toBeVisible();
    const got = await signInAccents(page);
    expect(got.bodyClass).toContain('qp-app--customer-rust-app');
    // The Rust Admin app's red sign-in set (research R7), not the React Customer app's teal.
    expect(got.accent).toBe(got.red);
    expect(got.accent).not.toBe(got.teal);
    expect(isReddish(got.accent)).toBe(true);
    expect(got.cardEdge).toBe(got.red);
    expect(got.stoneAccent).toBe(got.redStones);
  });

  await test.step('signed in, it returns to My tickets (returnTo)', async () => {
    await submitSignIn(page, username, 'test123');
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
    await expect(page).toHaveURL(`${RUST.url}/my-tickets`);
    await expect(page.getByRole('heading', { level: 1, name: 'My tickets' })).toBeVisible();
  });

  await test.step('the app is red and says "QueuePass Tickets (Rust)"', async () => {
    await expect(page).toHaveTitle(RUST.name);
    await expect(page.getByRole('banner')).toContainText(RUST.name);
    const colors = await page.evaluate(() => ({
      page: getComputedStyle(document.body).backgroundColor,
      header: getComputedStyle(document.querySelector('header.topbar')!).backgroundColor,
    }));
    expect(colors.page).toBe(RED.bg);
    expect(colors.header).toBe(RED.surface);
  });

  await test.step('no sign-in value is left in the browser storage', async () => {
    // Tokens in memory only; the PKCE state is removed from sessionStorage once used (parity S2).
    expect(await storageOf(page)).toEqual({ session: [], local: [] });
  });

  await test.step('My tickets lists the order placed through the React app: the same customer', async () => {
    await expect(
      page.getByRole('article').getByRole('heading', { level: 2 }).filter({ hasText: eventName }),
    ).toHaveCount(1);
  });

  await context.close();
});

/** One sign-in per app, in the shared window's tabs. */
type Tab = 'rust' | 'react' | 'admin' | 'admin-rust' | 'booth';

test('040 S2: the two Customer apps share one session, and logging out of one releases holds and leaves every other app signed in', async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  // Index 10 is 001's and 028's sign-in-only customer; this test's one hold is released by the
  // logout it checks, so it leaves nothing behind.
  const username = customerFor(testInfo, 10);
  const eventName = uniqueName(testInfo, 'shared session');

  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const { event } = await seatedEvent(admin.api, {
    venueName: uniqueName(testInfo, 'session hall'),
    place: PLACES.louisville,
    layout: {
      name: 'Main floor',
      levels: [{ name: 'Standard', color: 'blue' }],
      sections: [{ name: 'A', rows: 1, seatsPerRow: 10, level: 'Standard' }],
    },
    event: { name: eventName, startsAt: startsInHours(24 * 7), endsAt: startsInHours(24 * 7 + 3) },
    prices: { Standard: '25.00' },
  });
  await admin.close();

  // One browser window: one context, one tab per app. The clock is the context's, installed once
  // before the first page, so the access tokens' renewal can be forced (as 028 does).
  const context: BrowserContext = await browser.newContext();
  await context.clock.install();
  const tabs: Record<Tab, Page> = {
    rust: await context.newPage(),
    react: await context.newPage(),
    admin: await context.newPage(),
    'admin-rust': await context.newPage(),
    booth: await context.newPage(),
  };

  await test.step('signed in to the Rust app, the React app signs in without the form', async () => {
    await signIn(tabs.rust, 'customer-rust', username);
    await tabs.react.goto(REACT.url);
    await expect(tabs.react.getByRole('button', { name: 'Log out' })).toBeVisible();
    await expect(signInHeading(tabs.react, 'customer')).toHaveCount(0);
    await expect(tabs.react).toHaveURL(new RegExp(`^${REACT.url}/`));
  });

  await test.step('both Admin apps and the Booth are signed in, each in its own realm', async () => {
    await signIn(tabs.admin, 'admin', adminFor(testInfo));
    await signIn(tabs['admin-rust'], 'admin-rust', adminFor(testInfo));
    // Agent 2 is 028's: this test only signs in and stays signed in.
    await signIn(tabs.booth, 'booth', agentFor(testInfo, 2));
  });

  const tickets = tabs.react.getByRole('region', { name: 'Get tickets' });
  const seats = tickets.getByRole('group', { name: 'Main floor map' });
  const seat = seats.getByRole('button', { name: /^Row 1, Seat 4, / });

  await test.step('the React Customer app holds a seat', async () => {
    await tabs.react.goto(`${REACT.url}/events/${event.id}`);
    await tickets.getByRole('button', { name: 'Choose seats' }).click();
    await seats.getByRole('button', { name: /^Section A, / }).click();
    await seat.click();
    await expect(seat).toHaveAccessibleName('Row 1, Seat 4, Standard, $25, held by you');
  });

  await test.step("the Rust app's Log out releases it, and Keycloak only redirects back (R2)", async () => {
    // Research R2: record the logout's own answers and every frame the Rust tab loads meanwhile.
    // The default, asserted here, is that Keycloak answers the end-session request with a redirect
    // back (no front-channel logout page of its own) and never frames the React Customer app.
    const logoutAnswers: number[] = [];
    const framed: string[] = [];
    const onResponse = (res: Response) => {
      if (
        res.url().startsWith(`${KEYCLOAK}/realms/${CUSTOMER_REALM}/protocol/openid-connect/logout`)
      ) {
        logoutAnswers.push(res.status());
      }
    };
    const onFrame = (frame: Frame) => {
      if (frame.parentFrame()) framed.push(frame.url());
    };
    tabs.rust.on('response', onResponse);
    tabs.rust.on('framenavigated', onFrame);
    const release = tabs.rust.waitForRequest(
      (req) => req.url() === `${API_BASE}/me/reservations/release` && req.method() === 'POST',
    );
    release.catch(() => undefined);

    await signOut(tabs.rust, 'customer-rust');
    // Release on logout ran first, with the token still in memory (parity S5, S6).
    expect((await release).headers()['authorization']).toMatch(/^Bearer /);
    tabs.rust.off('response', onResponse);
    tabs.rust.off('framenavigated', onFrame);

    expect(logoutAnswers.length).toBeGreaterThan(0);
    for (const status of logoutAnswers) {
      expect(status, 'the end-session answer is a redirect').toBeGreaterThanOrEqual(300);
      expect(status, 'the end-session answer is a redirect').toBeLessThan(400);
    }
    expect(framed.filter((url) => url.startsWith(REACT.url))).toEqual([]);
    expect(framed.filter((url) => url.startsWith(KEYCLOAK))).toEqual([]);

    // The hold is the account's, so the React tab's map shows the seat open again.
    await expect(seat).toHaveAccessibleName('Row 1, Seat 4, Standard, $25, open');
  });

  await test.step('at its next renewal, the React Customer app asks for sign-in again', async () => {
    // The realm session has ended, so the React app's refresh is refused (an OAuth error), which
    // ends its session and signs in again (parity S2). Its access token may work until then.
    await context.clock.runFor('04:05');
    await expect(signInHeading(tabs.react, 'customer')).toBeVisible({ timeout: 30_000 });
  });

  await test.step('both Admin apps and the Booth are still signed in after a reload', async () => {
    for (const [tab, app] of [
      ['admin', 'admin'],
      ['admin-rust', 'admin-rust'],
      ['booth', 'booth'],
    ] as const) {
      await tabs[tab].reload();
      await expect(tabs[tab].getByRole('button', { name: 'Log out' }), app).toBeVisible();
      await expect(signInHeading(tabs[tab], app), app).toHaveCount(0);
    }
  });

  await context.close();
});

/**
 * Research R13: rewrites the Customer realm's token answers so the access token's
 * `realm_access.roles` lacks `customer`. The signature is left as it is (neither app verifies the
 * access token; the Backend would refuse it), and the ID token, which the Rust app verifies, is
 * untouched. No Keycloak writes: a role-less account in this realm would be disabled by the seed.
 */
async function withoutCustomerRole(route: Route): Promise<void> {
  const response = await route.fetch();
  const body = (await response.json()) as { access_token?: string };
  if (body.access_token) {
    const [header, payload, signature] = body.access_token.split('.');
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as {
      realm_access?: { roles?: string[] };
    };
    claims.realm_access = {
      roles: (claims.realm_access?.roles ?? []).filter((role) => role !== 'customer'),
    };
    const rewritten = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    body.access_token = `${header}.${rewritten}.${signature}`;
  }
  await route.fulfill({ response, json: body });
}

test('040 S8: a token without the customer role shows the wrong-role card, and an unreachable Backend is said plainly', async ({
  browser,
}, testInfo) => {
  // Index 9: this test only signs in; it buys and holds nothing.
  const username = customerFor(testInfo, 9);
  // Both Customer apps, the React one as the reference for the same screens (parity S7, S8).
  for (const app of ['customer', 'customer-rust'] as const) {
    await test.step(`${app}: the wrong-role card, with no API call`, async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const calls = authorizedApiCalls(page);
      await page.route(TOKEN_URL, withoutCustomerRole);

      await page.goto(APPS[app].url);
      await expect(signInHeading(page, app)).toBeVisible();
      await submitSignIn(page, username, 'test123');

      const card = page.locator('div.card');
      await expect(
        card.getByRole('heading', { level: 1, name: "Your account can't use this app." }),
      ).toBeVisible();
      await expect(card.getByText(`You are signed in as ${username}.`)).toBeVisible();
      await expect(card.getByRole('button', { name: 'Log out' })).toHaveClass(/\bbtn--primary\b/);
      // The whole page is the card: no top bar, no navigation, no data (parity S7).
      await expect(page.locator('header.topbar')).toHaveCount(0);
      await expect(page.getByRole('navigation')).toHaveCount(0);
      expect(calls).toEqual([]);

      await test.step(`${app}: an unreachable Backend is said plainly`, async () => {
        // The real token again (the Keycloak session signs in without the form), and every API
        // call failing as if the Backend were down.
        await page.unroute(TOKEN_URL);
        await page.route(`${API_BASE}/**`, (route) => route.abort());
        await page.goto(`${APPS[app].url}/events`);
        await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
        const alert = page
          .getByRole('alert')
          .filter({ hasText: "Can't reach the QueuePass service." });
        await expect(alert).toBeVisible();
        await expect(alert).toHaveText("Can't reach the QueuePass service.");
        await expect(alert).toHaveClass(
          /\bbanner\b.*\bbanner--error\b|\bbanner--error\b.*\bbanner\b/,
        );
        await expect(page.getByRole('heading', { level: 1, name: 'Events' })).toBeVisible();
      });

      await context.close();
    });
  }
});
