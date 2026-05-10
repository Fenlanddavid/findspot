// ─── Trace Target Engine ──────────────────────────────────────────────────────
// Builds the secondary exploratory "Trace Signals" layer from the widest
// available candidate pool.  This layer is completely additive — it never
// modifies hotspots, displayTargets, primaryTargetId, or any main-engine data.
//
// Source priority (best to fallback):
//   1. rawClusters (pre-consensus, if passed)  → enables merged-echo recovery
//   2. terrainClusters (post-pipeline, pre-display filter)
//
// Output cap: 8 signals (devMode can relax to 20).

import type { Cluster } from '../pages/fieldGuideTypes';
import type { TraceTarget, TraceType, TraceRejectionReason } from '../pages/fieldGuideTypes';
import { getDistance } from './fieldGuideAnalysis';

// ─── Gate mirrors (must exactly match FieldGuide.tsx) ────────────────────────

function hasTargetEvidence(f: Cluster): boolean {
    const hasLidar = f.sources.includes('terrain') || f.sources.includes('terrain_global');
    const hasSlopeWithPhysicalSupport = f.sources.includes('slope') && (
        hasLidar ||
        f.sources.includes('hydrology') ||
        f.sources.includes('satellite_spring') ||
        f.sources.includes('satellite_summer')
    );
    return (
        hasLidar ||
        hasSlopeWithPhysicalSupport ||
        (f.sources.includes('satellite_summer') && f.sources.includes('satellite_spring')) ||
        f.aimInfo !== undefined
    );
}

function hasLocalPhysicalEvidence(f: Cluster): boolean {
    const hasLidar = f.sources.includes('terrain') || f.sources.includes('terrain_global');
    const hasSlopeWithLocalSupport = f.sources.includes('slope') && (
        hasLidar ||
        (f.sources.includes('satellite_spring') && f.sources.includes('satellite_summer')) ||
        f.multiScale === true
    );
    return (
        hasLidar ||
        hasSlopeWithLocalSupport ||
        (f.sources.includes('satellite_spring') && f.sources.includes('satellite_summer')) ||
        f.multiScale === true
    );
}

// ─── Physical source helpers ──────────────────────────────────────────────────

const PHYSICAL_SOURCES = ['terrain', 'terrain_global', 'hydrology', 'satellite_spring', 'satellite_summer'] as const;

function physicalSourceCount(f: Cluster): number {
    return f.sources.filter(s => (PHYSICAL_SOURCES as readonly string[]).includes(s)).length;
}

function hasStrongPhysical(f: Cluster): boolean {
    return f.sources.includes('terrain') || f.sources.includes('terrain_global');
}

// ─── Trace score ──────────────────────────────────────────────────────────────
// Own scoring scale — not derived from hotspot score or findPotential.

function computeTraceScore(c: Cluster, nearestDisplayDist: number): number {
    let score = 0;

    // Physical source present — base qualification
    if (physicalSourceCount(c) > 0) score += 15;

    // Source quality
    if (c.sources.includes('terrain') || c.sources.includes('terrain_global')) score += 18;
    if (c.sources.includes('hydrology')) score += 10;
    if (c.sources.includes('satellite_summer') && c.sources.includes('satellite_spring')) score += 14;
    else if (c.sources.includes('satellite_summer')) score += 9;
    else if (c.sources.includes('satellite_spring')) score += 5;

    // Multi-scale detection — stronger independent confirmation
    if (c.multiScale) score += 10;

    // Relative elevation adds archaeological plausibility
    if (c.relativeElevation === 'Ridge' || c.relativeElevation === 'Hollow') score += 4;

    // Disturbance context
    if (c.disturbanceRisk === 'Low')    score += 5;
    if (c.disturbanceRisk === 'High')   score -= 12;

    // Distance from solid targets — further is more independent, better as a trace
    if (nearestDisplayDist > 60)        score += 6;
    else if (nearestDisplayDist < 25)   score -= 8;

    // Near-miss bonus: passed exactly one of the two evidence gates.
    // These are the most archaeologically interesting traces — one gate away from
    // being a solid target.
    const passedE = hasTargetEvidence(c);
    const passedP = hasLocalPhysicalEvidence(c);
    if (passedE && !passedP) score += 12;   // passed broad gate, failed physical
    if (!passedE && passedP) score += 8;    // has own sensor, failed evidence gate

    return Math.max(0, Math.min(100, score));
}

// ─── Classification ───────────────────────────────────────────────────────────

function classifyTraceType(
    c: Cluster,
    passedEvidence: boolean,
    passedPhysical: boolean,
    belowCut: boolean,
    isMergedEcho: boolean,
): TraceType {
    if (isMergedEcho)                       return 'merged_echo';
    if (belowCut)                           return 'below_cut_supporting';
    if (physicalSourceCount(c) === 1)       return 'single_source_landscape';
    if (!passedEvidence || !passedPhysical) return 'suppressed_physical';
    return 'suppressed_physical';
}

function getTraceLabel(type: TraceType, sources: Cluster['sources']): string {
    switch (type) {
        case 'below_cut_supporting':  return 'Supporting Signal';
        case 'merged_echo':           return 'Merged Source Echo';
        case 'single_source_landscape':
            if (sources.includes('hydrology'))                                       return 'Hydrology Trace';
            if (sources.includes('satellite_summer') || sources.includes('satellite_spring')) return 'Cropmark Trace';
            return 'Subtle Terrain Signal';
        default:
            if (sources.includes('hydrology') && physicalSourceCount({ sources } as Cluster) === 1) return 'Hydrology Trace';
            return 'Trace Signal';
    }
}

function buildTraceReason(c: Cluster, type: TraceType): string {
    switch (type) {
        case 'below_cut_supporting':
            return 'Passed evidence gates but ranked outside the top 12 display targets.';
        case 'merged_echo':
            return 'A sub-signal within a stronger target — spatially offset enough to be worth noting.';
        case 'single_source_landscape': {
            if (c.sources.includes('hydrology'))        return 'Single hydrology signal — palaeochannel or wet-margin read.';
            if (c.sources.includes('satellite_summer')) return 'Single-season summer spectral anomaly.';
            if (c.sources.includes('satellite_spring')) return 'Single-season spring spectral anomaly.';
            return 'Single physical source — not strong enough for a confirmed target.';
        }
        default: {
            const failed: string[] = [];
            if (!hasTargetEvidence(c))      failed.push('evidence gate');
            if (!hasLocalPhysicalEvidence(c)) failed.push('physical gate');
            if (c.isRouteArtefactRisk)      failed.push('route artefact check');
            return failed.length > 0
                ? `Failed: ${failed.join(', ')}. Has physical basis worth noting.`
                : 'Below strict display threshold but has physical support.';
        }
    }
}

function getRejectionReason(
    c: Cluster,
    passedEvidence: boolean,
    passedPhysical: boolean,
    belowCut: boolean,
    isMergedEcho: boolean,
): TraceRejectionReason {
    if (isMergedEcho)       return 'merged_echo';
    if (belowCut)           return 'below_display_cut';
    if (!passedEvidence)    return 'failed_target_evidence';
    if (!passedPhysical)    return 'failed_local_physical_evidence';
    if (c.disturbanceRisk === 'High') return 'disturbance_limited';
    return 'single_source_signal';
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Computes up to 8 Trace Signals (max 20 in devMode) from the widest
 * available candidate pool.  Never modifies any input arrays.
 *
 * @param terrainClusters  All clusters post-pipeline, pre-display filter
 * @param displayTargets   The confirmed top-12 targets already shown
 * @param rawClusters      Pre-consensus clusters (optional — enables merged-echo recovery)
 * @param devMode          Raise cap to 20 for lab review
 */
export function computeTraceTargets(
    terrainClusters: Cluster[],
    displayTargets:  Cluster[],
    rawClusters?:    Cluster[],
    devMode?:        boolean,
): TraceTarget[] {
    const CAP = devMode ? 20 : 8;

    const displayIds     = new Set(displayTargets.map(t => t.id));
    const displayCentres = displayTargets.map(t => t.center);

    const belowCutClusters = terrainClusters
        .filter(c => !c.isProtected && hasTargetEvidence(c) && hasLocalPhysicalEvidence(c) && !c.isRouteArtefactRisk)
        .sort((a, b) => b.findPotential - a.findPotential)
        .slice(12);
    const belowCutIds = new Set(belowCutClusters.map(c => c.id));

    // ── Merged-echo recovery from rawClusters ─────────────────────────────────
    // rawClusters are pre-consensus — each represents a single isolated sensor
    // signal before merging.  Where one merged INTO a displayTarget but its
    // centre is offset ≥ 20 m, it can surface as a merged-echo trace.
    const mergedEchoIds = new Set<string>();
    const mergedEchoCandidates: Cluster[] = [];

    if (rawClusters && rawClusters.length > 0) {
        for (const raw of rawClusters) {
            // Skip if already surfaced as a display target
            if (displayIds.has(raw.id)) continue;

            const nearestDisplayDist = displayCentres.reduce(
                (min, dc) => Math.min(min, getDistance(raw.center, dc)),
                Infinity,
            );

            // Only surface as merged echo if spatially meaningful offset
            if (nearestDisplayDist < 20 || nearestDisplayDist > 200) continue;

            // Must have its own physical signal — not just context
            if (physicalSourceCount(raw) === 0) continue;

            // Skip slope-alone and route-only
            if (raw.sources.length === 1 && raw.sources.includes('slope')) continue;

            mergedEchoIds.add(raw.id);
            mergedEchoCandidates.push(raw);
        }
    }

    // ── Main candidate pool ───────────────────────────────────────────────────
    // Primary: terrainClusters (post-pipeline, pre-display filter)
    const candidates: TraceTarget[] = [];

    for (const c of terrainClusters) {
        if (displayIds.has(c.id)) continue;
        if (c.isProtected)        continue;

        const passedEvidence = hasTargetEvidence(c);
        const passedPhysical = hasLocalPhysicalEvidence(c);
        const belowCut       = belowCutIds.has(c.id);

        // ── Filtering rules ───────────────────────────────────────────────────

        // Route artefacts excluded entirely. isRouteArtefactRisk means "probable
        // modern road/track scanner noise" — a fundamentally different class from
        // weak archaeology. Showing them as investigable traces misleads users.
        if (c.isRouteArtefactRisk) continue;

        // No physical basis at all — exclude
        if (physicalSourceCount(c) === 0) continue;

        // Slope alone — exclude
        if (c.sources.length === 1 && c.sources.includes('slope')) continue;

        // Route / context / place-name only (no physical) — exclude
        if (!passedEvidence && !passedPhysical) continue;

        // AIM-only with no independent physical signal — exclude
        if (c.aimInfo && !hasLocalPhysicalEvidence(c) && physicalSourceCount(c) === 0) continue;

        // High disturbance: require strong physical or two weaker independent sources
        if (c.disturbanceRisk === 'High') {
            if (!hasStrongPhysical(c) && physicalSourceCount(c) < 2) continue;
        }

        const nearestDisplayDist = displayCentres.reduce(
            (min, dc) => Math.min(min, getDistance(c.center, dc)),
            Infinity,
        );

        // Too close to a display target centre (≤ 15 m) — suppress unless merged echo
        if (nearestDisplayDist < 15) continue;

        const traceScore = computeTraceScore(c, nearestDisplayDist);
        if (traceScore < 8) continue;  // minimum threshold

        const traceType = classifyTraceType(c, passedEvidence, passedPhysical, belowCut, false);

        candidates.push({
            id:                    c.id,
            center:                c.center,
            type:                  c.type,
            sources:               c.sources,
            findPotential:         c.findPotential,
            confidence:            c.confidence,
            disturbanceRisk:       c.disturbanceRisk,
            multiScale:            c.multiScale,
            polarity:              c.polarity,
            relativeElevation:     c.relativeElevation,
            aimInfo:               c.aimInfo,
            isRouteArtefactRisk:   c.isRouteArtefactRisk,
            traceScore,
            traceType,
            traceLabel:            getTraceLabel(traceType, c.sources),
            traceReason:           buildTraceReason(c, traceType),
            rejectedBy:            getRejectionReason(c, passedEvidence, passedPhysical, belowCut, false),
            distanceToNearestTarget: nearestDisplayDist,
        });
    }

    // ── Merged-echo candidates ────────────────────────────────────────────────
    for (const raw of mergedEchoCandidates) {
        // Skip if a terrainCluster with the same id is already in candidates
        if (candidates.some(c => c.id === raw.id)) continue;

        const nearestDisplayDist = displayCentres.reduce(
            (min, dc) => Math.min(min, getDistance(raw.center, dc)),
            Infinity,
        );

        const traceScore = computeTraceScore(raw, nearestDisplayDist);
        if (traceScore < 8) continue;

        candidates.push({
            id:                    raw.id + '-echo',
            center:                raw.center,
            type:                  raw.type,
            sources:               raw.sources,
            findPotential:         raw.findPotential,
            confidence:            raw.confidence,
            disturbanceRisk:       raw.disturbanceRisk,
            multiScale:            raw.multiScale,
            polarity:              raw.polarity,
            relativeElevation:     raw.relativeElevation,
            aimInfo:               raw.aimInfo,
            isRouteArtefactRisk:   raw.isRouteArtefactRisk,
            traceScore,
            traceType:             'merged_echo',
            traceLabel:            'Merged Source Echo',
            traceReason:           buildTraceReason(raw, 'merged_echo'),
            rejectedBy:            'merged_echo',
            distanceToNearestTarget: nearestDisplayDist,
        });
    }

    // ── Deduplication ─────────────────────────────────────────────────────────
    // Collapse trace candidates within 20 m of each other; keep highest traceScore.
    const deduped: TraceTarget[] = [];
    for (const cand of [...candidates].sort((a, b) => {
        const aBelowCut = belowCutIds.has(a.id);
        const bBelowCut = belowCutIds.has(b.id);
        if (aBelowCut !== bBelowCut) return aBelowCut ? -1 : 1;
        if (!!a.isRouteArtefactRisk !== !!b.isRouteArtefactRisk) return a.isRouteArtefactRisk ? 1 : -1;
        return b.traceScore - a.traceScore;
    })) {
        const tooClose = deduped.some(d => getDistance(d.center, cand.center) < 20);
        if (!tooClose) deduped.push(cand);
    }

    // Keep demoted solid-target candidates visible first. These are the normal
    // target overflow items that passed display gates but missed the top-12 list.
    const belowCutTraceIds = new Set(belowCutIds);
    const belowCutTraces = deduped
        .filter(t => belowCutTraceIds.has(t.id))
        .sort((a, b) => b.findPotential !== a.findPotential
            ? b.findPotential - a.findPotential
            : b.traceScore - a.traceScore);
    const supportingTraces = deduped
        .filter(t => !belowCutTraceIds.has(t.id))
        .sort((a, b) => {
            if (!!a.isRouteArtefactRisk !== !!b.isRouteArtefactRisk) return a.isRouteArtefactRisk ? 1 : -1;
            return b.traceScore !== a.traceScore
            ? b.traceScore - a.traceScore
            : b.findPotential - a.findPotential;
        });

    return [...belowCutTraces, ...supportingTraces].slice(0, Math.max(CAP, belowCutTraces.length));
}

// ─── Tag helper (used by Engine Lab and UI) ───────────────────────────────────

/**
 * Returns a short array of display tags for a trace target.
 * Safe to call with either a TraceTarget or a plain Cluster.
 */
export function getTraceTags(cluster: TraceTarget | Cluster): string[] {
    const tags: string[] = [];

    // Trace-type chip (TraceTarget only)
    if ('traceType' in cluster) {
        if (cluster.traceType === 'below_cut_supporting') tags.push('Below Cut');
        if (cluster.traceType === 'single_source_landscape') tags.push('Single Source');
        if (cluster.traceType === 'merged_echo') tags.push('Merged Echo');
    }

    // Source chips
    if (cluster.sources.includes('terrain') || cluster.sources.includes('terrain_global')) tags.push('LiDAR');
    if (cluster.sources.includes('hydrology')) tags.push('Hydro');
    if (cluster.sources.includes('satellite_summer') || cluster.sources.includes('satellite_spring')) tags.push('Spectral');
    if (cluster.multiScale) tags.push('Multi-Scale');

    // Warning chips
    if (cluster.disturbanceRisk === 'High') tags.push('High Disturb.');
    if (cluster.isRouteArtefactRisk)        tags.push('Route Risk');

    return tags;
}
