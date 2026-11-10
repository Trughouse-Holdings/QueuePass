// Spec 034 quickstart S1 and S2 (research R11): a customer buys a ticket for an event that has
// already started, and is told so on the Get tickets panel and the confirmation; a gate agent
// then looks the ticket up and admits it, through the API. The event is set up through the API by
// an admin, at a venue of its own in Eastern time, started 10 minutes ago and ending in 2 hours.
import { expect, test } from '@playwright/test';
import { adminFor, agentFor, customerFor } from '../fixtures/apps';
import { apiFor, createEvent, createVenue } from '../fixtures/api';
import { PLACES, startsInHours, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';

test('034 S1/S2: a customer buys a ticket for an event that has already started and sees the notice on the panel and the confirmation', async ({
  browser,
  page,
}, testInfo) => {
  const eventName = uniqueName(testInfo, 'late show');
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const venue = await createVenue(admin.api, PLACES.louisville, uniqueName(testInfo, 'venue'));
  const event = await createEvent(admin.api, venue, {
    name: eventName,
    startsAt: startsInHours(-10 / 60),
    endsAt: startsInHours(2),
    basePrice: '25.00',
  });
  await admin.close();

  // S1: the notice at the top of the panel, then the purchase, as before the start.
  await signIn(page, 'customer', customerFor(testInfo, 11), `/events/${event.id}`);
  await expect(page.getByRole('heading', { level: 1, name: eventName })).toBeVisible();
  const tickets = page.getByRole('region', { name: 'Get tickets' });
  await expect(tickets).toContainText('This event has already started (began at');
  await expect(tickets).toContainText('You can still buy tickets until it ends at');
  await tickets.getByRole('textbox', { name: 'Name on tickets' }).fill('Jordan Lee');
  await tickets.getByRole('button', { name: 'Confirm order' }).click();

  // S2: the confirmation says how long the ticket admits.
  const confirmed = page.getByRole('region', { name: 'Order confirmed' });
  await expect(confirmed.getByRole('heading', { name: 'Order confirmed' })).toBeVisible();
  await expect(confirmed).toContainText('Your tickets admit you until it ends at');
  const line = await confirmed
    .getByRole('list', { name: 'Ticket codes' })
    .getByRole('listitem')
    .first()
    .textContent();
  const code = /^([A-Z2-9]{12})/.exec(line ?? '')?.[1];
  expect(code, `a ticket code in "${line}"`).toBeTruthy();

  // S2: at the gate, through the API: the ticket bought after the start is admitted.
  const agent = await apiFor(browser, 'booth', agentFor(testInfo, 4));
  const found = await agent.api.call<{ ticketId: string; state: string }>(
    'POST',
    `/events/${event.id}/entry/lookup`,
    { code },
  );
  expect(found.state).toBe('ADMITTABLE');
  const admitted = await agent.api.call<{ admitted: { ticketId: string }[] }>(
    'POST',
    `/events/${event.id}/entry/admit`,
    { ticketId: found.ticketId, wholeOrder: false },
  );
  expect(admitted.admitted.map((t) => t.ticketId)).toEqual([found.ticketId]);
  await agent.close();
});
