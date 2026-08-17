import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Find, GeoJSONPolygon, Track } from '../db';
import { pagePersistence } from '../services/pagePersistence';
import type { TrackingPoint } from '../services/tracking';
import type { SessionMapMarker } from './useSessionMap';
import { distanceMetres, evaluateBoundaryPosition, type FieldLocation } from '../services/session/sessionFieldPosition';
import { recentSessionActivity } from '../services/session/sessionActivity';

export function useActiveSessionFieldContext(params: {
  projectId: string;
  sessionId: string;
  finds: Find[] | undefined;
  tracks: Track[] | undefined;
  trackingPoint: TrackingPoint | null;
  trackFallbackEnabled: boolean;
  manualLocation: FieldLocation | null;
  boundary: GeoJSONPolygon | undefined;
}) {
  const signals = useLiveQuery(
    () => pagePersistence.undugSignals.where('sessionId').equals(params.sessionId).toArray(),
    [params.sessionId], [],
  );
  const observations = useLiveQuery(
    () => pagePersistence.surfaceObservations.where('sessionId').equals(params.sessionId).toArray(),
    [params.sessionId], [],
  );
  const savedPoints = useLiveQuery(
    () => pagePersistence.savedPoints.where('projectId').equals(params.projectId)
      .filter(point => point.note.includes(`Session ${params.sessionId}`)).toArray(),
    [params.projectId, params.sessionId], [],
  );
  const latestTrackLocation = useMemo<FieldLocation | null>(() => {
    const point = (params.tracks ?? []).flatMap(track => track.points ?? [])
      .filter(candidate => Number.isFinite(candidate.lat) && Number.isFinite(candidate.lon))
      .sort((left, right) => left.timestamp - right.timestamp).at(-1);
    return point ? { lat: point.lat, lon: point.lon, accuracyM: point.accuracy ?? null, headingDegrees: point.headingDegrees ?? null } : null;
  }, [params.tracks]);
  const liveLocation: FieldLocation | null = params.trackingPoint
    ? { lat: params.trackingPoint.lat, lon: params.trackingPoint.lon, accuracyM: params.trackingPoint.accuracyM, headingDegrees: params.trackingPoint.headingDegrees }
    : params.manualLocation ?? (params.trackFallbackEnabled ? latestTrackLocation : null);
  const markers = useMemo(() => [
    ...(params.finds ?? []).flatMap<SessionMapMarker>(find => find.lat != null && find.lon != null ? [{ id: find.id, kind: 'find', lat: find.lat, lon: find.lon }] : []),
    ...signals.flatMap<SessionMapMarker>(signal => Number.isFinite(signal.lat) && Number.isFinite(signal.lng) ? [{ id: signal.id, kind: 'signal', lat: signal.lat, lon: signal.lng }] : []),
    ...observations.filter(item => !item.retiredAt).map<SessionMapMarker>(item => ({ id: item.id, kind: 'observation', lat: item.lat, lon: item.lon })),
    ...savedPoints.map<SessionMapMarker>(point => ({ id: point.id, kind: 'point', lat: point.lat, lon: point.lon })),
  ], [observations, params.finds, savedPoints, signals]);
  const startPoint = savedPoints.find(point => point.label === 'Start point') ?? null;
  const startPointDistanceText = startPoint && liveLocation
    ? (() => { const metres = distanceMetres(liveLocation, startPoint); return metres < 1_000 ? `${Math.round(metres)}m away` : `${(metres / 1_000).toFixed(1)}km away`; })()
    : null;
  const recentActivity = useMemo(() => recentSessionActivity({
    finds: params.finds ?? [], signals, observations, savedPoints,
  }), [observations, params.finds, savedPoints, signals]);
  const findActivity = useMemo(() => recentSessionActivity({
    finds: params.finds ?? [], signals: [], observations: [], savedPoints: [],
  }, Number.MAX_SAFE_INTEGER), [params.finds]);

  return {
    signals, observations, savedPoints, liveLocation, markers, startPoint, startPointDistanceText, recentActivity, findActivity,
    boundaryStatus: evaluateBoundaryPosition(params.boundary, liveLocation),
    openSignalCount: signals.filter(item => item.status === 'open').length,
    observationCount: observations.filter(item => !item.retiredAt).length,
  };
}
