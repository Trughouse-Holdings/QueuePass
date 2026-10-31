// Spec 024 quickstart V1 to V5: on the New venue form the admin picks the time zone, an address the
// address service does not know (or cannot be asked about) is saved in one press and marked not
// verified, and section lines read Rows × Seats per row with their seats (research R10).
import { expect, test, type Page, type Request } from '@playwright/test';
import { API_BASE, adminFor } from '../fixtures/apps';
import type { Place } from '../fixtures/api';
import { OUTAGE_PLACE, PLACES, UNKNOWN_PLACE, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';

const ZONES = [
  'Eastern Time',
  'Central Time',
  'Mountain Time',
  'Arizona Time (no daylight saving)',
  'Pacific Time',
  'Alaska Time',
  'Hawaii-Aleutian Time',
  'Hawaii Time',
];
const HINT =
  'A section is a grid of seats: rows run front to back, and every row has the same number of seats across.';

/** Research R6's notice for an address saved not verified. */
const notVerified = (address: string, zone: string): string =>
  `Venue saved, but its address is not verified: ${address}. The US address service couldn't ` +
  "confirm it, so check that it's right: customers see this address and its map link. To verify " +
  "it later, edit the venue and save it, correcting the address if it's wrong. " +
  `Time zone: ${zone}.`;

const formatted = (p: Place): string => `${p.street}, ${p.city}, ${p.state} ${p.zip}`;

/** Every `POST /locations` the page sends, in order. */
function recordVenuePosts(page: Page): Request[] {
  const posted: Request[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url() === `${API_BASE}/locations`) posted.push(req);
  });
  return posted;
}

async function fillAddress(page: Page, place: Place): Promise<void> {
  await page.getByLabel('Street address', { exact: true }).fill(place.street);
  await page.getByLabel('City', { exact: true }).fill(place.city);
  await page.getByLabel('State', { exact: true }).selectOption(place.state);
  await page.getByLabel('ZIP code', { exact: true }).fill(place.zip);
}

async function openNewVenue(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Venues', exact: true }).click();
  await page.getByRole('link', { name: 'Add venue' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'New venue' })).toBeVisible();
}

/** One section line: its name, rows, and seats per row, typed into the labelled boxes. */
async function typeSection(page: Page, n: number, name: string, rows: string, seats: string) {
  await page.getByRole('textbox', { name: `Section ${n} Section name`, exact: true }).fill(name);
  await page.getByRole('spinbutton', { name: `Section ${n} Rows`, exact: true }).fill(rows);
  await page
    .getByRole('spinbutton', { name: `Section ${n} Seats per row`, exact: true })
    .fill(seats);
}

const line = (page: Page, n: number) =>
  page.getByRole('group', { name: `Section ${n}`, exact: true });

test('024 V1/V2/V3: an admin creates a seated venue in one press, at an address the service does not know, in the zone they pick', async ({
  page,
}, testInfo) => {
  const venueName = uniqueName(testInfo, 'yum center');
  const posted = recordVenuePosts(page);
  await signIn(page, 'admin', adminFor(testInfo));
  await openNewVenue(page);

  // V1: the eight zones and "Choose a time zone", nothing that works one out.
  const zone = page.getByLabel('Time zone', { exact: true });
  await expect(zone.getByRole('option')).toHaveText(['Choose a time zone', ...ZONES]);
  await expect(zone).toHaveValue('');

  await page.getByLabel('Name', { exact: true }).fill(venueName);
  await fillAddress(page, UNKNOWN_PLACE);

  // V2: labelled section lines, each with its seats, and the hint once.
  await page.getByRole('radio', { name: 'Seated' }).check();
  await page.getByRole('button', { name: 'Add section' }).click();
  await page.getByRole('button', { name: 'Add section' }).click();
  await expect(page.getByText(HINT)).toHaveCount(1);
  for (const n of [1, 2]) {
    for (const label of ['Section name', 'Rows', 'Seats per row']) {
      await expect(line(page, n).getByText(label, { exact: true })).toBeVisible();
    }
    await expect(line(page, n).getByText('×', { exact: true })).toBeVisible();
  }
  await typeSection(page, 1, 'Floor', '10', '20');
  await typeSection(page, 2, 'Balcony', '5', '10');
  await expect(line(page, 1).getByText('= 200 seats', { exact: true })).toBeVisible();
  await expect(line(page, 2).getByText('= 50 seats', { exact: true })).toBeVisible();
  await expect(page.getByText('Total: 250 seats', { exact: true })).toBeVisible();

  // V1: no zone chosen: the form says so and sends nothing.
  await page.getByRole('button', { name: 'Create venue' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: "Choose the venue's time zone." }),
  ).toBeVisible();
  // Long enough for a request the press might have sent late to have gone out.
  await page.waitForTimeout(1_000);
  expect(posted).toHaveLength(0);

  // V1, V3: Central Time; one press saves the unknown address, not verified.
  await zone.selectOption({ label: 'Central Time' });
  await expect(page.getByText("Choose the venue's time zone.")).toHaveCount(0);
  await page.getByRole('button', { name: 'Create venue' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Venues' })).toBeVisible();
  await expect(
    page.getByRole('status').filter({
      hasText: notVerified(formatted(UNKNOWN_PLACE), 'Central Time, chosen by an admin'),
    }),
  ).toBeVisible();
  await expect(page.getByTestId('success-state')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Save anyway/ })).toHaveCount(0);
  expect(posted).toHaveLength(1);
  expect(posted[0].postDataJSON()).toMatchObject({
    acceptUnverifiedAddress: true,
    timeZone: 'America/Chicago',
  });

  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: venueName }) });
  await expect(row.getByText('Not verified', { exact: true })).toBeVisible();
  await expect(row.getByText('Central Time, chosen by an admin', { exact: true })).toBeVisible();

  // V2: the venue page's layout, and the same labelled lines in its editor.
  await row.getByRole('link', { name: venueName }).click();
  const layout = page.getByRole('region', { name: 'Seating layout' });
  await expect(layout.getByText('Total: 250 seats', { exact: true })).toBeVisible();
  await layout.getByRole('button', { name: 'Edit layout' }).click();
  await expect(layout.getByText(HINT)).toHaveCount(1);
  await expect(layout.getByRole('spinbutton', { name: 'Section 1 Rows', exact: true })).toHaveValue(
    '10',
  );
  await expect(
    layout.getByRole('spinbutton', { name: 'Section 1 Seats per row', exact: true }),
  ).toHaveValue('20');
  await expect(line(page, 1).getByText('= 200 seats', { exact: true })).toBeVisible();
  await expect(line(page, 2).getByText('= 50 seats', { exact: true })).toBeVisible();
});

test('024 V4/V5: with the address service down a venue is saved not verified, and a new address keeps its zone', async ({
  page,
}, testInfo) => {
  const venueName = uniqueName(testInfo, 'outage hall');
  await signIn(page, 'admin', adminFor(testInfo));
  await openNewVenue(page);

  // V4: the stand-in answers 503 for this street: saved at once, not verified.
  await page.getByLabel('Name', { exact: true }).fill(venueName);
  await fillAddress(page, OUTAGE_PLACE);
  await page.getByLabel('Time zone', { exact: true }).selectOption({ label: 'Pacific Time' });
  await page.getByLabel('Seating capacity', { exact: true }).fill('300');
  await page.getByRole('button', { name: 'Create venue' }).click();
  await expect(
    page.getByRole('status').filter({
      hasText: notVerified(formatted(OUTAGE_PLACE), 'Pacific Time, chosen by an admin'),
    }),
  ).toBeVisible();
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: venueName }) });
  await expect(row.getByText('Not verified', { exact: true })).toBeVisible();

  // V5: Edit venue starts on the stored zone, and a new address does not change it.
  await row.getByRole('link', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Edit venue' })).toBeVisible();
  const zone = page.getByLabel('Time zone', { exact: true });
  await expect(zone).toHaveValue('America/Los_Angeles');
  await expect(page.getByText('Pacific Time, chosen by an admin.', { exact: true })).toBeVisible();
  await expect(
    page.getByText('This address is not verified. Saving checks it again.', { exact: true }),
  ).toBeVisible();
  await fillAddress(page, PLACES.louisville);
  await expect(
    page.getByText(
      "Changing the address doesn't change the time zone. Choose another zone here if the venue is in a different one.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByTestId('success-state').filter({
      hasText:
        'Venue saved. Address: 1 ARENA PLZ, LOUISVILLE, KY 40202. Time zone: Pacific Time, chosen by an admin.',
    }),
  ).toBeVisible();
  // The row is rendered before its missing mark counts for anything (review round 1, minor 5).
  await expect(row.getByText('Pacific Time, chosen by an admin', { exact: true })).toBeVisible();
  await expect(row.getByText('Not verified', { exact: true })).toHaveCount(0);
});
