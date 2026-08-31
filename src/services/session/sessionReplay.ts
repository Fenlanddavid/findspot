import type { Find, SavedPoint, SurfaceObservation, Track, UndugSignal } from '../../db';
import { segmentCrossesRecordedGap } from '../../shared/trackSegments';

export type SessionReplayMarkerKind = 'find' | 'signal' | 'observation' | 'saved_point';

export type SessionReplayMarker = {
  id: string;
  kind: SessionReplayMarkerKind;
  lat: number;
  lon: number;
  timestamp: number;
  label: string;
};

export type SessionReplayPoint = {
  lat: number;
  lon: number;
  timestamp: number;
};

export type SessionReplayData = {
  trailSegments: SessionReplayPoint[][];
  markers: SessionReplayMarker[];
  startedAt: number;
  endedAt: number;
};

function parsedTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function locationIsUsable(lat: number | null | undefined, lon: number | null | undefined): lat is number {
  return Number.isFinite(lat) && Number.isFinite(lon);
}

function splitTrack(track: Track): SessionReplayPoint[][] {
  const sorted = [...track.points].sort((left, right) => left.timestamp - right.timestamp);
  const segments: SessionReplayPoint[][] = [];
  let current: SessionReplayPoint[] = [];
  for (const point of sorted) {
    const previous = current[current.length - 1];
    if (previous && segmentCrossesRecordedGap(previous.timestamp, point.timestamp, track.gaps)) {
      if (current.length > 0) segments.push(current);
      current = [];
    }
    current.push({ lat: point.lat, lon: point.lon, timestamp: point.timestamp });
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

export function buildSessionReplay(input: {
  sessionId: string;
  sessionStartedAt: number;
  sessionEndedAt?: number | null;
  tracks: Track[];
  finds: Find[];
  signals: UndugSignal[];
  observations: SurfaceObservation[];
  savedPoints: SavedPoint[];
}): SessionReplayData {
  const trailSegments = input.tracks.flatMap(splitTrack);
  const markers: SessionReplayMarker[] = [];

  for (const find of input.finds) {
    if (!locationIsUsable(find.lat, find.lon)) continue;
    const timestamp = parsedTimestamp(find.foundAt) ?? parsedTimestamp(find.createdAt);
    if (timestamp === null) continue;
    markers.push({ id: find.id, kind: 'find', lat: find.lat, lon: find.lon!, timestamp, label: find.findCode || 'Find' });
  }
  for (const signal of input.signals) {
    if (!locationIsUsable(signal.lat, signal.lng)) continue;
    markers.push({ id: signal.id, kind: 'signal', lat: signal.lat, lon: signal.lng, timestamp: signal.createdAt, label: 'Signal' });
  }
  for (const observation of input.observations) {
    if (observation.retiredAt) continue;
    const timestamp = parsedTimestamp(observation.observedAt);
    if (timestamp === null) continue;
    markers.push({
      id: observation.id,
      kind: 'observation',
      lat: observation.lat,
      lon: observation.lon,
      timestamp,
      label: observation.observationKind === 'iron_patch' ? 'Iron / junk patch' : 'Surface observation',
    });
  }
  const notePrefix = `Session ${input.sessionId}`;
  for (const point of input.savedPoints) {
    if (point.note !== notePrefix && !point.note.startsWith(`${notePrefix} ·`)) continue;
    const timestamp = parsedTimestamp(point.createdAt);
    if (timestamp === null) continue;
    markers.push({ id: point.id, kind: 'saved_point', lat: point.lat, lon: point.lon, timestamp, label: point.label });
  }

  markers.sort((left, right) => left.timestamp - right.timestamp);
  const timestamps = [
    input.sessionStartedAt,
    ...trailSegments.flatMap(segment => segment.map(point => point.timestamp)),
    ...markers.map(marker => marker.timestamp),
    ...(input.sessionEndedAt == null ? [] : [input.sessionEndedAt]),
  ].filter(Number.isFinite);
  const startedAt = Math.min(...timestamps);
  const endedAt = Math.max(startedAt + 1, ...timestamps);

  return { trailSegments, markers, startedAt, endedAt };
}
