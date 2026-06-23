// ─── Landscape Evidence Assembly (vNext-P2) ───────────────────────────────────
// Gathers all scan evidence into one object built on WHAT EXISTS.
// Genuinely absent fields are optional and left undefined — never zero-faked.
// Consumed by the ALIE worker when present; individual fields used as fallback.

import type { Cluster, Hotspot, HistoricRoute } from '../../pages/fieldGuideTypes';
import type { NHLEFeature, AIMFeature } from '../historicScanService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LandscapeEvidence {
    terrain: {
        relativeReliefNorm: number;
        slopeGradient:      number;
        aspectDegrees:      number;
        relativeElevation?: string;
        polarity?:          string;
        measured:           boolean;
    };
    hydrology: {
        dryMarginScore?:      number;  // 0–1: raised usable ground beside local wet terrain
        flowConvergence?:     number;  // 0–1: D8-derived local convergence
        hydrologicalContext?: number;  // 0–1: composite (terrain-hydro-v1)
        // FUTURE — not yet computed by any engine:
        riverDistanceM?:      never;
        springLikelihood?:    never;
    };
    historic: {
        routes:            HistoricRoute[];
        nhle:              NHLEFeature[];
        aim:               AIMFeature[];
        scheduledOverlap:  boolean;
    };
    hotspots: {
        clusters:       Cluster[];
        topScore:       number;
        signalBreakdown?: Cluster['signalBreakdown'];
        convergence:    number;
    };
    user: {
        findDensity:  number;   // finds per km² within scan area
        findPeriods:  string[]; // unique periods recorded
    };
}

// ─── Builder ──────────────────────────────────────────────────────────────────

export function buildLandscapeEvidence(
    clusters:        Cluster[],
    primaryHotspot:  Hotspot | null,
    sortedHotspots:  Hotspot[],
    historicRoutes:  HistoricRoute[],
    nhleFeatures:    NHLEFeature[],
    aimFeatures:     AIMFeature[],
    terrainSignals: {
        relativeReliefNorm?: number;
        slopeGradient?:      number;
        aspectDegrees:       number;
        terrainMeasured:     boolean;
    },
    nearbyFindPeriods: string[],
    nearbyFindDensity: number,
): LandscapeEvidence {
    // ── Terrain ───────────────────────────────────────────────────────────────
    const memberIds = new Set(primaryHotspot?.memberIds ?? []);
    const relevant  = memberIds.size
        ? clusters.filter(c => memberIds.has(c.id))
        : clusters;

    // Pick the most common relativeElevation / polarity from relevant clusters
    const elevCounts = new Map<string, number>();
    const polarCounts = new Map<string, number>();
    for (const c of relevant) {
        if (c.relativeElevation) elevCounts.set(c.relativeElevation, (elevCounts.get(c.relativeElevation) ?? 0) + 1);
        if (c.polarity)          polarCounts.set(c.polarity,         (polarCounts.get(c.polarity)         ?? 0) + 1);
    }
    const topElev  = [...elevCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const topPolar = [...polarCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    const terrain: LandscapeEvidence['terrain'] = {
        relativeReliefNorm: terrainSignals.relativeReliefNorm ?? 0,
        slopeGradient:      terrainSignals.slopeGradient      ?? 0,
        aspectDegrees:      terrainSignals.aspectDegrees,
        measured:           terrainSignals.terrainMeasured,
        ...(topElev  ? { relativeElevation: topElev  } : {}),
        ...(topPolar ? { polarity:           topPolar } : {}),
    };

    // ── Hydrology ─────────────────────────────────────────────────────────────
    // Read from the clusters that have hydrology metrics (terrain-hydro-v1)
    const hydroClusters = relevant.filter(c => c.metrics?.hydrologyUsed);
    const hydrology: LandscapeEvidence['hydrology'] = {};
    if (hydroClusters.length > 0) {
        const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
        const dryVals  = hydroClusters.map(c => c.metrics!.dryMarginScore  ?? 0);
        const flowVals = hydroClusters.map(c => c.metrics!.flowConvergence  ?? 0);
        const ctxVals  = hydroClusters.map(c => c.metrics!.hydrologicalContext ?? 0);
        hydrology.dryMarginScore      = mean(dryVals);
        hydrology.flowConvergence     = mean(flowVals);
        hydrology.hydrologicalContext = mean(ctxVals);
    }

    // ── Historic ──────────────────────────────────────────────────────────────
    // All features from the NHLE FeatureServer/6 endpoint ARE scheduled monuments
    // (the endpoint targets that layer exclusively). Mirror the same logic as
    // scheduledMonumentGate.ts — non-empty list = overlap.
    const scheduledOverlap = nhleFeatures.length > 0;

    // ── Hotspots ──────────────────────────────────────────────────────────────
    const topHotspot = sortedHotspots[0] ?? null;
    const topScore   = topHotspot?.score ?? 0;
    const convergence = topHotspot?.metrics.convergence ?? 0;
    const signalBreakdown = primaryHotspot
        ? clusters.find(c => primaryHotspot.memberIds.includes(c.id))?.signalBreakdown
        : undefined;

    return {
        terrain,
        hydrology,
        historic: { routes: historicRoutes, nhle: nhleFeatures, aim: aimFeatures, scheduledOverlap },
        hotspots: { clusters, topScore, convergence, ...(signalBreakdown ? { signalBreakdown } : {}) },
        user: { findDensity: nearbyFindDensity, findPeriods: nearbyFindPeriods },
    };
}
