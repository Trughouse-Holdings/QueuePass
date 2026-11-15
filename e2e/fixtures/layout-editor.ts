// Spec 039's layout-editor steps, shared by the 039 journeys and spec 037's S10 (both apps' editors
// have the same names, labels and classes).
import { expect, type Locator, type Page } from '@playwright/test';

/** The editor's map, and a section on it by name: "Section 101, Standard, 240 seats". */
export const mapOf = (page: Page): Locator =>
  page.getByRole('application', { name: /^Layout map:/ });
export const mapSection = (page: Page, name: string): Locator =>
  mapOf(page).getByRole('button', { name: new RegExp(`^Section ${name}, `) });
export const sectionsPanel = (page: Page): Locator =>
  page.locator('[aria-labelledby="editor-sections-heading"]');
export const levelsPanel = (page: Page): Locator =>
  page.locator('[aria-labelledby="editor-levels-heading"]');
/** A level's line in the Levels panel: its name, color and seats. */
export const levelLine = (page: Page, name: string): Locator =>
  levelsPanel(page)
    .locator('.editor-levels__item')
    .filter({ has: page.locator('.editor-levels__name', { hasText: new RegExp(`^${name}$`) }) });

/** Drags with the mouse from the middle of `target` by (dx, dy) screen pixels, in steps. */
export async function drag(page: Page, target: Locator, dx: number, dy: number): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('drag: the target is not on screen');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y + (dy * i) / 10);
  await page.mouse.up();
}

/** Add section with the generator's form, then Generate. */
export async function addSection(
  page: Page,
  values: { name: string; rows: number; seatsPerRow: string; curve: string },
): Promise<void> {
  await sectionsPanel(page).getByRole('button', { name: 'Add section' }).click();
  const form = page.getByRole('form', { name: 'Add section' });
  await form.getByLabel('Section name').fill(values.name);
  await form.getByLabel('Rows', { exact: true }).fill(String(values.rows));
  await form.getByLabel('Seats per row').fill(values.seatsPerRow);
  await form.getByLabel('Row labels').selectOption('LETTERS');
  await form.getByLabel('First row').fill('A');
  await form.getByLabel('First seat').fill('1');
  await form.getByLabel('Seat numbers').selectOption('LEFT_TO_RIGHT');
  await form.getByLabel('Curve').selectOption({ label: values.curve });
  await form.getByRole('button', { name: 'Generate' }).click();
  await expect(form).toBeHidden();
}

/** Save, past the warnings list if there is one; "Saved". */
export async function save(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const anyway = page.getByRole('button', { name: 'Save anyway' });
  const saved = page.getByText('Saved', { exact: true });
  await expect(anyway.or(saved)).toBeVisible();
  if (await anyway.isVisible()) await anyway.click();
  await expect(saved).toBeVisible();
}

/** Add level, then its name and color typed in place. */
export async function addLevel(page: Page, name: string, color: string): Promise<void> {
  const before = await levelsPanel(page).locator('.editor-levels__item').count();
  await levelsPanel(page).getByRole('button', { name: 'Add level' }).click();
  await expect(levelsPanel(page).locator('.editor-levels__item')).toHaveCount(before + 1);
  const box = levelsPanel(page)
    .getByRole('textbox', { name: /^Name of Level / })
    .last();
  await box.fill(name);
  await box.press('Enter');
  await levelsPanel(page).getByLabel(`Color of ${name}`).selectOption(color);
}

/** The selection's level, chosen under Selection: Price level (it applies at once). */
export async function paint(page: Page, level: string): Promise<void> {
  await page
    .locator('[aria-labelledby="editor-selection-heading"]')
    .getByLabel('Price level')
    .selectOption({ label: level });
}

export async function expectTotals(page: Page, totals: Record<string, number>): Promise<void> {
  for (const [name, n] of Object.entries(totals)) {
    await expect(levelLine(page, name).locator('.editor-levels__count')).toHaveText(
      `${n} ${n === 1 ? 'seat' : 'seats'}`,
    );
  }
}
