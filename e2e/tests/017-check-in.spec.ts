// Spec 017 quickstart S3: a gate agent types a ticket's code, checks the ID, refuses, then admits
// it once; a third look-up shows it already used. The event starts in an hour, so its entry
// window (from 2 hours before the start) is open; the ticket is bought through the API.
import { expect, test } from '@playwright/test';
import { adminFor, agentFor, customerFor } from '../fixtures/apps';
import { addTier, apiFor, buyTickets, createEvent, createVenue } from '../fixtures/api';
import { PLACES, startsInHours, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';

test('017 S3: a gate agent types a code and admits it once; again, it is already used', async ({
  browser,
  page,
}, testInfo) => {
  const eventName = uniqueName(testInfo, 'gate show');
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const venue = await createVenue(admin.api, PLACES.chicago, uniqueName(testInfo, 'venue'));
  const event = await createEvent(admin.api, venue, {
    name: eventName,
    startsAt: startsInHours(1),
    endsAt: startsInHours(4),
    capacity: 50,
  });
  const tier = await addTier(admin.api, event, { name: 'Floor', price: '35.00', quantity: 50 });
  await admin.close();

  // The customer gets 1 ticket (set-up), then reads its code on My tickets, as a holder would.
  const customer = await apiFor(browser, 'customer', customerFor(testInfo, 5));
  await buyTickets(customer.api, event, { quantity: 1, tierId: tier.id, holderName: 'Jordan Lee' });
  await customer.page.getByRole('link', { name: 'My tickets', exact: true }).click();
  const order = customer.page
    .getByRole('article')
    .filter({ has: customer.page.getByRole('heading', { name: eventName }) });
  await expect(order).toContainText('Name on tickets');
  const line = await order
    .getByRole('list', { name: 'Tickets' })
    .getByRole('listitem')
    .first()
    .textContent();
  const code = /^([A-Z2-9]{12}):/.exec(line ?? '')?.[1];
  expect(code, `a ticket code in "${line}"`).toBeTruthy();
  await customer.close();

  // The gate agent chooses the event they are working.
  await signIn(page, 'booth', agentFor(testInfo, 0));
  await page.getByRole('button', { name: new RegExp(`^${eventName} · `) }).click();
  const field = page.getByLabel('Ticket code');
  const result = page.getByRole('status');
  // Typed as people type it: lower case, with a dash in the middle.
  const typed = `${code!.slice(0, 6)}-${code!.slice(6)}`.toLowerCase();

  await field.fill(typed);
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await expect(result).toContainText(eventName);
  await expect(result).toContainText('Floor');
  await expect(result).toContainText('Check a government-issued photo ID that shows: Jordan Lee');
  await expect(result.getByRole('button', { name: 'Admit', exact: true })).toBeVisible();
  await result.getByRole('button', { name: 'Refuse' }).click();
  await expect(result).toContainText('✕ Not admitted');

  await field.fill(typed);
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await result.getByRole('button', { name: 'Admit', exact: true }).click();
  await expect(result).toContainText('✓ Admitted');

  await field.fill(typed);
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await expect(result).toContainText('✕ Already used at ');
  await expect(result.getByRole('button', { name: 'Admit', exact: true })).toHaveCount(0);
});
