// Spec 003 quickstart C1 (with 002's Admin pages and 013's address check): an admin adds a venue
// and an event in the Admin app; a customer finds the event, with its venue and times.
import { expect, test } from '@playwright/test';
import { adminFor, customerFor } from '../fixtures/apps';
import { PLACES, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';
import { atLocal, eventTime, localDate } from '../fixtures/time';

const ZONE = 'America/New_York'; // Louisville, KY: Eastern.

test('003 C1: an admin adds a venue and an event; a customer finds it with its venue and times', async ({
  browser,
}, testInfo) => {
  const venueName = uniqueName(testInfo, 'hall');
  const eventName = uniqueName(testInfo, 'early show');
  const day = localDate(ZONE, 1);

  await test.step('the admin adds a venue at a checked address', async () => {
    const admin = await (await browser.newContext()).newPage();
    await signIn(admin, 'admin', adminFor(testInfo));
    await admin.getByRole('link', { name: 'Venues', exact: true }).click();
    await admin.getByRole('link', { name: 'Add venue' }).first().click();
    await admin.getByLabel('Name', { exact: true }).fill(venueName);
    await admin.getByLabel('Street address', { exact: true }).fill(PLACES.louisville.street);
    await admin.getByLabel('City', { exact: true }).fill(PLACES.louisville.city);
    await admin.getByLabel('State', { exact: true }).selectOption(PLACES.louisville.state);
    await admin.getByLabel('ZIP code', { exact: true }).fill(PLACES.louisville.zip);
    await admin.getByLabel('Seating capacity', { exact: true }).fill('500');
    await admin.getByRole('button', { name: 'Create venue' }).click();
    // Spec 013: saved in the address service's standard form; spec 020: its zone from the address.
    await expect(
      admin.getByText(/^Venue saved\. Address: 1 ARENA PLZ, LOUISVILLE, KY 40202\./),
    ).toBeVisible();
    await expect(admin.getByText(/Time zone: Eastern Time/)).toBeVisible();

    await test.step('and schedules an event there tomorrow, 6:00 PM to 9:00 PM', async () => {
      await admin.getByRole('link', { name: 'Events', exact: true }).click();
      await admin.getByRole('link', { name: 'Schedule event' }).first().click();
      await admin.getByLabel('Event name', { exact: true }).fill(eventName);
      await admin
        .getByLabel('Venue', { exact: true })
        .selectOption({ label: `${venueName} (500 seats)` });
      await admin.getByLabel('Starts', { exact: true }).fill(`${day}T18:00`);
      await admin.getByLabel('Ends', { exact: true }).fill(`${day}T21:00`);
      await admin.getByLabel('Ticket type 1 name', { exact: true }).fill('General');
      await admin.getByLabel('Ticket type 1 price', { exact: true }).fill('45.5');
      await admin.getByLabel('Ticket type 1 quantity', { exact: true }).fill('100');
      await admin.getByRole('button', { name: 'Schedule event' }).click();
      await expect(admin.getByRole('heading', { level: 1, name: eventName })).toBeVisible();
    });
    await admin.context().close();
  });

  await test.step('a customer finds it by name, with its venue, times, and price', async () => {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, 'customer', customerFor(testInfo, 8));
    // The landing page is the event list (C1 step 2).
    await expect(page.getByRole('heading', { level: 1, name: 'Events' })).toBeVisible();
    await page.getByLabel('Search events').fill(eventName);
    const card = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: eventName }) });
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('link', { name: venueName })).toBeVisible();
    await expect(card).toContainText(eventTime(atLocal(`${day}T18:00`, ZONE), ZONE));
    await expect(card).toContainText(eventTime(atLocal(`${day}T21:00`, ZONE), ZONE));
    await expect(card).toContainText('$45.50');
    await page.context().close();
  });
});
