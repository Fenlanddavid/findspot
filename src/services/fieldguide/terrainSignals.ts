// ─── Terrain signal helpers (pure, no React) ─────────────────────────────────
// Extracted from HistoricLayerManager so the fallback invariant can be unit-
// tested without a component tree.
//
// HONESTY CONSTRAINT: the terrain worker operates on a normalised (ring-relative,
// hillshade-corrected) DEM — NOT absolute metres. slopeGradient and
// relativeReliefNorm are in those normalised units. Keep those measured values
// separate from the legacy elevationM / slopePercent proxy fields, because
// downstream engines still treat slopePercent as a terrain-percent heuristic.

import type { Cluster, Hotspot } from '../../pages/fieldGuideTypes';
import type { LandscapeInterpretationWorkerInput } from '../../types/landscapeInterpretation';

// ─── Aspect averaging (circular mean) ────────────────────────────────────────

export function averageAspect(clusters: Cluster[]): number {
    const aspects = clusters
        .map(c => c.aspect)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (!aspects.length) return 180;

    const vector = aspects.reduce((acc, degrees) => {
        const radians = degrees * Math.PI / 180;
        return {
            x: acc.x + Math.cos(radians),
            y: acc.y + Math.sin(radians),
        };
    }, { x: 0, y: 0 });

    const degrees = Math.atan2(vector.y, vector.x) * 180 / Math.PI;
    return Math.round((degrees + 360) % 360);
}

// ─── Categorical proxy (pre-vNext) ───────────────────────────────────────────
// Translates categorical relativeElevation / polarity into rough numeric bands.
// Still used as the fallback for cached scans, no-DEM areas, and older clusters
// that pre-date vNext-P1.

export function deriveTerrainProxy(
    clusters: Cluster[],
    primaryHotspot: Hotspot | null,
): Pick<LandscapeInterpretationWorkerInput, 'elevationM' | 'slopePercent' | 'aspectDegrees'> {
    const memberIds = new Set(primaryHotspot?.memberIds ?? []);
    const relevant  = memberIds.size
        ? clusters.filter(c => memberIds.has(c.id))
        : clusters;

    const hasSlopeSignal  = relevant.some(c => c.sources.includes('slope') || c.relativeElevation === 'Slope');
    const hasRaisedSignal = relevant.some(c => c.relativeElevation === 'Ridge' || c.polarity === 'Raised');
    const hasHollowSignal = relevant.some(c => c.relativeElevation === 'Hollow' || c.polarity === 'Sunken');

    return {
        // Proxy values — fabricated bands, not real measurements.
        elevationM:    hasRaisedSignal ? 18 : hasHollowSignal ? -2 : hasSlopeSignal ? 6 : 0,
        slopePercent:  hasSlopeSignal  ? 6  : hasRaisedSignal ? 3  : 0,
        aspectDegrees: averageAspect(relevant),
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

    const measured = relevant.filter(
        c => c.slopeGradient != null || c.relativeReliefNorm != null,
    );

    if (measured.length === 0) {
        // No DEM-derived clusters — fall back to categorical proxy
        return {
            ...deriveTerrainProxy(clusters, primaryHotspot),
            relativeReliefNorm: 0,
            slopeGradient:      0,
            terrainMeasured:    false,
        };
    }

    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

    const relief = mean(measured.map(c => c.relativeReliefNorm ?? 0));
    const grad   = mean(measured.map(c => c.slopeGradient      ?? 0));
    const proxy  = deriveTerrainProxy(clusters, primaryHotspot);

    return {
        relativeReliefNorm: relief,
        slopeGradient:      grad,
        // Legacy proxy fields stay categorical so older model paths do not treat
        // normalised image gradients as real-world slope or metres.
        slopePercent:       proxy.slopePercent,
        elevationM:         proxy.elevationM,
        aspectDegrees:      averageAspect(measured),
        terrainMeasured:    true,
    };
}
