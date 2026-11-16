// Spec 039 quickstart S1–S3 (US1) and S5 (US2): the Admin app's layout editor. Each test makes a
// venue of its own, so no test touches the demo's layouts (spec 022 research R8). S1–S3 draw a
// layout from blank in the editor and check the Customer app's map draws it; S5 starts from a
// drawn layout saved through the API (`createLayoutDrawing`) with the same two sections, and paints
// it in the editor.
//
// Customer account: 4 (it only looks at a map; it holds no seat).
import { expect, test } from '../fixtures/customer-app';
import { adminFor, customerFor } from '../fixtures/apps';
import {
  apiFor,
  createEvent,
  createVenue,
  type LayoutDetail,
  type Location,
} from '../fixtures/api';
import { PLACES, startsInHours, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';
import {
  addLevel,
  addSection,
  drag,
  expectTotals,
  levelLine,
  levelsPanel,
  mapOf,
  mapSection,
  paint,
  save,
  sectionsPanel,
} from '../fixtures/layout-editor';
import type { components } from '../../packages/shared/src/api-schema';

type DrawingInput = components['schemas']['LayoutDrawingInput'];
type Pt = [number, number];

test(
  '039 S1/S2/S3: an admin draws a layout with a court and two generated sections, turns one, saves it, and the customer map draws it',
  { tag: ['@admin', '@customer'] },
  async ({ customerApp, adminApp, page, browser }, testInfo) => {
    const admin = await apiFor(browser, 'admin', adminFor(testInfo));
    const venue: Location = await createVenue(
      admin.api,
      PLACES.louisville,
      uniqueName(testInfo, 'Riverside Arena'),
    );

    // S1: New layout opens the editor on an empty map, one level, no floor object.
    await signIn(page, adminApp, adminFor(testInfo), `/locations/${venue.id}`);
    await page.getByRole('link', { name: 'New layout', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/locations/${venue.id}/layouts/new$`));
    await expect(page.getByLabel('Layout name')).toHaveValue('');
    await expect(levelsPanel(page).locator('.editor-levels__item')).toHaveCount(1);
    await expect(levelLine(page, 'Standard')).toBeVisible();
    await expect(page.getByLabel('Floor object')).toHaveValue('NONE');

    // The court, drawn, and resized by a corner.
    await page.getByLabel('Floor object').selectOption('COURT');
    const corner = mapOf(page).locator('.editor-map__corner').first();
    await expect(corner).toBeVisible();
    const before = await corner.boundingBox();
    await drag(page, corner, -30, -20);
    await expect.poll(async () => (await corner.boundingBox())?.x).not.toBe(before?.x);

    // 101: 12 rows of 20, letters from A, a medium curve: 240 seats, in the middle, selected.
    await addSection(page, { name: '101', rows: 12, seatsPerRow: '20', curve: 'Medium' });
    await expect(sectionsPanel(page)).toContainText('1 section · 240 seats');
    await expect(mapSection(page, '101')).toHaveAccessibleName('Section 101, Standard, 240 seats');

    // S2: dragged beside the court, then turned with the round handle; the angle follows.
    await drag(page, mapSection(page, '101'), -160, 0);
    const angle = page.getByLabel('Angle');
    await expect(angle).toHaveValue('0');
    await drag(page, mapOf(page).locator('.editor-map__turn'), 60, 30);
    await expect(angle).not.toHaveValue('0');

    // 102: rows of 16, 16, 18, 18, 20 and 20, straight, at the corner.
    await addSection(page, {
      name: '102',
      rows: 6,
      seatsPerRow: '16, 16, 18, 18, 20, 20',
      curve: 'None',
    });
    await expect(sectionsPanel(page)).toContainText('2 sections · 348 seats');
    await drag(page, mapSection(page, '102'), 160, 80);

    // S3: named and saved; the editor moves to the layout's own edit page.
    await page.getByLabel('Layout name').fill('Basketball');
    await save(page);
    await expect(page).toHaveURL(new RegExp(`/locations/${venue.id}/layouts/[0-9a-f-]{36}/edit$`));
    const layoutId = /layouts\/([0-9a-f-]{36})\/edit/.exec(page.url())![1];

    await page.getByRole('link', { name: 'Back to the venue' }).click();
    const card = page.getByRole('region', { name: 'Layouts' });
    await expect(card).toContainText('348 seats · 2 sections · 1 price level · used by 0 events');
    await expect(card.getByRole('img', { name: 'Basketball: 2 sections' })).toBeVisible();

    // An event on it, priced; the Customer app's map draws both sections with their seats.
    const layout = await admin.api.call<LayoutDetail>('GET', `/layouts/${layoutId}`);
    const event = await createEvent(admin.api, venue, {
      name: uniqueName(testInfo, 'Opening Night'),
      startsAt: startsInHours(48),
      endsAt: startsInHours(51),
      seating: { layout, prices: { Standard: '40.00' } },
    });
    await admin.close();

    await signIn(page, customerApp, customerFor(testInfo, 4), `/events/${event.id}`);
    const tickets = page.getByRole('region', { name: 'Get tickets' });
    await tickets.getByRole('button', { name: 'Choose seats' }).click();
    const map = tickets.getByRole('group', { name: 'Basketball map' });
    await expect(map).toBeVisible();
    await expect(map.getByRole('button', { name: /^Section 101, / })).toHaveAccessibleName(
      'Section 101, 240 open seats from $40',
    );
    await expect(map.getByRole('button', { name: /^Section 102, / })).toHaveAccessibleName(
      'Section 102, 108 open seats from $40',
    );
  },
);

/**
 * S1–S3's two sections, straight and apart, as a drawing for `createLayoutDrawing`: 101 of 12 rows
 * A–L × 20 and 102 of rows A–F with 16, 16, 18, 18, 20, 20 seats, both Standard.
 */
function basketball(): DrawingInput {
  const block = (x0: number, y0: number, counts: number[]) =>
    counts.map((n, k) => ({
      label: 'ABCDEFGHIJKL'[k],
      seats: Array.from({ length: n }, (_, i) => ({
        label: String(i + 1),
        at: [x0 + 2 * (i - (n - 1) / 2), y0 - 2 * k] as Pt,
      })),
    }));
  return {
    name: 'Basketball',
    floor: {
      kind: 'COURT',
      outline: [
        [90, 80],
        [150, 80],
        [150, 120],
        [90, 120],
      ],
    },
    levels: [{ key: 'standard', name: 'Standard', color: 'violet' }],
    sections: [
      {
        name: '101',
        level: 'standard',
        origin: [60, 70],
        angle: 0,
        rows: block(60, 70, Array(12).fill(20)),
      },
      {
        name: '102',
        level: 'standard',
        origin: [190, 70],
        angle: 0,
        rows: block(190, 70, [16, 16, 18, 18, 20, 20]),
      },
    ],
  };
}

test(
  '039 S5: an admin adds three levels, paints a section, rows A–D and two seats, deletes Standard, and the levels are kept on reopening',
  { tag: '@admin' },
  async ({ adminApp, page, browser }, testInfo) => {
    const admin = await apiFor(browser, 'admin', adminFor(testInfo));
    const venue: Location = await createVenue(
      admin.api,
      PLACES.louisville,
      uniqueName(testInfo, 'Riverside Arena'),
    );
    const layout = await admin.api.call<LayoutDetail>(
      'POST',
      `/locations/${venue.id}/layouts/drawing`,
      basketball(),
    );
    await admin.close();

    await signIn(page, adminApp, adminFor(testInfo), `/locations/${venue.id}`);
    await page.getByRole('link', { name: 'Edit Basketball' }).click();
    await expect(page).toHaveURL(new RegExp(`/layouts/${layout.id}/edit$`));
    await expect(mapSection(page, '101')).toBeVisible();

    // Three levels, Courtside moved to the top.
    await addLevel(page, 'Courtside', 'red');
    await addLevel(page, 'Lower sideline', 'blue');
    await addLevel(page, 'Upper', 'teal');
    await levelsPanel(page).getByRole('button', { name: 'Move Courtside up' }).click();
    await expect(levelsPanel(page).locator('.editor-levels__name')).toHaveText([
      'Courtside',
      'Standard',
      'Lower sideline',
      'Upper',
    ]);

    // 101, chosen in the Sections list, painted Lower sideline.
    await sectionsPanel(page).getByRole('button', { name: '101 · 240 seats' }).click();
    await paint(page, 'Lower sideline');
    await expectTotals(page, { 'Lower sideline': 240, Standard: 108 });

    // Zoomed into 101: rows A to D by their labels, Courtside.
    await mapSection(page, '101').dblclick();
    await expect(page.getByRole('button', { name: 'Back to layout' })).toBeVisible();
    await mapOf(page).getByRole('button', { name: 'Row A', exact: true }).click();
    await mapOf(page)
      .getByRole('button', { name: 'Row D', exact: true })
      .click({ modifiers: ['Shift'] });
    await paint(page, 'Courtside');

    // Two seats of row K, by a box drawn around them, Upper.
    const k1 = mapOf(page).getByRole('button', { name: /^Row K, Seat 1, / });
    const k2 = mapOf(page).getByRole('button', { name: /^Row K, Seat 2, / });
    const a = (await k1.boundingBox())!;
    const b = (await k2.boundingBox())!;
    const pad = Math.min(a.width, a.height) * 0.3;
    await page.getByRole('button', { name: 'Box select' }).click();
    await page.mouse.move(Math.min(a.x, b.x) - pad, Math.min(a.y, b.y) - pad);
    await page.mouse.down();
    await page.mouse.move(
      Math.max(a.x + a.width, b.x + b.width) + pad,
      Math.max(a.y + a.height, b.y + b.height) + pad,
      { steps: 10 },
    );
    await page.mouse.up();
    await expect(k1).toHaveAttribute('aria-pressed', 'true');
    await expect(k2).toHaveAttribute('aria-pressed', 'true');
    await paint(page, 'Upper');
    await expectTotals(page, { Courtside: 80, 'Lower sideline': 158, Upper: 2, Standard: 108 });
    await page.getByRole('button', { name: 'Back to layout' }).click();

    // Standard goes; its seats take Lower sideline.
    await levelsPanel(page).getByRole('button', { name: 'Delete Standard' }).click();
    const deleting = levelsPanel(page).getByRole('group', { name: 'Delete Standard' });
    await deleting.getByRole('combobox').selectOption({ label: 'Lower sideline' });
    await deleting.getByRole('button', { name: 'Delete level' }).click();
    await expectTotals(page, { Courtside: 80, 'Lower sideline': 266, Upper: 2 });
    await expect(levelLine(page, 'Standard')).toHaveCount(0);

    await save(page);

    // Reopened, every seat's level is as painted.
    await page.reload();
    await expect(mapSection(page, '101')).toBeVisible();
    await expect(levelsPanel(page).locator('.editor-levels__name')).toHaveText([
      'Courtside',
      'Lower sideline',
      'Upper',
    ]);
    await expectTotals(page, { Courtside: 80, 'Lower sideline': 266, Upper: 2 });
  },
);
