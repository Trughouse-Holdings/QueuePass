// Spec 036 quickstart S1 (FR-003, FR-004, SC-006, T007): an event scheduled with doors 2 hours
// before the start shows that time in the Customer app. The form still sends doorsOpenAt.
import { expect, test } from '@playwright/test';
import { adminFor, customerFor } from '../fixtures/apps';
import { apiFor, createVenue } from '../fixtures/api';
import { PLACES, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';
import { atLocal, localDate, timeOfDay } from '../fixtures/time';
import { fillEventDateTime } from '../fixtures/event-times';

const EASTERN = 'America/New_York';

test('036 S1: an event with doors 2 hours before the start shows that time in the Customer app', async ({
  page,
  browser,
}, testInfo) => {
  const venueName = uniqueName(testInfo, '036 Hall');
  const eventName = uniqueName(testInfo, '036 Doors Show');
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  await createVenue(admin.api, PLACES.louisville, venueName);
  await admin.close();

  const day = localDate(EASTERN, 4);
  const at = (time: string) => atLocal(`${day}T${time}`, EASTERN);
  const doorsAt = timeOfDay(at('17:00'), EASTERN);

  await signIn(page, 'admin', adminFor(testInfo));
  await page.getByRole('link', { name: 'Events', exact: true }).click();
  await page.getByRole('link', { name: 'Schedule event' }).first().click();
  await page.getByLabel('Event name', { exact: true }).fill(eventName);
  await page
    .getByLabel('Venue', { exact: true })
    .selectOption({ label: `${venueName} (500 seats)` });
  await expect(page.getByLabel('Before the start')).toBeChecked();
  await page.getByLabel('How long before the start').selectOption({ label: '2 hours before' });
  await fillEventDateTime(page, 'Starts', `${day}T19:00`);
  await expect(page.getByTestId('doorsOpenAt-preview')).toHaveText(`Doors open at ${doorsAt}`);
  await fillEventDateTime(page, 'Ends', `${day}T22:00`);
  await page.getByLabel('Ticket type 1 name', { exact: true }).fill('General');
  await page.getByLabel('Ticket type 1 price', { exact: true }).fill('20');
  await page.getByLabel('Ticket type 1 quantity', { exact: true }).fill('50');
  await page.getByRole('button', { name: 'Schedule event' }).click();
  await expect(page.getByRole('heading', { level: 1, name: eventName })).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: doorsAt })).toHaveCount(1);
  const eventPath = new URL(page.url()).pathname;

  const context = await browser.newContext();
  const customer = await context.newPage();
  await signIn(customer, 'customer', customerFor(testInfo, 3), eventPath);
  await expect(customer.getByRole('heading', { level: 1, name: eventName })).toBeVisible();
  await expect(customer.getByRole('term').filter({ hasText: /^Doors open$/ })).toBeVisible();
  await expect(customer.getByRole('definition').filter({ hasText: doorsAt })).toHaveCount(1);
  await context.close();
});
