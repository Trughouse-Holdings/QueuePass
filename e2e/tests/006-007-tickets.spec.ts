// Spec 006 quickstart P1 and P4 (get tickets in a tier; My tickets) and spec 007 quickstart S3
// (choose seats). Each event is set up through the API by an admin; the purchase is walked in the
// Customer app.
import { expect, test } from '@playwright/test';
import { adminFor, customerFor } from '../fixtures/apps';
import {
  addTier,
  apiFor,
  buyTickets,
  createEvent,
  createVenue,
  seatedEvent,
} from '../fixtures/api';
import { PLACES, startsInHours, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';

const CODE = /^[A-Z2-9]{12}/;

test('006 P1/P4: a customer gets 2 tickets in a tier and sees them in My tickets', async ({
  browser,
  page,
}, testInfo) => {
  const eventName = uniqueName(testInfo, 'tier show');
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const venue = await createVenue(admin.api, PLACES.chicago, uniqueName(testInfo, 'venue'));
  const event = await createEvent(admin.api, venue, {
    name: eventName,
    startsAt: startsInHours(24 * 7),
    endsAt: startsInHours(24 * 7 + 3),
    capacity: 100,
    basePrice: '30.00',
  });
  await addTier(admin.api, event, { name: 'Balcony', price: '30.00', quantity: 40 });
  // An earlier order of this customer's (set-up), so My tickets has two to put in order.
  const earlierName = uniqueName(testInfo, 'earlier show');
  const earlier = await createEvent(admin.api, venue, {
    name: earlierName,
    startsAt: startsInHours(24 * 9),
    endsAt: startsInHours(24 * 9 + 3),
    capacity: 10,
  });
  const customer = await apiFor(browser, 'customer', customerFor(testInfo, 0));
  await buyTickets(customer.api, earlier, { quantity: 1, holderName: 'Jordan Lee' });
  await customer.close();

  await signIn(page, 'customer', customerFor(testInfo, 0), `/events/${event.id}`);
  await expect(page.getByRole('heading', { level: 1, name: eventName })).toBeVisible();
  // P1: each tier with its price and tickets left; the total is twice the price.
  const tickets = page.getByRole('region', { name: 'Get tickets' });
  await tickets.getByRole('radio', { name: 'Balcony, $30.00, 40 left' }).check();
  await tickets.getByLabel('Quantity').selectOption('2');
  await expect(tickets.getByText('Total: $60.00')).toBeVisible();
  await tickets.getByLabel('Name on tickets').fill('Jordan Lee');
  await tickets.getByRole('button', { name: 'Confirm order' }).click();

  const confirmed = page.getByRole('region', { name: 'Order confirmed' });
  await expect(confirmed.getByRole('heading', { name: 'Order confirmed' })).toBeVisible();
  await expect(confirmed).toContainText(eventName);
  await expect(confirmed).toContainText('Balcony');
  await expect(confirmed).toContainText('$60.00');
  const codes = await confirmed
    .getByRole('list', { name: 'Ticket codes' })
    .getByRole('listitem')
    .allTextContents();
  expect(codes).toHaveLength(2);
  for (const c of codes) expect(c).toMatch(CODE);
  expect(new Set(codes).size).toBe(2);

  // P4: My tickets lists the orders newest first, this one with its codes.
  await page.getByRole('link', { name: 'My tickets', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My tickets' })).toBeVisible();
  // This customer may hold orders from earlier runs in the same stack (--repeat-each): only
  // these two are compared.
  const mine = page.getByRole('article').getByRole('heading', { level: 2 });
  await expect(mine.filter({ hasText: earlierName })).toHaveCount(1);
  const shown = await mine.allTextContents();
  expect(shown.indexOf(eventName)).toBeLessThan(shown.indexOf(earlierName));
  expect(shown.indexOf(eventName)).toBeGreaterThanOrEqual(0);
  const order = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: eventName }) });
  await expect(order).toContainText('Balcony');
  for (const c of codes)
    await expect(order.getByRole('list', { name: 'Tickets' })).toContainText(`${c}: Valid`);

  // P4: the admin cancels the event; on reload the order is Refunded, the event Cancelled, and
  // its tickets Void.
  await admin.api.call('POST', `/events/${event.id}/cancel`);
  await admin.close();
  await page.reload();
  await expect(order.getByText('This event has been cancelled.')).toBeVisible();
  await expect(order.getByRole('definition').filter({ hasText: /^Refunded$/ })).toHaveCount(1);
  for (const c of codes)
    await expect(order.getByRole('list', { name: 'Tickets' })).toContainText(`${c}: Void`);
});

test('007 S3: a customer chooses seats and gets them', async ({ browser, page }, testInfo) => {
  const eventName = uniqueName(testInfo, 'seated show');
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const { event } = await seatedEvent(admin.api, {
    venueName: uniqueName(testInfo, 'seat hall'),
    place: PLACES.louisville,
    sections: [
      { name: 'A', rows: 3, seatsPerRow: 10 },
      { name: 'B', rows: 2, seatsPerRow: 20 },
    ],
    event: { name: eventName, startsAt: startsInHours(24 * 7), endsAt: startsInHours(24 * 7 + 3) },
    tiers: [
      { name: 'VIP', price: '120.00' },
      { name: 'General', price: '40.00' },
    ],
    map: [0, 1],
  });
  await admin.close();

  await signIn(page, 'customer', customerFor(testInfo, 1), `/events/${event.id}`);
  const tickets = page.getByRole('region', { name: 'Get tickets' });
  await tickets.getByRole('radio', { name: /^VIP, \$120\.00/ }).check();
  await tickets
    .getByRole('combobox', { name: 'Section', exact: true })
    .selectOption({ label: 'Section A' });
  const seats = tickets.getByRole('region', { name: 'Section A seats' });
  await seats.getByRole('button', { name: 'Row 1, Seat 5', exact: true }).click();
  await seats.getByRole('button', { name: 'Row 1, Seat 6', exact: true }).click();
  await expect(tickets.getByText('Total: $240.00')).toBeVisible();
  await tickets.getByLabel('Name on tickets').fill('Jordan Lee');
  // Spec 015: picked seats are reserved first, then bought.
  await tickets.getByRole('button', { name: 'Reserve seats' }).click();
  await tickets.getByRole('button', { name: 'Confirm purchase' }).click();

  const confirmed = page.getByRole('region', { name: 'Order confirmed' });
  const codes = confirmed.getByRole('list', { name: 'Ticket codes' });
  await expect(codes).toContainText('Section A, Row 1, Seat 5');
  await expect(codes).toContainText('Section A, Row 1, Seat 6');
  await expect(confirmed).toContainText('$240.00');

  await page.getByRole('link', { name: 'My tickets', exact: true }).click();
  const order = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: eventName }) });
  await expect(order.getByRole('list', { name: 'Tickets' })).toContainText(
    'Section A, Row 1, Seat 5',
  );
  await expect(order.getByRole('list', { name: 'Tickets' })).toContainText(
    'Section A, Row 1, Seat 6',
  );
});
