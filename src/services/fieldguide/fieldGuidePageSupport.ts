import * as turf from '@turf/turf';
import type { Cluster } from '../../pages/fieldGuideTypes';
import { MONUMENT_BOUNDARY_BUFFER_M } from '../../utils/fieldGuideAnalysis';

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
    const hasLidar = (
        feature.sources.includes('terrain')
        || feature.sources.includes('terrain_global')
    );
    const hasSlopeWithPhysicalSupport = feature.sources.includes('slope') && (
        hasLidar
        || feature.sources.includes('hydrology')
        || feature.sources.includes('satellite_spring')
        || feature.sources.includes('satellite_summer')
    );
    const hasCorroboratedHydrology = feature.sources.includes('hydrology') && hasLidar;
    return (
        hasLidar
        || hasSlopeWithPhysicalSupport
        || hasCorroboratedHydrology
        || (
            feature.sources.includes('satellite_summer')
            && feature.sources.includes('satellite_spring')
        )
        || feature.aimInfo !== undefined
    );
}

export function hasLocalPhysicalEvidence(feature: Cluster): boolean {
    const hasLidar = (
        feature.sources.includes('terrain')
        || feature.sources.includes('terrain_global')
    );
    const hasSlopeWithLocalSupport = feature.sources.includes('slope') && (
        hasLidar
        || (
            feature.sources.includes('satellite_spring')
            && feature.sources.includes('satellite_summer')
        )
        || feature.multiScale === true
    );
    return (
        hasLidar
        || hasSlopeWithLocalSupport
        || (
            feature.sources.includes('satellite_spring')
            && feature.sources.includes('satellite_summer')
        )
        || feature.multiScale === true
    );
}
