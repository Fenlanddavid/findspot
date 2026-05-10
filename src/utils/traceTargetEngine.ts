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

import type { Cluster, ModernWay } from '../pages/fieldGuideTypes';
import type { TraceTarget, TraceType, TraceRejectionReason } from '../pages/fieldGuideTypes';
import { getDistance, getDistanceToLine } from './fieldGuideAnalysis';

// ─── Gate mirrors (must exactly match FieldGuide.tsx) ────────────────────────

function hasTargetEvidence(f: Cluster): boolean {
    const hasLidar = f.sources.includes('terrain') || f.sources.includes('terrain_global');
    const hasSlopeWithPhysicalSupport = f.sources.includes('slope') && (
        hasLidar ||
        f.sources.includes('hydrology') ||
        f.sources.includes('satellite_spring') ||
        f.sources.includes('satellite_summer')
    );
    const hasCorroboratedHydrology = f.sources.includes('hydrology') && hasLidar;
    return (
        hasLidar ||
        hasSlopeWithPhysicalSupport ||
        hasCorroboratedHydrology ||
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

// ─── Trace-tier route artefact check ─────────────────────────────────────────
// Stricter than the display-target check (40 m centroid vs 20 m; 50 m linear
// alignment vs 30 m) because trace signals are the weakest evidence tier and
// most susceptible to road-embankment LiDAR noise.

function computeWayBearing(geometry: [number, number][]): number {
    if (geometry.length < 2) return 0;
    const [lon1, lat1] = geometry[0];
    const [lon2, lat2] = geometry[geometry.length - 1];
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1R = lat1 * Math.PI / 180;
    const lat2R = lat2 * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2R);
    const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLon);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function isNearModernWay(c: Cluster, modernWays: ModernWay[]): boolean {
    if (modernWays.length === 0) return false;
    for (const way of modernWays) {
        const dist = getDistanceToLine(c.center, way.geometry, way.bbox);
        if (dist <= 40) return true;   // 40 m centroid — catches embankment ridges
        // Linear features: also flag if bearing aligns within a wider band
        if (dist <= 50 && c.metrics && c.metrics.ratio > 3.5 && typeof c.bearing === 'number') {
            const wb = computeWayBearing(way.geometry);
            const diff = Math.abs(c.bearing - wb) % 360;
            const angleDiff = diff > 180 ? 360 - diff : diff;
            if (angleDiff <= 20 || angleDiff >= 160) return true;
        }
    }
    return false;
}

// ─── Suppression annotation helper ───────────────────────────────────────────
// Appends a suppression reason to a cluster's suppressedBy array without
// duplicating entries. Called when the trace engine decides to exclude a candidate.

function markSuppressed(c: Cluster, reason: string): void {
    if (!c.suppressedBy) c.suppressedBy = [];
    if (!c.suppressedBy.includes(reason)) c.suppressedBy.push(reason);
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

    // ── Archaeological shape quality ──────────────────────────────────────────
    // Ring and circular features are the highest-value trace shapes — compact,
    // discrete, and very unlikely to be road artefacts.
    // Generic linears without corroboration are the most common road artefact.
    const t = c.type;
    if (t.includes('Ring') || t.includes('Circular') || t.includes('Roundhouse') || t.includes('Barrow')) {
        score += 14;
    } else if (t.includes('Palaeochannel')) {
        score += 12;   // strong hydrology signal — palaeochannels are archaeologically meaningful
    } else if (t.includes('Enclosure') || t.includes('Structural')) {
        score += 7;
    } else if (t.includes('Linear') && !c.sources.includes('hydrology') && !c.multiScale) {
        // Generic linear without hydrology or multi-scale corroboration —
        // this is the dominant road-embankment / drainage-ditch false-positive shape.
        score -= 12;
    } else if (t.includes('Movement Signal') && !c.sources.includes('hydrology')) {
        // Trackway-like linear: slightly less penalised since it requires higher ratio
        // and direction consistency, but still suspect without hydrology corroboration.
        score -= 8;
    }

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
    if (isMergedEcho) return 'merged_echo';
    if (belowCut)     return 'below_cut_supporting';

    const t = c.type;

    // Shape-based archetypes — most specific classification first
    if (t.includes('Ring') || t.includes('Circular') || t.includes('Roundhouse') || t.includes('Barrow')) {
        return 'suppressed_circular';
    }
    if (t.includes('Enclosure') && physicalSourceCount(c) <= 1) {
        return 'fragmented_enclosure';
    }
    if (t.includes('Structural')) {
        return 'weak_structural';
    }
    if (t.includes('Palaeochannel') || (c.sources.includes('hydrology') && physicalSourceCount(c) === 1)) {
        return 'hydrology_trace';
    }
    if (c.multiScale && !passedEvidence) {
        return 'weak_multiscale';
    }
    if (c.isOnCorridor || t.includes('Movement') || t.includes('Corridor')) {
        return 'corridor_trace';
    }
    if (c.sources.includes('hydrology') && c.polarity === 'Raised') {
        return 'dry_margin_trace';
    }
    if ((c.sources.includes('satellite_summer') || c.sources.includes('satellite_spring')) &&
        !c.sources.includes('terrain') && !c.sources.includes('terrain_global')) {
        return 'spectral_trace';
    }
    if (t.includes('Linear') || t.includes('Boundary') || t.includes('Ditch')) {
        return 'boundary_trace';
    }

    if (physicalSourceCount(c) === 1) return 'single_source_landscape';
    return 'suppressed_physical';
}

function getTraceLabel(type: TraceType, _sources: Cluster['sources']): string {
    switch (type) {
        case 'below_cut_supporting':  return 'Supporting Signal';
        case 'merged_echo':           return 'Merged Source Echo';
        case 'hydrology_trace':       return 'Hydrology Trace';
        case 'spectral_trace':        return 'Spectral Trace';
        case 'boundary_trace':        return 'Boundary Trace';
        case 'suppressed_circular':   return 'Circular Anomaly';
        case 'weak_structural':       return 'Structural Trace';
        case 'fragmented_enclosure':  return 'Fragmented Enclosure';
        case 'corridor_trace':        return 'Corridor Trace';
        case 'dry_margin_trace':      return 'Dry Margin Trace';
        case 'weak_multiscale':       return 'Weak Multi-Scale Signal';
        case 'single_source_landscape': return 'Subtle Terrain Signal';
        default:                      return 'Trace Signal';
    }
}

function buildTraceReason(c: Cluster, type: TraceType): string {
    switch (type) {
        case 'below_cut_supporting':
            return 'Passed all evidence gates — ranked outside top 12 by find potential.';
        case 'merged_echo':
            return 'Sub-signal offset from a stronger target — independent spatial position worth noting.';
        case 'hydrology_trace':
            return 'Subtle water-associated terrain response — possible palaeochannel or wet-margin signal.';
        case 'spectral_trace':
            return 'Satellite-derived vegetation anomaly without LiDAR confirmation — field verification recommended.';
        case 'boundary_trace':
            return 'Linear ditch or bank signal below target confidence — possible field boundary or enclosure edge.';
        case 'suppressed_circular':
            return 'Weak circular morphology — possible ring ditch, barrow, or roundhouse below main confidence bar.';
        case 'weak_structural':
            return 'Structural signal with insufficient corroboration — possible building remains or platform.';
        case 'fragmented_enclosure':
            return 'Partial enclosure-like form — possible gap in field of view or partially preserved feature.';
        case 'corridor_trace':
            return 'Movement-associated signal near a historic route — possible roadside activity or trackway feature.';
        case 'dry_margin_trace':
            return 'Raised ground beside hydrology signal — dry edge beside former wet zone.';
        case 'weak_multiscale':
            return 'Multi-scale agreement without sufficient evidence corroboration — scale-consistent anomaly worth exploring.';
        case 'single_source_landscape':
            return 'Single physical source — credible but below the two-source threshold for a confirmed target.';
        default: {
            const failed: string[] = [];
            if (!hasTargetEvidence(c))        failed.push('evidence gate');
            if (!hasLocalPhysicalEvidence(c)) failed.push('physical gate');
            return failed.length > 0
                ? `Fell short of: ${failed.join(', ')}. Has physical basis worth noting.`
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
    modernWays?:     ModernWay[],
): TraceTarget[] {
    const CAP = devMode ? 20 : 8;
    const ways = modernWays ?? [];

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

        // Route artefacts excluded entirely — already marked by applyRouteArtefactSuppression.
        if (c.isRouteArtefactRisk) continue;

        // Trace-tier route proximity: stricter 40m threshold catches embankment ridges.
        if (ways.length > 0 && isNearModernWay(c, ways)) {
            markSuppressed(c, 'route_proximity_trace'); continue;
        }

        // No physical basis at all — exclude
        if (physicalSourceCount(c) === 0) {
            markSuppressed(c, 'no_physical_basis'); continue;
        }

        // Slope alone — exclude
        if (c.sources.length === 1 && c.sources.includes('slope')) {
            markSuppressed(c, 'slope_only'); continue;
        }

        // Route / context / place-name only (no physical) — exclude
        if (!passedEvidence && !passedPhysical) {
            markSuppressed(c, 'weak_corroboration'); continue;
        }

        // AIM-only with no independent physical signal — exclude
        if (c.aimInfo && !hasLocalPhysicalEvidence(c) && physicalSourceCount(c) === 0) {
            markSuppressed(c, 'aim_only_no_physical'); continue;
        }

        // High disturbance: require strong physical or two weaker independent sources
        if (c.disturbanceRisk === 'High') {
            if (!hasStrongPhysical(c) && physicalSourceCount(c) < 2) {
                markSuppressed(c, 'high_disturbance_insufficient_evidence'); continue;
            }
        }

        // Generic linear without corroboration — dominant road-embankment false positive.
        const isGenericLinear = c.metrics && c.metrics.ratio > 4.5 &&
            (c.type.includes('Linear') || c.type.includes('Movement Signal'));
        if (isGenericLinear && !c.multiScale && !c.sources.includes('hydrology') && !passedEvidence) {
            markSuppressed(c, 'generic_linear_unsupported'); continue;
        }

        const nearestDisplayDist = displayCentres.reduce(
            (min, dc) => Math.min(min, getDistance(c.center, dc)),
            Infinity,
        );

        // Too close to a display target centre (≤ 15 m) — suppress unless merged echo
        if (nearestDisplayDist < 15) continue;

        const traceScore = computeTraceScore(c, nearestDisplayDist);
        if (traceScore < 20) { markSuppressed(c, 'below_trace_threshold'); continue; }

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
        if (traceScore < 20) continue;

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

    // ── Archaeological type priority ──────────────────────────────────────────
    // Lower number = higher priority (more archaeologically specific / less likely
    // to be a modern artefact).  Within each tier, traces sort by traceScore.
    // Route-related and generic linear types are pushed to the back of the queue.
    const TRACE_TYPE_PRIORITY: Record<TraceType, number> = {
        suppressed_circular:     1,  // ring ditch, barrow, roundhouse — most specific
        fragmented_enclosure:    2,  // partial enclosure form
        weak_structural:         3,  // possible building platform / remains
        hydrology_trace:         4,  // palaeochannel / wet-margin signal
        dry_margin_trace:        5,  // raised ground beside former water
        weak_multiscale:         6,  // multi-scale agreement, evidence gate failed
        spectral_trace:          7,  // satellite-only anomaly
        suppressed_physical:     8,  // physical basis, failed a gate
        single_source_landscape: 9,  // single credible source
        below_cut_supporting:    10, // ranked outside top-12 (handled separately)
        boundary_trace:          11, // linear ditch/bank — often field boundary or ditch
        corridor_trace:          12, // route-side signal — highest route-artefact risk
        merged_echo:             13, // pre-consensus echo — handled separately
    };

    function traceTypePriority(t: TraceTarget): number {
        return TRACE_TYPE_PRIORITY[t.traceType] ?? 99;
    }

    // ── Deduplication ─────────────────────────────────────────────────────────
    // Collapse trace candidates within 20 m of each other; keep the best candidate.
    // Sort uses type priority FIRST so the more archaeologically specific candidate
    // survives — a merged echo or corridor trace with a higher raw traceScore must
    // not displace a suppressed_circular or hydrology_trace at the same location.
    const deduped: TraceTarget[] = [];
    for (const cand of [...candidates].sort((a, b) => {
        const aBelowCut = belowCutIds.has(a.id);
        const bBelowCut = belowCutIds.has(b.id);
        if (aBelowCut !== bBelowCut) return aBelowCut ? -1 : 1;
        if (!!a.isRouteArtefactRisk !== !!b.isRouteArtefactRisk) return a.isRouteArtefactRisk ? 1 : -1;
        const priDiff = traceTypePriority(a) - traceTypePriority(b);
        if (priDiff !== 0) return priDiff;
        return b.traceScore - a.traceScore;
    })) {
        const tooClose = deduped.some(d => getDistance(d.center, cand.center) < 20);
        if (!tooClose) deduped.push(cand);
    }

    // Priority order:
    //   1. Below-cut traces (overflow from display targets — passed all gates, rank 13+)
    //   2. Supporting traces sorted: type priority first, traceScore within tier
    //   3. Merged echoes last — fill remaining slots only after all other types
    //
    // Merged echoes come from the pre-consensus rawClusters pool which is large
    // (potentially 100s of raw signals), so without explicit de-prioritisation they
    // dominate the output even when better-typed traces exist.
    const belowCutTraceIds = new Set(belowCutIds);
    const belowCutTraces = deduped
        .filter(t => belowCutTraceIds.has(t.id))
        .sort((a, b) => b.findPotential !== a.findPotential
            ? b.findPotential - a.findPotential
            : b.traceScore - a.traceScore);
    const supportingTraces = deduped
        .filter(t => !belowCutTraceIds.has(t.id) && t.traceType !== 'merged_echo')
        .sort((a, b) => {
            if (!!a.isRouteArtefactRisk !== !!b.isRouteArtefactRisk) return a.isRouteArtefactRisk ? 1 : -1;
            const priDiff = traceTypePriority(a) - traceTypePriority(b);
            if (priDiff !== 0) return priDiff;
            return b.traceScore !== a.traceScore
                ? b.traceScore - a.traceScore
                : b.findPotential - a.findPotential;
        });
    const mergedEchoTraces = deduped
        .filter(t => t.traceType === 'merged_echo')
        .sort((a, b) => b.traceScore - a.traceScore);

    return [...belowCutTraces, ...supportingTraces, ...mergedEchoTraces].slice(0, Math.max(CAP, belowCutTraces.length));
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
