import { expect, test, type Page } from './fixtures';

test.setTimeout(60_000);

async function seedVisit(page: Page, companion = false) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('fs_onboarding_v2_done', '1');
    localStorage.setItem('fs_onboarding_done', '1');
  });
  await page.goto('./');
  await expect(page.getByText('Local-first storage', { exact: false })).toBeVisible();
  await page.evaluate(async active => {
    const req = indexedDB.open('findspot_uk');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const projectRequest = db.transaction('projects').objectStore('projects').getAll();
    const projects = await new Promise<Array<{ id: string }>>(resolve => {
      projectRequest.onsuccess = () => resolve(projectRequest.result);
    });
    const projectId = projects[0].id;
    const now = new Date().toISOString();
    const tx = db.transaction(['permissions', 'sessions', 'settings', 'tracks'], 'readwrite');
    tx.objectStore('permissions').put({
      id: 'recovery-permission', projectId, name: 'Recovery Field', type: 'individual',
      lat: 53.3811, lon: -1.4701, collector: '', landType: 'pasture', permissionGranted: true,
      notes: '', createdAt: now, updatedAt: now,
    });
    tx.objectStore('sessions').put({
      id: 'recovery-visit', projectId, permissionId: 'recovery-permission', fieldId: null,
      date: now, lat: 53.3811, lon: -1.4701, landUse: '', cropType: '', isStubble: false,
      notes: 'Keep these field notes', isFinished: false, sessionStartedAt: now, activatedAt: now,
      createdAt: now, updatedAt: now,
    });
    tx.objectStore('tracks').put({
      id: 'saved-trail', projectId, sessionId: 'recovery-visit', name: 'Earlier trail',
      points: [{ lat: 53.3811, lon: -1.4701, timestamp: Date.now() }],
      isActive: false, color: '#000000', createdAt: now, updatedAt: now,
    });
    if (active) {
      tx.objectStore('settings').put({ key: 'fs_companion_active_session', value: 'recovery-visit' });
      tx.objectStore('settings').put({ key: 'fs_companion_pending_command', value: {
        action: 'stop', sessionId: 'recovery-visit', requestedAt: Date.now(), finishAfterImport: true,
      } });
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, companion);
  await page.goto(`./session/recovery-visit${companion ? '?companionResult=stop_failed' : ''}`);
}

test('a missing Companion recording can be recovered without deleting the visit or saved trail', async ({ page }) => {
  await seedVisit(page, true);
  await expect(page.getByText('Companion could not stop or return its trail.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start in FindSpot' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Recover stuck recording' }).click();
  await expect(page.getByText('Reset Companion status?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Keep status' }).click();
  await expect(page.getByRole('button', { name: 'Stop Companion', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Recover stuck recording' }).click();
  await page.getByRole('button', { name: 'Reset status', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start in FindSpot' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Start in FindSpot' })).toBeVisible();
  await page.getByRole('button', { name: 'Start in FindSpot' }).click();
  await expect(page.getByRole('button', { name: 'Stop FindSpot trail', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop FindSpot trail', exact: true }).click();
  const saved = await page.evaluate(async () => {
    const modulePath = '/findspot/src/db.ts';
    const { db } = await import(modulePath);
    return { trail: await db.tracks.get('saved-trail'), visit: await db.sessions.get('recovery-visit') };
  });
  expect(saved.trail.points).toHaveLength(1);
  expect(saved.visit.notes).toBe('Keep these field notes');
  expect(saved.visit.isFinished).toBe(false);
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('button', { name: 'Finish visit', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => {
    const modulePath = '/findspot/src/db.ts';
    const { db } = await import(modulePath);
    return (await db.sessions.get('recovery-visit')).isFinished;
  })).toBe(true);
});

test('silent GPS has visible progress, can be cancelled, and times out with a retry', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      watchPosition: () => 42,
      clearWatch: () => {},
      getCurrentPosition: () => {},
    } });
  });
  await seedVisit(page);
  await page.clock.install();
  await page.getByRole('button', { name: 'Start in FindSpot' }).click();
  await expect(page.getByRole('status')).toContainText('Starting trail');
  await page.getByRole('button', { name: 'Cancel trail start' }).click();
  await expect(page.getByRole('button', { name: 'Start in FindSpot' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start in FindSpot' }).click();
  await page.clock.runFor(20_001);
  await expect(page.getByRole('alert')).toContainText('Trail could not start in time');
  await expect(page.getByRole('button', { name: 'Start in FindSpot' })).toBeVisible();
});

test('a failed first GPS save is displayed and the next start succeeds', async ({ page }) => {
  await seedVisit(page);
  await page.evaluate(async () => {
    const modulePath = '/findspot/src/db.ts';
    const { db } = await import(modulePath);
    const original = db.tracks.add.bind(db.tracks);
    db.tracks.add = () => {
      db.tracks.add = original;
      return Promise.reject(new Error('Storage is full'));
    };
  });
  await page.getByRole('button', { name: 'Start in FindSpot' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save the trail: Storage is full');
  await page.getByRole('button', { name: 'Start in FindSpot' }).click();
  await expect(page.getByRole('button', { name: 'Stop FindSpot trail', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('another visit links back to the stuck Companion visit for recovery', async ({ page }) => {
  await seedVisit(page, true);
  await page.evaluate(async () => {
    const modulePath = '/findspot/src/db.ts';
    const { db } = await import(modulePath);
    const visit = await db.sessions.get('recovery-visit');
    await db.sessions.put({ ...visit, id: 'other-visit' });
  });
  await page.goto('./session/other-visit');
  await page.getByRole('button', { name: 'Open Companion visit' }).click();
  await expect(page).toHaveURL(/\/session\/recovery-visit$/);
  await expect(page.getByRole('button', { name: 'Recover stuck recording' })).toBeVisible();
});
