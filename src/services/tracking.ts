import { db } from "../db";
import { v4 as uuid } from "uuid";
import { reportNonFatal } from "./diagLog";

// ── Core state ──────────────────────────────────────────────────────
let watchId: number | null = null;
let currentTrackId: string | null = null;
let currentTrackSessionId: string | null = null;
let wakeLock: WakeLockSentinel | null = null;
let isStarting = false;
let cancelTrackingStart: (() => void) | null = null;
let pointsBuffer: { lat: number; lon: number; timestamp: number; accuracy: number }[] = [];

// ── Liveness state (Step 1) ─────────────────────────────────────────
let lastFixAt: number | null = null;
let lastAcceptedFixAt: number | null = null;
let lastAcceptedPoint: TrackingPoint | null = null;
let droppedFixCount = 0;
let wakeLockHeld = false;
let watchError: string | null = null;
let gaps: { start: number; end: number }[] = [];

// ── Extracted module state (Step 2) ─────────────────────────────────
let trackCreated = false;
let onFirstAcceptedFix: (() => void) | null = null;
let watchdogId: number | null = null;

// ── Track creation context (captured per-session by startTracking) ──
let trackProjectId: string | null = null;
let trackSessionId: string | null = null;
let trackName: string | null = null;
let trackColor: string | null = null;
let trackCreatedAt: string | null = null;

export const ACTIVE_BROWSER_TRACK_SETTING = 'fs_active_browser_track_id';

function resetLivenessState() {
  lastFixAt = null;
  lastAcceptedFixAt = null;
  lastAcceptedPoint = null;
  droppedFixCount = 0;
  watchError = null;
  gaps = [];
  trackCreated = false;
  onFirstAcceptedFix = null;
}

/** Push a gap record, guarding against duplicates from repeated watchdog ticks. */
export function maybeRecordGap(
  gapList: { start: number; end: number }[],
  gapStart: number | null,
  now: number
): boolean {
  if (!gapStart) return false;
  const lastGap = gapList.length ? gapList[gapList.length - 1] : null;
  if (lastGap && lastGap.end >= gapStart) return false;
  gapList.push({ start: gapStart, end: now });
  return true;
}

function formatGeolocationError(err: GeolocationPositionError) {
    if (err.code === err.PERMISSION_DENIED) return "Location permission was denied. Allow location access before mapping a session.";
    if (err.code === err.POSITION_UNAVAILABLE) return "Location is unavailable. Move into open ground and try mapping again.";
    if (err.code === err.TIMEOUT) return "GPS did not get a fix in time. Move into open ground and try again.";
    return err.message || "Could not start tracking. Check location permissions and GPS signal.";
}

export async function closeStaleActiveTracks(staleAfterMs = 0): Promise<number> {
    if (watchId !== null || isStarting) return 0;

    const pointer = await db.settings.get(ACTIVE_BROWSER_TRACK_SETTING);
    if (typeof pointer?.value !== 'string' || !pointer.value) return 0;
    const activeTrack = await db.tracks.get(pointer.value);
    if (!activeTrack || !activeTrack.isActive) {
        await db.settings.delete(ACTIVE_BROWSER_TRACK_SETTING);
        return 0;
    }

    const cutoff = Date.now() - staleAfterMs;
    if (new Date(activeTrack.updatedAt).getTime() >= cutoff) return 0;

    const now = new Date().toISOString();
    await db.transaction('rw', [db.tracks, db.settings], async () => {
        await db.tracks.update(activeTrack.id, { isActive: false, updatedAt: now });
        await db.settings.delete(ACTIVE_BROWSER_TRACK_SETTING);
    });
    return 1;
}

// ── Status API (poll-based) ─────────────────────────────────────────

export type TrackingStatus = {
  active: boolean;
  lastFixAt: number | null;
  lastAcceptedFixAt: number | null;
  lastAcceptedPoint: TrackingPoint | null;
  droppedFixCount: number;
  wakeLockHeld: boolean;
  wakeLockSupported: boolean;
  watchError: string | null;
  gapCount: number;
};

export type TrackingPoint = {
  lat: number;
  lon: number;
  accuracyM: number | null;
  headingDegrees: number | null;
  timestamp: number;
};

export function getTrackingStatus(): TrackingStatus {
  return {
    active: watchId !== null,
    lastFixAt,
    lastAcceptedFixAt,
    lastAcceptedPoint,
    droppedFixCount,
    wakeLockHeld,
    wakeLockSupported: isWakeLockSupported(),
    watchError,
    gapCount: gaps.length,
  };
}

// ── Wake lock (Step 3 — truth-tracking) ─────────────────────────────

export function isWakeLockSupported(): boolean {
  return 'wakeLock' in navigator;
}

async function requestWakeLock() {
  if (!isWakeLockSupported() || !currentTrackId) return;
  const requestedTrackId = currentTrackId;
  try {
    if (wakeLock) return;
    const acquired = await navigator.wakeLock.request('screen');
    if (currentTrackId !== requestedTrackId || wakeLock) {
      void acquired.release().catch(error => reportNonFatal('tracking', 'Wake lock release failed', error));
      return;
    }
    wakeLock = acquired;
    wakeLockHeld = true;
    acquired.addEventListener('release', () => {
      if (wakeLock === acquired) {
        wakeLock = null;
        wakeLockHeld = false;
      }
    });
  } catch (err: any) {
    console.error(`Wake lock: ${err.name}, ${err.message}`);
  }
}

async function releaseWakeLock() {
  const previous = wakeLock;
  wakeLock = null;
  wakeLockHeld = false;
  if (previous) await previous.release();
}

// ── Fix handler (Step 2) ────────────────────────────────────────────

async function handleFix(pos: GeolocationPosition) {
  if (!currentTrackId) return;
  const fixingTrackId = currentTrackId;

  lastFixAt = Date.now();
  watchError = null;

  const newPoint = {
    lat: pos.coords.latitude,
    lon: pos.coords.longitude,
    timestamp: pos.timestamp,
    accuracy: pos.coords.accuracy,
  };

  // Accuracy filter: skip points worse than 50m (except first point)
  if (pos.coords.accuracy > 50 && pointsBuffer.length > 0) {
    droppedFixCount++;
    return;
  }

  pointsBuffer.push(newPoint);
  lastAcceptedFixAt = Date.now();
  lastAcceptedPoint = {
    lat: newPoint.lat,
    lon: newPoint.lon,
    accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
    headingDegrees: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
    timestamp: pos.timestamp,
  };

  const updatedAt = new Date().toISOString();
  if (!trackCreated) {
    const firstTrack = {
      id: fixingTrackId,
      projectId: trackProjectId!,
      sessionId: trackSessionId,
      name: trackName!,
      points: [...pointsBuffer],
      gaps: [...gaps],
      isActive: true,
      color: trackColor!,
      createdAt: trackCreatedAt!,
      updatedAt,
    };
    await db.transaction('rw', [db.tracks, db.settings], async () => {
      if (currentTrackId !== fixingTrackId) throw new Error('Trail start cancelled.');
      await db.tracks.add(firstTrack);
      await db.settings.put({ key: ACTIVE_BROWSER_TRACK_SETTING, value: fixingTrackId });
      // A timeout or cancellation while IndexedDB was writing must roll back
      // the first point, rather than revive an abandoned start.
      if (currentTrackId !== fixingTrackId) throw new Error('Trail start cancelled.');
    });
    if (currentTrackId !== fixingTrackId) return;
    trackCreated = true;
  } else {
    await db.tracks.update(fixingTrackId, {
      points: pointsBuffer,
      gaps,
      updatedAt,
    });
  }

  if (currentTrackId !== fixingTrackId) return;
  if (onFirstAcceptedFix) {
    onFirstAcceptedFix();
    onFirstAcceptedFix = null;
  }
}

// ── Watch registration + restart (Step 2) ───────────────────────────

function registerWatch(onError: (err: Error) => void) {
  const watchedTrackId = currentTrackId;
  let fixes = Promise.resolve();
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      // Serialise fixes so two callbacks cannot both create the first row.
      fixes = fixes.then(async () => {
        if (currentTrackId !== watchedTrackId) return;
        await handleFix(pos);
      }).catch((err) => {
        if (currentTrackId !== watchedTrackId) return;
        const error = new Error(`Could not save the trail: ${err instanceof Error ? err.message : String(err)}`);
        watchError = error.message;
        onError(error);
      });
    },
    err => {
      if (currentTrackId === watchedTrackId) onError(new Error(formatGeolocationError(err)));
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

const STALE_RESTART_MS = 15_000;

function restartWatchIfStale() {
  if (watchId === null) return;
  // Liveness is based on usable evidence. A stream of rejected low-accuracy
  // fixes must not make a dead trail look continuous.
  const last = lastAcceptedFixAt ?? lastFixAt ?? 0;
  if (Date.now() - last < STALE_RESTART_MS) return;

  // Record gap from last accepted fix to now (guard against duplicates)
  maybeRecordGap(gaps, lastAcceptedFixAt ?? lastFixAt, Date.now());

  navigator.geolocation.clearWatch(watchId);
  watchId = null;
  registerWatch((err) => {
    watchError = err.message;
  });
}

// ── Visibility handler (extended for stale restart) ─────────────────

const visibilityHandler = async () => {
  if (watchId !== null && document.visibilityState === 'visible') {
    void requestWakeLock();
    restartWatchIfStale();
  }
};

// ── Public API ──────────────────────────────────────────────────────

export async function startTracking(projectId: string, sessionId: string | null = null, name: string = "New Hunt"): Promise<string> {
    if (watchId !== null || isStarting) {
        throw new Error("Tracking already in progress");
    }
    if (!navigator.geolocation) {
        throw new Error("This browser does not support GPS tracking.");
    }
    isStarting = true;

    try {
        const trackId = uuid();
        const now = new Date().toISOString();
        pointsBuffer = [];
        resetLivenessState();

        const colors = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        currentTrackId = trackId;
        currentTrackSessionId = sessionId;

        // Capture creation context for handleFix
        trackProjectId = projectId;
        trackSessionId = sessionId;
        trackName = name;
        trackColor = randomColor;
        trackCreatedAt = now;

        // Screen wake locks are optional and must never gate location startup.
        void requestWakeLock();
        document.addEventListener('visibilitychange', visibilityHandler);

        await new Promise<void>((resolve, reject) => {
            let startSettled = false;
            const deadline = window.setTimeout(() => {
                failStart(new Error('Trail could not start in time. Check location access and GPS, then try again.'));
            }, 20_000);

            const failStart = (err: unknown) => {
                if (startSettled) {
                    watchError = err instanceof Error ? err.message : String(err);
                    return;
                }
                startSettled = true;
                window.clearTimeout(deadline);
                cancelTrackingStart = null;
                reject(err);
            };
            cancelTrackingStart = () => failStart(new DOMException('Trail start cancelled.', 'AbortError'));

            // Wire up first-fix resolution
            onFirstAcceptedFix = () => {
                if (!startSettled) {
                    startSettled = true;
                    window.clearTimeout(deadline);
                    cancelTrackingStart = null;
                    resolve();
                }
            };

            try { registerWatch(failStart); }
            catch (err) { failStart(err); }
        });

        // Start watchdog after first fix succeeds
        watchdogId = window.setInterval(restartWatchIfStale, 30_000);

        return trackId;
    } catch (err) {
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
        if (watchdogId !== null) {
            clearInterval(watchdogId);
            watchdogId = null;
        }
        document.removeEventListener('visibilitychange', visibilityHandler);
        currentTrackId = null;
        currentTrackSessionId = null;
        pointsBuffer = [];
        resetLivenessState();
        void releaseWakeLock().catch(error => {
          reportNonFatal('tracking', 'Wake lock release failed', error);
        });
        throw err;
    } finally {
        isStarting = false;
    }
}

export async function stopTracking() {
    cancelTrackingStart?.();
    if (watchdogId !== null) {
        clearInterval(watchdogId);
        watchdogId = null;
    }

    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    document.removeEventListener('visibilitychange', visibilityHandler);

    const trackId = currentTrackId;
    const finalGaps = gaps;
    currentTrackId = null;
    currentTrackSessionId = null;
    pointsBuffer = [];
    resetLivenessState();
    void releaseWakeLock().catch(error => reportNonFatal('tracking', 'Wake lock release failed', error));

    if (trackId) {
        await db.transaction('rw', [db.tracks, db.settings], async () => {
            await db.tracks.update(trackId, {
                isActive: false,
                gaps: finalGaps,
                updatedAt: new Date().toISOString()
            });
            const pointer = await db.settings.get(ACTIVE_BROWSER_TRACK_SETTING);
            if (pointer?.value === trackId) await db.settings.delete(ACTIVE_BROWSER_TRACK_SETTING);
        });
    }
}

export function isTrackingStartingForSession(sessionId: string): boolean {
    return isStarting && currentTrackSessionId === sessionId;
}

export function isTrackingActive(): boolean {
    return watchId !== null;
}

export function getCurrentTrackId(): string | null {
    return currentTrackId;
}

export function getCurrentTrackSessionId(): string | null {
    return currentTrackSessionId;
}

export function isTrackingActiveForSession(sessionId: string | null | undefined): boolean {
    return watchId !== null && !!sessionId && currentTrackSessionId === sessionId;
}

export function isTrackCurrentlyRecording(trackId: string): boolean {
    return watchId !== null && currentTrackId === trackId;
}
