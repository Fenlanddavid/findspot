import type { FindLocationMethod } from '../db';
export type CaptureLocation = { gpsAccuracyM?: number | null; fixTimestamp?: number; capturedAt?: number; captureMethod?: FindLocationMethod };
export function captureLocationStatus(location: CaptureLocation | null, capturedAt = location?.capturedAt ?? Date.now()) {
  if (!location) return { label: 'No position captured', warning: true };
  const lowAccuracy = location.gpsAccuracyM != null && location.gpsAccuracyM > 50;
  const unknownAge = location.fixTimestamp == null || !Number.isFinite(location.fixTimestamp);
  const earlier = !unknownAge && capturedAt - location.fixTimestamp! > 60_000;
  const unknownAccuracy = location.gpsAccuracyM == null || !Number.isFinite(location.gpsAccuracyM);
  const manual = location.captureMethod === 'map_selected';
  const label = manual ? 'Position selected on map' : earlier ? 'Earlier position captured' : unknownAge ? 'Position captured · age unknown' : 'Position captured';
  return { label: lowAccuracy ? `${label} · low accuracy` : unknownAccuracy ? `${label} · accuracy unknown` : label,
    warning: earlier || lowAccuracy || unknownAge || unknownAccuracy };
}
export function captureElapsed(capturedAt: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - capturedAt) / 1000));
  if (seconds < 60) return `captured ${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  return `captured ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
}
export function fixTimeIso(timestamp: number | undefined) {
  const date = timestamp != null ? new Date(timestamp) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
