// Spec 025 quickstart S1, S2, S4, S5, S6 (research R10): an admin sets when doors open, the form
// fills it in and checks it before sending, customers see it; the Ticket Booth works an event only
// from an hour before its doors open and lists the others greyed with when they open. Every
// expected time, abbreviation, and offset is built with fixtures/time.ts, so the tests pass in
// standard and daylight time.
import { expect, test, type Request } from '@playwright/test';
import { API_BASE, adminFor, agentFor, customerFor } from '../fixtures/apps';
import { addTier, apiFor, buyTickets, createEvent, createVenue } from '../fixtures/api';
import { PLACES, startsInHours, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';
import { atLocal, eventTime, localDate, localDateOf, timeOfDay, zoned } from '../fixtures/time';

const CHICAGO = 'America/Chicago';

test('025 S1/S2/S6: an admin sets when doors open, and customers see it', async ({
  page,
  browser,
}, testInfo) => {
  const venueName = uniqueName(testInfo, 'doors hall');
  const eventName = uniqueName(testInfo, 'doors show');
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const venue = await createVenue(admin.api, PLACES.chicago, venueName);
  expect(venue.timeZone).toBe(CHICAGO);
  await admin.close();

  const day = localDate(CHICAGO, 3);
  const at = (time: string) => atLocal(`${day}T${time}`, CHICAGO);
  const posted: Request[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url() === `${API_BASE}/events`) posted.push(req);
  });

  // S1: New event; Doors open, before Starts, follows the typed start 1 hour earlier.
  await signIn(page, 'admin', adminFor(testInfo));
  await page.getByRole('link', { name: 'Events', exact: true }).click();
  await page.getByRole('link', { name: 'Schedule event' }).first().click();
  await page.getByLabel('Event name', { exact: true }).fill(eventName);
  await page
    .getByLabel('Venue', { exact: true })
    .selectOption({ label: `${venueName} (500 seats)` });
  const doors = page.getByLabel('Doors open', { exact: true });
  await expect(doors).toHaveValue('');
  await page.getByLabel('Starts', { exact: true }).fill(`${day}T19:00`);
  await expect(doors).toHaveValue(`${day}T18:00`);
  await page.getByLabel('Ends', { exact: true }).fill(`${day}T22:00`);
  await page.getByLabel('Ticket type 1 name', { exact: true }).fill('General');
  await page.getByLabel('Ticket type 1 price', { exact: true }).fill('20');
  await page.getByLabel('Ticket type 1 quantity', { exact: true }).fill('50');

  // More than 6 hours before the start: named under the field and on Save, nothing sent.
  await doors.fill(`${day}T17:30`);
  await doors.fill(`${day}T12:30`);
  const range =
    'Doors must open no more than 6 hours before the start and not after it: between ' +
    `${eventTime(at('13:00'), CHICAGO)} and ${timeOfDay(at('19:00'), CHICAGO)}.`;
  await expect(page.getByText(range).first()).toBeVisible();
  await page.getByRole('button', { name: 'Schedule event' }).click();
  await expect(page.getByText(range)).toHaveCount(2);
  await expect(doors).toHaveValue(`${day}T12:30`);
  await page.waitForTimeout(1_000);
  expect(posted).toHaveLength(0);

  // Back to 5:30 PM: saved, and the event page says so.
  // The note under the field goes as soon as the value is in range; the banner of the refused
  // press stays until the next press, as for every refusal on this form (020's skipped time too).
  await doors.fill(`${day}T17:30`);
  await expect(page.getByTestId('doorsOpenAt-range')).toHaveCount(0);
  await expect(page.getByText(range)).toHaveCount(1);
  await page.getByRole('button', { name: 'Schedule event' }).click();
  await expect(page.getByRole('heading', { level: 1, name: eventName })).toBeVisible();
  expect(posted).toHaveLength(1);
  expect(posted[0].postDataJSON()).toMatchObject({
    doorsOpenAt: zoned(at('17:30'), CHICAGO),
  });
  const doorsTerm = page.getByRole('term').filter({ hasText: /^Doors open$/ });
  await expect(doorsTerm).toBeVisible();
  await expect(
    page.getByRole('definition').filter({ hasText: timeOfDay(at('17:30'), CHICAGO) }),
  ).toHaveCount(1);
  const eventPath = new URL(page.url()).pathname;

  // S2: edit the start to 8:00 PM; Doors open follows with its 90-minute gap.
  await page.getByRole('link', { name: 'Edit', exact: true }).click();
  await expect(doors).toHaveValue(`${day}T17:30`);
  await page.getByLabel('Starts', { exact: true }).fill(`${day}T20:00`);
  await expect(doors).toHaveValue(`${day}T18:30`);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL(new RegExp(`${eventPath}$`));
  const doorsAt = timeOfDay(at('18:30'), CHICAGO);
  await expect(page.getByRole('definition').filter({ hasText: doorsAt })).toHaveCount(1);

  // S6: a customer sees it on the event page and its card.
  const context = await browser.newContext();
  const customer = await context.newPage();
  await signIn(customer, 'customer', customerFor(testInfo, 3), eventPath);
  await expect(customer.getByRole('heading', { level: 1, name: eventName })).toBeVisible();
  await expect(customer.getByRole('term').filter({ hasText: /^Doors open$/ })).toBeVisible();
  await expect(customer.getByRole('definition').filter({ hasText: doorsAt })).toHaveCount(1);
  await customer.getByRole('link', { name: 'Events', exact: true }).click();
  await customer.getByLabel('Search events').fill(eventName);
  const card = customer
    .getByRole('article')
    .filter({ has: customer.getByRole('heading', { name: eventName }) });
  await expect(card).toContainText('Doors open');
  await expect(card).toContainText(doorsAt);
  await context.close();
});

test('025 S4/S5: the Ticket Booth works an event only from an hour before its doors open', async ({
  page,
  browser,
}, testInfo) => {
  const openName = uniqueName(testInfo, 'open show');
  const waitingName = uniqueName(testInfo, 'later show');
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const first = await createVenue(admin.api, PLACES.chicago, uniqueName(testInfo, 'first hall'));
  const second = await createVenue(admin.api, PLACES.chicago, uniqueName(testInfo, 'second hall'));
  // Doors left out: the start minus 1 hour, so check-in opened an hour ago.
  const open = await createEvent(admin.api, first, {
    name: openName,
    startsAt: startsInHours(1),
    endsAt: startsInHours(4),
    capacity: 50,
  });
  // Doors 1 hour before a start 5 hours away: check-in opens in 3 hours.
  const waiting = await createEvent(admin.api, second, {
    name: waitingName,
    startsAt: startsInHours(5),
    endsAt: startsInHours(8),
    doorsOpenAt: startsInHours(4),
  });
  const tier = await addTier(admin.api, open, { name: 'Floor', price: '35.00', quantity: 50 });
  await admin.close();
  expect(Date.parse(open.entryOpensAt)).toBeLessThan(Date.now());

  const buyer = await apiFor(browser, 'customer', customerFor(testInfo, 4));
  const order = await buyTickets(buyer.api, open, {
    quantity: 1,
    tierId: tier.id,
    holderName: 'Jordan Lee',
  });
  await buyer.close();
  const code = order.tickets[0].code;

  // "Opens …" by FR-015's rule: the time alone when that is today at the venue, else the date.
  const opens = new Date(Date.parse(waiting.doorsOpenAt) - 3_600_000);
  expect(opens.toISOString()).toBe(new Date(waiting.entryOpensAt).toISOString());
  const zone = second.timeZone;
  const when =
    localDateOf(opens, zone) === localDate(zone) ? timeOfDay(opens, zone) : eventTime(opens, zone);

  await signIn(page, 'booth', agentFor(testInfo, 1));
  const openButton = page.getByRole('button', { name: new RegExp(`^${openName} · `) });
  await expect(openButton).toBeVisible();
  const waitingItem = page.getByRole('listitem').filter({ hasText: waitingName });
  await expect(waitingItem).toContainText('Not open yet');
  await expect(waitingItem).toContainText(`Opens ${when}`);
  await expect(page.getByRole('button', { name: new RegExp(`^${waitingName}`) })).toHaveCount(0);

  await openButton.click();
  await page.getByLabel('Ticket code').fill(code);
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  const result = page.getByRole('status');
  await expect(result).toContainText(openName);
  await expect(result.getByRole('button', { name: 'Admit', exact: true })).toBeVisible();
});
