import { expect, test, type Page } from './fixtures';

declare global {
  interface Window { __findspotClearWatchCalls?: number }
}

async function readStore<T>(page: Page, storeName: string): Promise<T[]> {
  return page.evaluate(name => new Promise<T[]>((resolve, reject) => {
    const request = indexedDB.open('findspot_uk');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction(name, 'readonly');
      const rows = transaction.objectStore(name).getAll();
      rows.onerror = () => reject(rows.error);
      rows.onsuccess = () => resolve(rows.result as T[]);
    };
  }), storeName);
}

async function putRows(page: Page, storeName: string, rows: object[]) {
  await page.evaluate(({ name, values }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('findspot_uk');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction(name, 'readwrite');
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();
      const store = transaction.objectStore(name);
      for (const value of values) store.put(value);
    };
  }), { name: storeName, values: rows });
}

async function seedActiveSession(page: Page, suffix: string) {
  await page.goto('./');
  await expect(page.getByText('Local-first storage')).toBeVisible();
  const [{ id: projectId }] = await readStore<{ id: string }>(page, 'projects');
  const now = new Date().toISOString();
  const permissionId = `map-object-permission-${suffix}`;
  const sessionId = `map-object-session-${suffix}`;
  await putRows(page, 'permissions', [{
    id: permissionId, projectId, name: `Map Object Field ${suffix}`, type: 'individual',
    lat: 52.2055, lon: 0.1218, gpsAccuracyM: 4, collector: '', landType: 'pasture',
    boundary: { type: 'Polygon', coordinates: [[[0.1208, 52.2048], [0.1228, 52.2048], [0.1228, 52.2062], [0.1208, 52.2062], [0.1208, 52.2048]]] },
    permissionGranted: true, notes: '', createdAt: now, updatedAt: now,
  }]);
  await putRows(page, 'sessions', [{
    id: sessionId, projectId, permissionId, fieldId: null, date: now,
    lat: 52.2055, lon: 0.1218, gpsAccuracyM: 4, landUse: 'pasture', cropType: '',
    isStubble: false, notes: '', isFinished: false, sessionStartedAt: now,
    activatedAt: now, createdAt: now, updatedAt: now,
  }]);
  return { projectId, permissionId, sessionId, now };
}

async function openMapAndTapCentre(page: Page) {
  await page.getByRole('button', { name: /^Map$/ }).click();
  const canvas = page.locator('.maplibregl-canvas');
  await expect(canvas).toBeVisible();
  await tapCentreUntilSheet(page);
}

async function tapMapCentre(page: Page) {
  const canvas = page.locator('.maplibregl-canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Session map canvas has no bounds');
  await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
}

async function tapCentreUntilSheet(page: Page) {
  await expect.poll(async () => {
    const sheetCount = await page.locator('#session-map-object-title').count();
    if (sheetCount === 0) await tapMapCentre(page);
    return page.locator('#session-map-object-title').count();
  }, { timeout: 10_000, intervals: [250, 500, 750] }).toBe(1);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('fs_onboarding_v2_done', '1');
    localStorage.setItem('fs_onboarding_done', '1');
    window.__findspotClearWatchCalls = 0;
    const geolocation = navigator.geolocation;
    const clearWatch = geolocation.clearWatch.bind(geolocation);
    Object.defineProperty(geolocation, 'clearWatch', {
      configurable: true,
      value: (watchId: number) => {
        window.__findspotClearWatchCalls = (window.__findspotClearWatchCalls ?? 0) + 1;
        return clearWatch(watchId);
      },
    });
  });
});

test('overlapping map objects are explicit and inspection keeps the active session mounted', async ({ page }) => {
  test.setTimeout(45_000);
  const context = await seedActiveSession(page, 'overlap');
  await putRows(page, 'finds', [{
    id: 'map-object-find', projectId: context.projectId, permissionId: context.permissionId,
    fieldId: null, sessionId: context.sessionId, findCode: 'MAP-001', objectType: 'Bronze buckle',
    lat: 52.2055, lon: 0.1218, gpsAccuracyM: 5, osGridRef: '', w3w: '', period: 'Medieval',
    material: 'Copper alloy', weightG: null, widthMm: null, heightMm: null, depthMm: null,
    decoration: '', completeness: 'Complete', findContext: '', storageLocation: '', notes: '',
    foundAt: context.now, createdAt: context.now, updatedAt: context.now,
  }]);
  await putRows(page, 'undugSignals', [{
    id: 'map-object-signal', permissionId: context.permissionId, sessionId: context.sessionId,
    lat: 52.2055, lng: 0.1218, gpsAccuracy: 6, vdi: '42', status: 'open', createdAt: Date.now(),
  }]);
  await page.goto(`./session/${context.sessionId}`);
  const routeBefore = new URL(page.url()).pathname;
  await openMapAndTapCentre(page);

  await expect(page.getByRole('heading', { name: 'Choose what you tapped' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Bronze buckle.*Find/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /VDI 42.*Signal/ })).toBeVisible();
  await page.getByRole('button', { name: /VDI 42.*Signal/ }).click();
  await expect(page.getByRole('heading', { name: 'VDI 42' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(routeBefore);
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  await tapCentreUntilSheet(page);
  await page.getByRole('button', { name: /Bronze buckle.*Find/ }).click();
  await expect(page.getByRole('heading', { name: 'Bronze buckle' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(routeBefore);
  await expect(page.getByRole('navigation', { name: 'Detecting workspace' })).toBeVisible();
  await expect(page.locator('.maplibregl-map')).toHaveCount(1);
  expect(await page.evaluate(() => window.__findspotClearWatchCalls)).toBe(0);

  await page.getByRole('button', { name: 'Open full record' }).click();
  await expect(page).toHaveURL(/\/find\?quickId=map-object-find$/);
});

test('surface observations and marked points inspect in place', async ({ page }) => {
  test.setTimeout(45_000);
  const context = await seedActiveSession(page, 'point-like');
  await putRows(page, 'surfaceObservations', [{
    id: 'map-object-observation', projectId: context.projectId, permissionId: context.permissionId,
    fieldId: null, sectionId: null, sessionId: context.sessionId, lat: 52.2055, lon: 0.1218,
    gpsAccuracyM: null, observedAt: context.now, material: 'pottery', abundance: 'few',
    materialConfidence: 'fairly_sure', periodImpression: 'unknown', datingConfidence: 'unsure',
    note: '', reassessments: [], createdAt: context.now, updatedAt: context.now,
  }]);
  await putRows(page, 'savedPoints', [{
    id: 'map-object-point', projectId: context.projectId, label: 'North gate',
    lat: 52.2055, lon: 0.1218, zoom: 17, note: `Session ${context.sessionId}`,
    createdAt: context.now,
  }]);
  await page.goto(`./session/${context.sessionId}`);
  const routeBefore = new URL(page.url()).pathname;
  await openMapAndTapCentre(page);

  await expect(page.getByRole('heading', { name: 'Choose what you tapped' })).toBeVisible();
  await page.getByRole('button', { name: /Pottery.*Surface observation/ }).click();
  await expect(page.getByRole('heading', { name: 'Pottery' })).toBeVisible();
  await expect(page.getByText('GPS accuracy')).toBeVisible();
  await expect(page.getByText('Unknown', { exact: true }).first()).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(routeBefore);
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();

  await tapCentreUntilSheet(page);
  await page.getByRole('button', { name: /North gate.*Marked point/ }).click();
  await expect(page.getByRole('heading', { name: 'North gate' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(routeBefore);
  await page.getByRole('button', { name: 'Open in Field Guide' }).click();
  await expect(page).toHaveURL(/\/fieldguide\?sessionId=map-object-session-point-like&savedPoints=1/);
});

test('a previous trail opens a local session summary before explicit navigation', async ({ page }) => {
  test.setTimeout(45_000);
  const context = await seedActiveSession(page, 'trail');
  const previousSessionId = 'map-object-previous-session';
  const previousDate = new Date(Date.now() - 86_400_000).toISOString();
  await putRows(page, 'sessions', [{
    id: previousSessionId, projectId: context.projectId, permissionId: context.permissionId,
    fieldId: null, date: previousDate, lat: 52.2055, lon: 0.1218, gpsAccuracyM: 5,
    landUse: 'pasture', cropType: '', isStubble: false, notes: '', isFinished: true,
    sessionStartedAt: previousDate, endTime: previousDate, createdAt: previousDate, updatedAt: previousDate,
  }]);
  await putRows(page, 'tracks', [{
    id: 'map-object-previous-track', projectId: context.projectId, sessionId: previousSessionId,
    name: 'Previous north line', isActive: false, color: '#67e8f9', gaps: [],
    points: [
      { lat: 52.2052, lon: 0.1218, timestamp: Date.now() - 87_000_000 },
      { lat: 52.2058, lon: 0.1218, timestamp: Date.now() - 86_940_000 },
    ],
    createdAt: previousDate, updatedAt: previousDate,
  }]);
  await page.goto(`./session/${context.sessionId}`);
  await page.getByRole('button', { name: /^Map$/ }).click();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Map layers' }).click();
  await page.getByRole('button', { name: 'Field trails' }).click();
  await tapCentreUntilSheet(page);

  await expect(page.getByRole('heading', { name: 'Previous north line' })).toBeVisible();
  await expect(page.getByText('Recorded distance')).toBeVisible();
  await expect(page.getByText('1 min')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/session/${context.sessionId}$`));
  await page.getByRole('button', { name: 'Open session record' }).click();
  await expect(page).toHaveURL(new RegExp(`/session/${previousSessionId}$`));
});
