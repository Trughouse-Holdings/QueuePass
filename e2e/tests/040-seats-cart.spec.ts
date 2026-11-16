// Spec 040 (quickstart S5; parity M1–M16, C1–C10; research R10, R13): seats held in the Rust
// Customer app are the account's, so the React Customer app's cart shows them with the same time
// left (C10), and they are bought in the Rust app's cart. It drives both Customer apps, so it is
// untagged and runs in the default project only; `033` and `038`'s Customer journeys run against
// the Rust app through the `customer-rust` project (`@customer`). S5's step 5, the 5:00 run-out,
// is by hand (quickstart Automation).
import { expect, test, type Page } from '@playwright/test';
import { apiFor, seatedEvent } from '../fixtures/api';
import { adminFor, customerFor } from '../fixtures/apps';
import { PLACES, startsInHours, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';

/** The countdown's `m:ss` as seconds. */
const seconds = (text: string | null): number => {
  const [m, s] = (text ?? '').trim().split(':').map(Number);
  return m * 60 + s;
};

const timeLeft = async (page: Page, scope = page.locator('body')): Promise<number> =>
  seconds(await scope.getByRole('timer').locator('.hold-countdown__time').textContent());

test("040 S5: seats held in the Rust Customer app show in the React Customer app's cart and are bought in the Rust one", async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const eventName = uniqueName(testInfo, 'rust seats show');
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const { event } = await seatedEvent(admin.api, {
    venueName: uniqueName(testInfo, 'rust seats hall'),
    place: PLACES.louisville,
    layout: {
      name: 'Main floor',
      levels: [
        { name: 'Standard', color: 'blue' },
        { name: 'Premium', color: 'red' },
      ],
      sections: [
        { name: 'A', rows: 2, seatsPerRow: 10, level: 'Standard' },
        { name: 'B', rows: 1, seatsPerRow: 6, level: 'Premium' },
      ],
    },
    event: {
      name: eventName,
      startsAt: startsInHours(24 * 7),
      endsAt: startsInHours(24 * 7 + 3),
    },
    prices: { Standard: '25.00', Premium: '40.00' },
  });
  await admin.close();

  // Index 14: 026's repeats use 11 + the repeat index; holds are per event, so a shared account
  // would not disturb this test anyway.
  const username = customerFor(testInfo, 14);
  const rustContext = await browser.newContext();
  const rust = await rustContext.newPage();
  await signIn(rust, 'customer-rust', username, `/events/${event.id}`);

  // S5 step 1: Choose seats, open a section, and hold two seats of two levels.
  const tickets = rust.getByRole('region', { name: 'Get tickets' });
  await expect(tickets.getByRole('term').first()).toHaveText('Price');
  await expect(tickets.locator('dl.stat-tiles')).toContainText('$25–$40');
  await tickets.getByRole('button', { name: 'Choose seats' }).click();
  const map = tickets.getByRole('group', { name: 'Main floor map' });
  await map.getByRole('button', { name: /^Section A, / }).click();
  const seat = (row: number, n: number) =>
    map.getByRole('button', { name: new RegExp(`^Row ${row}, Seat ${n}, `) });

  await seat(1, 5).click();
  await expect(seat(1, 5)).toHaveAccessibleName('Row 1, Seat 5, Standard, $25, held by you');
  const box = tickets.getByRole('region', { name: 'Your seats' });
  await expect(box.getByRole('timer')).toHaveText(/(5:00|4:5\d)/);
  const first = await timeLeft(rust, box);
  expect(first).toBeGreaterThanOrEqual(290);
  const log = tickets.locator('[data-announces="holds"]');
  await expect(log).toContainText(/Section A, Row 1, Seat 5 held\. \d:\d\d left\./);

  // The Sections list opens section B on the map; its seats are held in the same reservation.
  await tickets
    .getByRole('region', { name: 'Sections' })
    .getByRole('button', { name: /^Section B, / })
    .click();
  await seat(1, 1).click();
  await expect(seat(1, 1)).toHaveAccessibleName('Row 1, Seat 1, Premium, $40, held by you');
  expect(await timeLeft(rust, box)).toBeLessThanOrEqual(first);
  await expect(box.getByRole('timer')).toHaveCount(1);

  // Step 2: a click releases it, another holds it again, with no refusal.
  await seat(1, 1).click();
  await expect(seat(1, 1)).toHaveAccessibleName('Row 1, Seat 1, Premium, $40, open');
  await seat(1, 1).click();
  await expect(seat(1, 1)).toHaveAccessibleName('Row 1, Seat 1, Premium, $40, held by you');
  await expect(tickets.getByRole('alert')).toHaveCount(0);
  const held = [
    'Section A, Row 1, Seat 5, Standard, $25.00',
    'Section B, Row 1, Seat 1, Premium, $40.00',
  ];
  await expect(box.getByRole('list', { name: 'Held seats' }).getByRole('listitem')).toHaveText(
    held,
  );
  await expect(box).toContainText('Total: $65.00');

  // Step 3: the React Customer app's cart (the same customer) shows the same reservation with
  // the same time left, give or take the seconds between the two reads.
  const reactContext = await browser.newContext();
  const react = await reactContext.newPage();
  await signIn(react, 'customer', username, '/cart');
  const reactEntry = react.getByRole('region', { name: eventName });
  await expect(reactEntry.getByRole('list', { name: 'Seats' }).getByRole('listitem')).toHaveText(
    held,
  );
  await expect(reactEntry).toContainText('Total: $65.00');
  const [rustLeft, reactLeft] = [await timeLeft(rust, box), await timeLeft(react, reactEntry)];
  expect(Math.abs(rustLeft - reactLeft)).toBeLessThanOrEqual(5);

  // Step 4: Add to cart in the Rust app, the name, Buy tickets.
  await box.getByRole('button', { name: 'Add to cart' }).click();
  await expect(rust).toHaveURL(/\/cart$/);
  const entry = rust.getByRole('region', { name: eventName });
  await expect(entry.getByRole('list', { name: 'Seats' }).getByRole('listitem')).toHaveText(held);
  await expect(entry.getByRole('link', { name: 'Change seats' })).toHaveAttribute(
    'href',
    `/events/${event.id}`,
  );
  const buy = entry.getByRole('button', { name: 'Buy tickets' });
  await expect(buy).toBeDisabled();
  await rust.getByRole('textbox', { name: 'Name on tickets' }).fill('Jordan Lee');
  await buy.click();

  const confirmed = rust.getByRole('region', { name: 'Order confirmed' });
  const codes = confirmed.getByRole('list', { name: 'Ticket codes' });
  await expect(codes.getByRole('listitem')).toHaveCount(2);
  await expect(codes).toContainText('Section A, Row 1, Seat 5, Standard, $25.00');
  await expect(codes).toContainText('Section B, Row 1, Seat 1, Premium, $40.00');
  await expect(confirmed).toContainText('$65.00');
  await expect(rust.getByRole('region', { name: eventName })).toHaveCount(0);

  // The React app's cart lets the entry go (bought, said politely) and My tickets lists the seats.
  await expect(react.getByRole('region', { name: eventName })).toHaveCount(0, {
    timeout: 15_000,
  });
  await react.getByRole('link', { name: 'My tickets', exact: true }).click();
  const order = react.getByRole('article').filter({ hasText: eventName });
  const lines = order.getByRole('list', { name: 'Tickets' });
  await expect(lines).toContainText('Section A, Row 1, Seat 5, Standard, $25.00: Valid');
  await expect(lines).toContainText('Section B, Row 1, Seat 1, Premium, $40.00: Valid');

  // The seats are sold on the Rust app's own map now.
  await rust.goto(`${new URL(rust.url()).origin}/events/${event.id}`);
  await rust
    .getByRole('region', { name: 'Get tickets' })
    .getByRole('button', { name: 'Choose seats' })
    .click();
  await map.getByRole('button', { name: /^Section A, / }).click();
  await expect(seat(1, 5)).toHaveAccessibleName('Row 1, Seat 5, Standard, $25, sold');

  await reactContext.close();
  await rustContext.close();
});
