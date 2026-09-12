import { ephemeralSession } from './clientStorage';
import { reportNonFatal } from './diagLog';
export type FindsMapState = { center: [number, number]; zoom: number; satellite: boolean };
const key = (projectId: string) => `fs_finds_map:${projectId}`;
export function loadFindsMapState(projectId: string): FindsMapState | null {
  try {
    const value = JSON.parse(ephemeralSession.get(key(projectId)) ?? 'null');
    if (value && Array.isArray(value.center) && value.center.length === 2 && value.center.every(Number.isFinite)
      && Math.abs(value.center[1]) <= 90 && Number.isFinite(value.zoom) && value.zoom >= 0 && value.zoom <= 24
      && typeof value.satellite === 'boolean') return value;
  } catch (error) { reportNonFatal('finds-map', 'Could not restore optional map state', error); }
  return null;
}
export function saveFindsMapState(projectId: string, value: FindsMapState) {
  try { ephemeralSession.set(key(projectId), JSON.stringify(value)); } catch (error) { reportNonFatal('finds-map', 'Could not retain optional map state', error); }
}
