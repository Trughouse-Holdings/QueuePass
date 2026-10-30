// Spec 015 quickstart S2: live gray-out. Two customers side by side on one seated event; seats one
// reserves show as reserved on the other's open page within 2 seconds, without a reload (FR-006),
// and turn open again within 2 seconds when released.
import { expect, test, type Page } from '@playwright/test';
import { adminFor, customerFor } from '../fixtures/apps';
import { apiFor, seatedEvent } from '../fixtures/api';
import { PLACES, startsInHours, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';

/** SC-002: what "live" means. */
const LIVE_MS = 2_000;

/** Opens the event, chooses General and Section A, and returns Section A's seats. */
async function openSectionA(page: Page, eventId: string) {
  const tickets = page.getByRole('region', { name: 'Get tickets' });
  await tickets.getByRole('radio', { name: /^General, \$20\.00/ }).check();
  await tickets
    .getByRole('combobox', { name: 'Section', exact: true })
    .selectOption({ label: 'Section A' });
  const seats = tickets.getByRole('region', { name: 'Section A seats' });
  await expect(seats.getByRole('button', { name: 'Row 2, Seat 3', exact: true })).toBeEnabled();
  expect(page.url()).toContain(eventId);
  return { tickets, seats };
}

test('015 S2: live gray-out, seats one customer reserves turn unavailable for another within 2 seconds', async ({
  browser,
}, testInfo) => {
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const { event } = await seatedEvent(admin.api, {
    venueName: uniqueName(testInfo, 'hold hall'),
    place: PLACES.chicago,
    sections: [
      { name: 'A', rows: 3, seatsPerRow: 10 },
      { name: 'B', rows: 2, seatsPerRow: 10 },
    ],
    event: {
      name: uniqueName(testInfo, 'hold show'),
      startsAt: startsInHours(24 * 7),
      endsAt: startsInHours(24 * 7 + 3),
    },
    tiers: [
      { name: 'General', price: '20.00' },
      { name: 'VIP', price: '50.00' },
    ],
    map: [0, 0],
  });
  await admin.close();

  // Two customers in two browser contexts that share nothing, side by side.
  const one = await (await browser.newContext()).newPage();
  const two = await (await browser.newContext()).newPage();
  await signIn(one, 'customer', customerFor(testInfo, 2), `/events/${event.id}`);
  await signIn(two, 'customer', customerFor(testInfo, 3), `/events/${event.id}`);
  const first = await openSectionA(one, event.id);
  const second = await openSectionA(two, event.id);

  await first.seats.getByRole('button', { name: 'Row 2, Seat 3', exact: true }).click();
  await first.seats.getByRole('button', { name: 'Row 2, Seat 4', exact: true }).click();
  await first.tickets.getByLabel('Name on tickets').fill('Jordan Lee');
  await first.tickets.getByRole('button', { name: 'Reserve seats' }).click();

  // Customer 2's page, never reloaded: within 2 seconds of the press, both seats are Reserved and
  // can't be chosen.
  for (const seat of [3, 4]) {
    const there = second.seats.getByRole('button', {
      name: new RegExp(`^Row 2, Seat ${seat}(,|$)`),
    });
    await expect(there).toHaveAccessibleName(`Row 2, Seat ${seat}, reserved`, { timeout: LIVE_MS });
    await expect(there).toBeDisabled();
  }

  await expect(first.tickets.getByRole('heading', { name: 'Reserved for you' })).toBeVisible();

  // Customer 1 releases them: they turn open again for Customer 2, as live.
  await first.tickets.getByRole('button', { name: 'Release seats' }).click();
  for (const seat of [3, 4]) {
    const there = second.seats.getByRole('button', {
      name: new RegExp(`^Row 2, Seat ${seat}(,|$)`),
    });
    await expect(there).toHaveAccessibleName(`Row 2, Seat ${seat}`, { timeout: LIVE_MS });
    await expect(there).toBeEnabled();
  }

  await one.context().close();
  await two.context().close();
});
