// Spec 026 quickstart S2 (research R11): a customer over the seat-hold limit is told so, with a
// countdown above the disabled Reserve seats, keeps the seats already held, and can hold again
// when the countdown ends. The stack runs with the default limits, 10 a minute and 3 in any 5
// seconds (e2e/stack/docker-compose.e2e.yml), whatever a developer's own configuration says.
import { expect, test } from '@playwright/test';
import { adminFor, customerFor } from '../fixtures/apps';
import { apiAs, apiFor, seatedEvent } from '../fixtures/api';
import { PLACES, startsInHours, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';

test('026 S2: a customer over the hold limit sees a countdown and keeps their seats', async ({
  browser,
  page,
}, testInfo) => {
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const { event, layout } = await seatedEvent(admin.api, {
    venueName: uniqueName(testInfo, 'limit hall'),
    place: PLACES.louisville,
    sections: [{ name: 'A', rows: 2, seatsPerRow: 10 }],
    event: {
      name: uniqueName(testInfo, 'limit show'),
      startsAt: startsInHours(24 * 7),
      endsAt: startsInHours(24 * 7 + 3),
    },
    tiers: [{ name: 'General', price: '20.00' }],
    map: [0],
  });
  await admin.close();

  // An account per repeat (review S1): `--repeat-each` (022 R13) would otherwise send one account
  // past 10 hold attempts in a minute by the third run. 11 to 19 are free; 0 to 10 are the other
  // tests' (tasks T015).
  const index = 11 + testInfo.repeatEachIndex;
  expect(index, 'at most 9 repeats: customerFor allows indices up to 19 (022 R8)').toBeLessThan(20);
  // The customer's own page, and the API with the token that page signed in with.
  const customer = await apiAs(page, () =>
    signIn(page, 'customer', customerFor(testInfo, index), `/events/${event.id}`),
  );
  const tickets = page.getByRole('region', { name: 'Get tickets' });
  await tickets.getByRole('radio', { name: /^General, \$20\.00/ }).check();
  const seats = tickets.getByRole('region', { name: 'Section A seats' });
  const reserve = tickets.getByRole('button', { name: 'Reserve seats' });
  const held = tickets.getByRole('list', { name: 'Reserved seats' });

  // Step 2: the name first (Confirm purchase needs it), then one seat held.
  await tickets.getByLabel('Name on tickets').fill('Jordan Lee');
  await seats.getByRole('button', { name: 'Row 1, Seat 1', exact: true }).click();
  await reserve.click();
  await expect(held).toContainText('Section A, Row 1, Seat 1');

  // Step 3: hold attempts straight to the API, back to back, for the held seat, each refused as
  // already held (400) or for the limit (429), until one is refused for the limit with at least
  // 3 seconds to wait: the window is then full of attempts made just now, whatever the runner's
  // speed, so step 4 cannot slip in as the oldest ages out (review M1).
  const sectionId = layout.sections[0].id;
  let full = false;
  for (let i = 0; i < 20 && !full; i++) {
    const { status, retryAfter } = await customer.attempt(
      'POST',
      `/events/${event.id}/reservation`,
      { seats: [{ sectionId, row: 1, seat: 1 }] },
    );
    expect([400, 429]).toContain(status);
    full = status === 429 && (retryAfter ?? 0) >= 3;
  }
  expect(full, 'the hold allowance was filled through the API').toBe(true);
  await customer.dispose();

  // Step 4: another seat, at once, within the wait: refused for the limit.
  await seats.getByRole('button', { name: 'Row 1, Seat 2', exact: true }).click();
  await reserve.click();
  const message = tickets.getByText(/^Too many tries\. You can try again in \d+ seconds?\.$/);
  await expect(message).toBeVisible();
  const n = Number((await message.textContent())?.match(/\d+/)?.[0]);
  expect(n).toBeGreaterThanOrEqual(1);
  expect(n).toBeLessThanOrEqual(5);
  await expect(reserve).toHaveAttribute('aria-disabled', 'true');
  await expect(held).toContainText('Section A, Row 1, Seat 1');
  await expect(tickets.getByRole('button', { name: 'Confirm purchase' })).toBeEnabled();

  // Step 5: when the countdown ends, Reserve seats works again and adds the second seat.
  await expect(message).toBeHidden({ timeout: 10_000 });
  await expect(reserve).not.toHaveAttribute('aria-disabled', 'true');
  await reserve.click();
  await expect(held).toContainText('Section A, Row 1, Seat 2');
  await expect(held).toContainText('Section A, Row 1, Seat 1');
});
