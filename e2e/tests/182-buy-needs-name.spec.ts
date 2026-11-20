// Issue #182: Buy tickets (Cart) and Confirm order (general admission) are disabled until the
// Name on tickets holds a valid name. While the name is all that is missing, a line beside the
// button says so, linked to it; once a name is typed the line goes and the button buys. Tagged
// `@customer`, so it runs against both Customer apps (spec 040 R13).
import { expect, test } from '../fixtures/customer-app';
import { adminFor, customerFor } from '../fixtures/apps';
import { apiFor, createEvent, createVenue, seatedEvent } from '../fixtures/api';
import { PLACES, startsInHours, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';

const NEEDS_NAME = 'Enter the name on tickets above to buy.';

test(
  '#182: the cart says the name on tickets is needed to buy, and buys once it is typed',
  { tag: '@customer' },
  async ({ customerApp, browser, page }, testInfo) => {
    const eventName = uniqueName(testInfo, 'needs name show');
    const admin = await apiFor(browser, 'admin', adminFor(testInfo));
    const { event } = await seatedEvent(admin.api, {
      venueName: uniqueName(testInfo, 'needs name hall'),
      place: PLACES.louisville,
      layout: {
        name: 'Main floor',
        levels: [{ name: 'Standard', color: 'blue' }],
        sections: [{ name: 'A', rows: 1, seatsPerRow: 6, level: 'Standard' }],
      },
      event: {
        name: eventName,
        startsAt: startsInHours(24 * 7),
        endsAt: startsInHours(24 * 7 + 3),
      },
      prices: { Standard: '35.00' },
    });
    await admin.close();

    // Index 17: free in both projects' ranges (033 uses 19; 026's repeats 11 to 18 use other
    // events, and holds and limits are per event).
    await signIn(page, customerApp, customerFor(testInfo, 17), `/events/${event.id}`);
    const tickets = page.getByRole('region', { name: 'Get tickets' });
    await tickets.getByRole('button', { name: 'Choose seats' }).click();
    const map = tickets.getByRole('group', { name: 'Main floor map' });
    await map.getByRole('button', { name: /^Section A, / }).click();
    const seat = (n: number) =>
      map.getByRole('button', { name: new RegExp(`^Row 1, Seat ${n}, `) });
    await seat(2).click();
    await expect(seat(2)).toHaveAccessibleName('Row 1, Seat 2, Standard, $35, held by you');
    await seat(3).click();
    await expect(seat(3)).toHaveAccessibleName('Row 1, Seat 3, Standard, $35, held by you');
    // The event page of a seated event asks for no name, nor says one is needed.
    await expect(page.getByText(NEEDS_NAME)).toHaveCount(0);

    await tickets
      .getByRole('region', { name: 'Your seats' })
      .getByRole('button', { name: 'Add to cart' })
      .click();
    await expect(page).toHaveURL(/\/cart$/);
    const entry = page.getByRole('region', { name: eventName });
    const buy = entry.getByRole('button', { name: 'Buy tickets' });

    // No name: Buy tickets is disabled, looks it, and the line beside it says why.
    await expect(buy).toBeDisabled();
    await expect(entry.getByText(NEEDS_NAME)).toBeVisible();
    await expect(buy).toHaveAccessibleDescription(NEEDS_NAME);
    await expect(buy).toHaveCSS('cursor', 'not-allowed');
    await expect(buy).toHaveCSS('opacity', '0.55');

    // A name: the line goes, and Buy tickets buys both seats.
    await page.getByRole('textbox', { name: 'Name on tickets' }).fill('Jordan Lee');
    await expect(entry.getByText(NEEDS_NAME)).toHaveCount(0);
    await expect(buy).toBeEnabled();
    await expect(buy).toHaveCSS('opacity', '1');
    await buy.click();

    const confirmed = page.getByRole('region', { name: 'Order confirmed' });
    const codes = confirmed.getByRole('list', { name: 'Ticket codes' });
    await expect(codes.getByRole('listitem')).toHaveCount(2);
    await expect(codes).toContainText('Section A, Row 1, Seat 2');
    await expect(codes).toContainText('Section A, Row 1, Seat 3');
    await expect(confirmed).toContainText('$70.00');
    await expect(page.getByRole('region', { name: eventName })).toHaveCount(0);
  },
);

test(
  "#182: general admission's Confirm order says the name on tickets is needed, and buys once it is typed",
  { tag: '@customer' },
  async ({ customerApp, browser, page }, testInfo) => {
    const eventName = uniqueName(testInfo, 'needs name ga show');
    const admin = await apiFor(browser, 'admin', adminFor(testInfo));
    const venue = await createVenue(admin.api, PLACES.chicago, uniqueName(testInfo, 'venue'));
    const event = await createEvent(admin.api, venue, {
      name: eventName,
      startsAt: startsInHours(24 * 7),
      endsAt: startsInHours(24 * 7 + 3),
      capacity: 50,
      basePrice: '20.00',
    });
    await admin.close();

    // Index 18: see above.
    await signIn(page, customerApp, customerFor(testInfo, 18), `/events/${event.id}`);
    const tickets = page.getByRole('region', { name: 'Get tickets' });
    const confirm = tickets.getByRole('button', { name: 'Confirm order' });

    await expect(confirm).toBeDisabled();
    await expect(tickets.getByText(NEEDS_NAME)).toBeVisible();
    await expect(confirm).toHaveAccessibleDescription(NEEDS_NAME);
    await expect(confirm).toHaveCSS('cursor', 'not-allowed');

    await tickets.getByLabel('Quantity').selectOption('2');
    await expect(tickets.getByText('Total: $40.00')).toBeVisible();
    await tickets.getByLabel('Name on tickets').fill('Jordan Lee');
    await expect(tickets.getByText(NEEDS_NAME)).toHaveCount(0);
    await expect(confirm).toBeEnabled();
    await confirm.click();

    const confirmed = page.getByRole('region', { name: 'Order confirmed' });
    await expect(
      confirmed.getByRole('list', { name: 'Ticket codes' }).getByRole('listitem'),
    ).toHaveCount(2);
    await expect(confirmed).toContainText('$40.00');
  },
);
