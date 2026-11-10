// Spec 030 quickstart S1, S2, S4, S6 (research R11, tasks T007): an event that has ended is left
// out of the Customer app's lists and, until Show past events is on, the Admin app's; its own
// pages still open. Each test makes its own venue and three events through the API: ended (5 to 2
// hours ago), in progress (30 minutes ago to 2 hours from now, 90 minutes after the ended one's
// end, so the 60-minute rule holds), and ahead (7 days from now, 7:00 to 10:00 PM venue-local).
// Read only beyond its own rows.
import { expect, test, type Browser, type TestInfo } from '@playwright/test';
import { adminFor, customerFor } from '../fixtures/apps';
import { apiFor, createEvent, createVenue, type Event, type Location } from '../fixtures/api';
import { PLACES, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';
import { atLocal, localDate } from '../fixtures/time';

const ZONE = 'America/New_York'; // Louisville, KY: Eastern.
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

interface Setup {
  base: string;
  venue: Location;
  ended: Event;
  inProgress: Event;
  ahead: Event;
}

async function setUp(browser: Browser, testInfo: TestInfo): Promise<Setup> {
  const base = uniqueName(testInfo, 'past');
  const now = Date.now();
  const nextWeek = localDate(ZONE, 7);
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const venue = await createVenue(admin.api, PLACES.louisville, `${base} Hall`);
  const ended = await createEvent(admin.api, venue, {
    name: `${base} Ended Show`,
    startsAt: new Date(now - 5 * HOUR),
    endsAt: new Date(now - 2 * HOUR),
  });
  const inProgress = await createEvent(admin.api, venue, {
    name: `${base} Now Playing`,
    startsAt: new Date(now - 30 * MINUTE),
    endsAt: new Date(now + 2 * HOUR),
  });
  const ahead = await createEvent(admin.api, venue, {
    name: `${base} Coming Soon`,
    startsAt: atLocal(`${nextWeek}T19:00`, ZONE),
    endsAt: atLocal(`${nextWeek}T22:00`, ZONE),
  });
  await admin.close();
  return { base, venue, ended, inProgress, ahead };
}

test('030 S1/S2: the Customer app leaves an ended event out of the list, a search, and its venue page, and its own page says it has ended', async ({
  browser,
}, testInfo) => {
  const { base, venue, ended, inProgress, ahead } = await setUp(browser, testInfo);
  const page = await (await browser.newContext()).newPage();
  await signIn(page, 'customer', customerFor(testInfo, 10));
  const titles = (label: string) =>
    page.getByRole('list', { name: label }).getByRole('heading', { level: 2 });

  await test.step('the Events page and a search show the other two, not the ended one', async () => {
    await expect(page.getByRole('heading', { level: 1, name: 'Events' })).toBeVisible();
    await page.getByLabel('Search events').fill(base);
    await expect(titles('Events')).toHaveText([inProgress.name, ahead.name]);
    await page.getByLabel('Search events').fill(ended.name);
    await expect(page.getByText('No events match your filters.')).toBeVisible();
    await expect(page.getByRole('heading', { name: ended.name })).toHaveCount(0);
  });

  await test.step("the venue's page shows the other two", async () => {
    await page.goto(`${new URL(page.url()).origin}/venues/${venue.id}`);
    await expect(page.getByRole('heading', { level: 1, name: venue.name })).toBeVisible();
    await expect(titles(`Events at ${venue.name}`)).toHaveText([inProgress.name, ahead.name]);
  });

  await test.step("the ended event's own page opens and says it has ended", async () => {
    await page.goto(`${new URL(page.url()).origin}/events/${ended.id}`);
    await expect(page.getByRole('heading', { level: 1, name: ended.name })).toBeVisible();
    await expect(page.getByText('This event has ended.')).toBeVisible();
    await page.goto(`${new URL(page.url()).origin}/events/${inProgress.id}`);
    await expect(page.getByRole('heading', { level: 1, name: inProgress.name })).toBeVisible();
    await expect(page.getByText('This event has ended.')).toHaveCount(0);
  });
  await page.context().close();
});

test('030 S4/S6: the Admin app hides an ended event until Show past events is on, marks it Ended, and its page, attendees, and Reports row open', async ({
  browser,
}, testInfo) => {
  const { venue, ended, inProgress, ahead } = await setUp(browser, testInfo);
  const page = await (await browser.newContext()).newPage();
  await signIn(page, 'admin', adminFor(testInfo));
  const row = (name: string) =>
    page.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) });

  await test.step('the Events page, searched by venue, leaves the ended event out', async () => {
    await page.getByRole('link', { name: 'Events', exact: true }).click();
    await expect(page.getByText(/past events hidden/)).toBeVisible();
    // The filter's label wraps its select, so its name starts with "Venue" and goes on with the
    // options' text; matched by its start, not exactly.
    await page.getByRole('combobox', { name: /^Venue/ }).selectOption({ label: venue.name });
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(row(inProgress.name)).toBeVisible();
    await expect(row(ahead.name)).toBeVisible();
    await expect(row(ended.name)).toHaveCount(0);
  });

  await test.step('Show past events lists it, marked Ended, and stays on after a reload', async () => {
    await page.getByRole('checkbox', { name: 'Show past events' }).check();
    await expect(row(ended.name)).toBeVisible();
    await expect(row(ended.name).getByText('Ended', { exact: true })).toBeVisible();
    await expect(row(inProgress.name).getByText('Ended', { exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(/[?&]past=1(&|$)/);
    await page.reload();
    await expect(page.getByRole('checkbox', { name: 'Show past events' })).toBeChecked();
    await expect(row(ended.name).getByText('Ended', { exact: true })).toBeVisible();
  });

  await test.step('its page shows Ended, and its Attendees page opens', async () => {
    await row(ended.name).getByRole('link', { name: ended.name, exact: true }).click();
    const heading = page.getByRole('heading', { level: 1, name: new RegExp(`^${ended.name}`) });
    await expect(heading).toBeVisible();
    await expect(heading.getByText('Ended', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Attendees', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: `Attendees: ${ended.name}` }),
    ).toBeVisible();
  });

  await test.step('Reports lists it, and its name opens its page', async () => {
    await page.getByRole('link', { name: 'Reports', exact: true }).click();
    await page.getByRole('link', { name: ended.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/events/${ended.id}$`));
    await expect(
      page.getByRole('heading', { level: 1, name: new RegExp(`^${ended.name}`) }),
    ).toBeVisible();
  });
  await page.context().close();
});
