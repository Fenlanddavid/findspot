import { db } from "../db";
import { v4 as uuid } from "uuid";

let watchId: number | null = null;
let currentTrackId: string | null = null;
let currentTrackSessionId: string | null = null;
let wakeLock: WakeLockSentinel | null = null;
let isStarting = false;
let pointsBuffer: { lat: number; lon: number; timestamp: number; accuracy: number }[] = [];

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

export function isWakeLockSupported(): boolean {
  return 'wakeLock' in navigator;
}

async function requestWakeLock() {
  if (!isWakeLockSupported()) return;
  try {
    if (wakeLock) await wakeLock.release();
    wakeLock = await (navigator as any).wakeLock.request('screen');
    wakeLock!.addEventListener('release', () => { wakeLock = null; });
  } catch (err: any) {
    console.error(`Wake lock: ${err.name}, ${err.message}`);
  }
}

async function releaseWakeLock() {
  if (wakeLock !== null) {
    await wakeLock.release();
    wakeLock = null;
  }
}

// Defined once so it can be added and removed cleanly
const visibilityHandler = async () => {
  if (watchId !== null && document.visibilityState === 'visible') {
    await requestWakeLock();
  }
};

export async function startTracking(projectId: string, sessionId: string | null = null, name: string = "New Hunt"): Promise<string> {
    // Guard against concurrent calls — isStarting covers the async gap before watchId is set
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

        const colors = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        currentTrackId = trackId;
        currentTrackSessionId = sessionId;

        await requestWakeLock();

        // Re-acquire wake lock when app returns to foreground
        document.addEventListener('visibilitychange', visibilityHandler);

        let trackCreated = false;
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
                await releaseWakeLock().catch(() => {});
                reject(err);
            };

            watchId = navigator.geolocation.watchPosition(
                async (pos) => {
                    if (!currentTrackId) return;

                    try {
                        const newPoint = {
                            lat: pos.coords.latitude,
                            lon: pos.coords.longitude,
                            timestamp: pos.timestamp,
                            accuracy: pos.coords.accuracy
                        };

                        // Only add if accuracy is decent (< 50m) OR it's the first point
                        if (pos.coords.accuracy > 50 && pointsBuffer.length > 0) return;

                        pointsBuffer.push(newPoint);
                        const updatedAt = new Date().toISOString();
                        if (!trackCreated) {
                            await db.tracks.add({
                                id: trackId,
                                projectId,
                                sessionId,
                                name,
                                points: pointsBuffer,
                                isActive: true,
                                color: randomColor,
                                createdAt: now,
                                updatedAt
                            });
                            trackCreated = true;
                        } else {
                            await db.tracks.update(currentTrackId, {
                                points: pointsBuffer,
                                updatedAt
                            });
                        }

                        if (!startSettled) {
                            startSettled = true;
                            resolve();
                        }
                    } catch (err) {
                        await failStart(err);
                    }
                },
                (err) => {
                    void failStart(new Error(formatGeolocationError(err)));
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                }
            );
        });

        return trackId;
    } catch (err) {
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
        document.removeEventListener('visibilitychange', visibilityHandler);
        currentTrackId = null;
        currentTrackSessionId = null;
        pointsBuffer = [];
        await releaseWakeLock().catch(() => {});
        throw err;
    } finally {
        isStarting = false;
    }
}

export async function stopTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    document.removeEventListener('visibilitychange', visibilityHandler);

    if (currentTrackId) {
        await db.tracks.update(currentTrackId, {
            isActive: false,
            updatedAt: new Date().toISOString()
        });
        currentTrackId = null;
    }
    currentTrackSessionId = null;
    pointsBuffer = [];

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
