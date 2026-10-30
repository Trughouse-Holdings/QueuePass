// Spec 001 quickstart V3 and V4: sign-in, the signed-in page, and logout in each app; the wrong
// role refused.
import { expect, test, type Page } from '@playwright/test';
import { APPS, adminFor, agentFor, customerFor, type AppName } from '../fixtures/apps';
import { signIn, signInHeading, signOut } from '../fixtures/sign-in';

/** What each app shows once signed in (V3's "hello-world page", as each app has it today). */
async function expectSignedIn(page: Page, app: AppName, username: string): Promise<void> {
  await expect(page.getByText(APPS[app].name, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  if (app === 'admin') {
    // The Admin app's landing page is still 001's hello page: the Backend's greeting, called
    // with the user's own token.
    await expect(page.getByRole('heading', { level: 1, name: APPS.admin.name })).toBeVisible();
    await expect(page.getByText(username)).toBeVisible();
  } else if (app === 'customer') {
    await expect(page.getByRole('heading', { level: 1, name: 'Events' })).toBeVisible();
  } else {
    await expect(
      page.getByRole('heading', { level: 1, name: 'Choose the event you are working' }),
    ).toBeVisible();
  }
}

test('001 V3: sign in, the signed-in page, and logout in each app', async ({
  browser,
}, testInfo) => {
  const users: Record<AppName, string> = {
    admin: adminFor(testInfo),
    customer: customerFor(testInfo, 9),
    booth: agentFor(testInfo, 0),
  };
  for (const app of ['admin', 'customer', 'booth'] as const) {
    await test.step(`${app}: ${users[app]}`, async () => {
      // A new context per app: V3's private window, so no earlier session interferes.
      const context = await browser.newContext();
      const page = await context.newPage();
      // 1-3: the app sends you to Keycloak's page; the right password returns you signed in.
      await signIn(page, app, users[app]);
      await expectSignedIn(page, app, users[app]);
      // 4: a reload keeps you signed in, through Keycloak's session, with no sign-in prompt.
      await page.reload();
      await expectSignedIn(page, app, users[app]);
      // 5: Log out ends the session: you end on Keycloak's page.
      await signOut(page, app);
      // 7: reopening the app asks you to sign in again.
      await page.goto(APPS[app].url);
      await expect(signInHeading(page, app)).toBeVisible();
      await context.close();
    });
  }
});

test('001 V4: a customer is refused in the Admin app', async ({ page }, testInfo) => {
  const customer = customerFor(testInfo, 10);
  await signIn(page, 'admin', customer);
  await expect(page.getByText("Your account can't use this app.")).toBeVisible();
  await expect(page.getByText(`You are signed in as ${customer}.`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  // Nothing else: none of the Admin app's pages or data.
  await expect(page.getByRole('link', { name: 'Venues' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Events' })).toHaveCount(0);
  await signOut(page, 'admin');
});
