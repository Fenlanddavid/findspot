import * as turf from '@turf/turf';
import type { Field, GeoJSONPolygon, Permission } from '../../db';
import {
  fetchScheduledMonuments,
  type NHLEResponse,
  type SMDatasetMetadata,
} from '../historicScanService';
import { resolveScheduledMonumentMapCoverage } from './sessionScheduledMonuments';
import { reportNonFatal } from '../diagLog';

export type SessionStartProtectionState =
  | 'loading'
  | 'recorded_monument'
  | 'none_recorded'
  | 'not_checked';

export type SessionStartProtection = {
  state: SessionStartProtectionState;
  monumentCount: number;
  reason: 'no_boundary' | 'not_cached' | 'partial_coverage' | 'unavailable' | null;
  dataset?: SMDatasetMetadata;
};

export const INITIAL_SESSION_START_PROTECTION: SessionStartProtection = {
  state: 'loading',
  monumentCount: 0,
  reason: null,
};

function boundaryFeature(boundary: GeoJSONPolygon) {
  return turf.polygon(boundary.coordinates);
}

function boundaryBbox(boundary: GeoJSONPolygon): [number, number, number, number] {
  const bounds = turf.bbox(boundaryFeature(boundary));
  return [bounds[0], bounds[1], bounds[2], bounds[3]];
}

function recordedIntersectionCount(boundary: GeoJSONPolygon, response: NHLEResponse): number {
  const area = boundaryFeature(boundary);
  return response.features.filter(feature => {
    try {
      return turf.booleanIntersects(area, turf.feature(feature.geometry as GeoJSON.Geometry));
    } catch {
      // A returned scheduled-monument record must never disappear into a
      // reassuring empty state because one geometry could not be evaluated.
      return true;
    }
  }).length;
}

export function resolveSessionStartProtection(
  boundary: GeoJSONPolygon | undefined,
  response: NHLEResponse | null,
): SessionStartProtection {
  if (!boundary) {
    return { state: 'not_checked', monumentCount: 0, reason: 'no_boundary' };
  }
  if (!response) {
    return { state: 'not_checked', monumentCount: 0, reason: 'unavailable' };
  }

  const bbox = boundaryBbox(boundary);
  const monumentCount = recordedIntersectionCount(boundary, response);
  if (monumentCount > 0) {
    return {
      state: 'recorded_monument',
      monumentCount,
      reason: null,
      dataset: response.dataset,
    };
  }

  const coverage = resolveScheduledMonumentMapCoverage(bbox, response);
  if (coverage.status === 'not_cached') {
    return {
      state: 'not_checked', monumentCount: 0, reason: 'not_cached', dataset: response.dataset,
    };
  }
  if (coverage.status !== 'ready') {
    return {
      state: 'not_checked', monumentCount: 0, reason: 'unavailable', dataset: response.dataset,
    };
  }
  if (coverage.classification !== 'covered' || coverage.unavailableReason) {
    return {
      state: 'not_checked', monumentCount: 0, reason: 'partial_coverage', dataset: response.dataset,
    };
  }
  return {
    state: 'none_recorded', monumentCount: 0, reason: null, dataset: response.dataset,
  };
}

export async function readSessionStartProtection(
  boundary: GeoJSONPolygon | undefined,
  signal?: AbortSignal,
): Promise<SessionStartProtection> {
  if (!boundary) return resolveSessionStartProtection(undefined, null);
  const [west, south, east, north] = boundaryBbox(boundary);
  const response = await fetchScheduledMonuments(
    west, south, east, north, signal, { cacheOnly: true, allowPartialCoverage: true },
  );
  return resolveSessionStartProtection(boundary, response);
}

export function sessionStartReferencePoint(
  permission: Permission | null | undefined,
  field: Field | null | undefined,
): { lat: number; lon: number } | null {
  const boundary = field?.boundary ?? permission?.boundary;
  if (boundary) {
    try {
      const point = turf.pointOnFeature(boundaryFeature(boundary)).geometry.coordinates;
      if (Number.isFinite(point[0]) && Number.isFinite(point[1])) {
        return { lon: point[0], lat: point[1] };
      }
    } catch (error) {
      reportNonFatal('session-start', 'Could not derive a boundary reference point; using the permission point.', error);
      // Fall through to the permission's explicitly recorded point.
    }
  }
  if (Number.isFinite(permission?.lat) && Number.isFinite(permission?.lon)) {
    return { lat: permission!.lat!, lon: permission!.lon! };
  }
  return null;
}

function normaliseDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function dayOfYear(year: number, month: number, day: number): number {
  const start = Date.UTC(year, 0, 0);
  return Math.floor((Date.UTC(year, month, day) - start) / 86_400_000);
}

function solarEventUtcHours(
  year: number,
  month: number,
  day: number,
  lat: number,
  lon: number,
  sunrise: boolean,
): number | null {
  const n = dayOfYear(year, month, day);
  const longitudeHour = lon / 15;
  const approximateTime = n + ((sunrise ? 6 : 18) - longitudeHour) / 24;
  const meanAnomaly = (0.9856 * approximateTime) - 3.289;
  const trueLongitude = normaliseDegrees(
    meanAnomaly
      + 1.916 * Math.sin(meanAnomaly * Math.PI / 180)
      + 0.020 * Math.sin(2 * meanAnomaly * Math.PI / 180)
      + 282.634,
  );
  let rightAscension = normaliseDegrees(
    Math.atan(0.91764 * Math.tan(trueLongitude * Math.PI / 180)) * 180 / Math.PI,
  );
  rightAscension += Math.floor(trueLongitude / 90) * 90 - Math.floor(rightAscension / 90) * 90;
  rightAscension /= 15;
  const sinDeclination = 0.39782 * Math.sin(trueLongitude * Math.PI / 180);
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosHourAngle = (
    Math.cos(90.833 * Math.PI / 180)
      - sinDeclination * Math.sin(lat * Math.PI / 180)
  ) / (cosDeclination * Math.cos(lat * Math.PI / 180));
  if (cosHourAngle > 1 || cosHourAngle < -1) return null;
  const hourAngle = sunrise
    ? 360 - Math.acos(cosHourAngle) * 180 / Math.PI
    : Math.acos(cosHourAngle) * 180 / Math.PI;
  const localMeanTime = hourAngle / 15 + rightAscension - 0.06571 * approximateTime - 6.622;
  return ((localMeanTime - longitudeHour) % 24 + 24) % 24;
}

function eventDate(now: Date, utcHours: number): Date {
  const wholeHours = Math.floor(utcHours);
  const minutes = Math.floor((utcHours - wholeHours) * 60);
  const seconds = Math.round((((utcHours - wholeHours) * 60) - minutes) * 60);
  return new Date(Date.UTC(
    now.getFullYear(), now.getMonth(), now.getDate(), wholeHours, minutes, seconds,
  ));
}

export type DaylightSummary = {
  state: 'daylight' | 'before_sunrise' | 'after_sunset' | 'unavailable';
  minutes: number | null;
  sunset: Date | null;
};

export function daylightSummary(
  now: Date,
  point: { lat: number; lon: number } | null,
): DaylightSummary {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) {
    return { state: 'unavailable', minutes: null, sunset: null };
  }
  const sunriseHours = solarEventUtcHours(
    now.getFullYear(), now.getMonth(), now.getDate(), point.lat, point.lon, true,
  );
  const sunsetHours = solarEventUtcHours(
    now.getFullYear(), now.getMonth(), now.getDate(), point.lat, point.lon, false,
  );
  if (sunriseHours === null || sunsetHours === null) {
    return { state: 'unavailable', minutes: null, sunset: null };
  }
  const sunrise = eventDate(now, sunriseHours);
  const sunset = eventDate(now, sunsetHours);
  if (now < sunrise) {
    return {
      state: 'before_sunrise', minutes: Math.max(0, Math.ceil((sunrise.getTime() - now.getTime()) / 60_000)), sunset,
    };
  }
  if (now >= sunset) return { state: 'after_sunset', minutes: 0, sunset };
  return {
    state: 'daylight', minutes: Math.max(0, Math.floor((sunset.getTime() - now.getTime()) / 60_000)), sunset,
  };
}
