// Spec 003 quickstart C1 (with 002's Admin pages and 013's address check): an admin adds a venue
// and an event in the Admin app; a customer finds the event, with its venue and times.
import { expect, test } from '@playwright/test';
import { adminFor, customerFor } from '../fixtures/apps';
import { apiFor, createEvent, createVenue, type Location } from '../fixtures/api';
import { PLACES, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';
import { atLocal, eventTime, localDate } from '../fixtures/time';

const ZONE = 'America/New_York'; // Louisville, KY: Eastern.

test('003 C1: events appear soonest first, with their venues, times, and prices', async ({
  browser,
}, testInfo) => {
  // One search finds this test's three events: Early Show, Late Show, and Matinee.
  const base = uniqueName(testInfo, 'c1');
  const venueName = `${base} Alpha Arena`;
  const eventName = `${base} Early Show`;
  const day = localDate(ZONE, 1);
  const nextWeek = localDate(ZONE, 7);
  const dayAfterNextWeek = localDate(ZONE, 8);

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
    await admin.getByLabel('Time zone', { exact: true }).selectOption({ label: 'Eastern Time' });
    await admin.getByRole('button', { name: 'Create venue' }).click();
    // Spec 013: saved in the address service's standard form; spec 024: the zone the admin chose.
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

  // C1 step 1's other venue and event, and step 3's Matinee, are set up through the API.
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const zeta = await createVenue(admin.api, PLACES.louisville, `${base} Zeta Hall`);
  await createEvent(admin.api, zeta, {
    name: `${base} Late Show`,
    startsAt: atLocal(`${nextWeek}T22:00`, ZONE),
    endsAt: atLocal(`${dayAfterNextWeek}T02:00`, ZONE),
    basePrice: '1200',
  });
  const alpha = (await admin.api.call<Location[]>('GET', '/locations')).find(
    (v) => v.name === venueName,
  )!;

  const page = await (await browser.newContext()).newPage();
  await signIn(page, 'customer', customerFor(testInfo, 8));
  const titles = () =>
    page.getByRole('list', { name: 'Events' }).getByRole('heading', { level: 2 });
  const card = (name: string) =>
    page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });

  await test.step('a customer finds them, soonest first, with venues, times, and prices', async () => {
    // The landing page is the event list (C1 step 2).
    await expect(page.getByRole('heading', { level: 1, name: 'Events' })).toBeVisible();
    await page.getByLabel('Search events').fill(base);
    await expect(titles()).toHaveText([eventName, `${base} Late Show`]);
    const early = card(eventName);
    await expect(early.getByRole('link', { name: venueName })).toBeVisible();
    await expect(early).toContainText(eventTime(atLocal(`${day}T18:00`, ZONE), ZONE));
    await expect(early).toContainText(eventTime(atLocal(`${day}T21:00`, ZONE), ZONE));
    await expect(early).toContainText('$45.50');
    const late = card(`${base} Late Show`);
    await expect(late.getByRole('link', { name: `${base} Zeta Hall` })).toBeVisible();
    await expect(late).toContainText(eventTime(atLocal(`${nextWeek}T22:00`, ZONE), ZONE));
    // The end is on the next day, and says so.
    await expect(late).toContainText(eventTime(atLocal(`${dayAfterNextWeek}T02:00`, ZONE), ZONE));
    await expect(late).toContainText('$1,200.00');
  });

  await test.step('a Matinee added tomorrow at noon appears at the top after a reload', async () => {
    await createEvent(admin.api, alpha, {
      name: `${base} Matinee`,
      startsAt: atLocal(`${day}T12:00`, ZONE),
      endsAt: atLocal(`${day}T14:00`, ZONE),
    });
    await page.reload();
    await expect(titles()).toHaveText([`${base} Matinee`, eventName, `${base} Late Show`]);
  });
  await admin.close();
  await page.context().close();
});
