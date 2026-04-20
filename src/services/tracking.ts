import { db, Track } from "../db";
import { v4 as uuid } from "uuid";

let watchId: number | null = null;
let currentTrackId: string | null = null;
let wakeLock: any = null;
let isStarting = false;
let pointsBuffer: { lat: number; lon: number; timestamp: number; accuracy: number }[] = [];

export function isWakeLockSupported(): boolean {
  return 'wakeLock' in navigator;
}

async function requestWakeLock() {
  if (!isWakeLockSupported()) return;
  try {
    if (wakeLock) await wakeLock.release();
    wakeLock = await (navigator as any).wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
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
    isStarting = true;

    try {
        const trackId = uuid();
        const now = new Date().toISOString();
        pointsBuffer = [];

        const colors = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        await db.tracks.add({
            id: trackId,
            projectId,
            sessionId,
            name,
            points: [],
            isActive: true,
            color: randomColor,
            createdAt: now,
            updatedAt: now
        });

        currentTrackId = trackId;

        await requestWakeLock();

        // Re-acquire wake lock when app returns to foreground
        document.addEventListener('visibilitychange', visibilityHandler);

        watchId = navigator.geolocation.watchPosition(
            async (pos) => {
                if (!currentTrackId) return;

                const newPoint = {
                    lat: pos.coords.latitude,
                    lon: pos.coords.longitude,
                    timestamp: pos.timestamp,
                    accuracy: pos.coords.accuracy
                };

                // Only add if accuracy is decent (< 50m) OR it's the first point
                if (pos.coords.accuracy > 50 && pointsBuffer.length > 0) return;

                pointsBuffer.push(newPoint);
                await db.tracks.update(currentTrackId, {
                    points: pointsBuffer,
                    updatedAt: new Date().toISOString()
                });
            },
            (err) => {
                console.error("Tracking error:", err);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );

        return trackId;
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
    pointsBuffer = [];

    await releaseWakeLock();
}

export function isTrackingActive(): boolean {
    return watchId !== null;
}

export function getCurrentTrackId(): string | null {
    return currentTrackId;
}
