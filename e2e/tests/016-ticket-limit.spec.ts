// Spec 016 quickstart S2: buy up to the per-customer limit; at the limit, more tickets are refused,
// with the reason. The limit is set through the API by an admin (S1 is the Admin form).
import { expect, test, type Page } from '@playwright/test';
import { adminFor, customerFor } from '../fixtures/apps';
import { addTier, apiFor, createEvent, createVenue, setTicketLimit } from '../fixtures/api';
import { PLACES, startsInHours, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';

/** Gets `n` tickets on the open event page, then returns to the event through My tickets. */
async function getTickets(page: Page, eventName: string, n: number): Promise<void> {
  const tickets = page.getByRole('region', { name: 'Get tickets' });
  await tickets.getByLabel('Quantity').selectOption(String(n));
  await tickets.getByLabel('Name on tickets').fill('Jordan Lee');
  await tickets.getByRole('button', { name: 'Confirm order' }).click();
  await expect(page.getByRole('heading', { name: 'Order confirmed' })).toBeVisible();
  await page.getByRole('link', { name: 'My tickets', exact: true }).click();
  await page.getByRole('link', { name: eventName }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: eventName })).toBeVisible();
}

test('016 S2: buy up to the per-customer limit; more is refused with the reason', async ({
  browser,
  page,
}, testInfo) => {
  const eventName = uniqueName(testInfo, 'limit show');
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const venue = await createVenue(admin.api, PLACES.losAngeles, uniqueName(testInfo, 'venue'));
  const event = await createEvent(admin.api, venue, {
    name: eventName,
    startsAt: startsInHours(24 * 7),
    endsAt: startsInHours(24 * 7 + 3),
    capacity: 100,
  });
  await addTier(admin.api, event, { name: 'General', price: '25.00', quantity: 100 });
  await setTicketLimit(admin.api, event, 3);
  await admin.close();

  await signIn(page, 'customer', customerFor(testInfo, 4), `/events/${event.id}`);
  const tickets = page.getByRole('region', { name: 'Get tickets' });
  await tickets.getByRole('radio', { name: /^General, \$25\.00/ }).check();
  await expect(
    tickets.getByText('Limit: 3 tickets per customer. You can get 3 more.'),
  ).toBeVisible();
  await expect(tickets.getByLabel('Quantity').getByRole('option')).toHaveText(['1', '2', '3']);
  await getTickets(page, eventName, 2);

  await tickets.getByRole('radio', { name: /^General, \$25\.00/ }).check();
  await expect(
    tickets.getByText('Limit: 3 tickets per customer. You can get 1 more.'),
  ).toBeVisible();
  await expect(tickets.getByLabel('Quantity').getByRole('option')).toHaveText(['1']);
  await getTickets(page, eventName, 1);

  // At the limit: the reason, and no way to confirm.
  await expect(
    tickets.getByText('You have reached the limit of 3 tickets for this event.'),
  ).toBeVisible();
  await expect(tickets.getByRole('button', { name: /^Confirm/ })).toHaveCount(0);
});
