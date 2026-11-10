// Spec 031 quickstart S3 (FR-003, FR-006, FR-009, FR-010, FR-015; research R11): a refused ticket
// type on Schedule event saves nothing, shows beside the ticket type, and keeps the form filled;
// fixed and scheduled again, the event is created once with both types.
import { expect, test } from '@playwright/test';
import { adminFor } from '../fixtures/apps';
import { apiFor, createVenue, type Event, type TicketTier } from '../fixtures/api';
import { PLACES, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';
import { localDate } from '../fixtures/time';
import { expectEventDateTime, fillEventDateTime } from '../fixtures/event-times';

const EASTERN = 'America/New_York';

test('031 S3: a refused ticket type on Schedule shows its error beside it, keeps the form filled, and creates no event', async ({
  page,
  browser,
}, testInfo) => {
  const venueName = uniqueName(testInfo, 'atomic hall');
  const eventName = uniqueName(testInfo, 'atomic show');
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  await createVenue(admin.api, PLACES.louisville, venueName);
  const found = () => admin.api.call<Event[]>('GET', `/events?q=${encodeURIComponent(eventName)}`);

  const day = localDate(EASTERN, 5);
  await signIn(page, 'admin', adminFor(testInfo));
  await page.getByRole('link', { name: 'Events', exact: true }).click();
  await page.getByRole('link', { name: 'Schedule event' }).first().click();
  await page.getByLabel('Event name', { exact: true }).fill(eventName);
  await page
    .getByLabel('Venue', { exact: true })
    .selectOption({ label: `${venueName} (500 seats)` });
  await fillEventDateTime(page, 'Starts', `${day}T19:00`);
  await fillEventDateTime(page, 'Ends', `${day}T22:00`);
  await page.getByLabel('Ticket type 1 name', { exact: true }).fill('Floor');
  await page.getByLabel('Ticket type 1 price', { exact: true }).fill('80.00');
  await page.getByLabel('Ticket type 1 quantity', { exact: true }).fill('300');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  const name2 = page.getByLabel('Ticket type 2 name', { exact: true });
  await name2.fill('floor');
  await page.getByLabel('Ticket type 2 price', { exact: true }).fill('60.00');
  await page.getByLabel('Ticket type 2 quantity', { exact: true }).fill('200');
  await page.getByRole('button', { name: 'Schedule event' }).click();

  // The message beside ticket type 2. Spec 035: no top error-banner for a field-mapped problem.
  const message =
    "Ticket type 2, 'floor', has the same name as ticket type 1, 'Floor'. Give each ticket type " +
    'its own name.';
  await expect(page.getByTestId('error-banner')).toHaveCount(0);
  await expect(page.getByTestId('type-2-error')).toContainText(message);
  await expect(name2).toHaveAttribute('aria-invalid', 'true');
  await expect(name2).toHaveAccessibleDescription(message);

  // Every value still there; nothing saved.
  await expect(page.getByLabel('Event name', { exact: true })).toHaveValue(eventName);
  await expectEventDateTime(page, 'Starts', `${day}T19:00`);
  await expectEventDateTime(page, 'Ends', `${day}T22:00`);
  await expect(page.getByLabel('Ticket type 1 name', { exact: true })).toHaveValue('Floor');
  await expect(page.getByLabel('Ticket type 1 quantity', { exact: true })).toHaveValue('300');
  await expect(name2).toHaveValue('floor');
  await expect(page.getByLabel('Ticket type 2 quantity', { exact: true })).toHaveValue('200');
  expect(await found()).toHaveLength(0);

  // Renamed: scheduled once, with both types, and no conflict with itself.
  await name2.fill('Balcony');
  await page.getByRole('button', { name: 'Schedule event' }).click();
  await expect(page.getByRole('heading', { level: 1, name: eventName })).toBeVisible();
  const events = await found();
  expect(events).toHaveLength(1);
  const tiers = await admin.api.call<TicketTier[]>('GET', `/events/${events[0].id}/tiers`);
  expect(tiers.map((t) => [t.name, t.quantity]).sort()).toEqual([
    ['Balcony', 200],
    ['Floor', 300],
  ]);
  await admin.close();
});
