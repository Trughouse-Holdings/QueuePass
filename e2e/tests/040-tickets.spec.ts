// Spec 040 (quickstart S6; research R9, R13; FR-015, SC-007; parity T1–T12): My tickets, the live
// entry code, the printed ticket, and the calendar file in both Customer apps, side by side. The
// test drives both apps, so it is untagged and runs in the default project only (R13); the shared
// `@customer` journeys (019 S2 and the rest) run against the Rust app in the `customer-rust` one.
// The Ticket Booth scan of a live code stays by hand (the gate's typed-code path is 017 S3).
import { readFile } from 'node:fs/promises';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { addTier, apiFor, buyTickets, createEvent, createVenue } from '../fixtures/api';
import { APPS, adminFor, customerFor, type AppName } from '../fixtures/apps';
import { PLACES, startsInHours, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';

const BOTH = ['customer', 'customer-rust'] as const satisfies readonly AppName[];
type CustomerApp = (typeof BOTH)[number];

/** One signed-in window per Customer app, for the same customer. */
async function windows(browser: Browser, username: string): Promise<Record<CustomerApp, Page>> {
  const pages = {} as Record<CustomerApp, Page>;
  for (const app of BOTH) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, app, username);
    pages[app] = page;
  }
  return pages;
}

/** The order card of `eventName` on My tickets. */
const cardOf = (page: Page, eventName: string) =>
  page.getByRole('article').filter({ has: page.getByRole('heading', { name: eventName }) });

/** Every order card's text, top to bottom, with the Past heading where it falls. */
async function myTicketsOutline(page: Page): Promise<string[]> {
  await page.goto(`${new URL(page.url()).origin}/my-tickets`);
  await expect(page.getByRole('heading', { level: 1, name: 'My tickets' })).toBeVisible();
  await expect(page.getByRole('article').first()).toBeVisible();
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('#past-orders, article.order-card')).map((el) =>
      (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
    ),
  );
}

/** A QR's drawing: its view box and the one path of dark modules. */
async function qrOf(page: Page, name: string): Promise<{ viewBox: string; d: string }> {
  const svg = page.getByRole('img', { name });
  await expect(svg).toBeVisible();
  return {
    viewBox: (await svg.getAttribute('viewBox')) ?? '',
    d: (await svg.locator('path.ticket-qr__dark').getAttribute('d')) ?? '',
  };
}

test('040 S6: the entry code, the printed ticket, and the calendar file are the same in both Customer apps', async ({
  browser,
}) => {
  const testInfo = test.info();
  test.setTimeout(180_000);
  // Index 14: no other journey uses it, so this test's order is the only one it sees for its event.
  const username = customerFor(testInfo, 14);
  const eventName = uniqueName(testInfo, 'Same Ticket, Both Apps; Live');

  let ticketId = '';
  let ticketCode = '';
  await test.step('set-up: one order, placed through the API', async () => {
    const admin = await apiFor(browser, 'admin', adminFor(testInfo));
    const venue = await createVenue(admin.api, PLACES.louisville, uniqueName(testInfo, 'venue'));
    const event = await createEvent(admin.api, venue, {
      name: eventName,
      startsAt: startsInHours(24 * 3),
      endsAt: startsInHours(24 * 3 + 3),
      capacity: 20,
    });
    const tier = await addTier(admin.api, event, { name: 'General', price: '15.00', quantity: 20 });
    await admin.close();
    const customer = await apiFor(browser, 'customer', username);
    const order = await buyTickets(customer.api, event, {
      quantity: 2,
      tierId: tier.id,
      holderName: 'Jordan Lee',
    });
    await customer.close();
    ticketId = order.tickets[0].id;
    ticketCode = order.tickets[0].code;
  });

  const pages = await windows(browser, username);

  await test.step('My tickets: the same orders, in the same order, with the same texts', async () => {
    const react = await myTicketsOutline(pages.customer);
    const rust = await myTicketsOutline(pages['customer-rust']);
    expect(rust).toEqual(react);
    expect(react.some((card) => card.includes(eventName))).toBe(true);
    for (const app of BOTH) {
      const card = cardOf(pages[app], eventName);
      await expect(
        card.getByRole('link', { name: `Show entry code for ticket ${ticketCode}` }),
      ).toHaveAttribute('href', `/my-tickets/${ticketId}/entry-code`);
      await expect(card.getByRole('link', { name: `Print ticket ${ticketCode}` })).toHaveAttribute(
        'href',
        `/my-tickets/${ticketId}/print`,
      );
    }
  });

  await test.step('the calendar file and the Google link are the same, apart from DTSTAMP', async () => {
    const files: Record<CustomerApp, { name: string; text: string; google: string }> = {} as never;
    for (const app of BOTH) {
      const page = pages[app];
      const group = cardOf(page, eventName).getByRole('group', { name: 'Add to calendar' });
      await expect(group).toBeVisible();
      const download = page.waitForEvent('download');
      await group.getByRole('button', { name: /^Add to Apple Calendar or Outlook/ }).click();
      const file = await download;
      files[app] = {
        name: file.suggestedFilename(),
        text: await readFile((await file.path())!, 'utf8'),
        google:
          (await group
            .getByRole('link', { name: /^Add to Google Calendar/ })
            .getAttribute('href')) ?? '',
      };
    }
    const withoutStamp = (text: string) => text.replace(/^DTSTAMP:.*\r\n/m, '');
    expect(files['customer-rust'].name).toBe(files.customer.name);
    expect(withoutStamp(files['customer-rust'].text)).toBe(withoutStamp(files.customer.text));
    expect(files.customer.text).toMatch(/^DTSTAMP:\d{8}T\d{6}Z\r$/m);
    expect(files['customer-rust'].text).toMatch(/^DTSTAMP:\d{8}T\d{6}Z\r$/m);
    expect(files['customer-rust'].google).toBe(files.customer.google);
  });

  await test.step('the printed ticket: the same QR, code, and facts', async () => {
    const printed = {} as Record<CustomerApp, { qr: { viewBox: string; d: string }; text: string }>;
    for (const app of BOTH) {
      const page = pages[app];
      await page.goto(`${APPS[app].url}/my-tickets/${ticketId}/print`);
      await expect(page.getByRole('heading', { level: 1, name: eventName })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
      printed[app] = {
        qr: await qrOf(page, `QR code for ticket ${ticketCode}`),
        text: ((await page.locator('.print-ticket__page').textContent()) ?? '')
          .replace(/\s+/g, ' ')
          .trim(),
      };
    }
    expect(printed['customer-rust']).toEqual(printed.customer);
    expect(printed.customer.qr.viewBox).toBe('0 0 29 29');
    expect(printed.customer.text).toContain(ticketCode);
  });

  await test.step('the live entry code: the same QR at the same time, and a countdown', async () => {
    const LIVE = 'Live entry code, changes every 30 seconds';
    for (const app of BOTH) {
      await pages[app].goto(`${APPS[app].url}/my-tickets/${ticketId}/entry-code`);
      await expect(pages[app].getByRole('heading', { level: 1, name: eventName })).toBeVisible();
      await expect(pages[app].getByText(/^Changes in \d{1,2} s$/)).toBeVisible();
    }
    // Both follow the Backend's clock: read both within one 30-second window (a read across a
    // window's end is read again).
    await expect
      .poll(
        async () => {
          const react = await qrOf(pages.customer, LIVE);
          const rust = await qrOf(pages['customer-rust'], LIVE);
          return rust.d !== '' && rust.d === react.d && rust.viewBox === react.viewBox;
        },
        { timeout: 35_000 },
      )
      .toBe(true);
    const live = await qrOf(pages['customer-rust'], LIVE);
    // A 62-character live code is version 4: 33 modules and the 4-module quiet zone.
    expect(live.viewBox).toBe('0 0 41 41');
    const facts = async (page: Page) =>
      ((await page.locator('.entry-code__card dl').textContent()) ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    expect(await facts(pages['customer-rust'])).toBe(await facts(pages.customer));
  });

  for (const app of BOTH) await pages[app].context().close();
});
