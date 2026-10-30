// T014 smoke test: the stack is up and the Customer app sends you to Keycloak. Deleted before
// Phase 3 (it is not a quickstart scenario).
import { expect, test } from '@playwright/test';
import { API_BASE, APPS } from '../fixtures/apps';
import { signInHeading } from '../fixtures/sign-in';

test('000 X1: the stack answers', async ({ page, request }) => {
  expect((await request.get(`${API_BASE}/health`)).status()).toBe(200);
  await page.goto(APPS.customer.url);
  await expect(signInHeading(page, 'customer')).toBeVisible();
});
