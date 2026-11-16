// Spec 040 (T061; parity S11, FR-020): the Rust Customer app lays out every page as the React
// Customer app does. Spec 037 research R15's method: every route of parity S11, with the same data
// in both apps, at 1280 px and at 375 px wide; per page, `main`'s accessibility snapshot (headings,
// landmarks, labels, buttons, table columns, in order) with the app's name normalized, and the
// boxes of each page title, card, form section, list, table, and banner, top to bottom, within
// 2 px. Colors are not compared. It drives both Customer apps, so it is untagged and runs in the
// default project only.
import { expect, request, test, type Locator, type Page } from '@playwright/test';
import {
  addTier,
  apiFor,
  buyTickets,
  createEvent,
  createVenue,
  holdSeats,
  seatAt,
  seatedEvent,
  type Event,
} from '../fixtures/api';
import { API_BASE, APPS, adminFor, customerFor } from '../fixtures/apps';
import { PLACES, startsInHours, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';

const REACT = APPS.customer;
const RUST = APPS['customer-rust'];

/** What may differ between the two loads without the layout differing. */
function normalized(snapshot: string, route: string): string {
  let out = snapshot
    .replaceAll(RUST.name, REACT.name)
    // A select's options list every venue on the stack, which tests running beside this add to.
    .replace(/^\s*- option .*$\n?/gm, '');
  // The hold countdown and the live entry code tick between the two reads.
  if (route === '/cart' || /^\/events\//.test(route)) out = out.replace(/\b\d+:\d\d\b/g, '#:##');
  if (route.endsWith('/entry-code')) out = out.replace(/\d/g, '#');
  return out;
}

const BOX_SELECTOR = [
  'main .page-title',
  'main .page-band',
  'main .card',
  'main fieldset',
  'main table',
  'main .card-grid',
  'main .empty',
  'main .banner',
  'main .venue-map',
].join(', ');

type Box = { sel: string; x: number; y: number; w: number; h: number };

const sameBoxes = (a: Box[], b: Box[]): boolean =>
  a.length === b.length &&
  a.every(
    (box, i) =>
      box.sel === b[i]!.sel &&
      (['x', 'y', 'w', 'h'] as const).every((k) => Math.abs(b[i]![k] - box[k]) <= 2),
  );

async function boxesOf(page: Page): Promise<Box[]> {
  return page.locator(BOX_SELECTOR).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      const sel = `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`;
      return { sel, x: r.x, y: r.y + window.scrollY, w: r.width, h: r.height };
    }),
  );
}

/**
 * `main`'s elements, one a line: tag, classes, role, name, type, and link, indented by depth. A
 * select's options are left out (every venue on the stack), and ids too (React's `useId`).
 */
async function domOf(page: Page): Promise<string> {
  return page.locator('main').evaluate((main) => {
    const out: string[] = [];
    const walk = (el: Element, depth: number) => {
      if (el.tagName === 'OPTION') return;
      const attrs = ['role', 'aria-label', 'type', 'href']
        .map((a) => (el.hasAttribute(a) ? ` ${a}=${el.getAttribute(a)}` : ''))
        .join('');
      out.push(
        `${'  '.repeat(depth)}${el.tagName.toLowerCase()}${[...el.classList].map((c) => `.${c}`).join('')}${attrs}`,
      );
      for (const child of el.children) walk(child, depth + 1);
    };
    walk(main, 0);
    return out.join('\n');
  });
}

/** `main`, ready: no loading text left. */
async function settled(page: Page): Promise<Locator> {
  const main = page.locator('main');
  await expect(main).toBeVisible();
  await expect(main.getByText(/^(Loading|Getting your entry code)/)).toHaveCount(0, {
    timeout: 15_000,
  });
  return main;
}

/**
 * Opens `route` in the signed-in app, in the app (a history entry and `popstate`, as a link does):
 * under Vite dev (React StrictMode) a deep `goto` in a signed-in React page now and then lands on
 * `/` (the dev-only double sign-in run).
 */
async function open(page: Page, base: string, route: string): Promise<void> {
  const want = new URL(`${base}${route}`);
  await page.evaluate((url) => {
    history.pushState({}, '', url);
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }, want.href);
  await expect(page).toHaveURL(want.href);
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
}

/** The same page in both apps: the same snapshot, and the same boxes within 2 px. */
async function expectSameLayout(react: Page, rust: Page, route: string): Promise<void> {
  const [reactMain, rustMain] = [await settled(react), await settled(rust)];
  const path = route.split('?')[0]!;
  // Cards that load after the page (Get tickets, the seat map) are waited for in both. Venues
  // lists every venue, which tests running beside this one add to: both are reloaded until
  // they list the same venues.
  await expect
    .poll(
      async () => {
        const same =
          normalized(await rustMain.ariaSnapshot(), path) ===
          normalized(await reactMain.ariaSnapshot(), path);
        if (!same && path === '/venues') {
          await Promise.all([react.reload(), rust.reload()]);
          await Promise.all([settled(react), settled(rust)]);
        }
        return same;
      },
      { timeout: 30_000 },
    )
    .toBe(true)
    .catch(() => undefined);
  expect(normalized(await rustMain.ariaSnapshot(), path)).toEqual(
    normalized(await reactMain.ariaSnapshot(), path),
  );
  // The same elements and classes, in order.
  expect(normalized(await domOf(rust), path)).toEqual(normalized(await domOf(react), path));
  // The boxes settle once pictures know their shapes.
  await expect
    .poll(async () => sameBoxes(await boxesOf(react), await boxesOf(rust)), { timeout: 10_000 })
    .toBe(true)
    .catch(() => undefined);
  const [a, b] = [await boxesOf(react), await boxesOf(rust)];
  expect(
    b.map((x) => x.sel),
    'the same cards, sections, lists, and tables, in order',
  ).toEqual(a.map((x) => x.sel));
  for (const [i, box] of a.entries()) {
    for (const k of ['x', 'y', 'w', 'h'] as const) {
      expect(Math.abs(b[i]![k] - box[k]), `box ${i} (${box.sel}) ${k}`).toBeLessThanOrEqual(2);
    }
  }
}

/** A small picture drawn in the browser, as a file for the images endpoint. */
async function picture(page: Page, width: number, height: number, color: string) {
  const b64 = await page.evaluate(
    ([w, h, c]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w as number;
      canvas.height = h as number;
      const g = canvas.getContext('2d')!;
      g.fillStyle = c as string;
      g.fillRect(0, 0, w as number, h as number);
      return canvas.toDataURL('image/png').split(',')[1]!;
    },
    [width, height, color],
  );
  return { name: 'picture.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

/** Adds pictures to an event as the signed-in admin of `page` (multipart, spec 014). */
async function addImages(page: Page, event: Event, colors: string[]): Promise<void> {
  const authorized = page.waitForRequest(
    (req) => req.url().startsWith(`${API_BASE}/`) && !!req.headers()['authorization'],
  );
  await page.reload();
  const authorization = (await authorized).headers()['authorization']!;
  const ctx = await request.newContext({ baseURL: API_BASE, extraHTTPHeaders: { authorization } });
  for (const color of colors) {
    const res = await ctx.post(`/events/${event.id}/images`, {
      multipart: { file: await picture(page, 640, 360, color) },
    });
    expect(res.status(), await res.text()).toBe(201);
  }
  await ctx.dispose();
}

test('040 S11: every page has the same structure and arrangement in both Customer apps, at desktop and phone width', async ({
  browser,
}, testInfo) => {
  test.setTimeout(420_000);
  const name = uniqueName(testInfo, 'same layout');

  // Set-up: a seated event with seats held by the customer, held by another, and sold; a general
  // admission event with two pictures, a doors-open time, and an order of two tickets; an event
  // with tiers; a cancelled event the customer had a ticket to; a venue with nothing scheduled.
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const seated = await seatedEvent(admin.api, {
    venueName: `${name} hall`,
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
      name: `${name} game`,
      startsAt: startsInHours(24 * 6),
      endsAt: startsInHours(24 * 6 + 3),
    },
    prices: { Standard: '25.00', Premium: '40.00' },
  });
  const gaVenue = await createVenue(admin.api, PLACES.chicago, `${name} club`);
  const ga = await createEvent(admin.api, gaVenue, {
    name: `${name} concert`,
    startsAt: startsInHours(24 * 9),
    endsAt: startsInHours(24 * 9 + 3),
    doorsOpenAt: startsInHours(24 * 9 - 1),
    capacity: 100,
  });
  await addImages(admin.page, ga, ['#b4372b', '#2b6cb4']);
  const tiered = await createEvent(admin.api, gaVenue, {
    name: `${name} gala`,
    startsAt: startsInHours(24 * 10),
    endsAt: startsInHours(24 * 10 + 3),
    capacity: 50,
  });
  await addTier(admin.api, tiered, { name: 'Floor', price: '80.00', quantity: 20 });
  await addTier(admin.api, tiered, { name: 'Balcony', price: '30.00', quantity: 30 });
  const cancelled = await createEvent(admin.api, gaVenue, {
    name: `${name} cancelled show`,
    startsAt: startsInHours(24 * 11),
    endsAt: startsInHours(24 * 11 + 3),
    capacity: 50,
  });
  const empty = await createVenue(admin.api, PLACES.chicago, `${name} empty room`);

  // Index 15: 026's repeats use 11 + the repeat index (one run: 11); 16 holds a seat for "held".
  const username = customerFor(testInfo, 15);
  const other = await apiFor(browser, 'customer', customerFor(testInfo, 16));
  await holdSeats(other.api, seated.event, [await seatAt(other.api, seated.layout, 'A', '1', '7')]);
  const customer = await apiFor(browser, 'customer', username);
  const order = await buyTickets(customer.api, ga, { quantity: 2, holderName: 'Jordan Lee' });
  // A seated order is bought from a hold (spec 033).
  const sold = await seatAt(customer.api, seated.layout, 'A', '2', '1');
  await holdSeats(customer.api, seated.event, [sold]);
  await buyTickets(customer.api, seated.event, {
    quantity: 1,
    holderName: 'Jordan Lee',
    seats: [sold],
  });
  await holdSeats(customer.api, seated.event, [
    await seatAt(customer.api, seated.layout, 'A', '1', '4'),
  ]);
  await buyTickets(customer.api, cancelled, { quantity: 1, holderName: 'Jordan Lee' });
  await admin.api.call('POST', `/events/${cancelled.id}/cancel`);
  await admin.close();
  const ticketId = order.tickets[0]!.id;

  const q = encodeURIComponent(name);
  const routes = [
    `/?q=${q}`,
    `/events?q=${q}`,
    `/events?q=${q}%20nothing`,
    '/venues',
    `/venues/${seated.venue.id}`,
    `/venues/${gaVenue.id}`,
    `/venues/${empty.id}`,
    `/events/${seated.event.id}`,
    `/events/${ga.id}`,
    `/events/${tiered.id}`,
    `/events/${cancelled.id}`,
    '/my-tickets',
    '/cart',
    `/my-tickets/${ticketId}/print`,
    `/my-tickets/${ticketId}/entry-code`,
    '/no-such-page',
  ];

  try {
    for (const width of [1280, 375]) {
      // Reduced motion stops the galleries' rotation, so both show the same picture.
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      });
      const react = await context.newPage();
      const rust = await context.newPage();
      await signIn(react, 'customer', username);
      // One Keycloak session: the Rust app signs in without the form (research R3).
      await rust.goto(RUST.url);
      await expect(rust.getByRole('button', { name: 'Log out' })).toBeVisible();
      for (const route of routes) {
        await test.step(`${route} at ${width} px`, async () => {
          await open(react, REACT.url, route);
          await open(rust, RUST.url, route);
          await expectSameLayout(react, rust, route);
        });
      }
      await test.step(`the seated map, the held seat's section open, at ${width} px`, async () => {
        const route = `/events/${seated.event.id}`;
        await open(react, REACT.url, route);
        await open(rust, RUST.url, route);
        for (const page of [react, rust]) {
          const tickets = page.getByRole('region', { name: 'Get tickets' });
          const choose = tickets.getByRole('button', { name: 'Choose seats' });
          const map = tickets.getByRole('group', { name: 'Main floor map' });
          await expect(choose.or(map)).toBeVisible();
          if (await choose.isVisible()) await choose.click();
          await map.getByRole('button', { name: /^Section A, / }).click();
          await expect(map.getByRole('button', { name: /^Row 1, Seat 4, / })).toHaveAccessibleName(
            'Row 1, Seat 4, Standard, $25, held by you',
          );
        }
        await expectSameLayout(react, rust, route);
        // A seat held now, in one app: both mark it the customer's (the stream), the same way.
        const seat = (page: Page, n: number) =>
          page
            .getByRole('region', { name: 'Get tickets' })
            .getByRole('group', { name: 'Main floor map' })
            .getByRole('button', { name: new RegExp(`^Row 1, Seat ${n}, `) });
        const n = width === 1280 ? 9 : 10;
        await seat(width === 1280 ? rust : react, n).click();
        for (const page of [react, rust]) {
          await expect(seat(page, n)).toHaveAccessibleName(
            `Row 1, Seat ${n}, Standard, $25, held by you`,
          );
        }
        await expectSameLayout(react, rust, route);
        // For a look by eye: the marks are the same apart from colour (attached to the report).
        for (const [app, page] of [
          ['React', react],
          ['Rust', rust],
        ] as const) {
          await testInfo.attach(`the seat map in the ${app} app at ${width} px`, {
            body: await page.screenshot({ fullPage: true }),
            contentType: 'image/png',
          });
        }
      });
      await context.close();
    }
  } finally {
    await customer.api.call('POST', '/me/reservations/release');
    await other.api.call('POST', '/me/reservations/release');
    await customer.close();
    await other.close();
  }
});
