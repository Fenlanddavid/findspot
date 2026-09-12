import { test, expect, type Page } from './fixtures';
import { BACKUP_FIXTURE_FACTORIES as fixtures } from './fixtures/backupFixtureFactories';

const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=', 'base64');
async function rows(page: Page, store: string) {
  return page.evaluate(store => new Promise<Record<string, unknown>[]>((resolve, reject) => {
    const request = indexedDB.open('findspot_uk');
    request.onsuccess = () => { const db = request.result; const result = db.transaction(store).objectStore(store).getAll(); result.onsuccess = () => { db.close(); resolve(result.result); }; result.onerror = () => reject(result.error); };
    request.onerror = () => reject(request.error);
  }), store);
}
async function seed(page: Page, active = false) {
  await page.goto('./');
  await expect(page.getByText('Local-first storage')).toBeVisible();
  const project = (await rows(page, 'projects'))[0];
  const now = new Date().toISOString();
  const data = {
    permissions: [{ ...fixtures.permissions(), projectId: project.id }],
    sessions: [{ ...fixtures.sessions(), projectId: project.id, fieldId: null, isFinished: !active, date: now, sessionStartedAt: now, activatedAt: now }],
    finds: [
      { ...fixtures.finds(), projectId: project.id, fieldId: null, isFavorite: true },
      { ...fixtures.finds(), projectId: project.id, fieldId: null, id: 'pending-1', findCode: 'PENDING-1', objectType: 'Pending Quick Find', isPending: true },
    ],
  };
  await page.evaluate(data => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('findspot_uk');
    request.onsuccess = () => { const db = request.result; const tx = db.transaction(Object.keys(data), 'readwrite');
      for (const [table, values] of Object.entries(data)) for (const row of values) tx.objectStore(table).put(row);
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }), data);
}
async function failNextWrite(page: Page, store: string) {
  await page.evaluate(store => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, ...args: unknown[]) {
      if (this.name === store) { IDBObjectStore.prototype.put = original; throw new DOMException('Injected failure', 'QuotaExceededError'); }
      return Reflect.apply(original, this, [value, ...args]);
    };
  }, store);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('fs_onboarding_v2_done', '1'); localStorage.setItem('fs_onboarding_done', '1'); localStorage.setItem('fs_fg_helpers_seen', '1');
  });
});

test('editing cancels text and photos, protects dirty dismissal and retries a failed save', async ({ page }) => {
  await seed(page); await page.goto('./finds-box');
  await page.getByRole('button', { name: 'Open Coin FS-001', exact: true }).click();
  await page.getByRole('button', { name: 'Edit record', exact: true }).click();
  const title = page.getByLabel('Title / Description');
  await title.fill('Unsaved buckle');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'field.png', mimeType: 'image/png', buffer: photo });
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
  expect(await rows(page, 'media')).toHaveLength(0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Unsaved buckle', { exact: true })).toHaveCount(0);
  await expect(page.getByText('No photos attached.')).toBeVisible();
  await page.getByRole('button', { name: 'Edit record', exact: true }).click();
  await expect(title).toHaveValue('Coin');
  await title.fill('Saved buckle');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(title).toHaveValue('Saved buckle');
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'field.png', mimeType: 'image/png', buffer: photo });
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
  await failNextWrite(page, 'media');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByRole('alert')).toContainText('Your changes were not saved');
  await expect(title).toHaveValue('Saved buckle');
  expect((await rows(page, 'finds')).find(row => row.id === 'find-1')?.objectType).toBe('Coin');
  expect(await rows(page, 'media')).toHaveLength(0);
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await rows(page, 'finds')).find(row => row.id === 'find-1')?.objectType).toBe('Saved buckle');
  expect(await rows(page, 'media')).toHaveLength(1);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('Finds includes pending records, preserves filters across map/gallery and completes a record', async ({ page }) => {
  await seed(page); await page.goto('./finds?filter=all');
  await expect(page).toHaveURL(/finds-box/);
  await expect(page.getByRole('button', { name: 'Open Coin FS-001', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Pending Quick Find PENDING-1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Favourites', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search finds' }).fill('Coin');
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.getByText('1 of 1 records have a location.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Gallery', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search finds' })).toHaveValue('Coin');
  await expect(page.getByRole('button', { name: 'Favourites', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('./pending?session=session-1');
  await expect(page).toHaveURL(/finds-box\?.*filter=pending/);
  await page.getByRole('button', { name: 'Open Pending Quick Find PENDING-1', exact: true }).click();
  await page.getByRole('button', { name: 'Finish record', exact: true }).click();
  await page.getByLabel('Title / Description').fill('Lead token');
  await page.getByRole('button', { name: 'Save completed record' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await rows(page, 'finds')).find(row => row.id === 'pending-1')?.isPending).toBe(false);
  await expect(page.getByRole('button', { name: /Open.*PENDING-1/ })).toHaveCount(0);
  await page.goto('./finds-box');
  await page.evaluate(() => { document.documentElement.classList.remove('dark'); document.documentElement.style.fontSize = '20px'; });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole('button', { name: 'Open Coin FS-001', exact: true }).click();
  await page.getByRole('button', { name: 'Remove from favourites' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByText('Share / export', { exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^Save image/ })).toBeVisible();
  await page.getByText('Share / export', { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.goto('./find?quickId=find-1');
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Finds', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('quick capture protects entered data and labels poor GPS while retaining the saved position', async ({ page }) => {
  await page.addInitScript(() => {
    const position = { coords: { latitude: 52.2053, longitude: 0.1218, accuracy: 90, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() };
    navigator.geolocation.getCurrentPosition = callback => callback(position);
    navigator.geolocation.watchPosition = callback => { callback(position); return 1; };
    navigator.geolocation.clearWatch = () => {};
  });
  await seed(page, true); await page.goto('./session/session-1');
  await page.getByRole('button', { name: 'Add Find to Session' }).click();
  await expect(page.getByText(/Position captured · low accuracy/)).toBeVisible({ timeout: 15000 });
  const description = page.getByPlaceholder('e.g. buckle, coin, button');
  await description.fill('Field button');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(description).toHaveValue('Field button');
  await description.fill('');
  await page.getByRole('button', { name: 'Save & finish later', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Record a find' })).toHaveCount(0);
  const saved = (await rows(page, 'finds')).find(row => row.id !== 'find-1' && row.id !== 'pending-1');
  expect(saved).toMatchObject({ lat: 52.2053, lon: 0.1218, gpsAccuracyM: 90, isPending: true });
});

test('FieldGuide panel expands by keyboard and remains usable with large text on a short screen', async ({ page }) => {
  await page.goto('./fieldguide?lat=52.2053&lng=0.1218');
  await page.setViewportSize({ width: 360, height: 640 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
  const expand = page.getByRole('button', { name: 'Expand landscape panel' });
  await expect(expand).toBeVisible(); await expand.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Collapse landscape panel' })).toHaveAttribute('aria-expanded', 'true');
  await page.getByText('Scan controls', { exact: true }).click();
  await page.getByRole('button', { name: 'My location', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'My location', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const handle = await page.getByTestId('fieldguide-mobile-sheet-handle').boundingBox();
  expect(handle?.height).toBeLessThan(250);
  await expect(page.getByText('FieldGuide™ uses proprietary methods', { exact: false })).toBeHidden();
});


test('ordinary session review leads directly to unfinished records for that visit', async ({ page }) => {
  await seed(page); await page.goto('./session/session-1');
  await page.getByRole('button', { name: 'View Review' }).click();
  const review = page.getByRole('dialog', { name: 'Session Review' });
  await expect(review.getByText('Recorded trail', { exact: true })).toBeVisible();
  await expect(review.getByRole('button', { name: 'Landowner update · image', exact: true })).toBeVisible();
  await review.getByRole('button', { name: 'Finish 1 record', exact: true }).click();
  await expect(page).toHaveURL(/finds-box\?filter=pending&session=session-1/);
  await expect(page.getByRole('button', { name: 'Open Pending Quick Find PENDING-1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Coin FS-001', exact: true })).toHaveCount(0);
});

for (const enlarged of [false, true]) {
  test(`map layers and field choices stay clickable above the expanded scan panel${enlarged ? ' with enlarged text' : ''}`, async ({ page }) => {
    await seed(page);
    await page.goto('./fieldguide?lat=52.2053&lng=0.1218');
    await page.setViewportSize({ width: 360, height: 640 });
    if (enlarged) await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
    await page.getByRole('button', { name: 'Expand landscape panel' }).click();
    const layers = page.getByRole('button', { name: 'Map layers', exact: true });
    await layers.click();
    await expect(layers).toHaveAttribute('aria-expanded', 'true');
    const options = page.getByRole('group', { name: 'Map layer options' });
    const satellite = options.getByRole('button', { name: 'Satellite', exact: true });
    await satellite.click();
    await expect(satellite).toHaveAttribute('aria-pressed', 'true');
    await options.getByRole('button', { name: 'Save This Point', exact: true }).click();
    await expect(page.getByText('Save this map point', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await layers.click();
    await options.getByRole('button', { name: 'My Fields', exact: true }).click();
    await expect(options).toHaveCount(0);
    await page.getByRole('button', { name: 'Off', exact: true }).click();
    await expect(page.getByText('Show fields', { exact: true })).toHaveCount(0);
    await layers.click();
    await options.getByRole('button', { name: 'My Finds', exact: true }).click();
    const bounds = await options.boundingBox();
    expect(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 640).toBe(true);
    await layers.click();
    await expect(options).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Collapse landscape panel' })).toHaveAttribute('aria-expanded', 'true');
  });
}
