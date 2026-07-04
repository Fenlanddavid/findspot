import { db } from "../db";
import { v4 as uuid } from "uuid";

// ── Core state ──────────────────────────────────────────────────────
let watchId: number | null = null;
let currentTrackId: string | null = null;
let currentTrackSessionId: string | null = null;
let wakeLock: WakeLockSentinel | null = null;
let isStarting = false;
let pointsBuffer: { lat: number; lon: number; timestamp: number; accuracy: number }[] = [];

// ── Liveness state (Step 1) ─────────────────────────────────────────
let lastFixAt: number | null = null;
let lastAcceptedFixAt: number | null = null;
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

function resetLivenessState() {
  lastFixAt = null;
  lastAcceptedFixAt = null;
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

    const cutoff = Date.now() - staleAfterMs;
    const activeTracks = await db.tracks
        .filter(track => !!track.isActive && new Date(track.updatedAt).getTime() < cutoff)
        .toArray();
    if (activeTracks.length === 0) return 0;

    const now = new Date().toISOString();
    await db.tracks.bulkPut(activeTracks.map(track => ({
        ...track,
        isActive: false,
        updatedAt: now,
    })));
    return activeTracks.length;
}

// ── Status API (poll-based) ─────────────────────────────────────────

export type TrackingStatus = {
  active: boolean;
  lastFixAt: number | null;
  lastAcceptedFixAt: number | null;
  droppedFixCount: number;
  wakeLockHeld: boolean;
  wakeLockSupported: boolean;
  watchError: string | null;
  gapCount: number;
};

export function getTrackingStatus(): TrackingStatus {
  return {
    active: watchId !== null,
    lastFixAt,
    lastAcceptedFixAt,
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
  if (!isWakeLockSupported()) return;
  try {
    if (wakeLock) await wakeLock.release();
    wakeLock = await (navigator as any).wakeLock.request('screen');
    wakeLockHeld = true;
    wakeLock!.addEventListener('release', () => {
      wakeLock = null;
      wakeLockHeld = false;
    });
  } catch (err: any) {
    wakeLockHeld = false;
    console.error(`Wake lock: ${err.name}, ${err.message}`);
  }
}

async function releaseWakeLock() {
  if (wakeLock !== null) {
    await wakeLock.release();
    wakeLock = null;
  }
  wakeLockHeld = false;
}

// ── Fix handler (Step 2) ────────────────────────────────────────────

async function handleFix(pos: GeolocationPosition) {
  if (!currentTrackId) return;

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

  const updatedAt = new Date().toISOString();
  if (!trackCreated) {
    await db.tracks.add({
      id: currentTrackId,
      projectId: trackProjectId!,
      sessionId: trackSessionId,
      name: trackName!,
      points: pointsBuffer,
      gaps,
      isActive: true,
      color: trackColor!,
      createdAt: trackCreatedAt!,
      updatedAt,
    });
    trackCreated = true;
  } else {
    await db.tracks.update(currentTrackId, {
      points: pointsBuffer,
      gaps,
      updatedAt,
    });
  }

  if (onFirstAcceptedFix) {
    onFirstAcceptedFix();
    onFirstAcceptedFix = null;
  }
}

// ── Watch registration + restart (Step 2) ───────────────────────────

function registerWatch(onError: (err: GeolocationPositionError) => void) {
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      void handleFix(pos).catch((err) => {
        watchError = err instanceof Error ? err.message : String(err);
        console.error("Tracking fix error:", err);
      });
    },
    onError,
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

const STALE_RESTART_MS = 15_000;

function restartWatchIfStale() {
  if (watchId === null) return;
  const last = lastFixAt ?? 0;
  if (Date.now() - last < STALE_RESTART_MS) return;

  // Record gap from last accepted fix to now (guard against duplicates)
  maybeRecordGap(gaps, lastAcceptedFixAt ?? lastFixAt, Date.now());

  navigator.geolocation.clearWatch(watchId);
  watchId = null;
  registerWatch((err) => {
    watchError = formatGeolocationError(err);
  });
}

// ── Visibility handler (extended for stale restart) ─────────────────

const visibilityHandler = async () => {
  if (watchId !== null && document.visibilityState === 'visible') {
    await requestWakeLock();
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

        await requestWakeLock();
        document.addEventListener('visibilitychange', visibilityHandler);

        await new Promise<void>((resolve, reject) => {
            let startSettled = false;

            const failStart = async (err: unknown) => {
                if (startSettled) {
                    console.error("Tracking error:", err);
                    return;
                }
                startSettled = true;
                if (watchId !== null) {
                    navigator.geolocation.clearWatch(watchId);
                    watchId = null;
                }
                document.removeEventListener('visibilitychange', visibilityHandler);
                currentTrackId = null;
                currentTrackSessionId = null;
                pointsBuffer = [];
                resetLivenessState();
                await releaseWakeLock().catch(() => {});
                reject(err);
            };

            // Wire up first-fix resolution
            onFirstAcceptedFix = () => {
                if (!startSettled) {
                    startSettled = true;
                    resolve();
                }
            };

            registerWatch((err) => {
                void failStart(new Error(formatGeolocationError(err)));
            });
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
        await releaseWakeLock().catch(() => {});
        throw err;
    } finally {
        isStarting = false;
    }
}

export async function stopTracking() {
    if (watchdogId !== null) {
        clearInterval(watchdogId);
        watchdogId = null;
    }

    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    document.removeEventListener('visibilitychange', visibilityHandler);

    if (currentTrackId) {
        await db.tracks.update(currentTrackId, {
            isActive: false,
            gaps,
            updatedAt: new Date().toISOString()
        });
        currentTrackId = null;
    }
    currentTrackSessionId = null;
    pointsBuffer = [];
    resetLivenessState();

    await releaseWakeLock();
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
