import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tracking: typeof import('../../src/services/tracking');
let database: typeof import('../../src/db').db;
let success: PositionCallback;
let failure: PositionErrorCallback;
let watch: ReturnType<typeof vi.fn>;
let clear: ReturnType<typeof vi.fn>;
const fix = {
  coords: { latitude: 52.2, longitude: 0.1, accuracy: 8, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
  timestamp: Date.now(),
} as GeolocationPosition;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  watch = vi.fn((onPosition: PositionCallback, onError: PositionErrorCallback) => {
    success = onPosition;
    failure = onError;
    return 7;
  });
  clear = vi.fn();
  vi.stubGlobal('navigator', { geolocation: { watchPosition: watch, clearWatch: clear } });
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  database = (await import('../../src/db')).db;
  await Dexie.delete('findspot_uk');
  await database.open();
  tracking = await import('../../src/services/tracking');
});

afterEach(async () => {
  await tracking.stopTracking();
  database.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function start() {
  const state = { status: 'pending', error: '' };
  const done = tracking.startTracking('project', 'visit').then(
    () => { state.status = 'recording'; },
    error => { state.status = 'failed'; state.error = error.message; },
  );
  return { state, done };
}

async function flush() {
  // IndexedDB delivers its events with setImmediate, independently of the GPS deadline.
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
}

describe('browser trail start failure recovery', () => {
  it('reports the first GPS write failure and allows a fresh start', async () => {
    const write = vi.spyOn(database.tracks, 'add').mockRejectedValueOnce(new Error('Storage is full'));
    const first = start();
    await flush();
    success(fix);
    await flush();
    expect(write).toHaveBeenCalled();
    expect(first.state.status).toBe('failed');
    expect(first.state.error).toContain('Storage is full');
    expect(clear).toHaveBeenCalledWith(7);
    expect(tracking.isTrackingActive()).toBe(false);

    const retry = start();
    await flush();
    success(fix);
    await flush();
    expect(retry.state.status).toBe('recording');
    expect(await database.tracks.count()).toBe(1);
  });

  it('starts GPS even if the screen wake lock request never returns', async () => {
    Object.assign(navigator, { wakeLock: { request: vi.fn(() => new Promise(() => {})) } });
    const attempt = start();
    await flush();
    expect(watch).toHaveBeenCalledOnce();
    success(fix);
    await flush();
    expect(attempt.state.status).toBe('recording');
  });

  it('bounds a silent GPS startup and ignores a late callback after retry', async () => {
    const attempt = start();
    await flush();
    const oldSuccess = success;
    await vi.advanceTimersByTimeAsync(20_001);
    await flush();
    expect(attempt.state.status).toBe('failed');
    expect(attempt.state.error).toMatch(/GPS|location/i);
    expect(tracking.isTrackingActive()).toBe(false);

    const retry = start();
    await flush();
    oldSuccess(fix);
    await flush();
    expect(await database.tracks.count()).toBe(0);
    success(fix);
    await flush();
    expect(retry.state.status).toBe('recording');
  });

  it('reports denied location permission and cleans up the watch', async () => {
    const attempt = start();
    await flush();
    failure({ code: 1, message: 'Denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
    await flush();
    expect(attempt.state.error).toMatch(/permission was denied/);
    expect(tracking.isTrackingActive()).toBe(false);
    expect(await database.tracks.count()).toBe(0);
  });

  it('cancels a pending start and releases a wake lock that arrives afterwards', async () => {
    let deliverLock!: (sentinel: WakeLockSentinel) => void;
    Object.assign(navigator, { wakeLock: { request: vi.fn(() => new Promise(resolve => { deliverLock = resolve; })) } });
    const attempt = start();
    await flush();
    const cancelledSuccess = success;
    await tracking.stopTracking();
    await attempt.done;
    expect(attempt.state.error).toMatch(/cancelled/);
    const release = vi.fn(async () => {});
    deliverLock(Object.assign(new EventTarget(), { release }) as unknown as WakeLockSentinel);
    cancelledSuccess(fix);
    await flush();
    expect(release).toHaveBeenCalledOnce();
    expect(await database.tracks.count()).toBe(0);

    const retry = start();
    success(fix);
    await flush();
    expect(retry.state.status).toBe('recording');
  });

  it('serialises arriving fixes and retains the completed trail on stop', async () => {
    const attempt = start();
    success(fix);
    success({ ...fix, timestamp: fix.timestamp + 1_000 });
    await flush();
    expect(attempt.state.status).toBe('recording');
    await tracking.stopTracking();
    const rows = await database.tracks.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].points).toHaveLength(2);
    expect(rows[0].isActive).toBe(false);
    expect(await database.settings.get(tracking.ACTIVE_BROWSER_TRACK_SETTING)).toBeUndefined();
  });

  it('rolls back a first point still being written when start is cancelled', async () => {
    let allowWrite!: () => void;
    const gate = new Promise<void>(resolve => { allowWrite = resolve; });
    const add = database.tracks.add.bind(database.tracks);
    vi.spyOn(database.tracks, 'add').mockImplementationOnce(async (...args) => {
      await Dexie.waitFor(gate);
      return add(...args);
    });
    const attempt = start();
    success(fix);
    await flush();
    const stopped = tracking.stopTracking();
    allowWrite();
    await stopped;
    await flush();
    expect(attempt.state.status).toBe('failed');
    expect(await database.tracks.count()).toBe(0);
    expect(await database.settings.get(tracking.ACTIVE_BROWSER_TRACK_SETTING)).toBeUndefined();
    const retry = start();
    success(fix);
    await flush();
    expect(retry.state.status).toBe('recording');
  });
});
