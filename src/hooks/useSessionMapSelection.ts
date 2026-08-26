import { useEffect, useRef, useState, type RefObject } from 'react';
import maplibregl from 'maplibre-gl';
import type { Track } from '../db';
import type { SessionMapMarker } from './useSessionMap';

export const SESSION_MAP_TAP_TOLERANCE_PX = 12;
export const SESSION_MAP_POINT_LAYERS = ['session-markers', 'field-finds'] as const;
export const SESSION_MAP_TRAIL_LAYERS = ['tracks-line', 'field-tracks-line'] as const;

const KIND_ORDER: Record<SessionMapObjectRef['kind'], number> = {
  find: 0,
  signal: 1,
  observation: 2,
  point: 3,
  trail: 4,
};

export type SessionMapTrailRef = {
  id: string;
  kind: 'trail';
  sessionId: string | null;
};

export type SessionMapObjectRef = SessionMapMarker | SessionMapTrailRef;

export type SessionMapHit = {
  object: SessionMapObjectRef;
  distancePx: number;
};

export type SessionMapSelection =
  | { mode: 'object'; object: SessionMapObjectRef }
  | { mode: 'choices'; objects: SessionMapObjectRef[] };

export function sessionMapTapBox(point: { x: number; y: number }): [[number, number], [number, number]] {
  return [
    [point.x - SESSION_MAP_TAP_TOLERANCE_PX, point.y - SESSION_MAP_TAP_TOLERANCE_PX],
    [point.x + SESSION_MAP_TAP_TOLERANCE_PX, point.y + SESSION_MAP_TAP_TOLERANCE_PX],
  ];
}

/** Resolves rendered hits without depending on MapLibre or React. */
export function resolveSessionMapHits(hits: readonly SessionMapHit[]): SessionMapSelection | null {
  const nearestByObject = new Map<string, SessionMapHit>();
  for (const hit of hits) {
    const key = `${hit.object.kind}:${hit.object.id}`;
    const current = nearestByObject.get(key);
    if (!current || hit.distancePx < current.distancePx) nearestByObject.set(key, hit);
  }

  const deduplicated = [...nearestByObject.values()];
  const pointHits = deduplicated.filter(hit => hit.object.kind !== 'trail');
  const eligible = pointHits.length > 0 ? pointHits : deduplicated;
  const nearestByKind = new Map<SessionMapObjectRef['kind'], SessionMapHit>();
  for (const hit of eligible) {
    const current = nearestByKind.get(hit.object.kind);
    if (!current
      || hit.distancePx < current.distancePx
      || (hit.distancePx === current.distancePx && hit.object.id.localeCompare(current.object.id) < 0)) {
      nearestByKind.set(hit.object.kind, hit);
    }
  }

  const objects = [...nearestByKind.values()]
    .sort((left, right) => KIND_ORDER[left.object.kind] - KIND_ORDER[right.object.kind])
    .map(hit => hit.object);
  if (objects.length === 0) return null;
  if (objects.length === 1) return { mode: 'object', object: objects[0] };
  return { mode: 'choices', objects };
}

function pointDistance(left: { x: number; y: number }, right: { x: number; y: number }): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function pointToSegmentDistance(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return pointDistance(point, start);
  const progress = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy),
  ));
  return pointDistance(point, { x: start.x + progress * dx, y: start.y + progress * dy });
}

function lineDistance(
  map: maplibregl.Map,
  point: { x: number; y: number },
  geometry: GeoJSON.Geometry,
): number {
  const lines = geometry.type === 'LineString'
    ? [geometry.coordinates]
    : geometry.type === 'MultiLineString'
      ? geometry.coordinates
      : [];
  let nearest = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    for (let index = 1; index < line.length; index++) {
      const start = map.project(line[index - 1] as [number, number]);
      const end = map.project(line[index] as [number, number]);
      nearest = Math.min(nearest, pointToSegmentDistance(point, start, end));
    }
  }
  return nearest;
}

function renderedHits(params: {
  map: maplibregl.Map;
  point: { x: number; y: number };
  markers: readonly SessionMapMarker[];
  fieldFindMarkers: readonly SessionMapMarker[];
  tracks: readonly Track[];
  fieldTracks: readonly Track[];
}): SessionMapHit[] {
  const { map, point } = params;
  const layers = [...SESSION_MAP_POINT_LAYERS, ...SESSION_MAP_TRAIL_LAYERS]
    .filter(layer => map.getLayer(layer));
  if (layers.length === 0) return [];
  const features = map.queryRenderedFeatures(sessionMapTapBox(point), { layers });
  const markerByKey = new Map(
    [...params.markers, ...params.fieldFindMarkers]
      .map(marker => [`${marker.kind}:${marker.id}`, marker] as const),
  );
  const trackById = new Map(
    [...params.tracks, ...params.fieldTracks].map(track => [track.id, track] as const),
  );

  return features.flatMap<SessionMapHit>(feature => {
    const id = typeof feature.properties?.id === 'string' ? feature.properties.id : null;
    const kind = feature.properties?.kind;
    if (!id) return [];
    if (kind === 'trail') {
      const track = trackById.get(id);
      if (!track) return [];
      return [{
        object: { id: track.id, kind: 'trail', sessionId: track.sessionId },
        distancePx: lineDistance(map, point, feature.geometry),
      }];
    }
    if (kind !== 'find' && kind !== 'signal' && kind !== 'observation' && kind !== 'point') return [];
    const markerKind = kind as SessionMapMarker['kind'];
    const marker = markerByKey.get(`${markerKind}:${id}`);
    if (!marker) return [];
    return [{ object: marker, distancePx: pointDistance(point, map.project([marker.lon, marker.lat])) }];
  });
}

/** Owns map-object hit testing and the active inspection/list selection. */
export function useSessionMapSelection(params: {
  mapRef: RefObject<maplibregl.Map | null>;
  mapReadyVersion: number;
  enabled: boolean;
  markers?: SessionMapMarker[];
  fieldFindMarkers?: SessionMapMarker[];
  tracks?: Track[];
  fieldTracks?: Track[];
}) {
  const [selection, setSelection] = useState<SessionMapSelection | null>(null);
  const dataRef = useRef(params);
  dataRef.current = params;

  useEffect(() => {
    if (!params.enabled) setSelection(null);
  }, [params.enabled]);

  useEffect(() => {
    const map = params.mapRef.current;
    if (!params.enabled || !map || params.mapReadyVersion === 0) return;
    const onClick = (event: maplibregl.MapMouseEvent) => {
      const current = dataRef.current;
      setSelection(resolveSessionMapHits(renderedHits({
        map,
        point: event.point,
        markers: current.markers ?? [],
        fieldFindMarkers: current.fieldFindMarkers ?? [],
        tracks: current.tracks ?? [],
        fieldTracks: current.fieldTracks ?? [],
      })));
    };
    map.on('click', onClick);
    return () => { map.off('click', onClick); };
  }, [params.enabled, params.mapReadyVersion, params.mapRef]);

  return {
    selection,
    clearSelection: () => setSelection(null),
    chooseMapObject: (object: SessionMapObjectRef) => setSelection({ mode: 'object', object }),
  };
}
