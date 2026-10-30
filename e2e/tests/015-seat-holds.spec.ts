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

  // Two customers in two browser contexts that share nothing, side by side, and the Admin seat map.
  const one = await (await browser.newContext()).newPage();
  const two = await (await browser.newContext()).newPage();
  const desk = await (await browser.newContext()).newPage();
  await signIn(one, 'customer', customerFor(testInfo, 2), `/events/${event.id}`);
  await signIn(two, 'customer', customerFor(testInfo, 3), `/events/${event.id}`);
  await signIn(desk, 'admin', adminFor(testInfo), `/events/${event.id}`);
  const first = await openSectionA(one, event.id);
  const second = await openSectionA(two, event.id);
  const seatMap = desk.getByRole('group', { name: 'Section A seat map' });
  await expect(desk.getByText('0 sold, 0 reserved, 30 open')).toBeVisible();

  /** Customer 2's seat and the Admin's, by row 2 and seat number, whatever their state. */
  const customerSeat = (seat: number) =>
    second.seats.getByRole('button', { name: new RegExp(`^Row 2, Seat ${seat}(,|$)`) });
  const adminSeat = (seat: number) =>
    seatMap.getByRole('img', { name: new RegExp(`^Row 2, Seat ${seat},`) });
  /** What is left of the 2 seconds since `since` (FR-006): every check shares one deadline. */
  const left = (since: number) => ({ timeout: Math.max(1, LIVE_MS - (Date.now() - since)) });

  await first.seats.getByRole('button', { name: 'Row 2, Seat 3', exact: true }).click();
  await first.seats.getByRole('button', { name: 'Row 2, Seat 4', exact: true }).click();
  await first.tickets.getByLabel('Name on tickets').fill('Jordan Lee');
  const reservedAt = Date.now();
  await first.tickets.getByRole('button', { name: 'Reserve seats' }).click();

  // Never reloaded: within 2 seconds of the press, Customer 2 sees both seats Reserved and can't
  // choose them, and the Admin sees them ◩ with section A's counts.
  await Promise.all([
    ...[3, 4].map((seat) =>
      expect(customerSeat(seat)).toHaveAccessibleName(
        `Row 2, Seat ${seat}, reserved`,
        left(reservedAt),
      ),
    ),
    ...[3, 4].map((seat) =>
      expect(adminSeat(seat)).toHaveAccessibleName(
        `Row 2, Seat ${seat}, reserved`,
        left(reservedAt),
      ),
    ),
    expect(desk.getByText('0 sold, 2 reserved, 28 open')).toBeVisible(left(reservedAt)),
  ]);
  for (const seat of [3, 4]) {
    await expect(customerSeat(seat)).toBeDisabled();
    await expect(adminSeat(seat)).toHaveText('◩');
  }
  await expect(first.tickets.getByRole('heading', { name: 'Reserved for you' })).toBeVisible();

  // Customer 1 releases them: within 2 seconds they are open again for Customer 2 and the Admin.
  const releasedAt = Date.now();
  await first.tickets.getByRole('button', { name: 'Release seats' }).click();
  await Promise.all([
    ...[3, 4].map((seat) =>
      expect(customerSeat(seat)).toHaveAccessibleName(`Row 2, Seat ${seat}`, left(releasedAt)),
    ),
    ...[3, 4].map((seat) =>
      expect(adminSeat(seat)).toHaveAccessibleName(`Row 2, Seat ${seat}, open`, left(releasedAt)),
    ),
  ]);
  for (const seat of [3, 4]) await expect(customerSeat(seat)).toBeEnabled();

  await desk.context().close();
  await one.context().close();
  await two.context().close();
});
