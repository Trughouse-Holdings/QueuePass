// Spec 035 quickstart S1 (FR-008, SC-001, T007): a seated event on a 30-seat layout is scheduled
// without a submit-time error. Spec 038 (FR-010, FR-011): the event takes one of the venue's
// layouts and a price per level, in place of a ticket type per section; every seat is on sale.
import { expect, test } from '@playwright/test';
import { adminFor } from '../fixtures/apps';
import { apiFor, createLayout, createVenue, type Event } from '../fixtures/api';
import { PLACES, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';
import { localDate } from '../fixtures/time';
import { fillEventDateTime } from '../fixtures/event-times';

const EASTERN = 'America/New_York';

test("035 S1: a seated event that fills the venue's layout is scheduled without a submit-time error", async ({
  page,
  browser,
}, testInfo) => {
  const venueName = uniqueName(testInfo, '035 Hall');
  const eventName = uniqueName(testInfo, '035 Full House');
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const venue = await createVenue(admin.api, PLACES.louisville, venueName);
  const layout = await createLayout(admin.api, venue, {
    name: 'Hall',
    levels: [
      { name: 'Floor', color: 'violet' },
      { name: 'Balcony', color: 'teal' },
    ],
    sections: [
      { name: 'Front', rows: 2, seatsPerRow: 5, level: 'Floor' },
      { name: 'Middle', rows: 2, seatsPerRow: 5, level: 'Balcony' },
      { name: 'Back', rows: 2, seatsPerRow: 5, level: 'Balcony' },
    ],
  });

  const day = localDate(EASTERN, 5);
  await signIn(page, 'admin', adminFor(testInfo));
  await page.getByRole('link', { name: 'Events', exact: true }).click();
  await page.getByRole('link', { name: 'Schedule event' }).first().click();
  await page.getByLabel('Event name', { exact: true }).fill(eventName);
  // The venue's capacity is its largest layout's seats (spec 038 FR-009).
  await page
    .getByLabel('Venue', { exact: true })
    .selectOption({ label: `${venueName} (30 seats)` });
  await fillEventDateTime(page, 'Starts', `${day}T19:00`);
  await fillEventDateTime(page, 'Ends', `${day}T22:00`);

  await expect(page.getByRole('group', { name: 'Tickets and seating' })).toBeVisible();
  await page.getByLabel('Seating', { exact: true }).selectOption({ label: 'Hall (30 seats)' });
  await expect(page.getByRole('table', { name: 'Prices by level' })).toBeVisible();
  await page.getByLabel('Floor price', { exact: true }).fill('80.00');
  await page.getByLabel('Balcony price', { exact: true }).fill('60.00');
  await expect(page.getByTestId('seat-line')).toHaveText('30 seats on sale · 0 off sale');

  await page.getByRole('button', { name: 'Schedule event' }).click();
  await expect(page.getByRole('heading', { level: 1, name: eventName })).toBeVisible();
  await expect(page.getByTestId('error-banner')).toHaveCount(0);
  await expect(page.getByTestId('submit-error')).toHaveCount(0);

  const events = await admin.api.call<Event[]>('GET', `/events?q=${encodeURIComponent(eventName)}`);
  expect(events).toHaveLength(1);
  // Every seat on sale: the capacity is the layout's 30 seats, the price its lowest and highest.
  expect(events[0]).toMatchObject({
    layoutId: layout.id,
    reservedSeating: true,
    totalTicketCapacity: 30,
    basePrice: '60.00',
    priceMax: '80.00',
  });
  await admin.close();
});
