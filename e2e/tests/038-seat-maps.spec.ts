// Spec 038 quickstart S0, S5, S6, S10–S17: venue layouts, an event priced by level with seats off
// sale, and the venue map in the Customer and Admin apps. S0 reads the demo state the harness
// loaded with the reset (spec 029 research R13) and changes nothing. Every other test makes a venue
// of its own with the Yum! Center's Basketball layout (research R18), imported through the API
// from the file the reset imports, so no test touches the demo's seats (spec 022 research R8).
//
// Customer accounts: 4 to 10 (this file holds few seats with each; 11 to 18 are 026's repeats,
// which fill an account's hold allowance, and 19 is 033's).
import { expect, test, type Locator, type Page } from '@playwright/test';
import { APPS, adminFor, customerFor } from '../fixtures/apps';
import {
  apiFor,
  basketballEvent,
  buyTickets,
  createEvent,
  createVenue,
  holdSeats,
  importLayout,
  seatAt,
  yumCenterFile,
  type Event,
  type Location,
} from '../fixtures/api';
import { PLACES, startsInHours, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';
import { localDate } from '../fixtures/time';
import { fillEventDateTime } from '../fixtures/event-times';

const EASTERN = 'America/New_York';
/** Spec 038 SC-004 (spec 015 FR-006): what "live" means. */
const LIVE_MS = 2_000;

// Basketball's seats (scripts/layouts/generate-yum-center.mjs; research R18).
const SEATS = 22_090;
const UPPER = 10_846; // sections 301–330, off sale at the women's game
const ON_SALE = SEATS - UPPER; // 11,244
const SECTION_115 = 603;

const n = (x: number): string => x.toLocaleString('en-US');
/** What is left of the 2 seconds since `since`: every check of one change shares one deadline. */
const within = (since: number) => ({ timeout: Math.max(1, LIVE_MS - (Date.now() - since)) });

/** The customer's event page, the map opened by Choose seats (research R14). */
async function chooseSeats(page: Page): Promise<{ tickets: Locator; map: Locator }> {
  const tickets = page.getByRole('region', { name: 'Get tickets' });
  await tickets.getByRole('button', { name: 'Choose seats' }).click();
  const map = tickets.getByRole('group', { name: 'Basketball map' });
  await expect(map).toBeVisible();
  return { tickets, map };
}

/** A seat of the open section on the map, whatever its state: "Row F, Seat 7, …". */
const seatOn = (map: Locator, row: string, seat: number): Locator =>
  map.getByRole('button', { name: new RegExp(`^Row ${row}, Seat ${seat}, `) });

/** A section of the map, whatever its counts: "Section 115, …". */
const sectionOn = (map: Locator, name: string): Locator =>
  map.getByRole('button', { name: new RegExp(`^Section ${name}, `) });

/** A venue of the test's own with Basketball and an event on it priced as the women's game. */
async function womensGame(
  browser: Parameters<typeof apiFor>[0],
  testInfo: Parameters<typeof uniqueName>[0],
  what: string,
): Promise<{ event: Event; eventName: string }> {
  const eventName = uniqueName(testInfo, what);
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const { event } = await basketballEvent(admin.api, {
    venueName: uniqueName(testInfo, 'arena'),
    place: PLACES.louisville,
    event: { name: eventName, startsAt: startsInHours(24 * 9), endsAt: startsInHours(24 * 9 + 3) },
  });
  await admin.close();
  return { event, eventName };
}

test('038 S0: after the reset, the KFC Yum! Center has its four layouts, three locked by sold seats, and its four events', async ({
  page,
}, testInfo) => {
  await signIn(page, 'admin', adminFor(testInfo), '/locations');
  await page.getByRole('link', { name: 'KFC Yum! Center', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'KFC Yum! Center' })).toBeVisible();

  // FR-009: the capacity is the largest layout's, shown read-only.
  await expect(page.getByText(`Seating capacity: ${n(SEATS)}`)).toBeVisible();
  await expect(page.getByText(`From the largest layout (${n(SEATS)} seats)`)).toBeVisible();

  const layouts = page.getByRole('region', { name: 'Layouts' });
  const layout = (name: string) => layouts.getByRole('article', { name, exact: true });
  await expect(layouts.getByRole('article')).toHaveCount(4);
  await expect(layout('Basketball')).toContainText(
    `${n(SEATS)} seats · 54 sections · 4 price levels · used by 2 events`,
  );
  await expect(layout('End-stage concert')).toContainText('17,500 seats · ');
  await expect(layout('End-stage concert')).toContainText('used by 1 event');
  await expect(layout('Wrestling (ring)')).toContainText('used by 1 event');
  await expect(layout('Center stage')).toContainText('used by 0 events');
  for (const name of ['Basketball', 'End-stage concert', 'Wrestling (ring)']) {
    await expect(layout(name).getByText('Locked: seats are sold or held')).toBeVisible();
  }
  await expect(layout('Center stage').getByText('Locked: seats are sold or held')).toHaveCount(0);

  // The four events of research R18.
  for (const name of [
    'Cardinals Women vs. Duke',
    'Cardinals Men vs. Kentucky',
    'Arena Tour: Live',
    'WWE Saturday Night',
  ]) {
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  }

  // The women's game: 40 seats sold, none held, the upper level off sale.
  await page.getByRole('link', { name: 'Cardinals Women vs. Duke', exact: true }).click();
  const seating = page.getByRole('region', { name: 'Seating' });
  await expect(
    seating.getByText(`40 sold, 0 held, ${ON_SALE - 40} open, ${UPPER} off sale`),
  ).toBeVisible();
  await expect(seating.getByRole('group', { name: 'Basketball map' })).toBeVisible();
});

test('038 S5: a locked layout refuses Rename and Delete naming its event, and Duplicate makes an unlocked copy', async ({
  browser,
  page,
}, testInfo) => {
  const venueName = uniqueName(testInfo, 'lock arena');
  const eventName = uniqueName(testInfo, 'lock game');
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const venue = await createVenue(admin.api, PLACES.louisville, venueName);
  const layout = await importLayout(admin.api, venue, yumCenterFile('basketball'));
  const event = await createEvent(admin.api, venue, {
    name: eventName,
    startsAt: startsInHours(24 * 9),
    endsAt: startsInHours(24 * 9 + 3),
    seating: {
      layout,
      prices: {
        Courtside: '95.00',
        'Lower sideline': '60.00',
        'Lower end': '35.00',
        Upper: '20.00',
      },
    },
  });
  // A seat sold locks the layout (FR-006, research R7).
  const customer = await apiFor(browser, 'customer', customerFor(testInfo, 4));
  const seat = await seatAt(customer.api, layout, '115', 'F', '7');
  await holdSeats(customer.api, event, [seat]);
  await buyTickets(customer.api, event, { quantity: 1, holderName: 'Jordan Lee', seats: [seat] });
  await customer.close();

  await signIn(page, 'admin', adminFor(testInfo), `/locations/${venue.id}`);
  const layouts = page.getByRole('region', { name: 'Layouts' });
  const basketball = layouts.getByRole('article', { name: 'Basketball', exact: true });
  await expect(basketball).toContainText('used by 1 event');
  await expect(basketball.getByText('Locked: seats are sold or held')).toBeVisible();

  // Rename: refused, naming the event, beside the layout; the name is kept.
  await basketball.getByRole('button', { name: 'Rename Basketball' }).click();
  await basketball.getByLabel('New name for Basketball').fill('Basketball 2026');
  await basketball.getByRole('button', { name: 'Save name' }).click();
  const refusal = basketball.getByTestId('error-banner');
  await expect(refusal).toContainText('Could not change Basketball');
  await expect(refusal).toContainText(
    `Basketball is used by "${eventName}", which has sold or held seats. Duplicate it to make changes.`,
  );
  await basketball.getByRole('button', { name: 'Cancel' }).click();

  // Delete: refused, naming the event.
  page.once('dialog', (dialog) => void dialog.accept());
  await basketball.getByRole('button', { name: 'Delete Basketball' }).click();
  await expect(basketball.getByTestId('error-banner')).toContainText(
    `Basketball is used by "${eventName}", so it can't be deleted`,
  );
  await expect(layouts.getByRole('article')).toHaveCount(1);

  // Duplicate: a copy, used by no event, unlocked.
  await basketball.getByRole('button', { name: 'Duplicate Basketball' }).click();
  const copy = layouts.getByRole('article', { name: 'Basketball (copy)', exact: true });
  await expect(copy).toContainText(
    `${n(SEATS)} seats · 54 sections · 4 price levels · used by 0 events`,
  );
  await expect(copy.getByText('Locked: seats are sold or held')).toHaveCount(0);
  await expect(basketball.getByText('Locked: seats are sold or held')).toBeVisible();
  await admin.close();
});

test('038 S6: an admin schedules an event on Basketball with the upper level and rows D–F of 104 off sale and a price per level', async ({
  browser,
  page,
}, testInfo) => {
  // Thirty sections are taken off sale one by one, each loaded as the form loads it.
  test.setTimeout(180_000);
  const venueName = uniqueName(testInfo, 'form arena');
  const eventName = uniqueName(testInfo, 'women vs duke');
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const venue: Location = await createVenue(admin.api, PLACES.louisville, venueName);
  await importLayout(admin.api, venue, yumCenterFile('basketball'));

  const day = localDate(EASTERN, 9);
  await signIn(page, 'admin', adminFor(testInfo));
  await page.getByRole('link', { name: 'Events', exact: true }).click();
  await page.getByRole('link', { name: 'Schedule event' }).first().click();
  await page.getByLabel('Event name', { exact: true }).fill(eventName);
  await page
    .getByLabel('Venue', { exact: true })
    .selectOption({ label: `${venueName} (${n(SEATS)} seats)` });
  await fillEventDateTime(page, 'Starts', `${day}T19:00`);
  await fillEventDateTime(page, 'Ends', `${day}T22:00`);
  await page
    .getByLabel('Seating', { exact: true })
    .selectOption({ label: `Basketball (${n(SEATS)} seats)` });
  await expect(page.getByRole('table', { name: 'Prices by level' })).toBeVisible();
  const line = page.getByTestId('seat-line');
  await expect(line).toHaveText(`${n(SEATS)} seats on sale · 0 off sale`);
  await expect(page.getByLabel('Upper price', { exact: true })).toBeVisible();

  // The upper level, sections 301–330, whole; then rows D–F of 104.
  const offSale = page.getByRole('group', { name: 'Seats off sale' });
  for (let s = 301; s <= 330; s++) {
    await offSale.getByRole('button', { name: `Section ${s}`, exact: true }).click();
    await offSale.getByRole('button', { name: 'Whole section off sale' }).click();
    await expect(offSale.getByRole('button', { name: 'Whole section on sale' })).toBeVisible();
    await offSale.getByRole('button', { name: 'Back to all sections' }).click();
  }
  // Upper's price box goes away: its seats are all off sale (FR-011).
  await expect(page.getByLabel('Upper price', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('row', { name: /^Upper / }).getByText('All seats off sale'),
  ).toBeVisible();
  await offSale.getByRole('button', { name: 'Section 104', exact: true }).click();
  for (const row of ['D', 'E', 'F']) {
    await offSale.getByRole('checkbox', { name: `Row ${row} off sale` }).check();
  }
  await offSale.getByRole('button', { name: 'Back to all sections' }).click();
  // 12 + 13 + 14 seats in rows D–F of 104.
  const off = UPPER + 39;
  await expect(line).toHaveText(`${n(SEATS - off)} seats on sale · ${n(off)} off sale`);

  await page.getByLabel('Courtside price', { exact: true }).fill('95');
  await page.getByLabel('Lower sideline price', { exact: true }).fill('60');
  await page.getByLabel('Lower end price', { exact: true }).fill('35');
  await page.getByRole('button', { name: 'Schedule event' }).click();
  await expect(page.getByRole('heading', { level: 1, name: eventName })).toBeVisible();
  await expect(page.getByTestId('error-banner')).toHaveCount(0);

  // The capacity is the seats on sale; the price, from the lowest level price to the highest.
  const [saved] = await admin.api.call<Event[]>(
    'GET',
    `/events?q=${encodeURIComponent(eventName)}`,
  );
  expect(saved).toMatchObject({
    reservedSeating: true,
    totalTicketCapacity: SEATS - off,
    basePrice: '35.00',
    priceMax: '95.00',
  });
  await admin.close();

  // FR-024: customers read the event's price as "$35–$95".
  const customer = await apiFor(browser, 'customer', customerFor(testInfo, 10));
  await customer.page.goto(`${APPS.customer.url}/events/${saved.id}`);
  await expect(customer.page.getByRole('heading', { level: 1, name: eventName })).toBeVisible();
  await expect(
    customer.page.getByRole('definition').filter({ hasText: /^\$35–\$95$/ }),
  ).toHaveCount(1);
  await customer.close();
});

test('038 S10/S11/S12/S13: a customer filters the venue map by price, zooms into section 115, holds seats of two levels, and buys them', async ({
  browser,
  page,
}, testInfo) => {
  const { event, eventName } = await womensGame(browser, testInfo, 'map game');
  await signIn(page, 'customer', customerFor(testInfo, 4), `/events/${event.id}`);
  const tickets = page.getByRole('region', { name: 'Get tickets' });
  await expect(tickets.getByText(`$35–$95, ${n(ON_SALE)} seats left`)).toBeVisible();
  const { map } = await chooseSeats(page);

  // S10: every section, colored by its cheapest open level; the upper level not on sale.
  await expect(map.getByRole('button', { name: /^Section / })).toHaveCount(54);
  await expect(
    tickets.getByRole('list', { name: 'Price levels' }).getByRole('listitem'),
  ).toHaveText(['Courtside $95', 'Lower sideline $60', 'Lower end $35', 'Upper: not on sale']);
  await expect(sectionOn(map, '101')).toHaveAccessibleName('Section 101, 288 open seats from $35');
  await expect(sectionOn(map, '301')).toHaveAccessibleName('Section 301, no open seats');

  // S11: $50 and up fades the end sections, only $35 seats; the sideline sections stay.
  await tickets.getByLabel('Lowest price').fill('50');
  await expect(tickets.locator('.price-filter__range')).toHaveText('$50–$95');
  for (const end of ['101', '103', '109', '112', '118', '120']) {
    await expect(sectionOn(map, end)).toHaveAccessibleName(
      `Section ${end}, no open seats between $50 and $95`,
    );
    await expect(sectionOn(map, end)).toHaveClass(/venue-map__section--faded/);
  }
  await expect(sectionOn(map, '115')).toHaveAccessibleName(
    `Section 115, ${SECTION_115} open seats from $60`,
  );
  await expect(map.getByRole('button', { name: /^Section / })).toHaveCount(54);
  await expect(
    tickets.getByRole('list', { name: 'Price levels' }).getByRole('listitem').nth(2),
  ).toHaveText('Lower end $35, outside your price range');

  // S12: zoomed into 115; rows D–G are Courtside, the rows behind Lower sideline.
  await sectionOn(map, '115').click();
  await expect(seatOn(map, 'D', 1)).toHaveAccessibleName('Row D, Seat 1, Courtside, $95, open');
  await expect(seatOn(map, 'G', 1)).toHaveAccessibleName('Row G, Seat 1, Courtside, $95, open');
  await expect(seatOn(map, 'H', 1)).toHaveAccessibleName(
    'Row H, Seat 1, Lower sideline, $60, open',
  );
  await seatOn(map, 'F', 7).hover();
  await expect(tickets.locator('.venue-map__tip')).toHaveText(
    'Sec 115, Row F, Seat 7 · Courtside · $95',
  );

  // S13: Row F 7 and 8 and Row P 7, held at once by clicking them.
  await seatOn(map, 'F', 7).click();
  await expect(seatOn(map, 'F', 7)).toHaveAccessibleName(
    'Row F, Seat 7, Courtside, $95, held by you',
  );
  await seatOn(map, 'F', 8).click();
  await expect(seatOn(map, 'F', 8)).toHaveAccessibleName(
    'Row F, Seat 8, Courtside, $95, held by you',
  );
  await seatOn(map, 'P', 7).click();
  await expect(seatOn(map, 'P', 7)).toHaveAccessibleName(
    'Row P, Seat 7, Lower sideline, $60, held by you',
  );
  const yours = tickets.getByRole('region', { name: 'Your seats' });
  await expect(yours.getByRole('timer')).toHaveCount(1);
  await expect(yours.getByRole('list', { name: 'Held seats' }).getByRole('listitem')).toHaveText([
    'Section 115, Row F, Seat 7, Courtside, $95.00',
    'Section 115, Row F, Seat 8, Courtside, $95.00',
    'Section 115, Row P, Seat 7, Lower sideline, $60.00',
  ]);
  await expect(yours.getByText('Total: $250.00')).toBeVisible();

  // Back to map: the overview again, the seats still held.
  await tickets.getByRole('button', { name: 'Back to map' }).click();
  await expect(seatOn(map, 'F', 7)).toHaveCount(0);
  await expect(sectionOn(map, '115')).toBeVisible();
  await expect(yours.getByText('Total: $250.00')).toBeVisible();

  await yours.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page).toHaveURL(/\/cart$/);
  const entry = page.getByRole('region', { name: eventName });
  await expect(entry.getByText('Total: $250.00')).toBeVisible();
  await page.getByRole('textbox', { name: 'Name on tickets' }).fill('Jordan Lee');
  await entry.getByRole('button', { name: 'Buy tickets' }).click();

  const confirmed = page.getByRole('region', { name: 'Order confirmed' });
  const codes = confirmed.getByRole('list', { name: 'Ticket codes' });
  await expect(codes.getByRole('listitem')).toHaveCount(3);
  await expect(codes).toContainText('Section 115, Row F, Seat 7, Courtside, $95.00');
  await expect(codes).toContainText('Section 115, Row F, Seat 8, Courtside, $95.00');
  await expect(codes).toContainText('Section 115, Row P, Seat 7, Lower sideline, $60.00');
  await expect(confirmed).toContainText('$250.00');

  await page.getByRole('link', { name: 'My tickets', exact: true }).click();
  const order = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: eventName }) });
  await expect(order.getByRole('list', { name: 'Tickets' })).toContainText(
    'Section 115, Row F, Seat 7',
  );
});

test('038 S10/S15: at phone width, the zoom buttons and a tap on a section open its seats, and a tap holds one', async ({
  browser,
}, testInfo) => {
  const { event } = await womensGame(browser, testInfo, 'phone game');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await signIn(page, 'customer', customerFor(testInfo, 5), `/events/${event.id}`);
  const tickets = page.getByRole('region', { name: 'Get tickets' });
  await tickets.getByRole('button', { name: 'Choose seats' }).tap();
  const map = tickets.getByRole('group', { name: 'Basketball map' });
  await expect(map).toBeVisible();

  // The zoom buttons zoom in about the middle and back out; Fit map shows the whole map.
  const width = async () => Number((await map.getAttribute('viewBox'))?.split(' ')[2]);
  const whole = await width();
  await tickets.getByRole('button', { name: 'Zoom in' }).tap();
  await expect.poll(width).toBeLessThan(whole);
  await tickets.getByRole('button', { name: 'Fit map' }).tap();
  await expect.poll(width).toBe(whole);

  // A tap on a section opens its seats; a tap on a seat holds it.
  await sectionOn(map, '115').tap();
  await expect(tickets.getByRole('button', { name: 'Back to map' })).toBeVisible();
  await expect(seatOn(map, 'F', 7)).toHaveAccessibleName('Row F, Seat 7, Courtside, $95, open');
  await seatOn(map, 'F', 7).tap();
  await expect(seatOn(map, 'F', 7)).toHaveAccessibleName(
    'Row F, Seat 7, Courtside, $95, held by you',
  );
  await expect(tickets.getByRole('region', { name: 'Your seats' })).toContainText(
    'Section 115, Row F, Seat 7, Courtside, $95.00',
  );
  await context.close();
});

test('038 S14: a second customer watching section 115 sees a seat held, then sold, within 2 seconds', async ({
  browser,
}, testInfo) => {
  const { event, eventName } = await womensGame(browser, testInfo, 'live game');
  const one = await (await browser.newContext()).newPage();
  const two = await (await browser.newContext()).newPage();
  await signIn(one, 'customer', customerFor(testInfo, 6), `/events/${event.id}`);
  await signIn(two, 'customer', customerFor(testInfo, 7), `/events/${event.id}`);
  const first = await chooseSeats(one);
  const second = await chooseSeats(two);
  await sectionOn(first.map, '115').click();
  await sectionOn(second.map, '115').click();
  const watched = seatOn(second.map, 'F', 9);
  await expect(watched).toHaveAccessibleName('Row F, Seat 9, Courtside, $95, open');

  // Held: the seat and its section's count change on the other page, never reloaded.
  await seatOn(first.map, 'F', 9).click();
  const heldAt = Date.now();
  await Promise.all([
    expect(watched).toHaveAccessibleName('Row F, Seat 9, Courtside, $95, held', within(heldAt)),
    expect(sectionOn(second.map, '115')).toHaveAccessibleName(
      `Section 115, ${SECTION_115 - 1} open seats from $60`,
      within(heldAt),
    ),
  ]);
  await expect(watched).toBeDisabled();

  // Bought from the cart: sold on the other page within 2 seconds.
  await first.tickets
    .getByRole('region', { name: 'Your seats' })
    .getByRole('button', { name: 'Add to cart' })
    .click();
  await one.getByRole('textbox', { name: 'Name on tickets' }).fill('Jordan Lee');
  await one
    .getByRole('region', { name: eventName })
    .getByRole('button', { name: 'Buy tickets' })
    .click();
  const boughtAt = Date.now();
  await expect(watched).toHaveAccessibleName(
    'Row F, Seat 9, Courtside, $95, sold',
    within(boughtAt),
  );
  await expect(one.getByRole('region', { name: 'Order confirmed' })).toContainText(
    'Section 115, Row F, Seat 9',
  );
  await one.context().close();
  await two.context().close();
});

test('038 S16: by keyboard alone, the Sections list filters, opens section 115, holds a seat and releases it', async ({
  browser,
  page,
}, testInfo) => {
  const { event } = await womensGame(browser, testInfo, 'keys game');
  await signIn(page, 'customer', customerFor(testInfo, 8), `/events/${event.id}`);
  const tickets = page.getByRole('region', { name: 'Get tickets' });
  const choose = tickets.getByRole('button', { name: 'Choose seats' });
  await choose.focus();
  await page.keyboard.press('Enter');
  const map = tickets.getByRole('group', { name: 'Basketball map' });
  const list = tickets.getByRole('region', { name: 'Sections' });
  // Spec 033 FR-016: each hold and release said in the hold log, a status region.
  const log = tickets.getByRole('status').filter({ hasText: /Section 115/ });

  // The price filter by its arrow keys: $35 up to $50.
  await tickets.getByLabel('Lowest price').focus();
  for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
  await expect(tickets.locator('.price-filter__range')).toHaveText('$50–$95');
  await expect(list.getByRole('button', { name: /^Section 101, / })).toHaveAccessibleName(
    'Section 101, no open seats between $50 and $95',
  );

  // Section 115 from the list: its seats as buttons by row, named as the map names them.
  const section = list.getByRole('button', { name: /^Section 115, / });
  await expect(section).toHaveAccessibleName(`Section 115, $60–$95, ${SECTION_115} open seats`);
  await section.focus();
  await page.keyboard.press('Enter');
  await expect(section).toHaveAttribute('aria-expanded', 'true');
  const seat = list
    .getByRole('group', { name: 'Row F' })
    .getByRole('button', { name: /^Row F, Seat 7, / });
  await expect(seat).toHaveAccessibleName('Row F, Seat 7, Courtside, $95, open');

  // Held by Enter; the map, zoomed into the same section, shows the same.
  await seat.focus();
  await page.keyboard.press('Enter');
  await expect(seat).toHaveAccessibleName('Row F, Seat 7, Courtside, $95, held by you');
  await expect(seat).toHaveAttribute('aria-pressed', 'true');
  await expect(seatOn(map, 'F', 7)).toHaveAccessibleName(
    'Row F, Seat 7, Courtside, $95, held by you',
  );
  await expect(log).toContainText('Section 115, Row F, Seat 7 held.');

  // Released by Space.
  await seat.focus();
  await page.keyboard.press('Space');
  await expect(seat).toHaveAccessibleName('Row F, Seat 7, Courtside, $95, open');
  await expect(seatOn(map, 'F', 7)).toHaveAccessibleName('Row F, Seat 7, Courtside, $95, open');
  await expect(log).toContainText('Section 115, Row F, Seat 7 released.');
});

test("038 S17: the admin's map of a seated event shows a customer's hold within 2 seconds", async ({
  browser,
  page,
}, testInfo) => {
  const eventName = uniqueName(testInfo, 'watch game');
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const { event, layout } = await basketballEvent(admin.api, {
    venueName: uniqueName(testInfo, 'arena'),
    place: PLACES.louisville,
    event: { name: eventName, startsAt: startsInHours(24 * 9), endsAt: startsInHours(24 * 9 + 3) },
  });
  await admin.close();

  await signIn(page, 'admin', adminFor(testInfo), `/events/${event.id}`);
  await expect(page.getByRole('heading', { level: 1, name: eventName })).toBeVisible();
  const seating = page.getByRole('region', { name: 'Seating' });
  const map = seating.getByRole('group', { name: 'Basketball map' });
  await expect(
    seating.getByText(`0 sold, 0 held, ${ON_SALE} open, ${UPPER} off sale`),
  ).toBeVisible();
  await expect(seating.getByText('Sections show sold / open seats.')).toBeVisible();
  await expect(sectionOn(map, '115')).toHaveAccessibleName(
    `Section 115, ${SECTION_115} open, 0 held, 0 sold, 0 off sale`,
  );
  await sectionOn(map, '115').click();
  await expect(seatOn(map, 'F', 7)).toHaveAccessibleName('Row F, Seat 7, Courtside, $95, open');

  // A customer holds Row F, Seat 7: held on the admin's map within 2 seconds, never reloaded.
  const customer = await apiFor(browser, 'customer', customerFor(testInfo, 9));
  const seat = await seatAt(customer.api, layout, '115', 'F', '7');
  await holdSeats(customer.api, event, [seat]);
  const heldAt = Date.now();
  await Promise.all([
    expect(seatOn(map, 'F', 7)).toHaveAccessibleName(
      'Row F, Seat 7, Courtside, $95, held',
      within(heldAt),
    ),
    expect(seating.getByText(`0 sold, 1 held, ${ON_SALE - 1} open, ${UPPER} off sale`)).toBeVisible(
      within(heldAt),
    ),
    expect(sectionOn(map, '115')).toHaveAccessibleName(
      `Section 115, ${SECTION_115 - 1} open, 1 held, 0 sold, 0 off sale`,
      within(heldAt),
    ),
  ]);
  // The map names no buyer (FR-028).
  await expect(seating).not.toContainText(/customer\d+/);
  await customer.close();
});
