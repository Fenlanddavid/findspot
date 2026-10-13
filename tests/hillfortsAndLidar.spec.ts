import { test, expect, type Page } from './fixtures';

async function mapState(page: Page) {
    return page.evaluate(() => {
        const container = document.querySelector('.maplibregl-map');
        if (!container) return null;
        const key = Object.keys(container).find(k => k.startsWith('__reactFiber$'));
        let fiber = key ? (container as unknown as Record<string, any>)[key] : null;
        let root = fiber;
        while (root?.return) root = root.return;
        if (root?.stateNode?.current !== root && fiber?.alternate) fiber = fiber.alternate;
        while (fiber) {
            const value = fiber.memoizedProps?.value;
            const map = value?.mapRef?.current;
            if (map) return {
                centre: map.getCenter().toArray(),
                layers: Object.fromEntries(['overlay-lidar', 'overlay-lidar-wales', 'overlay-lidar-scotland-phase1', 'hillfort-points'].map(id => [id, map.getLayer(id) ? { visibility: map.getLayoutProperty(id, 'visibility'), opacity: id.startsWith('overlay-') ? map.getPaintProperty(id, 'raster-opacity') : null } : null])),
                hillfortIds: value.hillfortContext?.results.map((r: { record: { id: string } }) => r.record.id) ?? [],
                status: value.hillfortContext?.status ?? null,
                selected: value.selectedHillfortId,
            };
            fiber = fiber.return;
        }
        return null;
    });
}

async function mockPublicServices(page: Page) {
    await page.route(/^https:\/\//, async route => {
        const url = route.request().url();
        if (/overpass/.test(url)) return route.fulfill({ json: { elements: [] } });
        if (/geocode.*reverse/.test(url)) return route.fulfill({ json: { address: { parish: 'Aconbury', county: 'Herefordshire' } } });
        if (/services-eu1\.arcgis\.com/.test(url)) return route.fulfill({ json: { type: 'FeatureCollection', features: [] } });
        if (/findspot-static/.test(url)) return route.fulfill({ status: 503, json: {} });
        return route.abort();
    });
}

test.beforeEach(async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
        localStorage.setItem('fs_onboarding_v2_done', '1');
        localStorage.setItem('fs_onboarding_done', '1');
        localStorage.setItem('fs_fg_helpers_seen', '1');
        localStorage.setItem('fs_fg_sheet', '1');
    });
    await mockPublicServices(page);
});

test('one LiDAR control toggles all regional coverage and shared opacity', async ({ page }) => {
    await page.goto('./fieldguide?lat=50.26&lng=-5.05');
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Map layers', exact: true }).click();
    const lidar = page.getByRole('button', { name: 'LiDAR', exact: true });
    await expect(lidar).toHaveCount(1);
    await expect(page.getByRole('button', { name: /LiDAR (England|Wales|Scotland)/ })).toHaveCount(0);
    await expect(lidar).toHaveAttribute('aria-pressed', 'false');
    await lidar.click();
    await expect.poll(async () => (await mapState(page))?.layers).toMatchObject({
        'overlay-lidar': { visibility: 'visible', opacity: 1 },
        'overlay-lidar-wales': { visibility: 'visible', opacity: 1 },
        'overlay-lidar-scotland-phase1': { visibility: 'visible', opacity: 1 },
    });
    const opacity = page.getByRole('slider', { name: 'LiDAR opacity' });
    await opacity.fill('45');
    await expect.poll(async () => (await mapState(page))?.layers).toMatchObject({
        'overlay-lidar': { opacity: 0.45 },
        'overlay-lidar-wales': { opacity: 0.45 },
        'overlay-lidar-scotland-phase1': { opacity: 0.45 },
    });
    await page.getByRole('button', { name: 'Map layers', exact: true }).click();
    await expect(lidar).toHaveAttribute('aria-pressed', 'true');
    await lidar.click();
    await expect.poll(async () => (await mapState(page))?.layers).toMatchObject({
        'overlay-lidar': { visibility: 'none' }, 'overlay-lidar-wales': { visibility: 'none' }, 'overlay-lidar-scotland-phase1': { visibility: 'none' },
    });
});

test('a scan uses real Atlas data, opens selected details and retains hidden context', async ({ page, context }) => {
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto('./');
    await expect(page.getByRole('button', { name: 'Scan area', exact: true })).toHaveCount(0);
    expect(requests.filter(url => url.includes('/hillforts/'))).toHaveLength(0);
    await page.goto('./fieldguide?lat=51.993628&lng=-2.724548');
    await expect(page.getByText('Ready to Scan')).toBeVisible();
    await expect.poll(async () => Math.abs(((await mapState(page))?.centre[1] ?? 0) - 51.993628)).toBeLessThan(0.00001);
    expect(requests.filter(url => url.includes('/hillforts/'))).toHaveLength(0);
    await page.getByRole('button', { name: 'Scan area', exact: true }).click();
    const name = page.getByRole('button', { name: 'Aconbury Camp · EN0001', exact: true });
    await expect(name).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[aria-label="Atlas site detail"]')).toHaveCount(0);
    await name.click();
    const detail = page.locator('[aria-label="Atlas site detail"]');
    await expect(detail).toBeVisible();
    await expect.poll(async () => {
        const heading = await detail.getByRole('heading', { name: 'Aconbury Camp', exact: true }).boundingBox();
        const scroll = await page.getByTestId('fieldguide-mobile-sheet-scroll').boundingBox();
        return !!heading && !!scroll && heading.y >= scroll.y;
    }).toBe(true);
    await expect(detail).toContainText('Recorded location within the scanned area');
    await expect(detail).toContainText('Dating reliability: C - Low');
    await expect(detail.getByRole('link', { name: 'Open Atlas record' })).toHaveAttribute('href', 'http://hillforts.arch.ox.ac.uk/records/EN0001.html');
    await detail.getByRole('button', { name: 'Close Atlas site detail' }).click();
    await expect(detail).toHaveCount(0);
    await page.getByRole('button', { name: /View all \d+ hillfort records/ }).click();
    const records = page.locator('[aria-label="Hillfort Atlas records"]');
    await expect(records).toBeVisible();
    await records.getByRole('button', { name: 'Close list', exact: true }).click();
    const before = await mapState(page);
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await page.getByRole('button', { name: 'Hillforts', exact: true }).click();
    await expect.poll(async () => (await mapState(page))?.layers['hillfort-points'].visibility).toBe('none');
    await expect(name).toBeVisible();
    expect((await mapState(page))?.hillfortIds).toEqual(before?.hillfortIds);
    await page.getByRole('button', { name: 'Scan again', exact: true }).click();
    await expect.poll(async () => (await mapState(page))?.status).toBe('loaded');
    await expect(name).toBeVisible();
    expect((await mapState(page))?.layers['hillfort-points'].visibility).toBe('none');
    expect(requests.filter(url => url.includes('/hillforts/'))).toHaveLength(1);
    expect(requests.filter(url => /hillforts\.arch\.ox\.ac\.uk|experience\.arcgis\.com/.test(url))).toHaveLength(0);
    await context.setOffline(true);
    await name.click();
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('Dating reliability: C - Low');
    await expect(detail).toContainText('Ralston, I., Lock, G. (2024)');
    await expect(detail).toContainText('archaeological context, not site boundaries');
    await context.setOffline(false);
    await page.screenshot({ path: '/tmp/findspot-hillfort-review-mobile.png', fullPage: true });
});

test('production fresh page scans and opens downloaded hillfort details offline', async ({ page, context }) => {
    test.skip(process.env.FINDSPOT_PRODUCTION_TEST !== '1', 'Requires the production service worker');
    await page.goto('./fieldguide?lat=51.993628&lng=-2.724548');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    if (!await page.evaluate(() => !!navigator.serviceWorker.controller)) await page.goto('./fieldguide?lat=51.993628&lng=-2.724548');
    await expect.poll(async () => Math.abs(((await mapState(page))?.centre[1] ?? 0) - 51.993628)).toBeLessThan(0.00001);
    await page.getByRole('button', { name: 'Scan area', exact: true }).click();
    const name = page.getByRole('button', { name: 'Aconbury Camp · EN0001', exact: true });
    await expect(name).toBeVisible({ timeout: 30_000 });
    await context.setOffline(true);
    // The app consumes one-shot route coordinates. Reopen the same selected
    // location as a fresh document rather than assuming reload preserves it.
    await page.goto('./fieldguide?lat=51.993628&lng=-2.724548');
    await expect(page.getByText('Ready to Scan')).toBeVisible();
    await expect.poll(async () => Math.abs(((await mapState(page))?.centre[1] ?? 0) - 51.993628)).toBeLessThan(0.00001);
    await page.getByRole('button', { name: 'Scan area', exact: true }).click();
    await expect(name).toBeVisible({ timeout: 30_000 });
    expect((await mapState(page))?.status).toBe('loaded');
    await name.click();
    const detail = page.locator('[aria-label="Atlas site detail"]');
    await expect(detail).toContainText('Dating reliability: C - Low');
    await expect(detail).toContainText('Ralston, I., Lock, G. (2024)');
    await page.screenshot({ path: '/tmp/findspot-hillfort-review-offline.png', fullPage: true });
});
