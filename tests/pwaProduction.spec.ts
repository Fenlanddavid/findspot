import { expect, test } from './fixtures';

test('collections and detector reference open and export from the production cache offline', async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    localStorage.setItem('fs_onboarding_v2_done', '1');
    localStorage.setItem('fs_onboarding_done', '1');
  });
  await page.goto('./finds-box');
  await expect(page.getByRole('button', { name: /Your own small museum/ })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  if (!await page.evaluate(() => !!navigator.serviceWorker.controller)) await page.reload();
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const painter = canvas.getContext('2d')!; painter.fillStyle = '#d4c8ab'; painter.fillRect(0, 0, 640, 480);
    painter.fillStyle = '#7f7651'; painter.beginPath(); painter.arc(320, 240, 120, 0, Math.PI * 2); painter.fill();
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/jpeg'));
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('findspot_uk'); request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(['projects', 'permissions', 'finds', 'media'], 'readwrite');
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => { database.close(); reject(transaction.error); };
        const projects = transaction.objectStore('projects').getAll();
        projects.onsuccess = () => {
          const projectId = projects.result[0].id; const now = new Date().toISOString();
          transaction.objectStore('permissions').put({ id: 'offline-permission', projectId, name: 'Private field', type: 'individual', permissionGranted: true, createdAt: now, updatedAt: now });
          transaction.objectStore('finds').put({ id: 'offline-find', projectId, permissionId: 'offline-permission', sessionId: null, findCode: 'PRIVATE-CODE', objectType: 'Offline coin', period: 'Unknown', material: 'Copper alloy', findCategory: 'Coin', lat: 52.2, lon: .12, osGridRef: '', w3w: '', weightG: null, widthMm: null, heightMm: null, depthMm: null, decoration: '', completeness: 'Unassessed', findContext: '', detector: 'Offline detector', targetId: 0, storageLocation: '', notes: '', createdAt: now, updatedAt: now });
          transaction.objectStore('media').put({ id: 'offline-photo', projectId, findId: 'offline-find', type: 'photo', filename: 'private-original.jpg', mime: 'image/jpeg', blob, caption: '', scalePresent: false, pxPerMm: null, createdAt: now });
        };
      };
    });
  });
  await context.setOffline(true);
  // These feature routes and their PDF chunks have not been opened online.
  await page.goto('./finds-box/detector-reference');
  await expect(page.getByRole('heading', { name: 'My detector, my finds' })).toBeVisible();
  await page.getByLabel('Exact target ID').fill('0');
  await expect(page.getByText('1 recorded find with exact target ID 0')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select find' }).check();
  await page.getByRole('button', { name: 'Create collection', exact: true }).click();
  await page.getByLabel('Collection title', { exact: true }).fill('Offline discoveries');
  await page.getByText('Edit caption, facts and photographs', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select photograph' }).check();
  await page.getByRole('button', { name: 'Save collection', exact: true }).click();
  await expect(page).toHaveURL(/\?collection=/);
  await expect(page.getByRole('button', { name: 'Edit collection', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Offline discoveries' })).toBeVisible();
  await page.getByRole('button', { name: 'Export collection', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare full preview' }).click();
  await expect(page.getByText('Export prepared. Review every page before saving.')).toBeVisible();
  for (const [button, filename] of [['Save PDF booklet', 'offline-collection.pdf'], ['Save carousel ZIP', 'offline-collection.zip']]) {
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: button }).click();
    const file = await download; await file.saveAs(testInfo.outputPath(filename)); expect(await file.failure()).toBeNull();
  }
  await context.setOffline(false);
});

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
