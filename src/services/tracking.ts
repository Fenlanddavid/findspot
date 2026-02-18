import { db, Track } from "../db";
import { v4 as uuid } from "uuid";

let watchId: number | null = null;
let currentTrackId: string | null = null;
let wakeLock: any = null;

// Request wake lock to prevent screen from sleeping
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await (navigator as any).wakeLock.request('screen');
      console.log('Wake Lock is active');
      
      wakeLock.addEventListener('release', () => {
        console.log('Wake Lock was released');
      });
    }
  } catch (err: any) {
    console.error(`${err.name}, ${err.message}`);
  }
}

// Release wake lock
async function releaseWakeLock() {
  if (wakeLock !== null) {
    await wakeLock.release();
    wakeLock = null;
  }
}

// Re-acquire wake lock when app becomes visible again
document.addEventListener('visibilitychange', async () => {
  if (watchId !== null && document.visibilityState === 'visible') {
    await requestWakeLock();
  }
});

export async function startTracking(projectId: string, sessionId: string | null = null, name: string = "New Hunt"): Promise<string> {
    if (watchId !== null) {
        throw new Error("Tracking already in progress");
    }

    const trackId = uuid();
    const now = new Date().toISOString();
    
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

    // Start Wake Lock
    await requestWakeLock();

    watchId = navigator.geolocation.watchPosition(
        async (pos) => {
            if (!currentTrackId) return;
            
            const track = await db.tracks.get(currentTrackId);
            if (!track) return;

            const newPoint = {
                lat: pos.coords.latitude,
                lon: pos.coords.longitude,
                timestamp: pos.timestamp,
                accuracy: pos.coords.accuracy
            };

            // Only add if accuracy is decent (e.g. < 50m) OR it's the first point
            if (pos.coords.accuracy > 50 && track.points.length > 0) return;

            await db.tracks.update(currentTrackId, {
                points: [...track.points, newPoint],
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
}

export async function stopTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    if (currentTrackId) {
        await db.tracks.update(currentTrackId, {
            isActive: false,
            updatedAt: new Date().toISOString()
        });
        currentTrackId = null;
    }

    // Release Wake Lock
    await releaseWakeLock();
}

export function isTrackingActive(): boolean {
    return watchId !== null;
}

export function getCurrentTrackId(): string | null {
    return currentTrackId;
}