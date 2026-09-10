import { expect, test, type Page } from './fixtures';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { BACKUP_FIXTURE_FACTORIES } from './fixtures/backupFixtureFactories';

async function putRows(page: Page, table: string, rows: object[]) {
  await page.evaluate(({ table, rows }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('findspot_uk');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(table, 'readwrite');
      for (const row of rows) transaction.objectStore(table).put(row);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  }), { table, rows });
}

async function seed(page: Page, finished = true) {
  await page.goto('./');
  await expect(page.getByText('Local-first storage')).toBeVisible();
  const projectId = await page.evaluate(() => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open('findspot_uk');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const rows = database.transaction('projects').objectStore('projects').getAll();
      rows.onsuccess = () => { database.close(); resolve(rows.result[0].id); };
    };
  }));
  const now = new Date().toISOString();
  await putRows(page, 'permissions', [{ id: 'trust-permission', projectId, name: 'Continuity Meadow', type: 'individual',
    lat: 52.2055, lon: 0.1218, gpsAccuracyM: 4, collector: '', landType: 'pasture',
    permissionGranted: true, notes: '', createdAt: now, updatedAt: now }]);
  await putRows(page, 'sessions', [{ id: 'trust-session', projectId, permissionId: 'trust-permission', fieldId: null,
    date: now, lat: 52.2055, lon: 0.1218, gpsAccuracyM: 4, landUse: 'pasture', cropType: '',
    isStubble: false, notes: 'Observed dry soil along the gate', isFinished: finished,
    sessionStartedAt: now, activatedAt: now, createdAt: now, updatedAt: now }]);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('fs_onboarding_v2_done', '1');
    localStorage.setItem('fs_onboarding_done', '1');
  });
});

test('returning permission exposes the latest visit while investigations stay collapsed, including offline', async ({ page }, info) => {
  await seed(page);
  await page.goto('./permission/trust-permission');
  const summary = page.getByText(/Latest recorded visit:/);
  await expect(summary).toBeVisible();
  await expect(page.getByText('Visit note: Observed dry soil along the gate')).toBeVisible();
  await expect(page.getByRole('button', { name: /Landscape investigations/ })).toHaveAttribute('aria-expanded', 'false');
  await summary.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('permission-overview.png') });
  // Load the visit route within this app before going offline. Production
  // app-shell precaching has its own suite; Vite does not precache routes.
  await page.getByText('Visit note: Observed dry soil along the gate').click();
  await expect(page.getByText('Observed dry soil along the gate', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(summary).toBeVisible();
  await page.context().setOffline(true);
  await expect(summary).toBeVisible();
  await page.getByText('Visit note: Observed dry soil along the gate').click();
  await expect(page).toHaveURL(/\/session\/trust-session/);
  await expect(page.getByText('Observed dry soil along the gate', { exact: true })).toBeVisible();
});

test('map failure leaves recording and visit notes usable, and a failed note save is recoverable', async ({ page }, info) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === 'webgl' || type === 'webgl2') return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await seed(page, false);
  await page.goto('./session/trust-session');
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.getByText('Map unavailable or incomplete')).toBeVisible();
  await expect(page.getByText('Session active', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('map-fallback.png') });
  await page.getByRole('button', { name: 'Open Record', exact: true }).click();
  await page.getByRole('button', { name: 'Add Find to Session' }).click();
  await expect(page.getByRole('heading', { name: 'Record a find', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Session', exact: true }).click();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, ...args: unknown[]) {
      if (this.name === 'sessions') {
        IDBObjectStore.prototype.put = original;
        throw new DOMException('Injected save failure', 'QuotaExceededError');
      }
      return Reflect.apply(original, this, [value, ...args]);
    };
  });
  const note = page.getByLabel('Quick session note');
  await note.fill('Retry this field note');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Your note was not saved. It is still here; please try again.')).toBeVisible();
  await expect(note).toHaveValue('Retry this field note');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(note).toHaveValue('');
});

test('full backup has explicit photo coverage and download is not confirmed storage', async ({ page }, info) => {
  await seed(page);
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('findspot_uk');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction(['permissions', 'media'], 'readwrite');
      const permission = tx.objectStore('permissions').get('trust-permission');
      permission.onsuccess = () => tx.objectStore('media').put({
        id: 'trust-photo', projectId: permission.result.projectId, permissionId: 'trust-permission',
        type: 'photo', mime: 'image/jpeg', filename: 'field-photo.jpg',
        blob: new Blob([new Uint8Array([0xff, 0xd8, 0x01, 0xff, 0xd9])], { type: 'image/jpeg' }),
        createdAt: new Date().toISOString(),
      });
      tx.oncomplete = () => { database.close(); resolve(); };
      tx.onerror = () => { database.close(); reject(tx.error); };
    };
  }));
  await page.goto('./settings?tab=data');
  await page.getByRole('button', { name: 'Backup', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Full backup, including photos/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.zip$/);
  const archivePath = info.outputPath('full-backup.zip');
  await file.saveAs(archivePath);
  const entries = unzipSync(await readFile(archivePath));
  const manifest = JSON.parse(strFromU8(entries['manifest.json']));
  expect(manifest.media).toHaveLength(1);
  expect(Array.from(entries[manifest.media[0]._zipEntry])).toEqual([0xff, 0xd8, 0x01, 0xff, 0xd9]);
  await expect(page.getByText(/Full backup prepared. Check that the download finished/)).toBeVisible();
  await expect(page.getByText('External full copy checked by you: not confirmed')).toBeVisible();
  await page.getByRole('button', { name: 'I’ve checked an external copy' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('backup-prepared.png') });
  await page.getByRole('button', { name: 'I’ve checked an external copy' }).click();
  await expect(page.getByText(/External full copy checked by you: snapshot from/)).toBeVisible();
});

test('rally download and historical export dates never claim delivery', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('findspot_uk');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction('permissions', 'readwrite');
      const store = tx.objectStore('permissions');
      const row = store.get('trust-permission');
      row.onsuccess = () => store.put({ ...row.result, type: 'rally', isClubDayMember: true,
        sharedPermissionId: 'trust-rally', submittedAt: '2026-09-08T12:00:00Z' });
      tx.oncomplete = () => { database.close(); resolve(); };
      tx.onerror = () => { database.close(); reject(tx.error); };
    };
  }));
  await putRows(page, 'finds', [{ ...BACKUP_FIXTURE_FACTORIES.finds(), permissionId: 'trust-permission',
    sessionId: 'trust-session', fieldId: null }]);
  await page.goto('./permission/trust-permission');
  await expect(page.getByText(/Export prepared on .*delivery not confirmed/)).toBeVisible();
  await expect(page.getByText(/Data sent/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Send Finds to Organiser', exact: true }).click();
  await page.getByPlaceholder('e.g. John Smith').fill('Test Recorder');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save Export File', exact: true }).click();
  await download;
  await expect(page.getByText('Export prepared. Check that the download finished before sending the file.')).toBeVisible();
  await expect(page.getByText(/Data sent|File saved to your Downloads/)).toHaveCount(0);
});
