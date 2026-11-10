// Spec 029 quickstart S2 (research R13, tasks T014): the demo state a presenter relies on, right
// after the harness loaded it with the reset (scripts/e2e.mjs). Read only: it admits nothing and
// changes no row, so it runs beside the other tests.
import { expect, test } from '@playwright/test';
import { APPS, agentFor, customerFor } from '../fixtures/apps';
import { apiAs, type Event } from '../fixtures/api';
import { signIn } from '../fixtures/sign-in';

test('029 S2: after the reset, the Ticket Booth offers Demo Tonight open and the Customer app shows Season Opener with sales closed', async ({
  page,
  browser,
}, testInfo) => {
  // The Ticket Booth: Demo Tonight is listed and can be chosen; Season Opener, over, is not.
  await signIn(page, 'booth', agentFor(testInfo, 2));
  const tonight = page.getByRole('button', { name: /^Demo Tonight · / });
  await expect(tonight).toBeVisible();
  await expect(tonight).toBeEnabled();
  await expect(page.getByText('Season Opener')).toHaveCount(0);

  // The Customer app: Season Opener's page says sales are closed; Fall Concert's offers tickets.
  const context = await browser.newContext();
  const customer = await context.newPage();
  const api = await apiAs(customer, () => signIn(customer, 'customer', customerFor(testInfo, 5)));
  // Spec 030 research R10: Season Opener is over, so the list leaves it out unless asked.
  const events = await api.call<Event[]>('GET', '/events?includePast=true');
  await api.dispose();
  const id = (name: string) => {
    const e = events.find((x) => x.name === name);
    expect(e, `${name} is in the demo state`).toBeDefined();
    return (e as Event).id;
  };

  await customer.goto(`${APPS.customer.url}/events/${id('Season Opener')}`);
  await expect(customer.getByRole('heading', { level: 1, name: 'Season Opener' })).toBeVisible();
  await expect(customer.getByText('Sales closed', { exact: true })).toBeVisible();
  // Spec 030 FR-014: Season Opener is over, and its page says so.
  await expect(customer.getByText('This event has ended.', { exact: true })).toBeVisible();
  // Spec 034 FR-011 (research R8): sales closed when it ended.
  await expect(
    customer.getByText('Sales closed: this event has ended.', { exact: true }),
  ).toBeVisible();

  await customer.goto(`${APPS.customer.url}/events/${id('Fall Concert')}`);
  await expect(customer.getByRole('heading', { level: 1, name: 'Fall Concert' })).toBeVisible();
  await expect(customer.getByRole('heading', { name: 'Get tickets' })).toBeVisible();
  await expect(customer.getByText(/^Sales closed/)).toHaveCount(0);
  await context.close();
});
