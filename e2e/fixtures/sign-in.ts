// Spec 022 (research R5, FR-004): sign in on Keycloak's own page, by labels and roles only, as a
// person does, with a seed test account; never a stored session, so a broken sign-in fails here.
import { expect, type Page } from '@playwright/test';
import { APPS, PASSWORD, type AppName } from './apps';

/** Keycloak's page for this app: its one heading names the app (spec 021 FR-001). */
export const signInHeading = (page: Page, app: AppName) =>
  page.getByRole('heading', { name: `Sign in to ${APPS[app].name}` });

/** Opens the app (at `path`), signs in on Keycloak's page, and waits for the signed-in app. */
export async function signIn(
  page: Page,
  app: AppName,
  username: string,
  path = '/',
): Promise<void> {
  await page.goto(`${APPS[app].url}${path}`);
  await expect(signInHeading(page, app)).toBeVisible();
  await page.getByLabel(/^Username/).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: /^Sign in$/i }).click();
  // Every signed-in page, the wrong-role page included, offers Log out (spec 001 FR-015).
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`^${APPS[app].url}/`));
}

/** Log out ends the app's and Keycloak's session: the app sends you back to Keycloak's page. */
export async function signOut(page: Page, app: AppName): Promise<void> {
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(signInHeading(page, app)).toBeVisible();
}
