// Spec 001 quickstart V3 and V4: sign-in, the signed-in page, and logout in each app; the wrong
// role refused.
import { expect, test, type Page } from '@playwright/test';
import { APPS, PASSWORD, adminFor, agentFor, customerFor, type AppName } from '../fixtures/apps';
import { signIn, signInHeading, signOut, submitSignIn } from '../fixtures/sign-in';

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
      // 1: opening the app sends you to Keycloak's page; no app content shows first.
      await page.goto(APPS[app].url);
      await expect(signInHeading(page, app)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Log out' })).toHaveCount(0);
      // 2: a wrong password keeps you on Keycloak's page, with an error.
      await submitSignIn(page, users[app], 'wrong-password');
      await expect(signInHeading(page, app)).toBeVisible();
      await expect(page.getByText('Invalid username or password.')).toBeVisible();
      // 3: the right password returns you to the app, signed in.
      await submitSignIn(page, users[app], PASSWORD);
      await expectSignedIn(page, app, users[app]);
      // 4: a reload keeps you signed in, through Keycloak's session, with no sign-in prompt.
      await page.reload();
      await expectSignedIn(page, app, users[app]);
      // 5: Log out ends the session: you end on Keycloak's page.
      await signOut(page, app);
      // 6: the browser's Back shows no signed-in content (SC-007): you are asked to sign in.
      await page.goBack();
      await expect(signInHeading(page, app)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Log out' })).toHaveCount(0);
      // 7: reopening the app asks you to sign in again.
      await page.goto(APPS[app].url);
      await expect(signInHeading(page, app)).toBeVisible();
      await context.close();
    });
  }
});

test('001 V4: each app refuses an account without its role', async ({ browser }, testInfo) => {
  // V4: a customer at the Admin app, a gate agent at the Customer app, an admin at the Booth.
  const refused: [AppName, string, string][] = [
    ['admin', customerFor(testInfo, 10), 'Venues'],
    ['customer', agentFor(testInfo, 1), 'My tickets'],
    ['booth', adminFor(testInfo), 'Choose the event you are working'],
  ];
  for (const [app, username, appContent] of refused) {
    await test.step(`${app}: ${username}`, async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await signIn(page, app, username);
      await expect(page.getByText("Your account can't use this app.")).toBeVisible();
      await expect(page.getByText(`You are signed in as ${username}.`)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Log out' })).toHaveCount(1);
      // Nothing else: none of the app's own pages or data.
      await expect(page.getByText(appContent)).toHaveCount(0);
      await expect(page.getByRole('link')).toHaveCount(0);
      await signOut(page, app);
      await context.close();
    });
  }
});
