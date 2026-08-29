import { expect, test, type Page } from './fixtures';

type SessionLocation = {
  lat: number;
  lon: number;
  boundary: { type: 'Polygon'; coordinates: number[][][] };
};

const ENGLAND: SessionLocation = {
  lat: 52.2055,
  lon: 0.1218,
  boundary: { type: 'Polygon', coordinates: [[[0.1208, 52.2048], [0.1228, 52.2048], [0.1228, 52.2062], [0.1208, 52.2062], [0.1208, 52.2048]]] },
};
const SCOTLAND: SessionLocation = {
  lat: 55.949,
  lon: -3.186,
  boundary: { type: 'Polygon', coordinates: [[[-3.191, 55.944], [-3.181, 55.944], [-3.181, 55.954], [-3.191, 55.954], [-3.191, 55.944]]] },
};
const NORTHERN_IRELAND: SessionLocation = {
  lat: 54.597,
  lon: -5.93,
  boundary: { type: 'Polygon', coordinates: [[[-5.935, 54.592], [-5.925, 54.592], [-5.925, 54.602], [-5.935, 54.602], [-5.935, 54.592]]] },
};
const BORDER: SessionLocation = {
  lat: 55.422,
  lon: -2.79,
  boundary: { type: 'Polygon', coordinates: [[[-2.795, 55.417], [-2.785, 55.417], [-2.785, 55.427], [-2.795, 55.427], [-2.795, 55.417]]] },
};

async function readProjectId(page: Page): Promise<string> {
  return page.evaluate(() => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open('findspot_uk');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const rows = request.result.transaction('projects', 'readonly').objectStore('projects').getAll();
      rows.onerror = () => reject(rows.error);
      rows.onsuccess = () => resolve((rows.result as Array<{ id: string }>)[0].id);
    };
  }));
}

async function writeRecord(page: Page, storeName: string, value: object) {
  await page.evaluate(({ storeName, value }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('findspot_uk');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction(storeName, 'readwrite');
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();
      transaction.objectStore(storeName).put(value);
    };
  }), { storeName, value });
}

async function seedSession(page: Page) {
  await page.goto('./');
  await expect(page.getByText('Local-first storage')).toBeVisible();
  const projectId = await readProjectId(page);
  const now = new Date().toISOString();
  await writeRecord(page, 'permissions', {
    id: 'sm-map-permission', projectId, name: 'Monument Map Field', type: 'individual',
    ...ENGLAND, gpsAccuracyM: 4, collector: '', landType: 'pasture', permissionGranted: true,
    notes: '', createdAt: now, updatedAt: now,
  });
  await writeRecord(page, 'sessions', {
    id: 'sm-map-session', projectId, permissionId: 'sm-map-permission', fieldId: null,
    date: now, lat: ENGLAND.lat, lon: ENGLAND.lon, gpsAccuracyM: 4, landUse: 'pasture',
    cropType: '', isStubble: false, notes: '', isFinished: false, sessionStartedAt: now,
    activatedAt: now, createdAt: now, updatedAt: now,
  });
}

async function moveSession(page: Page, location: SessionLocation) {
  await page.evaluate(location => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('findspot_uk');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction(['permissions', 'sessions'], 'readwrite');
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();
      const permissions = transaction.objectStore('permissions');
      const sessions = transaction.objectStore('sessions');
      const permissionRequest = permissions.get('sm-map-permission');
      const sessionRequest = sessions.get('sm-map-session');
      permissionRequest.onsuccess = () => permissions.put({
        ...permissionRequest.result, lat: location.lat, lon: location.lon, boundary: location.boundary,
      });
      sessionRequest.onsuccess = () => sessions.put({
        ...sessionRequest.result, lat: location.lat, lon: location.lon,
      });
    };
  }), location);
}

async function finishSessionWithTrack(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('findspot_uk');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction(['sessions', 'tracks'], 'readwrite');
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();
      const sessions = transaction.objectStore('sessions');
      const sessionRequest = sessions.get('sm-map-session');
      sessionRequest.onsuccess = () => {
        const now = new Date().toISOString();
        sessions.put({ ...sessionRequest.result, isFinished: true, endTime: now, updatedAt: now });
        transaction.objectStore('tracks').put({
          id: 'sm-map-finished-track',
          projectId: sessionRequest.result.projectId,
          sessionId: 'sm-map-session',
          name: 'Completed trail',
          points: [
            { lat: 52.2052, lon: 0.1218, timestamp: Date.now() - 60_000 },
            { lat: 52.2058, lon: 0.1218, timestamp: Date.now() },
          ],
          isActive: false,
          color: '#10b981',
          gaps: [],
          createdAt: now,
          updatedAt: now,
        });
      };
    };
  }));
}

async function openMap(page: Page) {
  await page.reload();
  await page.getByRole('button', { name: /^Map$/ }).click();
  await expect(page.locator('.maplibregl-map')).toHaveCount(1);
  return page.getByTestId('scheduled-monument-coverage');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('fs_onboarding_v2_done', '1');
    localStorage.setItem('fs_onboarding_done', '1');
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => localStorage.getItem('sm-map-auto-disabled') !== '1',
    });
    const originalMatch = caches.match.bind(caches);
    Object.defineProperty(caches, 'match', {
      configurable: true,
      value: async (request: RequestInfo | URL, options?: CacheQueryOptions) => {
        const url = request instanceof Request ? request.url : String(request);
        if (!url.includes('/v2/sm-index/')) return originalMatch(request, options);
        const mode = localStorage.getItem('sm-map-fixture') ?? 'covered';
        if (mode === 'auto') return originalMatch(request, options);
        if (mode === 'missing') return undefined;
        if (url.endsWith('/_meta.json')) {
          if (mode === 'error') return new Response('{', { status: 200 });
          return new Response(JSON.stringify({
            builtAt: '2026-08-29T00:00:00.000Z',
            generationVersion: 'v2', schemaVersion: 2, geometryMode: 'full-geojson',
            coverage: ['england', 'wales'],
            sources: [{ name: 'NHLE' }, { name: 'Cadw' }],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        const monuments = [
          {
            listEntry: 'SM-ENGLAND', name: 'Cached English monument',
            bbox: [0.121, 52.205, 0.122, 52.206],
            geometry: { type: 'Polygon', coordinates: [[[0.121, 52.205], [0.122, 52.205], [0.122, 52.206], [0.121, 52.206], [0.121, 52.205]]] },
          },
          {
            listEntry: 'SM-BORDER', name: 'Cached border monument',
            bbox: [-2.793, 55.419, -2.788, 55.424],
            geometry: { type: 'Polygon', coordinates: [[[-2.793, 55.419], [-2.788, 55.419], [-2.788, 55.424], [-2.793, 55.424], [-2.793, 55.419]]] },
          },
        ];
        return new Response(JSON.stringify(mode === 'covered-empty' ? [] : monuments), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      },
    });
  });
});

test('active map always states cached scheduled-monument coverage across all view states', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 360, height: 800 });
  const monumentNetworkRequests: string[] = [];
  let dialogs = 0;
  page.on('request', request => {
    if (request.url().includes('/v2/sm-index/')) monumentNetworkRequests.push(request.url());
  });
  page.on('dialog', dialog => { dialogs++; void dialog.dismiss(); });
  await seedSession(page);
  await page.evaluate(() => {
    localStorage.setItem('sm-map-auto-disabled', '1');
    localStorage.setItem('sm-map-fixture', 'covered-empty');
  });
  await page.goto('./session/sm-map-session');

  let line = await openMap(page);
  await expect(line).toContainText('NHLE, Cadw');
  await expect(line).toContainText('29 Aug');
  await expect(line).not.toContainText('2026');
  await expect(line).not.toContainText('coverage');
  await expect(line).toHaveAttribute('data-coverage-form', 'short');
  await expect(line).toHaveAttribute('data-rendered-feature-count', '0');
  const shortBox = await line.boundingBox();
  expect(shortBox?.height).toBeLessThanOrEqual(32);
  await expect(line).toHaveCSS('pointer-events', 'none');

  await page.evaluate(() => localStorage.setItem('sm-map-fixture', 'covered'));
  line = await openMap(page);
  await expect(line).toHaveAttribute('data-rendered-feature-count', '1');
  const mapCanvas = page.locator('.maplibregl-canvas');
  const canvasBox = await mapCanvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await mapCanvas.click({ position: { x: canvasBox!.width / 2, y: canvasBox!.height / 2 } });
  await expect(page.locator('.scheduled-monument-popup')).toContainText(
    'Scheduled monument · Cached English monument',
  );

  await moveSession(page, SCOTLAND);
  line = await openMap(page);
  await expect(line).toHaveAttribute('data-coverage-form', 'full');
  await expect(line).toContainText('Scheduled Monument Check Unavailable');
  await expect(line).toHaveAttribute('data-rendered-feature-count', '0');

  await moveSession(page, NORTHERN_IRELAND);
  line = await openMap(page);
  await expect(line).toContainText('Scheduled Monument Data Not Yet Available Here');
  await expect(line).toHaveAttribute('data-rendered-feature-count', '0');

  await moveSession(page, BORDER);
  line = await openMap(page);
  await expect(line).toHaveAttribute('data-coverage-form', 'full');
  await expect(line).toContainText('England');
  await expect(line).toContainText('Scotland');
  await expect(line).toContainText('Near the Scotland Border');
  await expect(line).toHaveAttribute('data-rendered-feature-count', '1');

  await page.evaluate(() => localStorage.setItem('sm-map-fixture', 'missing'));
  line = await openMap(page);
  await expect(line).toContainText('Data not downloaded for this area');

  await page.evaluate(() => localStorage.setItem('sm-map-fixture', 'error'));
  line = await openMap(page);
  await expect(line).toContainText('Scheduled Monument Check Unavailable');

  expect(monumentNetworkRequests).toEqual([]);
  expect(dialogs).toBe(0);
  await expect(page).toHaveURL(/\/session\/sm-map-session$/);
  await expect(page.locator('.maplibregl-map')).toHaveCount(1);
});

test('session setup prepares monument data without an offline-pack action', async ({ page }) => {
  test.setTimeout(45_000);
  const monumentRequests: string[] = [];
  await page.route('https://findspot-static.trials-uk.workers.dev/v2/sm-index/**', route => {
    monumentRequests.push(route.request().url());
    const isMeta = route.request().url().endsWith('/_meta.json');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(isMeta ? {
        builtAt: '2026-08-29T00:00:00.000Z',
        generationVersion: 'v2', schemaVersion: 2, geometryMode: 'full-geojson',
        coverage: ['england', 'wales'],
        sources: [{ name: 'NHLE' }, { name: 'Cadw' }],
      } : [{
        listEntry: 'SM-AUTO', name: 'Automatically cached monument',
        bbox: [0.121, 52.205, 0.122, 52.206],
        geometry: { type: 'Polygon', coordinates: [[[0.121, 52.205], [0.122, 52.205], [0.122, 52.206], [0.121, 52.206], [0.121, 52.205]]] },
      }]),
    });
  });
  await seedSession(page);
  await page.evaluate(() => {
    localStorage.removeItem('sm-map-auto-disabled');
    localStorage.setItem('sm-map-fixture', 'auto');
  });
  await page.goto('./session/sm-map-session');
  await page.getByRole('button', { name: /^Map$/ }).click();

  const line = page.getByTestId('scheduled-monument-coverage');
  await expect(line).toHaveAttribute('data-coverage-form', 'short', { timeout: 20_000 });
  await expect(line).toContainText('NHLE, Cadw');
  await expect(line).toContainText('29 Aug');
  await expect(line).toHaveAttribute('data-rendered-feature-count', '1');
  expect(monumentRequests.some(url => url.endsWith('/_meta.json'))).toBe(true);
  expect(monumentRequests.some(url => !url.endsWith('/_meta.json'))).toBe(true);
  await expect(page.getByText('Prepare for Offline')).toHaveCount(0);
});

test('active workspace and completed-session map use the same healthy short form', async ({ page }) => {
  test.setTimeout(45_000);
  await seedSession(page);
  await page.evaluate(() => {
    localStorage.setItem('sm-map-auto-disabled', '1');
    localStorage.setItem('sm-map-fixture', 'covered-empty');
  });
  await page.goto('./session/sm-map-session');

  const activeLine = await openMap(page);
  await expect(activeLine).toHaveAttribute('data-coverage-form', 'short');
  const activeText = (await activeLine.innerText()).trim();

  await finishSessionWithTrack(page);
  await page.reload();
  const completedLine = page.getByTestId('scheduled-monument-coverage');
  await expect(completedLine).toHaveAttribute('data-coverage-form', 'short');
  await expect(completedLine).toHaveAttribute('data-rendered-feature-count', '0');
  expect((await completedLine.innerText()).trim()).toBe(activeText);
});
