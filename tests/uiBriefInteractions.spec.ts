import { test, expect } from './fixtures';
import { seedBrief } from './helpers/uiBrief';
import type { Page } from './fixtures';
const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=', 'base64');
async function records(page: Page, store = 'finds') {
  return page.evaluate(store => new Promise<Record<string, unknown>[]>(resolve => {
    const r = indexedDB.open('findspot_uk'); r.onsuccess = () => { const db = r.result; const read = db.transaction(store).objectStore(store).getAll(); read.onsuccess = () => { db.close(); resolve(read.result); }; };
  }), store);
}
async function camera(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(sessionStorage).find(key => key.startsWith('fs_finds_map:'));
    return key ? JSON.parse(sessionStorage.getItem(key)!) as { center: number[]; zoom: number; satellite: boolean } : null;
  });
}
test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); });

test('permission, period and dates combine; individual chips and sort survive inspection', async ({ page }) => {
  await seedBrief(page); await page.goto('./finds-box');
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('combobox', { name: 'Permission', exact: true }).selectOption('permission-1');
  await page.getByRole('combobox', { name: 'Period', exact: true }).selectOption('Medieval');
  await page.getByLabel('Found from').fill('2026-09-10'); await page.getByLabel('Found to').fill('2026-09-12');
  await expect(page.getByRole('button', { name: 'Open Copper buckle FS-002' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Lead token FS-003' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove Medieval filter' }).click();
  await page.getByLabel('Sort finds').selectOption('oldest');
  const items = page.getByRole('button', { name: /^Open (Coin|Copper buckle)/ });
  await expect(items.first()).toHaveAccessibleName('Open Coin FS-001');
  await items.first().click(); await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByLabel('Sort finds')).toHaveValue('oldest');
  await expect(page.getByRole('combobox', { name: 'Permission', exact: true })).toHaveValue('permission-1');
  await page.getByLabel('Found to').fill('2026-09-01');
  await expect(page.getByRole('alert')).toContainText('end date');
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Lead token FS-003' })).toBeVisible();
});

test('map retains camera and basemap through edits and view changes; overlapping records have a chooser', async ({ page }) => {
  test.setTimeout(60000);
  await seedBrief(page); await page.goto('./finds-box?view=map');
  const fit = page.getByRole('button', { name: 'Show all results' });
  await expect(fit).toBeEnabled({ timeout: 20000 });
  await page.getByRole('searchbox').fill('FS-00');
  const canvas = page.locator('section[aria-label="Finds map"] canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 40, { steps: 10 }); await page.mouse.up();
  await page.getByRole('button', { name: 'Satellite', exact: true }).click();
  await expect.poll(() => camera(page)).toMatchObject({ satellite: true });
  const before = await camera(page);
  await page.getByText('Records on this map', { exact: true }).click();
  await page.getByRole('button', { name: 'Coin · FS-001', exact: true }).click();
  await page.getByRole('button', { name: 'Edit record', exact: true }).click();
  await page.getByLabel('Title / Description').fill('Edited coin');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await camera(page)).toEqual(before);
  await page.getByRole('button', { name: 'Gallery', exact: true }).click();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(fit).toBeEnabled(); expect(await camera(page)).toEqual(before);
  await page.getByRole('searchbox').fill('FS-001');
  expect(await camera(page)).toEqual(before);
  await fit.click();
  await expect.poll(async () => (await camera(page))?.zoom).not.toBe(before?.zoom);
  await page.getByRole('searchbox').fill('FS-00');
  await canvas.scrollIntoViewIfNeeded();
  const fittedBox = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: fittedBox.width / 2, y: fittedBox.height / 2 } });
  const chooser = page.getByRole('group', { name: 'Finds at this location' });
  await expect(chooser).toBeVisible();
  await chooser.getByRole('button', { name: /Copper buckle/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('searchbox').fill('Lead token');
  await expect(page).not.toHaveURL(/selected=/);
});

test('frozen capture stays fresh after minutes; failed refresh and failed save retain photo and provenance', async ({ page }) => {
  await page.addInitScript(() => {
    const fix = { coords: { latitude: 52.2053, longitude: 0.1218, accuracy: 8, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() };
    navigator.geolocation.watchPosition = success => { success(fix); return 1; };
    navigator.geolocation.clearWatch = () => {};
    navigator.geolocation.getCurrentPosition = success => success(fix);
  });
  await seedBrief(page); await page.goto('./session/session-1');
  await page.getByRole('button', { name: 'Add Find to Session' }).click();
  const sheet = page.getByRole('dialog', { name: 'Record a find' });
  await expect(sheet.getByText('Position captured', { exact: true })).toBeVisible();
  await page.clock.install(); await page.clock.fastForward(180000);
  await expect(sheet.getByText('Position captured', { exact: true })).toBeVisible();
  await expect(sheet.getByText(/captured 3 minutes ago/)).toBeVisible();
  await page.evaluate(() => { navigator.geolocation.watchPosition = (_ok, fail) => { fail?.({ code: 2, message: 'Unavailable', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); return 1; }; });
  await sheet.getByRole('button', { name: 'Refresh position' }).click();
  await expect(sheet.getByRole('alert')).toContainText('Earlier position retained');
  await sheet.locator('input[type=file]').setInputFiles({ name: 'field.png', mimeType: 'image/png', buffer: photo });
  await expect(sheet.getByRole('img', { name: 'Selected photo, not yet saved' })).toBeVisible();
  await page.evaluate(() => { const original = IDBObjectStore.prototype.add; IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) { if (this.name === 'finds') { IDBObjectStore.prototype.add = original; throw new DOMException('Full', 'QuotaExceededError'); } return original.apply(this, args); }; });
  await sheet.getByRole('button', { name: 'Save & finish later', exact: true }).click();
  await expect(sheet.getByRole('alert')).toContainText('not saved');
  await expect(sheet.getByRole('img')).toBeVisible();
  await sheet.getByRole('button', { name: 'Save & finish later', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  const saved = (await records(page)).filter(row => !['find-1', 'find-2', 'find-3', 'pending-1'].includes(String(row.id)));
  expect(saved).toHaveLength(1); expect(saved[0]).toMatchObject({ lat: 52.2053, lon: 0.1218, gpsAccuracyM: 8, locationMethod: 'live_gps' });
  expect(Date.parse(String(saved[0].locationFrozenAt)) - Date.parse(String(saved[0].locationFixAt))).toBeLessThan(60000);
});

test('phone save remains visible, photos replace and remove before committing, failed save retries once', async ({ page }) => {
  await seedBrief(page); await page.goto('./find?permissionId=permission-1&mode=full&manual=true');
  const save = page.getByRole('button', { name: 'Save Find', exact: true });
  await expect(save).toBeInViewport();
  const nav = await page.getByRole('navigation', { name: 'Primary' }).boundingBox();
  let bounds = (await save.boundingBox())!; expect(bounds.y + bounds.height).toBeLessThanOrEqual(nav!.y);
  const input = page.locator('input[type=file]').first();
  await input.setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: photo });
  await expect(page.getByText('Photo ready · not yet saved')).toBeVisible();
  expect(await records(page, 'media')).toHaveLength(0);
  await page.getByLabel('Replace first.png').setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: photo });
  await expect(page.getByLabel('Replace second.png')).toHaveCount(1);
  await page.getByRole('button', { name: 'Remove photo' }).click();
  await expect(page.getByText('Photo ready · not yet saved')).toHaveCount(0);
  await input.setInputFiles({ name: 'final.png', mimeType: 'image/png', buffer: photo });
  await page.evaluate(() => { const original = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) { if (this.name === 'media') { IDBObjectStore.prototype.put = original; throw new DOMException('Full', 'QuotaExceededError'); } return original.apply(this, args); }; });
  await save.click(); await expect(page.getByRole('alert')).toContainText('draft is still here');
  expect(await records(page)).toHaveLength(4); expect(await records(page, 'media')).toHaveLength(0);
  await save.click(); await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  expect(await records(page)).toHaveLength(5); expect(await records(page, 'media')).toHaveLength(1);
});

test('browser Back protects staged photos and keeps the original destination after cancellation', async ({ page }) => {
  await seedBrief(page); await page.goto('./finds-box');
  await page.getByRole('button', { name: 'Add Find', exact: true }).click();
  await page.locator('input[type=file]').first().setInputFiles({ name: 'draft.png', mimeType: 'image/png', buffer: photo });
  await expect(page.getByText('Photo ready · not yet saved')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'Leave this record?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.getByLabel('Replace draft.png')).toHaveCount(1);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Finds', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page).toHaveURL(/finds-box/);
  expect(await records(page, 'media')).toHaveLength(0);
});

test('narrow enlarged recording layout keeps save and final fields reachable with a short viewport', async ({ page }, info) => {
  await seedBrief(page); await page.goto('./find?permissionId=permission-1&mode=full&manual=true');
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
  const save = page.getByRole('button', { name: 'Save Find', exact: true });
  await expect(save).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByText('No photos yet', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText('No photos yet', { exact: true })).toBeInViewport();
  await expect(save).toBeInViewport();
  await page.setViewportSize({ width: 320, height: 420 });
  await expect(save).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('sorting uses the whole collection before pagination and permission cards resume the real active visit', async ({ page }) => {
  await seedBrief(page);
  const template = (await records(page))[0];
  await page.evaluate(template => new Promise<void>(resolve => {
    const request = indexedDB.open('findspot_uk'); request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('finds', 'readwrite');
      for (let i = 0; i < 65; i++) tx.objectStore('finds').put({ ...template, id: `bulk-${i}`, findCode: `BULK-${i}`, objectType: 'Bulk record', foundAt: new Date(Date.UTC(2020, 0, i + 1)).toISOString(), updatedAt: i === 0 ? '2099-01-01T00:00:00Z' : '2020-01-01T00:00:00Z' });
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  }), template);
  await page.goto('./finds-box');
  await expect(page.getByRole('button', { name: 'Open Bulk record BULK-0', exact: true })).toHaveCount(0);
  await page.getByLabel('Sort finds').selectOption('oldest');
  await expect(page.getByRole('button', { name: /^Open .* (BULK-|FS-|PENDING-)/ }).first()).toHaveAccessibleName('Open Bulk record BULK-0');
  await page.getByLabel('Sort finds').selectOption('edited');
  await expect(page.getByRole('button', { name: /^Open .* (BULK-|FS-|PENDING-)/ }).first()).toHaveAccessibleName('Open Bulk record BULK-0');
  await page.goto('./permissions');
  const card = page.getByRole('article', { name: 'Open permission North Field by the old orchard and river' });
  await card.getByRole('button', { name: 'Resume visit', exact: true }).click();
  await expect(page).toHaveURL(/session\/session-1/);
});

test('offline map imagery leaves records selectable and a locationless capture still saves', async ({ page, context }) => {
  await seedBrief(page); await page.route(/(tile.openstreetmap.org|services.arcgisonline.com)/, route => route.abort());
  await page.goto('./finds-box?view=map');
  await expect(page.getByText('Map imagery is unavailable.', { exact: false })).toBeVisible({ timeout: 20000 });
  await page.getByText('Records on this map', { exact: true }).click();
  await page.getByRole('button', { name: 'Coin · FS-001', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.goto('./session/session-1');
  await page.evaluate(() => { navigator.geolocation.watchPosition = (_ok, fail) => { fail?.({ code: 1, message: 'Denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); return 1; }; });
  // Re-enter the session to ensure no previously accepted live location is retained.
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Add Find to Session' }).click();
  const sheet = page.getByRole('dialog', { name: 'Record a find' });
  await expect(sheet.getByText('No position captured', { exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'Save & finish later', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  expect((await records(page)).filter(row => !['find-1', 'find-2', 'find-3', 'pending-1'].includes(String(row.id)))).toEqual([expect.objectContaining({ lat: null, lon: null, isPending: true })]);
});

test('a fresh explicit refresh replaces the old capture snapshot', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.geolocation.watchPosition = success => { success({ coords: { latitude: 52.2, longitude: 0.1, accuracy: 8, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() - 180000 }); return 1; };
    navigator.geolocation.clearWatch = () => {};
  });
  await seedBrief(page); await page.goto('./session/session-1');
  await page.getByRole('button', { name: 'Add Find to Session' }).click();
  const sheet = page.getByRole('dialog', { name: 'Record a find' });
  await expect(sheet.getByText('Earlier position captured', { exact: true })).toBeVisible();
  await page.evaluate(() => { navigator.geolocation.watchPosition = success => { success({ coords: { latitude: 52.21, longitude: 0.12, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() }); return 2; }; });
  await sheet.getByRole('button', { name: 'Refresh position' }).click();
  await expect(sheet.getByText('Position captured', { exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'Save & finish later', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  expect((await records(page)).filter(row => !['find-1', 'find-2', 'find-3', 'pending-1'].includes(String(row.id)))).toEqual([expect.objectContaining({ lat: 52.21, lon: 0.12, gpsAccuracyM: 5, locationMethod: 'live_gps' })]);
});
