import * as turf from '@turf/turf';
import type { Cluster } from '../../pages/fieldGuideTypes';
import { MONUMENT_BOUNDARY_BUFFER_M } from '../../utils/fieldGuideAnalysis';
import { hasDistinctImageryObservations } from '../../types/evidenceProvenance';

function hasDeliveredLidar(feature: Cluster): boolean {
    return (feature.provenance ?? []).some(item => item.parentSourceIdentity.startsWith('ea-lidar-composite') && item.fallbackStatus !== 'fallback');
}

export const MONUMENT_BUFFER_FILL_PAINT = {
    'fill-color': '#f97316',
    'fill-opacity': 0.16,
};

export const MONUMENT_BUFFER_OUTLINE_PAINT = {
    'line-color': '#f97316',
    'line-width': 2,
    'line-opacity': 0.85,
    'line-dasharray': [3, 2],
};

export function clampOpacity(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(1, value))
        : fallback;
}

export function buildMonumentBufferGeoJSON(
    data: { features?: unknown[] },
): GeoJSON.FeatureCollection {
    const features = (data.features ?? []).flatMap(feature => {
        const geoFeature = feature as GeoJSON.Feature;
        const geometryType = geoFeature.geometry?.type;
        if (geometryType !== 'Polygon' && geometryType !== 'MultiPolygon') return [];
        try {
            const buffered = turf.buffer(
                geoFeature,
                MONUMENT_BOUNDARY_BUFFER_M / 1000,
                { units: 'kilometers' },
            );
            if (!buffered) return [];
            buffered.properties = {
                ...(geoFeature.properties ?? {}),
                bufferMetres: MONUMENT_BOUNDARY_BUFFER_M,
            };
            return [buffered as GeoJSON.Feature];
        } catch {
            return [];
        }
    });
    return { type: 'FeatureCollection', features };
}

export function hasTargetEvidence(feature: Cluster): boolean {
    const hasLidar = hasDeliveredLidar(feature);
    const hasSlopeWithPhysicalSupport = feature.sources.includes('slope') && (
        hasLidar
        || feature.terrainMeasured === true
        || hasDistinctImageryObservations(feature.provenance)
    );
    const hasCorroboratedHydrology = feature.observationKind === 'elevation_measurement' && feature.sources.includes('hydrology') && hasLidar;
    return (
        hasLidar
        || hasSlopeWithPhysicalSupport
        || hasCorroboratedHydrology
        || hasDistinctImageryObservations(feature.provenance)
        || feature.terrainMeasured === true
        || feature.aimInfo !== undefined
    );
}

export function hasLocalPhysicalEvidence(feature: Cluster): boolean {
    const hasLidar = hasDeliveredLidar(feature);
    const hasSlopeWithLocalSupport = feature.sources.includes('slope') && (
        hasLidar
        || feature.terrainMeasured === true
        || hasDistinctImageryObservations(feature.provenance)
    );
    return (
        hasLidar
        || hasSlopeWithLocalSupport
        || hasDistinctImageryObservations(feature.provenance)
        || feature.terrainMeasured === true
    );
}
