// Spec 015 quickstart S2: live gray-out. Two customers side by side on one seated event; seats one
// reserves show as reserved on the other's open page within 2 seconds, without a reload (FR-006),
// and turn open again within 2 seconds when released. Spec 033: the first customer's clicks hold
// the seats, and clicking them again releases them. Spec 038: on the venue map, section A zoomed
// into; the Admin's event page shows the same seats on its map by state (FR-027).
import { expect, test, type Page } from '@playwright/test';
import { adminFor, customerFor } from '../fixtures/apps';
import { apiFor, seatedEvent } from '../fixtures/api';
import { PLACES, startsInHours, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';

/** SC-002: what "live" means. */
const LIVE_MS = 2_000;
const LAYOUT = 'Main floor';

/** Opens the event's venue map and section A in it, and returns the map. */
async function openSectionA(page: Page, eventId: string) {
  const tickets = page.getByRole('region', { name: 'Get tickets' });
  await tickets.getByRole('button', { name: 'Choose seats' }).click();
  const map = tickets.getByRole('group', { name: `${LAYOUT} map` });
  await map.getByRole('button', { name: /^Section A, / }).click();
  await expect(
    map.getByRole('button', { name: 'Row 2, Seat 3, General, $20, open', exact: true }),
  ).toBeEnabled();
  expect(page.url()).toContain(eventId);
  return { tickets, map };
}

test('015 S2: live gray-out, seats one customer reserves turn unavailable for another within 2 seconds', async ({
  browser,
}, testInfo) => {
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const { event } = await seatedEvent(admin.api, {
    venueName: uniqueName(testInfo, 'hold hall'),
    place: PLACES.chicago,
    layout: {
      name: LAYOUT,
      levels: [{ name: 'General', color: 'teal' }],
      sections: [
        { name: 'A', rows: 3, seatsPerRow: 10, level: 'General' },
        { name: 'B', rows: 2, seatsPerRow: 10, level: 'General' },
      ],
    },
    event: {
      name: uniqueName(testInfo, 'hold show'),
      startsAt: startsInHours(24 * 7),
      endsAt: startsInHours(24 * 7 + 3),
    },
    prices: { General: '20.00' },
  });
  await admin.close();

  // Two customers in two browser contexts that share nothing, side by side, and the Admin's map.
  const one = await (await browser.newContext()).newPage();
  const two = await (await browser.newContext()).newPage();
  const desk = await (await browser.newContext()).newPage();
  await signIn(one, 'customer', customerFor(testInfo, 2), `/events/${event.id}`);
  await signIn(two, 'customer', customerFor(testInfo, 3), `/events/${event.id}`);
  await signIn(desk, 'admin', adminFor(testInfo), `/events/${event.id}`);
  const first = await openSectionA(one, event.id);
  const second = await openSectionA(two, event.id);
  const seating = desk.getByRole('region', { name: 'Seating' });
  const deskMap = seating.getByRole('group', { name: `${LAYOUT} map` });
  await expect(seating.getByText('0 sold, 0 held, 50 open, 0 off sale')).toBeVisible();
  await deskMap
    .getByRole('button', { name: 'Section A, 30 open, 0 held, 0 sold, 0 off sale' })
    .click();

  /** Customer 2's seat and the Admin's, by row 2 and seat number, whatever their state. */
  const customerSeat = (seat: number) =>
    second.map.getByRole('button', { name: new RegExp(`^Row 2, Seat ${seat},`) });
  const adminSeat = (seat: number) =>
    deskMap.getByRole('button', { name: new RegExp(`^Row 2, Seat ${seat},`) });
  /** What is left of the 2 seconds since `since` (FR-006): every check shares one deadline. */
  const left = (since: number) => ({ timeout: Math.max(1, LIVE_MS - (Date.now() - since)) });

  // Spec 033: each click holds the seat at once. The 2 seconds run from the second click, so
  // they never span two holds one after another (review round 1, N6).
  await first.map.getByRole('button', { name: 'Row 2, Seat 3, General, $20, open' }).click();
  await first.map.getByRole('button', { name: 'Row 2, Seat 4, General, $20, open' }).click();
  const reservedAt = Date.now();

  // Never reloaded: within 2 seconds of the clicks, Customer 2 sees both seats held and can't
  // choose them, and the Admin sees them held with the event's counts.
  await Promise.all([
    ...[3, 4].map((seat) =>
      expect(customerSeat(seat)).toHaveAccessibleName(
        `Row 2, Seat ${seat}, General, $20, held`,
        left(reservedAt),
      ),
    ),
    ...[3, 4].map((seat) =>
      expect(adminSeat(seat)).toHaveAccessibleName(
        `Row 2, Seat ${seat}, General, $20, held`,
        left(reservedAt),
      ),
    ),
    expect(seating.getByText('0 sold, 2 held, 48 open, 0 off sale')).toBeVisible(left(reservedAt)),
  ]);
  for (const seat of [3, 4]) await expect(customerSeat(seat)).toBeDisabled();
  await expect(first.tickets.getByRole('region', { name: 'Your seats' })).toBeVisible();

  // Customer 1 releases them by clicking them: within 2 seconds they are open again for Customer 2
  // and the Admin.
  await expect(
    first.map.getByRole('button', { name: 'Row 2, Seat 4, General, $20, held by you' }),
  ).toBeVisible();
  const releasedAt = Date.now();
  await first.map.getByRole('button', { name: 'Row 2, Seat 3, General, $20, held by you' }).click();
  await first.map.getByRole('button', { name: 'Row 2, Seat 4, General, $20, held by you' }).click();
  await Promise.all([
    ...[3, 4].map((seat) =>
      expect(customerSeat(seat)).toHaveAccessibleName(
        `Row 2, Seat ${seat}, General, $20, open`,
        left(releasedAt),
      ),
    ),
    ...[3, 4].map((seat) =>
      expect(adminSeat(seat)).toHaveAccessibleName(
        `Row 2, Seat ${seat}, General, $20, open`,
        left(releasedAt),
      ),
    ),
  ]);
  for (const seat of [3, 4]) await expect(customerSeat(seat)).toBeEnabled();

  await desk.context().close();
  await one.context().close();
  await two.context().close();
});
