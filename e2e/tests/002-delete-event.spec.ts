// Spec 002 quickstart D1: an admin deletes an event, after first cancelling the confirmation; the
// event is gone and its time at the venue is free again. The venue and event are set up through
// the API (003 C1 walks adding them in the Admin app).
import { expect, test } from '@playwright/test';
import { API_BASE, adminFor } from '../fixtures/apps';
import { apiFor, createEvent, createVenue } from '../fixtures/api';
import { PLACES, startsInHours, uniqueName } from '../fixtures/data';
import { signIn } from '../fixtures/sign-in';

test('002 D1: an admin deletes an event, and its time at the venue is free again', async ({
  browser,
  page,
}, testInfo) => {
  const eventName = uniqueName(testInfo, 'show a');
  const slot = { startsAt: startsInHours(24), endsAt: startsInHours(27) };
  const admin = await apiFor(browser, 'admin', adminFor(testInfo));
  const venue = await createVenue(admin.api, PLACES.losAngeles, uniqueName(testInfo, 'hall'));
  await createEvent(admin.api, venue, { name: eventName, ...slot, capacity: 100 });

  const deletes: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'DELETE' && req.url().startsWith(`${API_BASE}/events/`))
      deletes.push(req.url());
  });
  await signIn(page, 'admin', adminFor(testInfo), `/locations/${venue.id}`);
  await page.getByRole('link', { name: eventName }).click();
  await expect(page.getByRole('heading', { level: 1, name: eventName })).toBeVisible();

  // Delete, then Cancel in the confirmation: nothing happens, and nothing is sent.
  page.once('dialog', (d) => void d.dismiss());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: eventName })).toBeVisible();
  expect(deletes).toEqual([]);

  // Delete, then OK: back on the event list, told so, and the event is gone.
  page.once('dialog', (d) => {
    expect(d.message()).toBe(`Delete the event "${eventName}"? This cannot be undone.`);
    void d.accept();
  });
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(`Deleted "${eventName}".`)).toBeVisible();
  await expect(page).toHaveURL(/\/events$/);
  await expect(page.getByRole('link', { name: eventName })).toHaveCount(0);
  expect(deletes).toHaveLength(1);

  // Step 6: the same time at the same venue is accepted again (the 60-minute rule freed it).
  const again = await createEvent(admin.api, venue, { name: `${eventName} again`, ...slot });
  expect(again.locationId).toBe(venue.id);
  await admin.close();
});
