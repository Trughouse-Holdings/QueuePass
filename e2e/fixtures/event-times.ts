/** Spec 036: fill and read the Admin event form's date and time controls as one local value. */
import { expect, type Page } from '@playwright/test';

export type EventTimeLabel = 'Starts' | 'Ends' | 'Doors open';

export async function fillEventDateTime(
  page: Page,
  label: EventTimeLabel,
  local: string,
): Promise<void> {
  const [date, time] = local.split('T');
  await page.getByLabel(`${label} date`, { exact: true }).fill(date ?? '');
  await page.getByLabel(`${label} time`, { exact: true }).fill((time ?? '').slice(0, 5));
}

export async function expectEventDateTime(
  page: Page,
  label: EventTimeLabel,
  local: string,
): Promise<void> {
  const [date, time] = local.split('T');
  await expect(page.getByLabel(`${label} date`, { exact: true })).toHaveValue(date ?? '');
  await expect(page.getByLabel(`${label} time`, { exact: true })).toHaveValue(
    (time ?? '').slice(0, 5),
  );
}
