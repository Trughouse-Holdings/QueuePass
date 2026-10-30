// Spec 019 quickstart S2: a customer adds an event to their calendar through the calendar file.
// The downloaded file holds the event's name, start and end in UTC, and its venue and address.
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { adminFor, customerFor } from '../fixtures/apps';
import { addTier, apiFor, buyTickets, createEvent, createVenue } from '../fixtures/api';
import { PLACES, uniqueName } from '../fixtures/data';
import { atLocal, icsUtc, localDate } from '../fixtures/time';

const ZONE = 'America/New_York'; // Louisville, KY: Eastern.

/** iCalendar text escaping (RFC 5545 3.3.11), as the file must have it. */
const escape = (s: string): string => s.replace(/([\\;,])/g, '\\$1');

test('019 S2: a customer downloads the calendar file, with the event, its times, and its venue', async ({
  browser,
}, testInfo) => {
  // S2's name, with the characters a calendar file must escape.
  const eventName = uniqueName(testInfo, 'Rock, Paper; Scissors \\ Live');
  const venueName = uniqueName(testInfo, 'venue');
  const day = localDate(ZONE, 1);
  const startsAt = atLocal(`${day}T19:30`, ZONE);
  const endsAt = atLocal(`${day}T22:45`, ZONE);

  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const venue = await createVenue(admin.api, PLACES.louisville, venueName);
  const event = await createEvent(admin.api, venue, {
    name: eventName,
    startsAt,
    endsAt,
    capacity: 20,
  });
  const tier = await addTier(admin.api, event, { name: 'General', price: '15.00', quantity: 20 });
  await admin.close();

  const customer = await apiFor(browser, 'customer', customerFor(testInfo, 6));
  await buyTickets(customer.api, event, { quantity: 1, tierId: tier.id, holderName: 'Jordan Lee' });
  const page = customer.page;
  await page.getByRole('link', { name: 'My tickets', exact: true }).click();
  const order = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: eventName }) });
  await expect(order.getByRole('group', { name: 'Add to calendar' })).toBeVisible();

  const download = page.waitForEvent('download');
  await order.getByRole('button', { name: /^Add to Apple Calendar or Outlook/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.ics$/);
  const raw = await readFile((await file.path())!, 'utf8');
  // Every line ends CRLF; long lines are folded with CRLF and one space (RFC 5545 3.1).
  expect(raw).not.toMatch(/[^\r]\n/);
  const lines = raw.replace(/\r\n /g, '').split('\r\n');

  expect(lines).toContain(`SUMMARY:${escape(eventName)}`);
  expect(lines).toContain(`DTSTART:${icsUtc(startsAt)}`);
  expect(lines).toContain(`DTEND:${icsUtc(endsAt)}`);
  expect(lines).toContain(`LOCATION:${escape(venueName)}\\, ${escape(venue.address)}`);
  expect(venue.address).toBe('1 ARENA PLZ, LOUISVILLE, KY 40202');
  await customer.close();
});
