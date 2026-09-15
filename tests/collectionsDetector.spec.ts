import { test, expect, type Page } from './fixtures';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

async function seed(page: Page) {
  await page.addInitScript(() => { localStorage.setItem('fs_onboarding_v2_done', '1'); localStorage.setItem('fs_onboarding_done', '1'); });
  await page.route('https://**/*', route => route.abort());
  await page.goto('./finds-box/collections');
  await expect(page.getByRole('heading', { name: 'Collections', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { db } = await import('/findspot/src/db.ts');
    const project = await db.projects.toCollection().first();
    const permission = await db.permissions.toCollection().first();
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      await db.finds.put({ id: `demo-find-${i}`, projectId: project.id, permissionId: permission.id, sessionId: null, findCode: `PRIVATE-CODE-${i}`, objectType: ['Test coin', 'Test buckle', 'Unknown object'][i], period: 'Unknown', material: 'Copper alloy', findCategory: 'Coin', lat: 52.2, lon: .12, osGridRef: 'PRIVATE GRID', w3w: '', weightG: 2, widthMm: 20, heightMm: 20, depthMm: 2, depthCm: 15, decoration: '', completeness: 'Unassessed', findContext: '', detector: 'Demo detector', targetId: [0, -9, 12][i], storageLocation: 'PRIVATE STORAGE', notes: 'PRIVATE NOTES', createdAt: now, updatedAt: now });
      const canvas = document.createElement('canvas'); canvas.width = i === 0 ? 800 : 500; canvas.height = i === 0 ? 500 : 800;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#d4c8ab'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#7f7651'; ctx.beginPath(); ctx.arc(canvas.width / 2, canvas.height / 2, 145, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#aaa17a'; ctx.lineWidth = 12; ctx.beginPath(); ctx.arc(canvas.width / 2, canvas.height / 2, 120, 0, Math.PI * 2); ctx.stroke();
      const original = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/jpeg'));
      const bytes = new Uint8Array(await original.arrayBuffer());
      const exif = new TextEncoder().encode('Exif\0\0PRIVATE-GPS-METADATA');
      const size = exif.length + 2;
      const blob = new Blob([bytes.slice(0, 2), new Uint8Array([255, 225, size >> 8, size & 255]), exif, bytes.slice(2)], { type: 'image/jpeg' });
      await db.media.put({ id: `demo-photo-${i}`, projectId: project.id, findId: `demo-find-${i}`, type: 'photo', filename: 'PRIVATE-FILENAME.jpg', mime: 'image/jpeg', blob, caption: '', scalePresent: false, pxPerMm: null, createdAt: now });
    }
  });
}

test('collection editing, source review and metadata-free exports at a mobile viewport', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await page.getByRole('button', { name: 'Create a collection', exact: true }).click();
  await page.getByLabel('Collection title', { exact: true }).fill('Everyday discoveries');
  await page.getByLabel('Your introduction').fill('A collection of objects that made me curious.');
  await page.getByRole('button', { name: /Choose finds/ }).click();
  await page.getByRole('checkbox', { name: 'Test coin' }).check();
  await page.getByRole('checkbox', { name: 'Test buckle' }).check();
  await page.getByRole('button', { name: 'Use 2 selected finds' }).click();
  const presentationControls = page.getByText('Edit caption, facts and photographs', { exact: true });
  await presentationControls.first().click(); await presentationControls.last().click();
  const captions = page.getByLabel('Your caption', { exact: true });
  await captions.first().fill('An object worth another look. '.repeat(25) + 'FINAL CAPTION MARKER');
  await page.getByRole('checkbox', { name: 'Select photograph' }).first().check();
  await page.getByRole('checkbox', { name: 'Select photograph' }).last().check();
  await page.getByRole('button', { name: 'Use as cover' }).first().click();
  await page.getByRole('button', { name: 'Mark source reviewed' }).first().click();
  await page.getByRole('button', { name: 'Save collection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit collection' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Everyday discoveries' })).toBeVisible();
  await page.evaluate(async () => { const { db } = await import('/findspot/src/db.ts'); await db.finds.update('demo-find-0', { period: 'Modern' }); });
  await expect(page.getByText('Selected source details or photographs changed', { exact: false })).toBeVisible();
  await expect(page.getByText('FINAL CAPTION MARKER', { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('collection-mobile.png'), fullPage: true });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('collection-desktop-light.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Export collection', exact: true }).click();
  await page.getByLabel('Public detector label (optional)').fill('My public detector');
  await page.getByRole('button', { name: 'Prepare full preview' }).click();
  await expect(page.getByText('Export prepared. Review every page before saving.')).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath('export-preview-mobile.png'), fullPage: true });
  const zipDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save carousel ZIP' }).click();
  const zip = await zipDownload; await zip.saveAs(testInfo.outputPath('collection.zip'));
  const entries = unzipSync(await readFile((await zip.path())!));
  expect(Object.keys(entries).length).toBeGreaterThanOrEqual(4);
  for (const [filename, bytes] of Object.entries(entries)) {
    expect(filename).toMatch(/^findspot-collection-\d{3}\.png$/);
    expect(Buffer.from(bytes).includes(Buffer.from('PRIVATE'))).toBe(false);
  }
  const pdfDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save PDF booklet' }).click();
  const pdf = await pdfDownload; await pdf.saveAs(testInfo.outputPath('collection.pdf'));
  const pdfBytes = await readFile((await pdf.path())!); expect(pdfBytes.toString().startsWith('%PDF')).toBe(true); expect(pdfBytes.includes(Buffer.from('PRIVATE'))).toBe(false);
});

test('relinks a missing source without losing collection wording or retaining old photographs', async ({ page }) => {
  await seed(page);
  const collectionId = await page.evaluate(async () => {
    const { db } = await import('/findspot/src/db.ts');
    const { newCollection, newCollectionItem, saveCollection } = await import('/findspot/src/services/collections.ts');
    const project = await db.projects.toCollection().first();
    const collection = newCollection(project.id, 'Repair my collection');
    const item = { ...newCollectionItem(collection.id, 'demo-find-0', 0), displayTitle: 'My authored title', caption: 'Keep this caption.', selectedMediaIds: ['demo-photo-0'], sourceFingerprintWhenReviewed: 'old-review', cropSettings: { 'demo-photo-0': { x: 20, y: 30 } } };
    await saveCollection({ ...collection, coverItemId: item.id }, [item]);
    // Simulate an unavailable source in a restored collection.
    await db.finds.delete('demo-find-0');
    return collection.id;
  });
  await page.goto(`./finds-box/collections?collection=${collectionId}`);
  await expect(page.getByText('Keep this caption.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit collection' }).click();
  await page.getByRole('button', { name: 'Relink source find' }).click();
  await page.getByRole('radio', { name: 'Test buckle' }).check();
  await page.getByRole('button', { name: 'Relink to selected find' }).click();
  await page.getByRole('button', { name: 'Save collection', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'My authored title' })).toBeVisible();
  await expect(page.getByText('Keep this caption.', { exact: true })).toBeVisible();
  const result = await page.evaluate(async id => {
    const { db } = await import('/findspot/src/db.ts');
    return { collection: await db.collections.get(id), item: await db.collectionItems.where('collectionId').equals(id).first(), photo: !!await db.media.get('demo-photo-0') };
  }, collectionId);
  expect(result.item.findId).toBe('demo-find-1');
  expect(result.item.selectedMediaIds).toEqual([]);
  expect(result.item.cropSettings).toBeUndefined();
  expect(result.item.sourceFingerprintWhenReviewed).toBeUndefined();
  expect(result.collection.coverItemId).toBe(result.item.id);
  expect(result.photo).toBe(true);
});

test('existing single-find sharing still prepares a downloadable image', async ({ page }) => {
  await seed(page); await page.goto('./finds-box/detector-reference');
  await page.getByRole('button', { name: /Test coin/ }).click();
  await page.getByText('Share / export', { exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Save image/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.png$/);
  expect((await readFile((await file.path())!)).byteLength).toBeGreaterThan(1000);
});

test('overlong collection wording remains editable after validation without truncation', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Create a collection', exact: true }).click();
  const title = page.getByLabel('Collection title', { exact: true });
  await title.fill('T'.repeat(101));
  await expect(title).toHaveValue('T'.repeat(101));
  await page.getByRole('button', { name: 'Save collection', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Collection title must be 100 characters or fewer.');
  await title.fill('My collection');
  await page.getByRole('button', { name: /Choose finds/ }).click();
  await page.getByRole('checkbox', { name: 'Test coin' }).check();
  await page.getByRole('button', { name: 'Use 1 selected finds' }).click();
  await page.getByText('Edit caption, facts and photographs', { exact: true }).click();
  const caption = page.getByRole('textbox', { name: 'Your caption', exact: true });
  const wording = 'C'.repeat(1000) + ' KEEP THE END';
  await caption.fill(wording);
  await page.getByRole('button', { name: 'Save collection', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Caption must be 1,000 characters or fewer.');
  await expect(caption).toHaveValue(wording);
  await caption.fill('A shorter caption.');
  await page.getByRole('button', { name: 'Save collection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit collection' })).toBeVisible();
});

test('detector reference preserves zero, negative readings and strict editing', async ({ page }, testInfo) => {
  await seed(page); await page.goto('./finds-box/detector-reference');
  await expect(page.getByRole('heading', { name: 'My detector, my finds' })).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const dark of [false, true]) {
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
      await page.screenshot({ path: testInfo.outputPath(`detector-${width}-${dark ? 'dark' : 'light'}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await page.getByLabel('Exact target ID').fill('0');
  await expect(page.getByText('1 recorded find with exact target ID 0')).toBeVisible();
  await page.getByRole('button', { name: /Test coin/ }).click();
  await expect(page.getByRole('button', { name: 'See similar recorded readings' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit record' }).click();
  await page.getByLabel('Target ID', { exact: true }).fill('12x');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Enter a whole-number target ID', { exact: false })).toBeVisible();
  const reading = await page.evaluate(async () => { const { db } = await import('/findspot/src/db.ts'); return (await db.finds.get('demo-find-0')).targetId; });
  expect(reading).toBe(0);
  await page.getByLabel('Target ID', { exact: true }).fill('-2');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Range', exact: true }).check();
  await page.getByLabel('Lower target ID').fill('-9'); await page.getByLabel('Upper target ID').fill('-2');
  await expect(page.getByText('2 recorded finds between -9 and -2 (inclusive)')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select find' }).first().check();
  await page.getByRole('button', { name: 'Create collection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose finds (1/50)' })).toBeVisible();
});

test('export text wraps without clipping, preserves final words and cancels cleanly', async ({ page }) => {
  await seed(page);
  const result = await page.evaluate(async () => {
    const { renderCollectionPages } = await import('/findspot/src/services/collectionExport.ts');
    const drawn: Array<{ text: string; x: number; y: number; width: number }> = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y) { drawn.push({ text, x, y, width: this.measureText(text).width }); original.call(this, text, x, y); };
    try {
      const data = { title: 'A title', introduction: 'word '.repeat(390) + 'INTRO_END', objects: [{ title: 'Object', caption: 'LongCaption'.repeat(85) + ' CAPTION_END', interpretation: '', facts: [], photos: [], missingPhotos: 0 }] };
      const pages = await renderCollectionPages(data, new AbortController().signal, () => {});
      const controller = new AbortController(); let aborted = false;
      try { await renderCollectionPages(data, controller.signal, () => controller.abort()); } catch (error) { aborted = error instanceof DOMException && error.name === 'AbortError'; }
      return { pages: pages.length, drawn, aborted };
    } finally { CanvasRenderingContext2D.prototype.fillText = original; }
  });
  expect(result.pages).toBeGreaterThanOrEqual(3); expect(result.aborted).toBe(true);
  expect(result.drawn.some(row => row.text.includes('INTRO_END'))).toBe(true); expect(result.drawn.some(row => row.text.includes('CAPTION_END'))).toBe(true);
  expect(result.drawn.every(row => row.y <= 1305 && row.width <= 928)).toBe(true);
});

test('large reference stays paginated and filters locally without connectivity', async ({ page, context }, testInfo) => {
  test.setTimeout(60_000);
  await seed(page);
  await page.evaluate(async () => {
    const { db } = await import('/findspot/src/db.ts'); const base = await db.finds.get('demo-find-0');
    await db.finds.bulkPut(Array.from({ length: 5000 }, (_, index) => ({ ...base, id: `large-${index}`, detector: 'Large dataset', targetId: index % 101 - 50, notes: 'Private source note '.repeat(50) })));
  });
  await page.goto('./finds-box/detector-reference');
  await page.getByRole('combobox', { name: 'Detector', exact: true }).selectOption('name:large dataset');
  await expect(page.getByText('5000 recorded finds')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('checkbox', { name: 'Select find' })).toHaveCount(40);
  await page.getByRole('button', { name: 'Next finds' }).click();
  await expect(page.getByRole('checkbox', { name: 'Select find' })).toHaveCount(40);
  await context.setOffline(true);
  const started = Date.now(); await page.getByLabel('Exact target ID').fill('0');
  await expect(page.getByText('50 recorded finds with exact target ID 0')).toBeVisible();
  await testInfo.attach('desktop-filter-measurement', { body: JSON.stringify({ records: 5000, filterToVisibleMs: Date.now() - started, environment: 'Desktop Chromium, not a physical phone', offline: true }), contentType: 'application/json' });
  await context.setOffline(false);
});

test.describe('compact Android touch layouts', () => {
  test.use({ viewport: { width: 384, height: 832 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  test('keeps reading controls and chart usable across phone display scaling', async ({ page }, testInfo) => {
    await seed(page); await page.goto('./finds-box/detector-reference');
    await expect(page.getByRole('heading', { name: 'My detector, my finds' })).toBeVisible();
    await page.getByText('Explore recorded target-ID counts', { exact: true }).click();
    for (const width of [360, 384, 412]) {
      await page.setViewportSize({ width, height: 832 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const undersized = await page.locator('.ui-primary, .ui-secondary, summary').evaluateAll(elements => elements.filter(element => {
        const bounds = element.getBoundingClientRect(); return bounds.width > 0 && bounds.height > 0 && (bounds.width < 44 || bounds.height < 44);
      }).map(element => element.textContent));
      expect(undersized).toEqual([]);
    }
    await page.setViewportSize({ width: 384, height: 832 });
    await page.screenshot({ path: testInfo.outputPath('android-touch-384.png'), fullPage: true });
    await page.getByLabel('Exact target ID').tap(); await page.getByLabel('Exact target ID').fill('-9');
    await expect(page.getByText('1 recorded find with exact target ID -9')).toBeVisible();
  });
});
