import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { test, expect } from './fixtures';
import { seedBrief } from './helpers/uiBrief';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedBrief(page);
});

test('full backup downloads real photo bytes, requires confirmation and restores the downloaded ZIP', async ({ page }) => {
  test.setTimeout(90_000);
  await page.evaluate(async () => {
    const { db } = await import('/findspot/src/db.ts');
    const find = await db.finds.get('find-1');
    const bytes = Uint8Array.from({ length: 1024 * 1024 + 17 }, (_, index) => index % 251);
    await db.media.put({ id: 'download-photo', projectId: find.projectId, findId: find.id,
      type: 'photo', filename: 'photo.bin', mime: 'application/octet-stream', blob: new Blob([bytes]),
      caption: '', scalePresent: false, createdAt: new Date().toISOString() });
  });
  await page.goto('./settings');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Full backup, including photos/ }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^findspot-full-backup-.*\.zip$/);
  expect(await download.failure()).toBeNull();
  const filename = (await download.path())!;
  const archive = await readFile(filename);
  expect(archive.length).toBeGreaterThan(0);
  const entries = unzipSync(archive);
  const manifest = JSON.parse(Buffer.from(entries['manifest.json']).toString('utf8'));
  const photo = manifest.media.find((row: { id: string }) => row.id === 'download-photo');
  const expectedBytes = Uint8Array.from({ length: 1024 * 1024 + 17 }, (_, index) => index % 251);
  expect(entries[photo._zipEntry]).toEqual(expectedBytes);
  await expect(page.getByText(/Full backup prepared/)).toBeVisible();
  expect(await page.evaluate(async () => {
    const { db } = await import('/findspot/src/db.ts');
    return !!(await db.settings.get('lastConfirmedFullBackupDate'));
  })).toBe(false);
  const preparedAt = await page.evaluate(async () => {
    const { db } = await import('/findspot/src/db.ts');
    return (await db.settings.get('lastFullBackupExportDate')).value;
  });
  await page.getByRole('button', { name: 'I’ve checked an external copy', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => {
    const { db } = await import('/findspot/src/db.ts');
    return (await db.settings.get('lastConfirmedFullBackupDate'))?.value;
  })).toBe(preparedAt);
  await page.evaluate(async () => {
    const { db } = await import('/findspot/src/db.ts');
    await db.media.delete('download-photo');
    await db.finds.update('find-1', { objectType: 'Changed after export' });
  });
  await page.locator('input[type="file"][accept*=".zip"]').setInputFiles({ name: 'downloaded-backup.zip', mimeType: 'application/zip', buffer: archive });
  await expect(page.getByText(/Restore "downloaded-backup\.zip"\?/)).toBeVisible();
  await page.getByLabel(/Type RESTORE/).fill('RESTORE');
  await page.getByRole('button', { name: 'Confirm Import', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const restored = await page.evaluate(async () => {
    const { db } = await import('/findspot/src/db.ts');
    const media = await db.media.get('download-photo');
    const bytes = new Uint8Array(await media.blob.arrayBuffer());
    return { title: (await db.finds.get('find-1')).objectType, size: bytes.length,
      intact: bytes.every((value: number, index: number) => value === index % 251) };
  });
  expect(restored).toEqual({ title: 'Coin', size: expectedBytes.length, intact: true });
});

test('signed landowner agreement downloads a non-empty PDF matching the stored document', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('./permission/permission-1');
  await page.getByRole('button', { name: 'More ↓', exact: true }).click();
  await page.getByRole('button', { name: 'Generate Agreement', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const save = dialog.getByRole('button', { name: 'Save Agreement PDF', exact: true });
  await save.click();
  await expect(dialog.getByText('Both signatures are required.', { exact: true })).toBeVisible();
  for (const canvas of await dialog.locator('canvas').all()) {
    await canvas.scrollIntoViewIfNeeded();
    const bounds = (await canvas.boundingBox())!;
    await page.mouse.move(bounds.x + 20, bounds.y + 35);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 100, bounds.y + 60, { steps: 12 });
    await page.mouse.up();
  }
  await expect(dialog.getByAltText('Landowner Signature')).toHaveCount(1);
  await expect(dialog.getByAltText('Detectorist Signature')).toHaveCount(1);
  const downloading = page.waitForEvent('download');
  await save.click();
  const download = await downloading;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const bytes = await readFile((await download.path())!);
  expect(bytes.length).toBeGreaterThan(1000);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const stored = await page.evaluate(async () => {
    const { db } = await import('/findspot/src/db.ts');
    const permission = await db.permissions.get('permission-1');
    const media = await db.media.get(permission.agreementId);
    return { filename: media.filename, bytes: Array.from(new Uint8Array(await media.blob.arrayBuffer())) };
  });
  expect(stored.filename).toBe(download.suggestedFilename());
  expect(Buffer.from(stored.bytes)).toEqual(bytes);
});
