import type { Page } from '@playwright/test';
import { BACKUP_FIXTURE_FACTORIES as f } from '../fixtures/backupFixtureFactories';
export async function seedBrief(page: Page) {
  await page.addInitScript(() => { for (const key of ['fs_onboarding_v2_done', 'fs_onboarding_done', 'fs_fg_helpers_seen']) localStorage.setItem(key, '1'); });
  await page.goto('./');
  await page.getByText('Local-first storage').waitFor();
  await page.evaluate(async data => {
    const request = indexedDB.open('findspot_uk');
    await new Promise<void>((resolve, reject) => { request.onsuccess = () => {
      const db = request.result; const read = db.transaction('projects').objectStore('projects').getAll();
      read.onsuccess = () => {
        const projectId = read.result[0].id;
        const tx = db.transaction(Object.keys(data), 'readwrite');
        for (const [store, values] of Object.entries(data)) for (const value of values) tx.objectStore(store).put({ ...value, projectId });
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
    }; request.onerror = () => reject(request.error); });
  }, {
    permissions: [{ ...f.permissions(), name: 'North Field by the old orchard and river', permissionGranted: true, boundary: f.fields().boundary }, { ...f.permissions(), id: 'permission-2', name: 'South Field', permissionGranted: true }],
    fields: [f.fields()],
    sessions: [{ ...f.sessions(), isFinished: false, activatedAt: new Date().toISOString(), sessionStartedAt: new Date().toISOString(), fieldId: null }],
    finds: [
      { ...f.finds(), isFavorite: true, fieldId: null, foundAt: '2026-09-10T10:00:00Z' },
      { ...f.finds(), id: 'find-2', findCode: 'FS-002', objectType: 'Copper buckle', period: 'Medieval', foundAt: '2026-09-11T10:00:00Z' },
      { ...f.finds(), id: 'find-3', findCode: 'FS-003', objectType: 'Lead token', permissionId: 'permission-2', sessionId: null, lat: 54, lon: -2, foundAt: '2026-09-09T10:00:00Z' },
      { ...f.finds(), id: 'pending-1', findCode: 'PENDING-1', objectType: 'Pending Quick Find', isPending: true, lat: null, lon: null },
    ],
  });
}
