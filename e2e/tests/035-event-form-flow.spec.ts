// Spec 035 quickstart S1 (FR-008, SC-001, T007): a seated event that assigns every section of a
// 30-seat layout is scheduled without a submit-time error, and both ticket types are saved.
import { expect, test } from '@playwright/test';
import { adminFor } from '../fixtures/apps';
import { apiFor, createVenue, type Event, type TicketTier } from '../fixtures/api';
import { PLACES, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';
import { localDate } from '../fixtures/time';

const EASTERN = 'America/New_York';

test("035 S1: a seated event that fills the venue's layout is scheduled without a submit-time error", async ({
  page,
  browser,
}, testInfo) => {
  const venueName = uniqueName(testInfo, '035 Hall');
  const eventName = uniqueName(testInfo, '035 Full House');
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  await createVenue(admin.api, PLACES.louisville, venueName, [
    { name: 'Front', rows: 2, seatsPerRow: 5 },
    { name: 'Middle', rows: 2, seatsPerRow: 5 },
    { name: 'Back', rows: 2, seatsPerRow: 5 },
  ]);

  const day = localDate(EASTERN, 5);
  await signIn(page, 'admin', adminFor(testInfo));
  await page.getByRole('link', { name: 'Events', exact: true }).click();
  await page.getByRole('link', { name: 'Schedule event' }).first().click();
  await page.getByLabel('Event name', { exact: true }).fill(eventName);
  await page
    .getByLabel('Venue', { exact: true })
    .selectOption({ label: `${venueName} (500 seats)` });
  await page.getByLabel('Starts', { exact: true }).fill(`${day}T19:00`);
  await page.getByLabel('Ends', { exact: true }).fill(`${day}T22:00`);

  await expect(page.getByRole('group', { name: 'Tickets and seating' })).toBeVisible();
  await expect(page.getByLabel('Reserved seating')).toBeChecked();
  await page.getByLabel('Ticket type 1 name', { exact: true }).fill('Floor');
  await page.getByLabel('Ticket type 1 price', { exact: true }).fill('80.00');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await page.getByLabel('Ticket type 2 name', { exact: true }).fill('Balcony');
  await page.getByLabel('Ticket type 2 price', { exact: true }).fill('60.00');
  await page.getByRole('combobox', { name: 'Section Middle ticket type' }).selectOption({
    label: 'Balcony',
  });
  await page.getByRole('combobox', { name: 'Section Back ticket type' }).selectOption({
    label: 'Balcony',
  });

  await expect(page.getByTestId('seat-total')).toHaveText(
    '30 of 30 seats assigned All 30 seats are assigned.',
  );

  await page.getByRole('button', { name: 'Schedule event' }).click();
  await expect(page.getByRole('heading', { level: 1, name: eventName })).toBeVisible();
  await expect(page.getByTestId('error-banner')).toHaveCount(0);
  await expect(page.getByTestId('submit-error')).toHaveCount(0);

  const events = await admin.api.call<Event[]>('GET', `/events?q=${encodeURIComponent(eventName)}`);
  expect(events).toHaveLength(1);
  const tiers = await admin.api.call<TicketTier[]>('GET', `/events/${events[0].id}/tiers`);
  expect(tiers.map((t) => [t.name, t.quantity]).sort()).toEqual([
    ['Balcony', 20],
    ['Floor', 10],
  ]);
  await admin.close();
});
