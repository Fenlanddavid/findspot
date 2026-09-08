// ─── Terrain signal helpers (pure, no React) ─────────────────────────────────
// Extracted from HistoricLayerManager so the fallback invariant can be unit-
// tested without a component tree.
//
// HONESTY CONSTRAINT: rendered relief and hillshade are image observations.
// Physical fields are populated only from decoded elevation samples.

import type { Cluster, Hotspot } from '../../pages/fieldGuideTypes';
import type { LandscapeInterpretationWorkerInput } from '../../types/landscapeInterpretation';

// ─── Aspect averaging (circular mean) ────────────────────────────────────────

export function averageAspect(clusters: Cluster[]): number | null {
    const aspects = clusters
        .map(c => c.aspect)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (!aspects.length) return null;

    const vector = aspects.reduce((acc, degrees) => {
        const radians = degrees * Math.PI / 180;
        return {
            x: acc.x + Math.cos(radians),
            y: acc.y + Math.sin(radians),
        };
    }, { x: 0, y: 0 });

    // An undefined circular mean must stay unknown. Without this resultant
    // guard, exactly opposing slopes can become 90/180/270 degrees through
    // floating-point residue and earn a directional suitability contribution.
    const resultant = Math.hypot(vector.x, vector.y) / aspects.length;
    if (resultant < 1e-6) return null;

    const degrees = Math.atan2(vector.y, vector.x) * 180 / Math.PI;
    return Math.round((degrees + 360) % 360);
}

// ─── Categorical proxy (pre-vNext) ───────────────────────────────────────────
// Legacy categorical morphology is deliberately not translated into metres,
// percent slope or an invented aspect.

export function deriveTerrainProxy(
    clusters: Cluster[],
    primaryHotspot: Hotspot | null,
): Pick<LandscapeInterpretationWorkerInput, 'elevationM' | 'slopePercent' | 'aspectDegrees'> {
    void clusters;
    void primaryHotspot;
    return {
        elevationM: null,
        slopePercent: null,
        aspectDegrees: null,
    };
}

// ─── Measured-first helper (vNext-P1) ────────────────────────────────────────
// Reads slopeGradient / relativeReliefNorm emitted by terrainScanWorker when
// real DEM data was available. Falls back to deriveTerrainProxy for cached
// scans, no-DEM areas, or clusters pre-dating vNext-P1.

export type TerrainSignals = Pick<LandscapeInterpretationWorkerInput,
    'elevationM' | 'slopePercent' | 'aspectDegrees' |
    'relativeReliefNorm' | 'slopeGradient' | 'terrainMeasured'>;

export function deriveTerrainSignals(
    clusters:       Cluster[],
    primaryHotspot: Hotspot | null,
): TerrainSignals {
    const memberIds = new Set(primaryHotspot?.memberIds ?? []);
    const relevant  = memberIds.size
        ? clusters.filter(c => memberIds.has(c.id))
        : clusters;

    const measured = relevant.filter(c => c.terrainMeasured === true);

    if (measured.length === 0) {
        // No DEM-derived clusters — fall back to categorical proxy
        return {
            ...deriveTerrainProxy(clusters, primaryHotspot),
            relativeReliefNorm: null,
            slopeGradient:      null,
            terrainMeasured:    false,
        };
    }

    const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

    const relief = mean(measured.flatMap(c => c.relativeReliefNorm == null ? [] : [c.relativeReliefNorm]));
    const grad   = mean(measured.flatMap(c => c.slopeGradient == null ? [] : [c.slopeGradient]));
    const elevation = mean(measured.flatMap(c => c.elevationM == null ? [] : [c.elevationM]));
    const slopePercent = mean(measured.flatMap(c => c.slopePercent == null ? [] : [c.slopePercent]));

    return {
        relativeReliefNorm: relief,
        slopeGradient:      grad,
        slopePercent,
        elevationM:         elevation,
        aspectDegrees:      averageAspect(measured),
        terrainMeasured:    true,
    };
}
