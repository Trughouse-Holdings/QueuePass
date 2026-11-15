// Spec 037 (quickstart S1–S5, S10, S11; research R10): the Rust Admin app beside the React Admin
// app. Each test drives both apps, so it runs in the default project only; the shared Admin
// journeys run against the Rust app through the `admin-rust` project (`@admin`).
import { expect, test, type Locator, type Page } from '@playwright/test';
import { APPS, adminFor } from '../fixtures/apps';
import { PLACES, uniqueName } from '../fixtures/data';
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

/** The venue page's Layouts card and one layout in it, by its name. */
const layoutsCard = (page: Page): Locator => page.getByRole('region', { name: 'Layouts' });
const layoutItem = (page: Page, name: string): Locator =>
  layoutsCard(page).getByRole('article', { name, exact: true });

/** One section line of the venue form or the lines form, typed into its labelled boxes. */
async function typeSection(
  scope: Page | Locator,
  n: number,
  name: string,
  rows: string,
  seats: string,
) {
  await scope.getByRole('textbox', { name: `Section ${n} Section name`, exact: true }).fill(name);
  await scope.getByRole('spinbutton', { name: `Section ${n} Rows`, exact: true }).fill(rows);
  await scope
    .getByRole('spinbutton', { name: `Section ${n} Seats per row`, exact: true })
    .fill(seats);
}

/** A layout file with mistakes the Backend lists (LAYOUT_FILE_INVALID). */
const BAD_LAYOUT = {
  name: 'Broken',
  size: { width: 100, height: 100 },
  floor: { kind: 'NONE' },
  levels: [{ name: 'Only', color: 'not-a-color' }],
  sections: [],
};

/** Imports BAD_LAYOUT on the venue page and returns what the refusal lists. */
async function importBadLayout(page: Page): Promise<string[]> {
  await layoutsCard(page)
    .getByLabel('Layout file', { exact: true })
    .setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(BAD_LAYOUT)),
    });
  await layoutsCard(page).getByRole('button', { name: 'Import layout file' }).click();
  const refusal = layoutsCard(page).getByRole('alert');
  await expect(refusal).toContainText('Could not import the layout');
  return refusal.getByRole('listitem').allInnerTexts();
}

test('037 S2: a venue and its layout made in the Rust Admin app show in the React Admin app', async ({
  browser,
}, testInfo) => {
  const username = adminFor(testInfo);
  const venueName = uniqueName(testInfo, 'rust arena');
  const context = await browser.newContext();
  const rust = await context.newPage();
  const react = await context.newPage();
  const place = PLACES.louisville;

  await test.step('in the Rust app, a seated venue with two section lines', async () => {
    await signIn(rust, 'admin-rust', username, '/locations/new');
    await expect(rust.getByRole('heading', { level: 1, name: 'New venue' })).toBeVisible();
    await rust.getByLabel('Name', { exact: true }).fill(venueName);
    await rust.getByLabel('Street address', { exact: true }).fill(place.street);
    await rust.getByLabel('City', { exact: true }).fill(place.city);
    await rust.getByLabel('State', { exact: true }).selectOption(place.state);
    await rust.getByLabel('ZIP code', { exact: true }).fill(place.zip);
    await rust.getByRole('radio', { name: 'Seated' }).check();
    await rust.getByRole('button', { name: 'Add section' }).click();
    await rust.getByRole('button', { name: 'Add section' }).click();
    await typeSection(rust, 1, 'Floor', '10', '20');
    await typeSection(rust, 2, 'Balcony', '5', '10');
    await rust.getByRole('button', { name: 'Add venue' }).click();
    await expect(rust.getByRole('status')).toContainText('Venue saved');
  });

  let venuePath = '';
  await test.step('the React app lists it, with its Standard layout', async () => {
    await signIn(react, 'admin', username, '/locations');
    await react.getByRole('link', { name: venueName, exact: true }).click();
    venuePath = new URL(react.url()).pathname;
    await expect(react.getByRole('heading', { level: 1, name: venueName })).toBeVisible();
    await expect(layoutItem(react, 'Standard')).toContainText('250 seats · 2 sections');
  });

  await test.step('renamed in React, read in Rust', async () => {
    const standard = layoutItem(react, 'Standard');
    await standard.getByRole('button', { name: 'Rename Standard' }).click();
    await standard.getByLabel('New name for Standard').fill('Main floor');
    await standard.getByRole('button', { name: 'Save name' }).click();
    await expect(layoutItem(react, 'Main floor')).toBeVisible();
    await rust.goto(`${RUST.url}${venuePath}`);
    await expect(layoutItem(rust, 'Main floor')).toContainText('250 seats · 2 sections');
  });

  await test.step('in Rust, duplicated and its section lines edited', async () => {
    await layoutItem(rust, 'Main floor')
      .getByRole('button', { name: 'Duplicate Main floor' })
      .click();
    const copy = layoutItem(rust, 'Main floor (copy)');
    await expect(copy).toContainText('250 seats · 2 sections');
    await copy.getByRole('button', { name: 'Edit section lines of Main floor (copy)' }).click();
    const form = layoutsCard(rust).getByRole('form', {
      name: 'Section lines of Main floor (copy)',
    });
    await form.getByRole('spinbutton', { name: 'Section 1 Rows', exact: true }).fill('12');
    await form.getByRole('button', { name: 'Save layout' }).click();
    await expect(copy).toContainText('290 seats · 2 sections');
  });

  await test.step('a bad layout file: the same problems in both apps, nothing saved', async () => {
    const fromRust = await importBadLayout(rust);
    expect(fromRust.length).toBeGreaterThan(0);
    await expect(layoutsCard(rust).getByRole('article')).toHaveCount(2);
    await react.reload();
    const fromReact = await importBadLayout(react);
    expect(fromRust).toEqual(fromReact);
    await expect(layoutsCard(react).getByRole('article')).toHaveCount(2);
    await expect(layoutItem(react, 'Main floor (copy)')).toContainText('290 seats · 2 sections');
  });

  await context.close();
});
