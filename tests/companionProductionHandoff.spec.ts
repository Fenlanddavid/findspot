import { expect, test } from './fixtures';
import {
  companionPayloadHash,
  type CompanionRecording,
} from '../src/shared/companionRecording';

test('production share target imports, acknowledges stop, and finishes at Companion stop time', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('fs_onboarding_v2_done', '1');
    localStorage.setItem('fs_onboarding_done', '1');
  });
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>(resolve => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
        window.location.reload();
      });
    }
  }).catch(() => undefined);
  await page.waitForLoadState('domcontentloaded');
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  const projectId = await page.evaluate(async () => {
    const request = indexedDB.open('findspot_uk');
    return new Promise<string>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const rows = request.result.transaction('projects').objectStore('projects').getAll();
        rows.onerror = () => reject(rows.error);
        rows.onsuccess = () => resolve(rows.result[0].id as string);
      };
    });
  });
  const startedAt = Date.UTC(2026, 7, 22, 9, 0, 0);
  const stoppedAt = startedAt + 3_600_000;
  const sessionId = 'production-companion-session';
  const recording: CompanionRecording = {
    schemaVersion: 1,
    producer: { name: 'FindSpot Companion', version: '1.0.0-beta.4', platform: 'android' },
    recordingUuid: '00000000-0000-4000-8000-000000000404',
    contentHash: `sha256:${'0'.repeat(64)}`,
    createdAtUtc: startedAt,
    startedAtUtc: startedAt,
    stoppedAtUtc: stoppedAt,
    state: 'stopped',
    interruptionReason: null,
    segments: [{
      segmentIndex: 0,
      startedAtUtc: startedAt,
      endedAtUtc: stoppedAt,
      observations: [{
        type: 'trackPoint', sequence: 0, timestampUtc: startedAt,
        monotonicTimestampNs: '1000000000', receivedTimestampUtc: startedAt + 10,
        latitude: 52.2053, longitude: 0.1218, altitudeM: 8,
        horizontalAccuracyM: 4, verticalAccuracyM: 6,
        headingDegrees: 90, speedMps: 1, provider: 'fused',
      }, {
        type: 'trackPoint', sequence: 1, timestampUtc: stoppedAt,
        monotonicTimestampNs: '3601000000000', receivedTimestampUtc: stoppedAt + 10,
        latitude: 52.2063, longitude: 0.1228, altitudeM: 8,
        horizontalAccuracyM: 4, verticalAccuracyM: 6,
        headingDegrees: 90, speedMps: 1, provider: 'fused',
      }],
    }],
  };
  recording.contentHash = await companionPayloadHash(recording);

  await page.evaluate(async ({ id, project, start }) => {
    const request = indexedDB.open('findspot_uk');
    await new Promise<void>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(['permissions', 'sessions', 'settings'], 'readwrite');
        transaction.onerror = () => reject(transaction.error);
        transaction.oncomplete = () => resolve();
        const now = new Date().toISOString();
        transaction.objectStore('permissions').put({
          id: 'production-companion-permission', projectId: project, name: 'Production handoff field',
          type: 'individual', lat: 52.2053, lon: 0.1218, gpsAccuracyM: 4, collector: '',
          landType: 'pasture', permissionGranted: true, notes: '', createdAt: now, updatedAt: now,
        });
        transaction.objectStore('sessions').put({
          id, projectId: project, permissionId: 'production-companion-permission', fieldId: null,
          date: new Date(start).toISOString(), startTime: new Date(start).toISOString(),
          lat: 52.2053, lon: 0.1218, gpsAccuracyM: 4, landUse: '', cropType: '', isStubble: false,
          notes: '', isFinished: false, createdAt: now, updatedAt: now,
        });
        transaction.objectStore('settings').put({ key: 'fs_companion_active_session', value: id });
        transaction.objectStore('settings').put({
          key: 'fs_companion_pending_command',
          value: { action: 'stop', sessionId: id, requestedAt: Date.now(), finishAfterImport: true },
        });
      };
    });
  }, { id: sessionId, project: projectId, start: startedAt });

  await page.evaluate(({ id, json }) => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/findspot/companion-share';
    form.enctype = 'multipart/form-data';
    const context = document.createElement('input');
    context.name = 'context';
    context.value = `${window.location.origin}/findspot/companion-import?session=${id}&finish=1`;
    const recordingInput = document.createElement('input');
    recordingInput.type = 'file';
    recordingInput.name = 'recording';
    recordingInput.id = 'production-companion-recording';
    const transfer = new DataTransfer();
    transfer.items.add(new File([json], 'companion-recording.json', {
      type: 'application/vnd.findspot.companion+json',
    }));
    recordingInput.files = transfer.files;
    form.append(context, recordingInput);
    document.body.append(form);
    form.submit();
  }, { id: sessionId, json: JSON.stringify(recording) });

  await expect(page).toHaveURL(new RegExp(`/session/${sessionId}$`));
  const stored = await page.evaluate(async id => {
    const request = indexedDB.open('findspot_uk');
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction(['sessions', 'tracks', 'settings'], 'readonly');
        const session = transaction.objectStore('sessions').get(id);
        const tracks = transaction.objectStore('tracks').getAll();
        const active = transaction.objectStore('settings').get('fs_companion_active_session');
        const pending = transaction.objectStore('settings').get('fs_companion_pending_command');
        transaction.onerror = () => reject(transaction.error);
        transaction.oncomplete = () => resolve({
          session: session.result,
          tracks: tracks.result,
          active: active.result?.value,
          pending: pending.result?.value,
        });
      };
    });
  }, sessionId);

  expect(stored.session).toMatchObject({
    id: sessionId,
    isFinished: true,
    endTime: new Date(stoppedAt).toISOString(),
  });
  expect(stored.tracks).toHaveLength(1);
  expect(stored.active).toBe('');
  expect(stored.pending).toBeNull();
});
