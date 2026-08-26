import { expect, test } from './fixtures';

test('production PWA reloads from its service-worker cache while offline', async ({ page, context }) => {
  await page.addInitScript(() => {
    localStorage.setItem('fs_onboarding_v2_done', '1');
    localStorage.setItem('fs_onboarding_done', '1');
  });

  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page).toHaveTitle(/FindSpot UK/);
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(false);
});
