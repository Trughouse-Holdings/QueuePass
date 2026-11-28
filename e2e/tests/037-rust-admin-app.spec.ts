// Spec 037 (quickstart S1–S5, S10, S11; research R10): the Rust Admin app beside the React Admin
// app. Each test drives both apps, so it runs in the default project only; the shared Admin
// journeys run against the Rust app through the `admin-rust` project (`@admin`). Spec 040 (research
// R13): `037 S4` holds and buys in the Customer app, so it is tagged `@customer` and its Customer
// steps run against the Rust Customer app in the `customer-rust` project.
import { expect, test } from '../fixtures/customer-app';
import { type Locator, type Page } from '@playwright/test';
import {
  addTier,
  apiFor,
  basketballEvent,
  buyTickets,
  createEvent,
  createLayout,
  createVenue,
  holdSeats,
  seasonOnSale,
  seatAt,
  type Event,
  type LayoutDetail,
  type Order,
} from '../fixtures/api';
import { API_BASE, APPS, adminFor, customerFor } from '../fixtures/apps';
import { PLACES, startsInHours, uniqueName } from '../fixtures/data';
import { signIn, signInHeading, signOut, submitSignIn } from '../fixtures/sign-in';
import { fillEventDateTime } from '../fixtures/event-times';
import { localDate } from '../fixtures/time';
import {
  addLevel,
  addSection,
  drag,
  levelsPanel,
  mapOf,
  mapSection,
  paint,
  save,
  sectionsPanel,
} from '../fixtures/layout-editor';

const RUST = APPS['admin-rust'];

/** Spec 037 research R8: the red look tokens, light set (admin-rust-app/style/red.css). */
const RED = { bg: 'rgb(253, 236, 234)', surface: 'rgb(255, 247, 246)' };

/** What the Rust app's origin keeps in the browser's storage: nothing once signed in (R3). */
async function storageOf(page: Page): Promise<{ session: string[]; local: string[] }> {
  return page.evaluate(() => ({
    session: Object.keys(sessionStorage),
    local: Object.keys(localStorage),
  }));
}

test('037 S1: both Admin apps stay signed in, and logging out of one leaves the other', async ({
  browser,
}, testInfo) => {
  const username = adminFor(testInfo);
  const context = await browser.newContext({ colorScheme: 'light' });
  const react = await context.newPage();
  const rust = await context.newPage();

  await test.step('sign in to both Admin apps in one window', async () => {
    await signIn(react, 'admin', username);
    await rust.goto(RUST.url);
    await expect(
      rust.getByRole('heading', { name: 'Sign in to QueuePass Admin (Rust)' }),
    ).toBeVisible();
    await submitSignIn(rust, username, 'test123');
    await expect(rust.getByRole('button', { name: 'Log out' })).toBeVisible();
    await expect(rust).toHaveURL(new RegExp(`^${RUST.url}/`));
  });

  await test.step('the Rust app says "(Rust)" and is red', async () => {
    await expect(rust).toHaveTitle(/\(Rust\)/);
    await expect(rust.getByRole('banner')).toContainText('QueuePass Admin (Rust)');
    const colors = await rust.evaluate(() => ({
      page: getComputedStyle(document.body).backgroundColor,
      header: getComputedStyle(document.querySelector('header.topbar')!).backgroundColor,
    }));
    expect(colors.page).toBe(RED.bg);
    expect(colors.header).toBe(RED.surface);
    // The React app keeps its own look.
    const reactPage = await react.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(reactPage).not.toBe(RED.bg);
  });

  await test.step("no sign-in value is left in the Rust app's storage", async () => {
    expect(await storageOf(rust)).toEqual({ session: [], local: [] });
  });

  await test.step('logging out of Rust leaves React signed in', async () => {
    await signOut(rust, 'admin-rust');
    await react.reload();
    await expect(react.getByRole('button', { name: 'Log out' })).toBeVisible();
    await expect(signInHeading(react, 'admin')).toHaveCount(0);
  });

  await test.step('opening /events signed out lands on Events after sign-in (returnTo)', async () => {
    await rust.goto(`${RUST.url}/events`);
    await expect(signInHeading(rust, 'admin-rust')).toBeVisible();
    await submitSignIn(rust, username, 'test123');
    await expect(rust).toHaveURL(`${RUST.url}/events`);
    await expect(rust.getByRole('heading', { level: 1, name: 'Events' })).toBeVisible();
    expect(await storageOf(rust)).toEqual({ session: [], local: [] });
  });

  await test.step('logging out of React leaves Rust signed in', async () => {
    await signOut(react, 'admin');
    await rust.reload();
    await expect(rust.getByRole('button', { name: 'Log out' })).toBeVisible();
    await expect(signInHeading(rust, 'admin-rust')).toHaveCount(0);
  });

  await context.close();
});

/** The venue page's Layouts card and one layout in it, by its name. */
const layoutsCard = (page: Page): Locator => page.getByRole('region', { name: 'Layouts' });
const layoutItem = (page: Page, name: string): Locator =>
  layoutsCard(page).getByRole('article', { name, exact: true });

/** One section line of the venue form or the lines form, typed into its labelled boxes. */
async function typeSection(
  scope: Page | Locator,
  n: number,
  name: string,
  rows: string,
  seats: string,
) {
  await scope.getByRole('textbox', { name: `Section ${n} Section name`, exact: true }).fill(name);
  await scope.getByRole('spinbutton', { name: `Section ${n} Rows`, exact: true }).fill(rows);
  await scope
    .getByRole('spinbutton', { name: `Section ${n} Seats per row`, exact: true })
    .fill(seats);
}

/** A layout file with mistakes the Backend lists (LAYOUT_FILE_INVALID). */
const BAD_LAYOUT = {
  name: 'Broken',
  size: { width: 100, height: 100 },
  floor: { kind: 'NONE' },
  levels: [{ name: 'Only', color: 'not-a-color' }],
  sections: [],
};

/** Imports BAD_LAYOUT on the venue page and returns what the refusal lists. */
async function importBadLayout(page: Page): Promise<string[]> {
  await layoutsCard(page)
    .getByLabel('Layout file', { exact: true })
    .setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(BAD_LAYOUT)),
    });
  await layoutsCard(page).getByRole('button', { name: 'Import layout file' }).click();
  const refusal = layoutsCard(page).getByRole('alert');
  await expect(refusal).toContainText('Could not import the layout');
  return refusal.getByRole('listitem').allInnerTexts();
}

test('037 S2: a venue and its layout made in the Rust Admin app show in the React Admin app', async ({
  browser,
}, testInfo) => {
  const username = adminFor(testInfo);
  const venueName = uniqueName(testInfo, 'rust arena');
  const context = await browser.newContext();
  const rust = await context.newPage();
  const react = await context.newPage();
  const place = PLACES.louisville;

  await test.step('in the Rust app, a seated venue with two section lines', async () => {
    await signIn(rust, 'admin-rust', username, '/locations/new');
    await expect(rust.getByRole('heading', { level: 1, name: 'New venue' })).toBeVisible();
    await rust.getByLabel('Name', { exact: true }).fill(venueName);
    await rust.getByLabel('Street address', { exact: true }).fill(place.street);
    await rust.getByLabel('City', { exact: true }).fill(place.city);
    await rust.getByLabel('State', { exact: true }).selectOption(place.state);
    await rust.getByLabel('ZIP code', { exact: true }).fill(place.zip);
    await rust.getByLabel('Time zone', { exact: true }).selectOption({ label: 'Eastern Time' });
    await rust.getByRole('radio', { name: 'Seated' }).check();
    await rust.getByRole('button', { name: 'Add section' }).click();
    await rust.getByRole('button', { name: 'Add section' }).click();
    await typeSection(rust, 1, 'Floor', '10', '20');
    await typeSection(rust, 2, 'Balcony', '5', '10');
    await rust.getByRole('button', { name: 'Create venue' }).click();
    await expect(rust.getByRole('status')).toContainText('Venue saved');
  });

  let venuePath = '';
  await test.step('the React app lists it, with its Standard layout', async () => {
    await signIn(react, 'admin', username, '/locations');
    await react.getByRole('link', { name: venueName, exact: true }).click();
    venuePath = new URL(react.url()).pathname;
    await expect(react.getByRole('heading', { level: 1, name: venueName })).toBeVisible();
    await expect(layoutItem(react, 'Standard')).toContainText('250 seats · 2 sections');
  });

  await test.step('renamed in React, read in Rust', async () => {
    const standard = layoutItem(react, 'Standard');
    await standard.getByRole('button', { name: 'Rename Standard' }).click();
    await standard.getByLabel('New name for Standard').fill('Main floor');
    await standard.getByRole('button', { name: 'Save name' }).click();
    await expect(layoutItem(react, 'Main floor')).toBeVisible();
    await rust.goto(`${RUST.url}${venuePath}`);
    await expect(layoutItem(rust, 'Main floor')).toContainText('250 seats · 2 sections');
  });

  await test.step('in Rust, duplicated and its section lines edited', async () => {
    await layoutItem(rust, 'Main floor')
      .getByRole('button', { name: 'Duplicate Main floor' })
      .click();
    const copy = layoutItem(rust, 'Main floor (copy)');
    await expect(copy).toContainText('250 seats · 2 sections');
    await copy.getByRole('button', { name: 'Edit section lines of Main floor (copy)' }).click();
    const form = layoutsCard(rust).getByRole('form', {
      name: 'Section lines of Main floor (copy)',
    });
    await form.getByRole('spinbutton', { name: 'Section 1 Rows', exact: true }).fill('12');
    await form.getByRole('button', { name: 'Save layout' }).click();
    await expect(copy).toContainText('290 seats · 2 sections');
  });

  await test.step('a bad layout file: the same problems in both apps, nothing saved', async () => {
    const fromRust = await importBadLayout(rust);
    expect(fromRust.length).toBeGreaterThan(0);
    await expect(layoutsCard(rust).getByRole('article')).toHaveCount(2);
    await react.reload();
    const fromReact = await importBadLayout(react);
    expect(fromRust).toEqual(fromReact);
    await expect(layoutsCard(react).getByRole('article')).toHaveCount(2);
    await expect(layoutItem(react, 'Main floor (copy)')).toContainText('290 seats · 2 sections');
  });

  await context.close();
});

// Research R15 (FR-020, parity SL1–SL14): the two Admin apps lay out every page the same way.
// What is compared, per page and width: `main`'s accessibility snapshot (headings, landmarks,
// labels, buttons, table columns, in order), with the app's name and what other tests running at
// the same time may add (list options, live counts) normalized; and the boxes of each card, form
// section, table, and page head, top to bottom, within 2 px. Colors are not compared.

/** What may differ between the two loads without the layout differing. */
function normalized(snapshot: string, route: string): string {
  let out = snapshot
    .replaceAll('QueuePass Admin (Rust)', 'QueuePass Admin')
    // A select's options list every venue on the stack, which tests running beside this add to.
    .replace(/^\s*- option .*$\n?/gm, '');
  if (route === '/reports') out = out.replace(/\d/g, '#');
  return out;
}

const BOX_SELECTOR =
  'main .page-head, main .card, main fieldset, main table, main .stats, main .gallery-band';

/** `main`, ready: no loading text left. */
async function settled(page: Page): Promise<Locator> {
  const main = page.locator('main');
  await expect(main).toBeVisible();
  await expect(main.getByText(/^Loading/)).toHaveCount(0, { timeout: 15_000 });
  return main;
}

async function boxesOf(page: Page): Promise<{ x: number; y: number; w: number; h: number }[]> {
  return page.locator(BOX_SELECTOR).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y + window.scrollY, w: r.width, h: r.height };
    }),
  );
}

test('037 S11: every page has the same structure and arrangement in both Admin apps, at desktop and phone width', async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const username = adminFor(testInfo);
  const admin = await apiFor(browser, 'admin', username);
  const name = uniqueName(testInfo, 'same layout');
  const seated = await basketballEvent(admin.api, {
    venueName: `${name} arena`,
    place: PLACES.louisville,
    event: {
      name: `${name} game`,
      startsAt: startsInHours(24 * 5),
      endsAt: startsInHours(24 * 5 + 3),
    },
  });
  const ga = await createEvent(admin.api, seated.venue, {
    name: `${name} concert`,
    startsAt: startsInHours(24 * 12),
    endsAt: startsInHours(24 * 12 + 3),
    capacity: 100,
  });
  // Spec 041 (T044, FR-022): a Season on sale of the seated game and a second one, so the Seasons
  // pages have one of this test's own to show.
  const second = await createEvent(admin.api, seated.venue, {
    name: `${name} second game`,
    startsAt: startsInHours(24 * 6),
    endsAt: startsInHours(24 * 6 + 3),
    seating: {
      layout: seated.layout,
      prices: {
        Courtside: '95.00',
        'Lower sideline': '60.00',
        'Lower end': '35.00',
        Upper: '20.00',
      },
    },
  });
  const season = await seasonOnSale(admin.api, seated.venue, {
    name: `${name} season`,
    layout: seated.layout,
    events: [seated.event, second],
    prices: {
      Courtside: '180.00',
      'Lower sideline': '110.00',
      'Lower end': '65.00',
      Upper: '35.00',
    },
    salesEndAt: new Date(seated.event.startsAt),
  });
  const customer = await apiFor(browser, 'customer', customerFor(testInfo, 5));
  await buyTickets(customer.api, ga, { quantity: 2, holderName: 'Jordan Lee' });
  await customer.close();
  await admin.close();

  const q = encodeURIComponent(name);
  const routes = [
    '/',
    `/locations?q=${q}`,
    '/locations/new',
    `/locations/${seated.venue.id}`,
    `/locations/${seated.venue.id}/edit`,
    `/locations/${seated.venue.id}/layouts/${seated.layout.id}/edit`,
    `/events?q=${q}`,
    '/events/new',
    `/events/${seated.event.id}`,
    `/events/${ga.id}`,
    `/events/${ga.id}/edit`,
    `/events/${ga.id}/attendees`,
    '/reports',
    // Spec 041 (T044): the Seasons list, a new Season, and this test's Season.
    '/seasons',
    '/seasons/new',
    `/seasons/${season.id}`,
  ];

  for (const width of [1280, 375]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const react = await context.newPage();
    const rust = await context.newPage();
    await signIn(react, 'admin', username);
    await signIn(rust, 'admin-rust', username);
    for (const route of routes) {
      await test.step(`${route} at ${width} px`, async () => {
        await react.goto(`${APPS.admin.url}${route}`);
        await rust.goto(`${RUST.url}${route}`);
        const [reactMain, rustMain] = [await settled(react), await settled(rust)];
        const path = route.split('?')[0]!;
        // An event page's Sales card renders nothing until the whole sales report loads, after
        // the page has settled; wait for it in both, or the pages can match without it and then
        // be measured after only one has it (CI run 46129575059, PR #195).
        if (/^\/events\/[^/]+$/.test(path) && path !== '/events/new') {
          await Promise.all(
            [reactMain, rustMain].map((m) =>
              expect(m.locator('#sales-heading')).toBeVisible({ timeout: 30_000 }),
            ),
          );
        }
        // Cards that load after the page (Sales, the seat map) are waited for in both. Reports
        // lists every event, and Seasons every Season (spec 041), which tests running beside this
        // one add to: both are reloaded until they load the same ones.
        await expect
          .poll(
            async () => {
              const same =
                normalized(await rustMain.ariaSnapshot(), path) ===
                normalized(await reactMain.ariaSnapshot(), path);
              if (!same && (path === '/reports' || path === '/seasons')) {
                await Promise.all([react.reload(), rust.reload()]);
                await Promise.all([settled(react), settled(rust)]);
              }
              return same;
            },
            { timeout: 30_000 },
          )
          .toBe(true);
        expect(normalized(await rustMain.ariaSnapshot(), path)).toEqual(
          normalized(await reactMain.ariaSnapshot(), path),
        );
        const [a, b] = [await boxesOf(react), await boxesOf(rust)];
        expect(b.length, 'the same number of cards, sections, and tables').toBe(a.length);
        for (const [i, box] of a.entries()) {
          for (const k of ['x', 'y', 'w', 'h'] as const) {
            expect(Math.abs(b[i]![k] - box[k]), `box ${i} ${k}`).toBeLessThanOrEqual(2);
          }
        }
      });
    }
    await context.close();
  }
});

// ---------------------------------------------------------------- S3, S4, S5, S10 (T057–T078)

const EASTERN = 'America/New_York';

/** `main`'s accessibility snapshot, with the app's name made the same in both apps. */
async function mainOf(page: Page): Promise<string> {
  return (await page.locator('main').ariaSnapshot()).replaceAll(
    'QueuePass Admin (Rust)',
    'QueuePass Admin',
  );
}

/** The same page in both apps reads the same, once both have loaded. */
async function expectSamePage(rust: Page, react: Page): Promise<void> {
  await expect
    .poll(async () => (await mainOf(rust)) === (await mainOf(react)), { timeout: 15_000 })
    .toBe(true);
}

/** A small picture drawn in the browser, as a file for an `<input type=file>`. */
async function picture(page: Page, type: 'image/png' | 'image/jpeg', name: string) {
  const b64 = await page.evaluate((t) => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const g = canvas.getContext('2d')!;
    g.fillStyle = t === 'image/png' ? '#b4372b' : '#2b6cb4';
    g.fillRect(0, 0, 64, 48);
    return canvas.toDataURL(t).split(',')[1]!;
  }, type);
  return { name, mimeType: type, buffer: Buffer.from(b64, 'base64') };
}

/** A new event starts on the venue's first layout; switch to General admission once it has. */
async function chooseGeneralAdmission(page: Page): Promise<void> {
  const seating = page.getByLabel('Seating', { exact: true });
  await expect(seating).not.toHaveValue('');
  await seating.selectOption({ label: 'General admission' });
}

test('037 S3: events scheduled in the Rust Admin app, general admission and on a layout, read the same in the React Admin app', async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const username = adminFor(testInfo);
  const admin = await apiFor(browser, 'admin', username);
  const venueName = uniqueName(testInfo, 'rust hall');
  const venue = await createVenue(admin.api, PLACES.louisville, venueName);
  await createLayout(admin.api, venue, {
    name: 'Hall',
    levels: [
      { name: 'Floor', color: 'violet' },
      { name: 'Balcony', color: 'teal' },
    ],
    sections: [
      { name: 'Front', rows: 3, seatsPerRow: 5, level: 'Floor' },
      { name: 'Back', rows: 3, seatsPerRow: 5, level: 'Balcony' },
    ],
  });
  const context = await browser.newContext();
  const rust = await context.newPage();
  const react = await context.newPage();
  const day = localDate(EASTERN, 6);
  const nextDay = localDate(EASTERN, 7);
  const gaName = uniqueName(testInfo, 'rust concert');
  const seatedName = uniqueName(testInfo, 'rust recital');
  const find = async (name: string) =>
    (await admin.api.call<Event[]>('GET', `/events?q=${encodeURIComponent(name)}`))[0]!;

  await test.step('general admission: two ticket types, 4 per customer, two pictures', async () => {
    await signIn(rust, 'admin-rust', username, '/events/new');
    await rust.getByLabel('Event name', { exact: true }).fill(gaName);
    await rust
      .getByLabel('Venue', { exact: true })
      .selectOption({ label: `${venueName} (30 seats)` });
    await fillEventDateTime(rust, 'Starts', `${day}T19:00`);
    await fillEventDateTime(rust, 'Ends', `${day}T22:00`);
    await chooseGeneralAdmission(rust);
    await rust.getByLabel('Ticket type 1 name', { exact: true }).fill('Floor');
    await rust.getByLabel('Ticket type 1 price', { exact: true }).fill('40.00');
    await rust.getByLabel('Ticket type 1 quantity', { exact: true }).fill('20');
    await rust.getByRole('button', { name: 'Add ticket type' }).click();
    await rust.getByLabel('Ticket type 2 name', { exact: true }).fill('Balcony');
    await rust.getByLabel('Ticket type 2 price', { exact: true }).fill('25.00');
    await rust.getByLabel('Ticket type 2 quantity', { exact: true }).fill('10');
    await rust.getByLabel('Tickets per customer', { exact: true }).fill('4');
    await rust
      .getByLabel('Add images', { exact: true })
      .setInputFiles([
        await picture(rust, 'image/png', 'cover.png'),
        await picture(rust, 'image/jpeg', 'second.jpg'),
      ]);
    await expect(rust.getByRole('button', { name: 'Remove image 2' })).toBeVisible();
    await rust.getByRole('button', { name: 'Schedule event' }).click();
    await expect(rust.getByRole('heading', { level: 1, name: gaName })).toBeVisible();
  });

  await test.step('React reads every value the same, the pictures in order', async () => {
    const ga = await find(gaName);
    expect(ga).toMatchObject({ maxTicketsPerCustomer: 4, reservedSeating: false });
    expect(ga.images?.map((i) => i.contentType)).toEqual(['image/png', 'image/jpeg']);
    await signIn(react, 'admin', username, `/events/${ga.id}`);
    await expectSamePage(rust, react);
    await rust.goto(`${RUST.url}/events/${ga.id}/edit`);
    await react.goto(`${APPS.admin.url}/events/${ga.id}/edit`);
    await expect(react.getByLabel('Tickets per customer', { exact: true })).toHaveValue('4');
    await expect(react.getByRole('button', { name: 'Remove image 2' })).toBeVisible();
    await expectSamePage(rust, react);
  });

  await test.step('an overlapping event: the clash beside the times, every value kept', async () => {
    await rust.goto(`${RUST.url}/events/new`);
    const clash = uniqueName(testInfo, 'rust clash');
    await rust.getByLabel('Event name', { exact: true }).fill(clash);
    await rust
      .getByLabel('Venue', { exact: true })
      .selectOption({ label: `${venueName} (30 seats)` });
    await fillEventDateTime(rust, 'Starts', `${day}T20:00`);
    await fillEventDateTime(rust, 'Ends', `${day}T23:00`);
    await chooseGeneralAdmission(rust);
    await rust.getByLabel('Ticket type 1 name', { exact: true }).fill('Floor');
    await rust.getByLabel('Ticket type 1 price', { exact: true }).fill('40.00');
    await rust.getByLabel('Ticket type 1 quantity', { exact: true }).fill('20');
    await rust.getByRole('button', { name: 'Schedule event' }).click();
    await expect(rust.getByTestId('conflict-detail')).toContainText(`Conflicts with ${gaName}`);
    await expect(rust.getByLabel('Event name', { exact: true })).toHaveValue(clash);
    await expect(rust.getByLabel('Ticket type 1 quantity', { exact: true })).toHaveValue('20');
    expect(
      await admin.api.call<Event[]>('GET', `/events?q=${encodeURIComponent(clash)}`),
    ).toHaveLength(0);
  });

  await test.step('on the layout: a price per level, a row and two seats off sale', async () => {
    await rust.goto(`${RUST.url}/events/new`);
    await rust.getByLabel('Event name', { exact: true }).fill(seatedName);
    await rust
      .getByLabel('Venue', { exact: true })
      .selectOption({ label: `${venueName} (30 seats)` });
    await fillEventDateTime(rust, 'Starts', `${nextDay}T19:00`);
    await fillEventDateTime(rust, 'Ends', `${nextDay}T22:00`);
    await rust.getByLabel('Seating', { exact: true }).selectOption({ label: 'Hall (30 seats)' });
    await rust.getByLabel('Floor price', { exact: true }).fill('50.00');
    await rust.getByLabel('Balcony price', { exact: true }).fill('30.00');
    const offSale = rust.getByRole('group', { name: 'Seats off sale' });
    await offSale.getByRole('button', { name: 'Section Front', exact: true }).click();
    await offSale.getByRole('checkbox', { name: 'Row 1 off sale' }).check();
    await offSale.getByRole('button', { name: 'Back to all sections' }).click();
    await offSale.getByRole('button', { name: 'Section Back', exact: true }).click();
    await offSale.getByRole('button', { name: 'Row 3, Seat 1', exact: true }).click();
    await offSale.getByRole('button', { name: 'Row 3, Seat 2', exact: true }).click();
    await offSale.getByRole('button', { name: 'Back to all sections' }).click();
    await expect(rust.getByTestId('seat-line')).toHaveText('23 seats on sale · 7 off sale');
    await rust.getByRole('button', { name: 'Schedule event' }).click();
    await expect(rust.getByRole('heading', { level: 1, name: seatedName })).toBeVisible();
  });

  await test.step("React's Edit event: the same layout, prices, and seats off sale", async () => {
    const seated = await find(seatedName);
    expect(seated).toMatchObject({
      reservedSeating: true,
      totalTicketCapacity: 23,
      basePrice: '30.00',
      priceMax: '50.00',
    });
    await react.goto(`${APPS.admin.url}/events/${seated.id}/edit`);
    await expect(react.getByTestId('seat-line')).toHaveText('23 seats on sale · 7 off sale');
    await expect(react.getByLabel('Floor price', { exact: true })).toHaveValue('50.00');
    await expect(react.getByLabel('Balcony price', { exact: true })).toHaveValue('30.00');
    await rust.goto(`${RUST.url}/events/${seated.id}/edit`);
    await expect(rust.getByTestId('seat-line')).toHaveText('23 seats on sale · 7 off sale');
    await expectSamePage(rust, react);
  });

  await admin.close();
  await context.close();
});

test(
  "037 S4: the Rust Admin app's event page shows live seats, sales by level, and edits tiers",
  { tag: '@customer' },
  async ({ customerApp, browser }, testInfo) => {
    test.setTimeout(120_000);
    const username = adminFor(testInfo);
    const admin = await apiFor(browser, 'admin', username);
    const gameName = uniqueName(testInfo, 'rust game');
    const { event, layout, venue } = await basketballEvent(admin.api, {
      venueName: uniqueName(testInfo, 'rust arena'),
      place: PLACES.louisville,
      event: { name: gameName, startsAt: startsInHours(24 * 8), endsAt: startsInHours(24 * 8 + 3) },
    });
    const ga = await createEvent(admin.api, venue, {
      name: uniqueName(testInfo, 'rust open day'),
      startsAt: startsInHours(24 * 15),
      endsAt: startsInHours(24 * 15 + 3),
      capacity: 100,
    });
    await addTier(admin.api, ga, { name: 'General', price: '30.00', quantity: 100 });
    await admin.close();

    const context = await browser.newContext();
    const rust = await context.newPage();
    const react = await context.newPage();
    await signIn(rust, 'admin-rust', username, `/events/${event.id}`);
    const seating = rust.getByRole('region', { name: 'Seating' });
    const map = seating.getByRole('group', { name: 'Basketball map' });
    const section = map.getByRole('button', { name: /^Section 115, / });
    await expect(seating.getByText(/^0 sold, 0 held, [\d,]+ open, [\d,]+ off sale$/)).toBeVisible();
    await section.click();
    const seatF7 = map.getByRole('button', { name: /^Row F, Seat 7, / });
    await expect(seatF7).toHaveAccessibleName('Row F, Seat 7, Courtside, $95, open');

    const customer = await apiFor(browser, customerApp, customerFor(testInfo, 11));
    const seat = await seatAt(customer.api, layout, '115', 'F', '7');
    await test.step('a hold from the Customer app shows without a reload', async () => {
      await holdSeats(customer.api, event, [seat]);
      await expect(seatF7).toHaveAccessibleName('Row F, Seat 7, Courtside, $95, held');
      await expect(seating.getByText(/^0 sold, 1 held, /)).toBeVisible();
    });
    await test.step('then the sale, in the counts, the seat, and the section', async () => {
      await buyTickets(customer.api, event, {
        quantity: 1,
        holderName: 'Jordan Lee',
        seats: [seat],
      });
      await expect(seatF7).toHaveAccessibleName('Row F, Seat 7, Courtside, $95, sold');
      await expect(seating.getByText(/^1 sold, 0 held, /)).toBeVisible();
      await rust.getByRole('button', { name: 'Back to map' }).click();
      await expect(section).toHaveAccessibleName(/, 0 held, 1 sold, 0 off sale$/);
    });
    await customer.close();

    await test.step('the Sales card shows it by level, as the React app does', async () => {
      await rust.reload();
      const sales = rust.getByRole('region', { name: 'Sales' });
      await expect(sales).toContainText('1 of');
      await expect(sales.getByRole('row', { name: /^Courtside / })).toContainText('$95.00');
      await signIn(react, 'admin', username, `/events/${event.id}`);
      await expect(react.getByRole('region', { name: 'Sales' })).toContainText('1 of');
      expect(await rust.getByRole('region', { name: 'Sales' }).ariaSnapshot()).toEqual(
        await react.getByRole('region', { name: 'Sales' }).ariaSnapshot(),
      );
    });

    await test.step("a tier's price edited in Rust shows in React", async () => {
      await rust.goto(`${RUST.url}/events/${ga.id}`);
      const tiers = rust.getByRole('region', { name: 'Ticket tiers' });
      await tiers
        .getByRole('row', { name: /^General / })
        .getByRole('button', { name: 'Edit' })
        .click();
      await tiers.getByLabel('Price for General', { exact: true }).fill('35.00');
      await tiers.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(tiers.getByRole('row', { name: /^General / })).toContainText('$35.00');
      await react.goto(`${APPS.admin.url}/events/${ga.id}`);
      await expect(
        react.getByRole('region', { name: 'Ticket tiers' }).getByRole('row', { name: /^General / }),
      ).toContainText('$35.00');
    });

    await context.close();
  },
);

/** Opens the page's Download menu and saves one format; the file's name and text. */
async function download(page: Page, menu: string, button: string) {
  const group = page.getByRole('group', { name: menu });
  if (!(await group.isVisible())) await page.locator('summary', { hasText: 'Download' }).click();
  const [file] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    group.getByRole('button', { name: button, exact: true }).click(),
  ]);
  const path = await file.path();
  return { name: file.suggestedFilename(), path };
}

/** A file name with its made-at time taken out (the two apps make theirs moments apart). */
const timeless = (name: string) => name.replace(/\d/g, '#');

/** A CSV's rows without the made-at time: its "Made at" line and the "Exported at" column. */
async function csvRows(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return (await readFile(path, 'utf8'))
    .split(/\r?\n/)
    .filter((line) => !/^"?Made at/.test(line))
    .map((line) => line.replace(/,\d{4}-\d\d-\d\dT[^,]*$/, ''))
    .join('\n');
}

test('037 S5: attendees, reports, and every download in the Rust Admin app', async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const username = adminFor(testInfo);
  const admin = await apiFor(browser, 'admin', username);
  const venue = await createVenue(admin.api, PLACES.louisville, uniqueName(testInfo, 'rust club'));
  const event = await createEvent(admin.api, venue, {
    name: uniqueName(testInfo, 'rust gala'),
    startsAt: startsInHours(24 * 20),
    endsAt: startsInHours(24 * 20 + 3),
    capacity: 50,
  });
  await admin.close();
  const customer = await apiFor(browser, 'customer', customerFor(testInfo, 12));
  await buyTickets(customer.api, event, { quantity: 2, holderName: 'Jordan Lee' });
  await buyTickets(customer.api, event, { quantity: 1, holderName: 'Sam Rivera' });
  await customer.close();

  const context = await browser.newContext({ acceptDownloads: true });
  const rust = await context.newPage();
  const react = await context.newPage();
  await signIn(rust, 'admin-rust', username, `/events/${event.id}/attendees`);
  await signIn(react, 'admin', username, `/events/${event.id}/attendees`);

  await test.step('the attendee table matches the React app', async () => {
    await expect(rust.getByRole('table')).toContainText('Sam Rivera');
    await expect(react.getByRole('table')).toContainText('Sam Rivera');
    await expectSamePage(rust, react);
  });

  await test.step('the attendee list as CSV, XLSX, and PDF, named and filled as in React', async () => {
    for (const button of ['CSV', 'Excel (XLSX)', 'PDF']) {
      const a = await download(rust, 'Download the attendee list', button);
      const b = await download(react, 'Download the attendee list', button);
      expect(timeless(a.name)).toBe(timeless(b.name));
      if (button === 'CSV') expect(await csvRows(a.path)).toBe(await csvRows(b.path));
    }
  });

  await test.step("the event's row of Reports matches the React app", async () => {
    await rust.goto(`${RUST.url}/reports`);
    await react.goto(`${APPS.admin.url}/reports`);
    const row = (page: Page) => page.getByRole('row', { name: new RegExp(`^${event.name} `) });
    await expect(row(rust)).toBeVisible();
    await expect(row(react)).toBeVisible();
    expect(await row(rust).ariaSnapshot()).toEqual(await row(react).ariaSnapshot());
  });

  await test.step('the sales report as CSV, XLSX, and PDF, named as in React', async () => {
    for (const button of ['CSV', 'Excel (XLSX)', 'PDF']) {
      const a = await download(rust, 'Download the sales report', button);
      const b = await download(react, 'Download the sales report', button);
      expect(timeless(a.name)).toBe(timeless(b.name));
    }
  });

  await test.step('a 5,000-ticket attendee PDF downloads in the Rust app', async () => {
    // The Backend's answer, made 5,000 tickets long in the browser (X5): no 5,000 real orders.
    await rust.route(`${API_BASE}/events/${event.id}/attendees*`, async (route) => {
      const real = (await (await route.fetch()).json()) as Order[];
      const one = real[0]!;
      const many = Array.from({ length: 5_000 }, (_, i) => ({
        ...one,
        id: crypto.randomUUID(),
        holderName: `Holder ${i + 1}`,
      }));
      await route.fulfill({ json: many });
    });
    await rust.goto(`${RUST.url}/events/${event.id}/attendees`);
    await expect(rust.getByRole('table')).toContainText('Holder 5000');
    const pdf = await download(rust, 'Download the attendee list', 'PDF');
    expect(pdf.name).toMatch(/\.pdf$/);
  });

  await context.close();
});

test("037 S10: a layout drawn in the Rust Admin app's editor is the same in the React Admin app's, and a stale save is refused", async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const username = adminFor(testInfo);
  const admin = await apiFor(browser, 'admin', username);
  const venue = await createVenue(admin.api, PLACES.louisville, uniqueName(testInfo, 'rust dome'));
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const rust = await context.newPage();
  const react = await context.newPage();
  let editPath = '';

  await test.step('drawn in Rust: a court, two sections, one moved and turned, a level painted', async () => {
    await signIn(rust, 'admin-rust', username, `/locations/${venue.id}`);
    await rust.getByRole('link', { name: 'New layout', exact: true }).click();
    await rust.getByLabel('Floor object').selectOption('COURT');
    await addSection(rust, { name: '101', rows: 6, seatsPerRow: '10', curve: 'Medium' });
    await addSection(rust, { name: '102', rows: 4, seatsPerRow: '8', curve: 'None' });
    await expect(sectionsPanel(rust)).toContainText('2 sections · 92 seats');
    await drag(rust, mapSection(rust, '102'), 160, 80);
    await sectionsPanel(rust).getByRole('button', { name: '101 · 60 seats' }).click();
    await drag(rust, mapOf(rust).locator('.editor-map__turn'), 60, 30);
    await expect(rust.getByLabel('Angle')).not.toHaveValue('0');
    await addLevel(rust, 'Premium', 'red');
    await paint(rust, 'Premium');
    await rust.getByRole('button', { name: 'Undo', exact: true }).click();
    await rust.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(levelsPanel(rust)).toContainText('60 seats');
    await rust.getByLabel('Layout name').fill('Dome court');
    await save(rust);
    await expect(rust).toHaveURL(/\/layouts\/[0-9a-f-]{36}\/edit$/);
    editPath = new URL(rust.url()).pathname;
  });

  await test.step("React's editor shows every section, place, angle, and level the same", async () => {
    await signIn(react, 'admin', username, editPath);
    await expect(mapSection(react, '101')).toBeVisible();
    await expect
      .poll(async () => (await mapOf(react).ariaSnapshot()) === (await mapOf(rust).ariaSnapshot()))
      .toBe(true);
    const drawing = await admin.api.call<{ sections: { name: string; angle: number }[] }>(
      'GET',
      `/layouts/${editPath.split('/')[4]}/drawing`,
    );
    expect(drawing.sections.find((s) => s.name === '101')!.angle).not.toBe(0);
    for (const page of [rust, react]) {
      await sectionsPanel(page).getByRole('button', { name: '101 · 60 seats' }).click();
    }
    expect(await react.getByLabel('Angle').inputValue()).toBe(
      await rust.getByLabel('Angle').inputValue(),
    );
    await drag(react, mapSection(react, '102'), -40, 0);
    await save(react);
  });

  await test.step('Rust, not reloaded, is refused: Save as a new layout and Reload', async () => {
    await drag(rust, mapSection(rust, '102'), 0, 40);
    await rust.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(rust.getByRole('button', { name: 'Save as a new layout' })).toBeVisible();
    await expect(rust.getByRole('button', { name: 'Reload' }).first()).toBeVisible();
  });

  await test.step('Back with unsaved changes asks first', async () => {
    let asked = '';
    rust.once('dialog', (d) => {
      asked = d.message();
      void d.dismiss();
    });
    await rust.goBack();
    await expect.poll(() => asked).toBe('Leave without saving? Your changes will be lost.');
    await expect(rust).toHaveURL(new RegExp(`${editPath}$`));
  });

  await test.step('a locked layout opens to view, and Duplicate to edit makes a copy', async () => {
    const [yum] = await admin.api.call<{ id: string }[]>('GET', '/locations?q=Yum');
    const layouts = await admin.api.call<(LayoutDetail & { locked: boolean })[]>(
      'GET',
      `/locations/${yum!.id}/layouts`,
    );
    const locked = layouts.find((l) => l.locked)!;
    rust.once('dialog', (d) => void d.accept());
    await rust.goto(`${RUST.url}/locations/${yum!.id}/layouts/${locked.id}/edit`);
    await expect(rust.getByText(/^Locked: seats are sold or held at /)).toBeVisible();
    await expect(rust.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await rust.getByRole('button', { name: 'Duplicate to edit' }).click();
    await expect(rust).not.toHaveURL(new RegExp(locked.id));
    await expect(rust.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    const copyId = /layouts\/([0-9a-f-]{36})\/edit/.exec(rust.url())![1]!;
    await admin.api.call('DELETE', `/layouts/${copyId}`);
  });

  await admin.close();
  await context.close();
});
