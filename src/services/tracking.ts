import { db, Track } from "../db";
import { v4 as uuid } from "uuid";

let watchId: number | null = null;
let currentTrackId: string | null = null;

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

            // Only add if accuracy is decent (e.g. < 30m) OR it's the first point
            if (pos.coords.accuracy > 50 && track.points.length > 0) return;

            // Simple distance check to avoid jitter? 
            // For now, just add all.

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
}

export function isTrackingActive(): boolean {
    return watchId !== null;
}

export function getCurrentTrackId(): string | null {
    return currentTrackId;
}
