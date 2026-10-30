// Spec 020 quickstart S6 and S7: event times show in the venue's zone whatever the browser's zone;
// a start time the venue's zone skips (the spring-forward night) is refused before anything is sent.
import { expect, test } from '@playwright/test';
import { API_BASE, adminFor, customerFor } from '../fixtures/apps';
import { addTier, apiFor, createEvent, createVenue } from '../fixtures/api';
import { PLACES, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';
import { atLocal, eventTime, localDate, timeOfDay } from '../fixtures/time';

const PHOENIX = 'America/Phoenix';

/** The next second Sunday of March (US spring forward), as `YYYY-MM-DD`. */
function nextSpringForward(): string {
  const now = new Date();
  for (let year = now.getUTCFullYear(); ; year++) {
    const march1 = new Date(Date.UTC(year, 2, 1)).getUTCDay();
    const day = 1 + ((7 - march1) % 7) + 7;
    const date = new Date(Date.UTC(year, 2, day, 12));
    if (date > now) return `${year}-03-${String(day).padStart(2, '0')}`;
  }
}

test('020 S6: a customer sees event times in the venue zone, whatever the browser zone', async ({
  browser,
}, testInfo) => {
  const eventName = uniqueName(testInfo, 'tz west');
  const day = localDate(PHOENIX, 7);
  const startsAt = atLocal(`${day}T19:00`, PHOENIX);
  const endsAt = atLocal(`${day}T22:00`, PHOENIX);
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const venue = await createVenue(admin.api, PLACES.phoenix, uniqueName(testInfo, 'phoenix hall'));
  expect(venue.timeZone).toBe(PHOENIX);
  const event = await createEvent(admin.api, venue, { name: eventName, startsAt, endsAt });
  await addTier(admin.api, event, { name: 'General', price: '20.00', quantity: 50 });
  await admin.close();

  const start = eventTime(startsAt, PHOENIX);
  expect(start).toMatch(/, 7:00 PM MST$/);
  for (const timezoneId of ['America/New_York', 'Asia/Tokyo']) {
    await test.step(`browser in ${timezoneId}`, async () => {
      const context = await browser.newContext({ timezoneId });
      const page = await context.newPage();
      await signIn(page, 'customer', customerFor(testInfo, 7), `/events/${event.id}`);
      await expect(page.getByRole('heading', { level: 1, name: eventName })).toBeVisible();
      await expect(page.getByRole('definition').filter({ hasText: start })).toHaveCount(1);
      await expect(page.getByText(eventTime(endsAt, PHOENIX), { exact: true })).toBeVisible();
      // The event list's card says the same.
      await page.getByRole('link', { name: 'Events', exact: true }).click();
      await page.getByLabel('Search events').fill(eventName);
      const card = page
        .getByRole('article')
        .filter({ has: page.getByRole('heading', { name: eventName }) });
      await expect(card).toContainText(start);
      expect(timeOfDay(startsAt, timezoneId)).not.toBe(timeOfDay(startsAt, PHOENIX));
      await context.close();
    });
  }
});

test('020 S7: a start time the venue zone skips is refused, and nothing is sent', async ({
  page,
  browser,
}, testInfo) => {
  const venueName = uniqueName(testInfo, 'eastern hall');
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const venue = await createVenue(admin.api, PLACES.louisville, venueName);
  expect(venue.timeZone).toBe('America/New_York');
  await admin.close();

  const night = nextSpringForward();
  const [y, m, d] = night.split('-').map(Number);
  const monthDay = `${['Jan', 'Feb', 'Mar'][m - 1]} ${d}, ${y}`;
  const message = `2:30 AM on ${monthDay} doesn't exist in Eastern Time: clocks jump from 2:00 AM to 3:00 AM. Choose another time.`;

  const posted: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().startsWith(`${API_BASE}/events`))
      posted.push(req.url());
  });
  await signIn(page, 'admin', adminFor(testInfo));
  await page.getByRole('link', { name: 'Events', exact: true }).click();
  await page.getByRole('link', { name: 'Schedule event' }).first().click();
  await page.getByLabel('Event name', { exact: true }).fill(uniqueName(testInfo, 'spring forward'));
  await page
    .getByLabel('Venue', { exact: true })
    .selectOption({ label: `${venueName} (500 seats)` });
  await page.getByLabel('Starts', { exact: true }).fill(`${night}T02:30`);
  await page.getByLabel('Ends', { exact: true }).fill(`${night}T04:00`);
  await page.getByLabel('Ticket type 1 name', { exact: true }).fill('General');
  await page.getByLabel('Ticket type 1 price', { exact: true }).fill('20');
  await page.getByLabel('Ticket type 1 quantity', { exact: true }).fill('50');
  // Said under the field as soon as it is typed, and again when Save is pressed.
  await expect(page.getByText(message).first()).toBeVisible();
  await page.getByRole('button', { name: 'Schedule event' }).click();
  await expect(page.getByText(message)).toHaveCount(2);
  // Every value kept; nothing sent.
  await expect(page.getByLabel('Starts', { exact: true })).toHaveValue(`${night}T02:30`);
  await expect(page.getByRole('heading', { level: 1, name: 'Schedule event' })).toBeVisible();
  expect(posted).toEqual([]);
});
