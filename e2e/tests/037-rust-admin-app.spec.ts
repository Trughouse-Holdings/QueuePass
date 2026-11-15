// Spec 037 (quickstart S1–S5, S10, S11; research R10): the Rust Admin app beside the React Admin
// app. Each test drives both apps, so it runs in the default project only; the shared Admin
// journeys run against the Rust app through the `admin-rust` project (`@admin`).
import { expect, test, type Page } from '@playwright/test';
import { APPS, adminFor } from '../fixtures/apps';
import { signIn, signInHeading, signOut, submitSignIn } from '../fixtures/sign-in';

const RUST = APPS['admin-rust'];

/** Spec 037 research R8: the red look tokens, light set (admin-rust-app/style/red.css). */
const RED = { bg: 'rgb(253, 236, 234)', surface: 'rgb(255, 247, 246)' };

/** What the Rust app's origin keeps in the browser's storage: nothing once signed in (R3). */
async function storageOf(page: Page): Promise<{ session: string[]; local: string[] }> {
  return page.evaluate(() => ({
    session: Object.keys(sessionStorage),
    local: Object.keys(localStorage),
  }));
}

test('037 S1: both Admin apps stay signed in, and logging out of one leaves the other', async ({
  browser,
}, testInfo) => {
  const username = adminFor(testInfo);
  const context = await browser.newContext({ colorScheme: 'light' });
  const react = await context.newPage();
  const rust = await context.newPage();

  await test.step('sign in to both Admin apps in one window', async () => {
    await signIn(react, 'admin', username);
    await rust.goto(RUST.url);
    await expect(
      rust.getByRole('heading', { name: 'Sign in to QueuePass Admin (Rust)' }),
    ).toBeVisible();
    await submitSignIn(rust, username, 'test123');
    await expect(rust.getByRole('button', { name: 'Log out' })).toBeVisible();
    await expect(rust).toHaveURL(new RegExp(`^${RUST.url}/`));
  });

  await test.step('the Rust app says "(Rust)" and is red', async () => {
    await expect(rust).toHaveTitle(/\(Rust\)/);
    await expect(rust.getByRole('banner')).toContainText('QueuePass Admin (Rust)');
    const colors = await rust.evaluate(() => ({
      page: getComputedStyle(document.body).backgroundColor,
      header: getComputedStyle(document.querySelector('header.topbar')!).backgroundColor,
    }));
    expect(colors.page).toBe(RED.bg);
    expect(colors.header).toBe(RED.surface);
    // The React app keeps its own look.
    const reactPage = await react.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(reactPage).not.toBe(RED.bg);
  });

  await test.step("no sign-in value is left in the Rust app's storage", async () => {
    expect(await storageOf(rust)).toEqual({ session: [], local: [] });
  });

  await test.step('logging out of Rust leaves React signed in', async () => {
    await signOut(rust, 'admin-rust');
    await react.reload();
    await expect(react.getByRole('button', { name: 'Log out' })).toBeVisible();
    await expect(signInHeading(react, 'admin')).toHaveCount(0);
  });

  await test.step('opening /events signed out lands on Events after sign-in (returnTo)', async () => {
    await rust.goto(`${RUST.url}/events`);
    await expect(signInHeading(rust, 'admin-rust')).toBeVisible();
    await submitSignIn(rust, username, 'test123');
    await expect(rust).toHaveURL(`${RUST.url}/events`);
    await expect(rust.getByRole('heading', { level: 1, name: 'Events' })).toBeVisible();
    expect(await storageOf(rust)).toEqual({ session: [], local: [] });
  });

  await test.step('logging out of React leaves Rust signed in', async () => {
    await signOut(react, 'admin');
    await rust.reload();
    await expect(rust.getByRole('button', { name: 'Log out' })).toBeVisible();
    await expect(signInHeading(rust, 'admin-rust')).toHaveCount(0);
  });

  await context.close();
});
