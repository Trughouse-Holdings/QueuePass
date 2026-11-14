// Spec 026 quickstart S2 (research R11): a customer over the seat-hold limit is told so, with a
// countdown above the seat map (spec 033: a seat click is the hold), keeps the seats already
// held, and can hold again when the countdown ends. The stack runs with the default hold limits,
// 30 a minute and 10 in any 5 seconds (spec 033; e2e/stack/docker-compose.e2e.yml), whatever a
// developer's own configuration says. Spec 038: the seats are clicked on the venue map.
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
    layout: {
      name: 'Main floor',
      levels: [{ name: 'General', color: 'teal' }],
      sections: [{ name: 'A', rows: 2, seatsPerRow: 10, level: 'General' }],
    },
    event: {
      name: uniqueName(testInfo, 'limit show'),
      startsAt: startsInHours(24 * 7),
      endsAt: startsInHours(24 * 7 + 3),
    },
    prices: { General: '20.00' },
  });
  await admin.close();

  // An account per repeat (review S1): `--repeat-each` (022 R13) would otherwise send one account
  // over its hold allowance in a minute. 11 to 18 are free; 0 to 10 are the other tests' (tasks
  // T015), 19 is 033's.
  const index = 11 + testInfo.repeatEachIndex;
  expect(index, "at most 8 repeats: 19 is spec 033's customer (022 R8)").toBeLessThan(19);
  // The customer's own page, and the API with the token that page signed in with.
  const customer = await apiAs(page, () =>
    signIn(page, 'customer', customerFor(testInfo, index), `/events/${event.id}`),
  );
  const tickets = page.getByRole('region', { name: 'Get tickets' });
  await tickets.getByRole('button', { name: 'Choose seats' }).click();
  const seats = tickets.getByRole('group', { name: 'Main floor map' });
  await seats.getByRole('button', { name: /^Section A, / }).click();
  const held = tickets.getByRole('region', { name: 'Your seats' });
  const second = seats.getByRole('button', { name: /^Row 1, Seat 2, / });

  // Step 2: one seat held, by clicking it (spec 033).
  await seats.getByRole('button', { name: 'Row 1, Seat 1, General, $20, open' }).click();
  await expect(held).toContainText('Section A, Row 1, Seat 1');

  // Step 3: hold attempts straight to the API, back to back, for the held seat, each refused as
  // already held (400) or for the limit (429), until one is refused for the limit with at least
  // 3 seconds to wait: the window is then full of attempts made just now, whatever the runner's
  // speed, so step 4 cannot slip in as the oldest ages out (review M1).
  const sectionId = layout.sections[0].id;
  let full = false;
  for (let i = 0; i < 60 && !full; i++) {
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

  // Step 4: another seat clicked, at once, within the wait: refused for the limit. The wait shown
  // is the one this refusal gives, whichever window binds on a slow runner (033 review round 2).
  const refusal = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname === `/events/${event.id}/reservation` &&
      r.status() === 429,
  );
  await second.click();
  const retryAfter = Number((await (await refusal).json()).error.details.retryAfterSeconds);
  // The visible banner; a visually hidden live region carries the same words for screen readers
  // (review M2), so the text alone matches twice.
  const message = tickets.locator('p.banner', {
    hasText: /^Too many tries\. You can try again in \d+ seconds?\.$/,
  });
  await expect(message).toBeVisible();
  const n = Number((await message.textContent())?.match(/\d+/)?.[0]);
  expect(n).toBeGreaterThanOrEqual(1);
  // Counting down from the refusal's own N: at most N, and not more than a couple of seconds less.
  expect(n).toBeLessThanOrEqual(retryAfter);
  expect(n).toBeGreaterThanOrEqual(Math.max(1, retryAfter - 2));
  // Above the venue map; open seats wait it out; the held seat and Add to cart stay.
  await expect(message.locator('xpath=following-sibling::*[1]')).toHaveClass(/venue-map-layout/);
  await expect(second).toHaveAttribute('aria-disabled', 'true');
  await expect(held).toContainText('Section A, Row 1, Seat 1');
  await expect(held.getByRole('button', { name: 'Add to cart' })).toBeEnabled();

  // Step 5: when the countdown ends, the next click holds the second seat.
  await expect(message).toBeHidden({ timeout: (retryAfter + 5) * 1_000 });
  await expect(second).not.toHaveAttribute('aria-disabled', 'true');
  await second.click();
  await expect(held).toContainText('Section A, Row 1, Seat 2');
  await expect(held).toContainText('Section A, Row 1, Seat 1');
});
