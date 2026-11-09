// Spec 001 quickstart V3 and V4: sign-in, the signed-in page, and logout in each app; another
// app's account refused (spec 028 FR-012).
import { expect, test, type Page } from '@playwright/test';
import { APPS, PASSWORD, adminFor, agentFor, customerFor, type AppName } from '../fixtures/apps';
import { signInHeading, signOut, submitSignIn } from '../fixtures/sign-in';

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

// Spec 028 FR-012 (research R10): each app signs in through its own realm, which holds only its
// own app's accounts, so another app's account is refused on the sign-in page itself. The
// wrong-role page is covered by packages/shared/test/web/require-role.test.tsx.
test("001 V4: each app's sign-in page refuses another app's account", async ({
  browser,
}, testInfo) => {
  // V4: a customer at the Admin app, a gate agent at the Customer app, an admin at the Booth.
  const refused: [AppName, string][] = [
    ['admin', customerFor(testInfo, 10)],
    ['customer', agentFor(testInfo, 1)],
    ['booth', adminFor(testInfo)],
  ];
  for (const [app, username] of refused) {
    await test.step(`${app}: ${username}`, async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(APPS[app].url);
      await expect(signInHeading(page, app)).toBeVisible();
      await submitSignIn(page, username, PASSWORD);
      // On CI's clean stack the account is not in this app's realm at all.
      await expect(signInHeading(page, app)).toBeVisible();
      await expect(page.getByText('Invalid username or password.')).toBeVisible();
      // Not signed in: no app page, and never the wrong-role page.
      await expect(page).not.toHaveURL(new RegExp(`^${APPS[app].url}/`));
      await expect(page.getByRole('button', { name: 'Log out' })).toHaveCount(0);
      await expect(page.getByText("Your account can't use this app.")).toHaveCount(0);
      await context.close();
    });
  }
});
