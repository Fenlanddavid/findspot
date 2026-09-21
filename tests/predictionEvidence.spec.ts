import { expect, test } from './fixtures';
import { seedBrief } from './helpers/uiBrief';
import { BACKUP_FIXTURE_FACTORIES } from './fixtures/backupFixtureFactories';

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`prediction evidence card reports current outcomes at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await seedBrief(page);
    await page.evaluate(async row => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('findspot_uk');
        request.onsuccess = () => {
          const tx = request.result.transaction('hotspotPredictions', 'readwrite');
          tx.objectStore('hotspotPredictions').put(row);
          tx.oncomplete = () => { request.result.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });
    }, { ...BACKUP_FIXTURE_FACTORIES.hotspotPredictions(), outcome: 'find_recorded', resolutionEvidence: 'reported', evidenceVersion: 2 });
    await page.goto('./permission/permission-1');
    const summary = page.locator('summary').filter({ hasText: 'Field Guide evidence' });
    await summary.click();
    const card = summary.locator('..');
    await expect(card.getByText('1 of 1', { exact: true })).toBeVisible();
    await expect(card.getByText('Accepted reported searches', { exact: true })).toBeVisible();
    await expect(page.getByText('Engine Calibration', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Hotspot Accuracy', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await card.screenshot({ path: test.info().outputPath('evidence-card.png') });
  });
}
