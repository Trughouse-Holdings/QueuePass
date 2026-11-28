// Spec 041 quickstart S0, S1, S8: Seasons in the Admin apps. Tagged `@admin`, so each runs against
// the React Admin app and, in the `admin-rust` project, the Rust Admin app (FR-022). S0 reads the
// demo state the harness loaded with the reset (spec 029 research R13) and changes nothing; S1 and
// S8 make a venue of their own with a small layout and events through the API (spec 022 research
// R8), so no test touches the demo's events or another test's.
import { expect, test } from '../fixtures/admin-app';
import { type Page } from '@playwright/test';
import { adminFor } from '../fixtures/apps';
import {
  apiFor,
  createEvent,
  createLayout,
  createVenue,
  seasonOnSale,
  type Event,
  type LayoutDetail,
  type Location,
} from '../fixtures/api';
import { PLACES, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';
import { atLocal, localDate } from '../fixtures/time';

const EASTERN = 'America/New_York';
const DEMO_SEASON = 'Louisville Cardinals Basketball 2026–27';
const DEMO_GAMES = [
  'Cardinals Men vs. Miami',
  'Cardinals Men vs. Virginia',
  'Cardinals Men vs. Syracuse',
];

/** 7:00 PM at the venue, `days` from today there; three hours long. */
const gameAt = (days: number) => {
  const startsAt = atLocal(`${localDate(EASTERN, days)}T19:00`, EASTERN);
  return { startsAt, endsAt: new Date(startsAt.getTime() + 3 * 3_600_000) };
};

/** A venue of the test's own with a two-level layout and two games on it, 10 and 17 days out. */
async function twoGames(
  browser: Parameters<typeof apiFor>[0],
  testInfo: Parameters<typeof uniqueName>[0],
  what: string,
  season?: { name: string },
): Promise<{ venue: Location; layout: LayoutDetail; games: Event[]; name: string }> {
  const name = uniqueName(testInfo, what);
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const venue = await createVenue(admin.api, PLACES.louisville, `${name} arena`);
  const layout = await createLayout(admin.api, venue, {
    name: `${name} plan`,
    levels: [
      { name: 'Lower', color: 'blue' },
      { name: 'Upper', color: 'green' },
    ],
    sections: [
      { name: '101', rows: 2, seatsPerRow: 4, level: 'Lower' },
      { name: '201', rows: 2, seatsPerRow: 4, level: 'Upper' },
    ],
  });
  const games: Event[] = [];
  for (const [i, days] of [10, 17].entries()) {
    games.push(
      await createEvent(admin.api, venue, {
        name: `${name} game ${i + 1}`,
        ...gameAt(days),
        seating: { layout, prices: { Lower: '40.00', Upper: '20.00' } },
      }),
    );
  }
  if (season) {
    await seasonOnSale(admin.api, venue, {
      name: season.name,
      layout,
      events: games,
      prices: { Lower: '75.00', Upper: '35.00' },
      salesEndAt: new Date(games[0]!.startsAt),
    });
  }
  await admin.close();
  return { venue, layout, games, name };
}

/** A row of the Seasons list by the Season's name. */
const seasonRow = (page: Page, name: string) =>
  page.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) });

test(
  '041 S0: after the reset, the Basketball Season is on sale with its three games and a price for every level',
  { tag: '@admin' },
  async ({ adminApp, page }, testInfo) => {
    await signIn(page, adminApp, adminFor(testInfo), '/seasons');
    await expect(page.getByRole('heading', { level: 1, name: 'Seasons' })).toBeVisible();
    const row = seasonRow(page, DEMO_SEASON);
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('cell').nth(1)).toHaveText('KFC Yum! Center');
    await expect(row.getByRole('cell').nth(2)).toHaveText('Basketball · Louisville Cardinals');
    await expect(row.getByRole('cell').nth(3)).toHaveText('3');
    // Single tickets go on sale 3 days after the reset (research R13).
    await expect(row.getByRole('cell').nth(4)).toHaveText(/^Presale until /);

    await row.getByRole('link', { name: DEMO_SEASON, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: DEMO_SEASON })).toBeVisible();
    const events = page.getByRole('group', { name: 'Events' });
    for (const game of DEMO_GAMES) {
      await expect(events.getByRole('checkbox', { name: new RegExp(`^${game} · `) })).toBeChecked();
    }
    for (const level of ['Courtside', 'Lower sideline', 'Lower end', 'Upper']) {
      await expect(page.getByLabel(`${level} pass price`, { exact: true })).toHaveValue(
        /^\d+\.\d\d$/,
      );
    }
  },
);

test(
  '041 S1: an admin creates a seated Season, prices every level and puts it on sale',
  { tag: '@admin' },
  async ({ adminApp, browser, page }, testInfo) => {
    const { venue, layout, games, name } = await twoGames(browser, testInfo, 'season s1');
    const seasonName = `${name} season`;

    await signIn(page, adminApp, adminFor(testInfo), '/seasons/new');
    await page.getByLabel('Season name', { exact: true }).fill(seasonName);
    await page.getByLabel('Venue', { exact: true }).selectOption({ label: venue.name });
    const layoutSelect = page.getByLabel('Layout', { exact: true });
    await expect(layoutSelect.getByRole('option', { name: layout.name })).toHaveCount(1);
    await layoutSelect.selectOption({ label: layout.name });
    await page.getByLabel('Sport', { exact: true }).selectOption({ label: 'Basketball' });
    await page.getByLabel('Team', { exact: true }).fill('Test Team');
    // The day before the first game, 6:00 PM at the venue.
    await page.getByLabel('Pass sales end date', { exact: true }).fill(localDate(EASTERN, 9));
    await page.getByLabel('Pass sales end time', { exact: true }).fill('18:00');

    // The picker lists exactly this venue's two games on the layout.
    const events = page.getByRole('group', { name: 'Events' });
    await expect(events.getByRole('checkbox')).toHaveCount(2);
    for (const game of games) {
      await events.getByRole('checkbox', { name: new RegExp(`^${game.name} · `) }).check();
    }
    await page.getByLabel('Lower pass price', { exact: true }).fill('75.00');
    await page.getByLabel('Upper pass price', { exact: true }).fill('35.00');
    await page.getByRole('button', { name: 'Save season' }).click();

    await expect(page.getByText('Season saved.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: seasonName })).toBeVisible();
    await expect(page.getByTestId('season-status')).toHaveText('Draft');
    await page.getByRole('button', { name: 'Put on sale' }).click();
    await expect(page.getByTestId('season-status')).toHaveText('On sale');
    await expect(page.getByText(`${seasonName} is on sale.`)).toBeVisible();

    await page.getByRole('link', { name: 'Seasons', exact: true }).click();
    await expect(seasonRow(page, seasonName).getByRole('cell').nth(4)).toHaveText('On sale');
  },
);

test(
  '041 S8: an event in a Season shows its Season and locks its layout',
  { tag: '@admin' },
  async ({ adminApp, browser, page }, testInfo) => {
    const seasonName = uniqueName(testInfo, 'season s8');
    const { games } = await twoGames(browser, testInfo, 'season s8 games', { name: seasonName });
    const game = games[0]!;

    await signIn(page, adminApp, adminFor(testInfo), `/events/${game.id}`);
    await expect(page.getByRole('heading', { level: 1, name: game.name })).toBeVisible();
    await expect(page.getByRole('link', { name: seasonName, exact: true })).toBeVisible();

    await page.goto(page.url().replace(/\/events\/.*$/, `/events/${game.id}/edit`));
    await expect(page.getByTestId('in-season')).toHaveText(`In season: ${seasonName}`);
    const reason = `In season: ${seasonName}. Its venue, layout and seating can't change.`;
    await expect(page.getByRole('combobox', { name: 'Seating' })).toBeDisabled();
    await expect(page.getByLabel('Venue', { exact: true })).toBeDisabled();
    await expect(page.getByText(reason).first()).toBeVisible();
  },
);
