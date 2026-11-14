// Spec 033 quickstart S1, S2, S6: on a seated event a customer holds seats by clicking them (no
// Reserve seats), lets one go by clicking it and takes it back at once (no 2-minute wait while the
// reservation goes on), adds them to the cart, and buys them there before the countdown ends.
// Spec 038: the seats are clicked on the venue map, section A zoomed into.
import { expect, test } from '@playwright/test';
import { adminFor, customerFor } from '../fixtures/apps';
import { apiFor, seatedEvent } from '../fixtures/api';
import { PLACES, startsInHours, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';

/** The countdown's `m:ss` as seconds. */
const seconds = (text: string | null): number => {
  const [m, s] = (text ?? '').trim().split(':').map(Number);
  return m * 60 + s;
};

test('033 S1/S2/S6: a customer holds seats by clicking them, lets one go and takes it back, adds them to the cart, and buys them there', async ({
  browser,
  page,
}, testInfo) => {
  const eventName = uniqueName(testInfo, 'cart show');
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const { event } = await seatedEvent(admin.api, {
    venueName: uniqueName(testInfo, 'cart hall'),
    place: PLACES.louisville,
    layout: {
      name: 'Main floor',
      levels: [{ name: 'Standard', color: 'blue' }],
      sections: [{ name: 'A', rows: 2, seatsPerRow: 10, level: 'Standard' }],
    },
    event: { name: eventName, startsAt: startsInHours(24 * 7), endsAt: startsInHours(24 * 7 + 3) },
    prices: { Standard: '25.00' },
  });
  await admin.close();

  // Index 19: 0 to 10 are the other tests', 11 to 18 026's repeats.
  await signIn(page, 'customer', customerFor(testInfo, 19), `/events/${event.id}`);
  const tickets = page.getByRole('region', { name: 'Get tickets' });
  await tickets.getByRole('button', { name: 'Choose seats' }).click();
  const seats = tickets.getByRole('group', { name: 'Main floor map' });
  await seats.getByRole('button', { name: /^Section A, / }).click();
  const seat = (n: number) =>
    seats.getByRole('button', { name: new RegExp(`^Row 1, Seat ${n}, `) });

  // S1: a click holds the seat at once; the countdown starts at 5:00 (or 4:5x).
  await seat(5).click();
  await expect(seat(5)).toHaveAccessibleName('Row 1, Seat 5, Standard, $25, held by you');
  const box = tickets.getByRole('region', { name: 'Your seats' });
  const timer = box.getByRole('timer');
  await expect(timer).toHaveText(/(5:00|4:5\d)/);
  const first = seconds(await timer.locator('.hold-countdown__time').textContent());
  expect(first).toBeGreaterThanOrEqual(290);

  // A second seat joins; the countdown has not gone up.
  await seat(6).click();
  await expect(seat(6)).toHaveAccessibleName('Row 1, Seat 6, Standard, $25, held by you');
  expect(seconds(await timer.locator('.hold-countdown__time').textContent())).toBeLessThanOrEqual(
    first,
  );

  // S2: a click on a held seat lets it go; a click again takes it back, with no refusal.
  await seat(6).click();
  await expect(seat(6)).toHaveAccessibleName('Row 1, Seat 6, Standard, $25, open');
  await seat(6).click();
  await expect(seat(6)).toHaveAccessibleName('Row 1, Seat 6, Standard, $25, held by you');
  await expect(tickets.getByRole('alert')).toHaveCount(0);
  await expect(box.getByRole('listitem')).toHaveText([
    'Section A, Row 1, Seat 5, Standard, $25.00',
    'Section A, Row 1, Seat 6, Standard, $25.00',
  ]);

  // No button of the old flow on the event page.
  for (const name of [/^Reserve seats$/, /^Release/, /^Confirm purchase$/, /^Remove/]) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }

  // S6: Add to cart opens the cart with both seats and the countdown.
  await box.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page).toHaveURL(/\/cart$/);
  const entry = page.getByRole('region', { name: eventName });
  await expect(entry.getByRole('list', { name: 'Seats' })).toContainText(
    'Section A, Row 1, Seat 5',
  );
  await expect(entry.getByRole('list', { name: 'Seats' })).toContainText(
    'Section A, Row 1, Seat 6',
  );
  await expect(entry.getByRole('timer')).toHaveText(/\d:\d\d/);
  for (const name of [/^Reserve seats$/, /^Release/, /^Confirm purchase$/, /^Remove/]) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }

  await page.getByRole('textbox', { name: 'Name on tickets' }).fill('Jordan Lee');
  await entry.getByRole('button', { name: 'Buy tickets' }).click();

  const confirmed = page.getByRole('region', { name: 'Order confirmed' });
  const codes = confirmed.getByRole('list', { name: 'Ticket codes' });
  await expect(codes).toContainText('Section A, Row 1, Seat 5');
  await expect(codes).toContainText('Section A, Row 1, Seat 6');
  await expect(page.getByRole('region', { name: eventName })).toHaveCount(0);

  // The cart is empty afterwards.
  await page.getByRole('link', { name: 'Cart', exact: true }).click();
  await expect(
    page.getByText(
      "Your cart is empty. Seats you hold on an event's page appear here for 5 minutes.",
    ),
  ).toBeVisible();
});
