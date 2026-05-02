// ─── Hotspot engine ───────────────────────────────────────────────────────────
// Two-stage pipeline:
//   buildTerrainHotspots        – terrain signal scoring (routes, LiDAR, spectral)
//   enhanceHotspotsWithHistoric – additive historic enrichment layer
//
// generateHotspots is the combined entry point kept for call-site compatibility.

import { Cluster, Hotspot, HotspotClassification, HistoricFind, PlaceSignal, HistoricRoute } from '../pages/fieldGuideTypes';
import { getDistance, getDistanceToLine, getDistanceKm, getRouteTypeWeight } from './fieldGuideAnalysis';
import { computeLandscapeReading } from './landscapeReadingEngine';

// ─── Shared confidence evaluator ──────────────────────────────────────────────
// Single model used after terrain scoring and again after historic enrichment,
// so confidence labels mean the same thing at both stages.
//
// Convergence is included because some of the strongest archaeological logic
// (route junctions, crossings, raised-access convergence) now lives there.
// Strong convergence can support a borderline upgrade, but cannot override
// a weak score or poor signal agreement on its own.

function evaluateHotspotConfidence(params: {
    score:       number;
    signalCount: number;
    behaviour:   number;
    context:     number;
    convergence: number;
}): Hotspot['confidence'] {
    const { score, signalCount, behaviour, context, convergence } = params;
    const hasStrongAgreement   = signalCount >= 3;
    const hasModerateAgreement = signalCount >= 2;

    let confidence: Hotspot['confidence'] = 'Weak Signal';
    if      (score > 80 && hasStrongAgreement)   confidence = 'Strongest Signal';
    else if (score > 60 && hasModerateAgreement) confidence = 'Strong Signal';
    else if (score > 35)                         confidence = 'Developing Signal';

    // Downgrade checks: strong route/hydrology context is required to hold
    // upper labels — pure score is not enough.
    if (confidence === 'Strong Signal'    && behaviour < 5 && context < 5 && convergence < 5) confidence = 'Developing Signal';
    if (confidence === 'Strongest Signal' && behaviour < 8 && convergence < 8)                confidence = 'Strong Signal';

    // Upgrade: strong convergence evidence can lift a borderline Developing Signal.
    if (confidence === 'Developing Signal' && convergence >= 10 && score > 30) confidence = 'Strong Signal';

    return confidence;
}

// ─── Explanation prioritisation ───────────────────────────────────────────────
// Keeps the most important explanations when the list is trimmed.
// IGNORE notes sit below the strongest positive signals (85) so at least one
// positive reason always survives when the limit allows.

const EXPLANATION_PRIORITY: [string, number][] = [
    ['Near Roman',                        90],
    ['Likely Roman',                      90],
    ['Hydrology + terrain depression',    80],
    ['Multi-season cropmark agreement',   75],
    ['LiDAR + Hydrology',                 70],
    ['Island effect',                     70],
    ['Repeated detection across scans',   68],
    ['Historic river crossing',           65],
    ['Historic crossing',                 65],
    ['Route junction',                    60],
    ['Near historic route convergence',   60],
    ['LiDAR + Spectral',                  55],
    ['IGNORE:',                           50],  // below positive signals; still visible but does not crowd them out
    ['Settlement structure',              48],
    ['Reliable LiDAR',                    45],
    ['Access route into settlement',      45],
    ['Historic data overlaps',            44],
    ['Spectral vegetation',               40],
    ['Field system indicators',           38],
    ['Multiple independent sources',      36],
    ['Raised dry footing',                35],
    ['Strategic dry point',               35],
    ['Historic movement corridor',        25],
    ['Near probable Roman',               25],
    ['Subtle earthwork signature',        22],
    ['Dry ground beside former wet zone', 20],
    ['Landscape edge detected',           18],
    ['Likely movement corridor',          16],
    ['Favourable slope and aspect',       14],
];

function prioritiseExplanations(items: string[], limit: number): string[] {
    const unique = Array.from(new Set(items));
    unique.sort((a, b) => {
        const scoreA = EXPLANATION_PRIORITY.find(([k]) => a.includes(k))?.[1] ?? 10;
        const scoreB = EXPLANATION_PRIORITY.find(([k]) => b.includes(k))?.[1] ?? 10;
        return scoreB - scoreA;
    });

    if (unique.length <= limit) return unique;

    // Guarantee at least one positive (non-IGNORE) explanation survives,
    // so users understand why the hotspot was surfaced even when penalties apply.
    const sliced    = unique.slice(0, limit);
    const hasIgnore  = sliced.some(s => s.startsWith('IGNORE:'));
    const hasPositive = sliced.some(s => !s.startsWith('IGNORE:'));

    if (hasIgnore && !hasPositive) {
        const firstPositive = unique.find(s => !s.startsWith('IGNORE:'));
        if (firstPositive) {
            sliced[sliced.length - 1] = firstPositive;
        }
    }

    return sliced;
}

// ─── Classification helper ────────────────────────────────────────────────────
// Rules-based landscape identity layer applied after scoring.
// Checks rules in priority order (most specific → most general) and returns
// on the first match. All thresholds are intentionally named and readable so
// they are easy to tune without archaeology knowledge.

interface ClassifyContext {
    hasLidar:               boolean;
    hasSatellite:           boolean;
    satelliteIsPrimary:     boolean;
    hasHydrology:           boolean;
    isRaised:               boolean;
    hasRomanProximity:      boolean;
    hasHistProximity:       boolean;
    routeCount:             number;
    isHighConfidenceCrossing: boolean;
    anomaly:                number;
    context:                number;
    convergence:            number;
    behaviour:              number;
    signalCount:            number;
    signalClassCount:       number;
}

function classifyHotspot(ctx: ClassifyContext): {
    classification: HotspotClassification;
    reason:         string;
    secondaryTag?:  string;
} {
    // 1. Crossing Point Candidate — most specific: water + route + convergence all agree
    if (ctx.isHighConfidenceCrossing && ctx.convergence >= 10 && ctx.hasHydrology) {
        return {
            classification: 'Crossing Point Candidate',
            reason:         'Route and water signals converge here',
            secondaryTag:   ctx.hasRomanProximity ? 'Roman corridor influence' : undefined,
        };
    }

    // 2. Junction / Convergence Zone — multiple routes meeting without dominant crossing identity
    // P2: convergence threshold 8 → 6
    if (ctx.convergence >= 6 && ctx.routeCount >= 2) {
        return {
            classification: 'Junction / Convergence Zone',
            reason:         'Multiple routes converge here',
            secondaryTag:   ctx.hasRomanProximity ? 'Roman corridor influence' : undefined,
        };
    }

    // 3. Settlement Edge Candidate — raised LiDAR anomaly with meaningful context.
    // Requires 2+ signal classes so a single LiDAR feature on raised ground alone
    // cannot trigger this classification.
    if (ctx.anomaly >= 12 && ctx.context >= 6 && ctx.isRaised && ctx.hasLidar &&
        ctx.signalClassCount >= 2 &&
        (ctx.behaviour >= 4 || ctx.convergence >= 4)) {
        return {
            classification: 'Settlement Edge Candidate',
            reason:         'Raised LiDAR anomaly in landscape context',
            secondaryTag:   ctx.hasHydrology ? 'Water margin setting' : undefined,
        };
    }

    // 4. Wetland Margin Activity Zone — raised dry island in wet context, no dominant junction
    if (ctx.hasHydrology && ctx.isRaised && ctx.context >= 8 && ctx.convergence < 6) {
        return {
            classification: 'Wetland Margin Activity Zone',
            reason:         'Dry elevated ground beside wetter terrain',
        };
    }

    // 5. Route-Side Activity Zone — route-led but not a junction or crossing
    // P2: behaviour threshold 8 → 6
    if (ctx.behaviour >= 6 && (ctx.hasRomanProximity || ctx.hasHistProximity) && ctx.convergence < 6) {
        return {
            classification: 'Route-Side Activity Zone',
            reason:         'Signals cluster alongside a movement corridor',
            secondaryTag:   ctx.hasRomanProximity ? 'Roman corridor influence' : undefined,
        };
    }

    // 6. Terrain Structure Candidate — LiDAR anomaly without route or hydrology reinforcement.
    // P2: anomaly 15 → 12, behaviour guard 8 → 6
    if (ctx.hasLidar && ctx.anomaly >= 12 && ctx.context >= 4 && !ctx.hasHydrology && ctx.behaviour < 6) {
        return {
            classification: 'Terrain Structure Candidate',
            reason:         'Distinct structural relief detected in LiDAR',
        };
    }

    // 7. Spectral Activity Candidate — satellite only, no LiDAR confirmation
    if (ctx.satelliteIsPrimary && !ctx.hasLidar) {
        return {
            classification: 'Spectral Activity Candidate',
            reason:         'Cropmark or vegetation response — field verification recommended',
        };
    }

    // ── Contextual fallbacks (P1) ─────────────────────────────────────────────
    // Replace the generic single fallback with signal-derived labels so outputs
    // feel distinct and meaningful even when primary thresholds are not met.

    // 8. Lowland Activity Zone — hydrology present but below Wetland Margin threshold
    if (ctx.hasHydrology && ctx.convergence < 6) {
        return {
            classification: 'Lowland Activity Zone',
            reason:         'Hydrological signal near water',
        };
    }

    // 9. Raised Activity Area — elevated terrain without strong structural signal
    if (ctx.isRaised) {
        return {
            classification: 'Raised Activity Area',
            reason:         'Slightly elevated ground favoured for settlement or use',
        };
    }

    // 10. Route-Influenced Area — route nearby but below route-side threshold
    if (ctx.hasRomanProximity || ctx.hasHistProximity) {
        return {
            classification: 'Route-Influenced Area',
            reason:         'Route proximity with activity signal clustering nearby',
            secondaryTag:   ctx.hasRomanProximity ? 'Roman corridor influence' : undefined,
        };
    }

    // 11. Cropmark Activity Zone — satellite signal present without exclusive spectral trigger
    if (ctx.hasSatellite && !ctx.hasLidar) {
        return {
            classification: 'Cropmark Activity Zone',
            reason:         'Spectral signal alongside other sources detected',
        };
    }

    // 12. Multi-Signal Activity Zone — multiple weak signals from different sources
    if (ctx.signalCount >= 2) {
        return {
            classification: 'Multi-Signal Activity Zone',
            reason:         'Mixed signals from multiple independent sources',
        };
    }

    // 13. General Activity Zone — ultimate fallback
    return {
        classification: 'General Activity Zone',
        reason:         'Multiple independent signals detected',
    };
}

// ─── Stage 1: terrain-based scoring ──────────────────────────────────────────

export function buildTerrainHotspots(
    clusters:       Cluster[],
    routes:         HistoricRoute[]    = [],
    monumentPoints: [number, number][] = [],
): Hotspot[] {
    const results: Hotspot[] = [];
    const usedIds = new Set<string>();

    // Sort clusters before grouping so the strongest always acts as the group
    // anchor — makes cluster membership deterministic regardless of input order.
    const confidenceRank: Record<string, number> = { 'High': 3, 'Medium': 2, 'Subtle': 1 };
    const typeRank: Record<string, number> = {
        'Roundhouse':        3,
        'Barrow':            3,
        'Burial Mound':      3,
        'Ring Ditch':        3,
        'Settlement':        3,
        'Foundation':        3,
        'Enclosure':         2,
        'Complex Earthwork': 2,
        'Raised Dry Point':  2,
        'Water Interaction': 2,
        'Corridor':          1,
        'Route Edge':        1,
        'Linear Feature':    1,
    };
    const sortedClusters = [...clusters].sort((a, b) => {
        const confDiff = (confidenceRank[b.confidence] ?? 0) - (confidenceRank[a.confidence] ?? 0);
        if (confDiff !== 0) return confDiff;
        const potDiff = (b.findPotential ?? 0) - (a.findPotential ?? 0);
        if (potDiff !== 0) return potDiff;
        const aType = Math.max(0, ...Object.entries(typeRank).map(([k, v]) => a.type.includes(k) ? v : 0));
        const bType = Math.max(0, ...Object.entries(typeRank).map(([k, v]) => b.type.includes(k) ? v : 0));
        return bType - aType;
    });

    for (const c of sortedClusters) {
        if (usedIds.has(c.id)) continue;

        let radiusM = 40;
        if (c.type.includes('Roundhouse') || c.type.includes('Barrow')) radiusM = 20;
        else if (c.metrics && c.metrics.ratio > 4) radiusM = 80;

        const members = sortedClusters.filter(n => !usedIds.has(n.id) && getDistance(c.center, n.center) < radiusM);
        if (members.length === 0) continue;
        members.forEach(m => usedIds.add(m.id));

        // Suppress if any member centre is inside a monument polygon (isProtected flag)
        // or within 80m of a monument point — catches clusters just outside polygon edges.
        if (members.some(m => m.isProtected)) continue;
        if (monumentPoints.length > 0) {
            const tooClose = members.some(m =>
                monumentPoints.some(([mLon, mLat]) =>
                    getDistanceKm(m.center[1], m.center[0], mLat, mLon) < 0.08,
                ),
            );
            if (tooClose) continue;
        }

        let anomaly = 0, context = 0, convergence = 0, behaviour = 0, penalty = 0;
        const explanation: string[] = [];

        const sources = new Set(members.flatMap(m => m.sources));

        // ── Signal presence flags (what data exists) ──────────────────────────
        const hasLidar              = sources.has('terrain') || sources.has('terrain_global');
        const hasSatellite          = sources.has('satellite_spring') || sources.has('satellite_summer');
        const hasHydrology          = sources.has('hydrology');
        const hasMultiSeasonSat     = sources.has('satellite_summer') && sources.has('satellite_spring');
        const hasAimEnrichment      = members.some(m => m.aimInfo !== undefined);
        // Primary evidence: at least one hard physical or archaeological signal.
        // Context-only hotspots (route proximity, place-names, raised ground alone)
        // are excluded by this gate — they cannot create a hotspot by themselves.
        const hasPrimaryEvidence    = hasLidar || hasMultiSeasonSat || hasAimEnrichment;

        // ── Signal weighting roles (how each signal contributes) ──────────────
        // Satellite is either the primary terrain signal (no LiDAR) or a
        // supporting corroboration layer (alongside LiDAR). These are separate
        // concepts — presence and role — so they are tracked independently.
        const satelliteIsPrimary    = hasSatellite && !hasLidar;
        const satelliteIsSupporting = hasSatellite && hasLidar;

        if (hasLidar) {
            const bestLidar = members.find(m => m.sources.includes('terrain') || m.sources.includes('terrain_global'));
            let lidarScore = bestLidar?.confidence === 'High' ? 18 : (bestLidar?.confidence === 'Medium' ? 10 : 5);
            if (hasHydrology)            { lidarScore += 5; explanation.push('LiDAR + Hydrology correlation'); }
            if (satelliteIsSupporting && sources.has('satellite_summer')) { lidarScore += 4; explanation.push('LiDAR + Spectral agreement'); }
            anomaly += lidarScore;
            explanation.push('Reliable LiDAR relief signature');
        }

        if (satelliteIsPrimary) {
            const hasSummer = sources.has('satellite_summer');
            const hasSpring = sources.has('satellite_spring');
            // Summer = 7 (raised: +8 → 15, clears hotspot threshold without needing routes)
            anomaly += (hasSummer && hasSpring) ? 10 : (hasSummer ? 7 : 3);
            explanation.push('Spectral vegetation anomaly');
        }

        const center        = c.center;
        const isRaised      = members.some(m => m.polarity === 'Raised');
        const hasSlope      = sources.has('slope');
        const isSouthFacing = members.some(m => typeof m.aspect === 'number' && m.aspect >= 135 && m.aspect <= 225);

        if (isRaised) {
            context += 8;
            explanation.push('Raised dry footing');
            if (hasHydrology) { context += 4; explanation.push('Strategic dry point near water'); }
        }

        if (hasHydrology) {
            // Raised ground near water is a strong signal; flat/wet ground alone is weak
            anomaly += isRaised ? 5 : 2;
            if (isRaised) {
                behaviour += 6 + (hasLidar ? 4 : 0);
                explanation.push('Island effect: Dry ground in wet zone');
            }
            if (members.some(m => m.type.includes('Corridor'))) {
                behaviour += 5 + (hasLidar ? 3 : 0);
                explanation.push('Historic river crossing / Ford potential');
            }
        }

        // ── Hydrology + terrain depression agreement (Refinement 3) ──────────
        // Basic co-location is covered above (+5). This checks whether both
        // sources independently identify a depression — a much stronger signal.
        // Uses m.sources.includes() throughout for consistent array-based checking.
        if (hasHydrology && hasLidar) {
            const hydroSunken   = members.some(m => m.sources.includes('hydrology') && m.polarity === 'Sunken');
            const terrainSunken = members.some(m =>
                (m.sources.includes('terrain') || m.sources.includes('terrain_global')) && m.polarity === 'Sunken',
            );
            if (hydroSunken && terrainSunken) {
                anomaly += 5;
                explanation.push('Hydrology + terrain depression agreement');
            } else if (hydroSunken || terrainSunken) {
                anomaly += 2;
            }
        }

        // ── Temporal agreement (multi-season satellite) ───────────────────────────
        // Cluster-level boosts were applied in findConsensus; this captures the
        // hotspot-level signal so it appears in output and gets a score contribution.
        // For satellite-primary mode the base scoring already accounts for dual
        // season (+3 extra); only the supporting-LiDAR case adds anomaly here.
        if (hasMultiSeasonSat) {
            if (!satelliteIsPrimary) anomaly += 4;
            explanation.push('Multi-season cropmark agreement');
        }

        // ── Persistence (verified signal via repeat detection) ────────────────────
        if (members.some(m => (m.rescanCount || 0) >= 3)) {
            context += 3;
            explanation.push('Repeated detection across scans');
        }

        // ── Context labels from cluster analysis ──────────────────────────────────
        // analyzeContext runs before buildTerrainHotspots in the pipeline, so
        // contextLabel and role are fully populated by the time we reach here.
        const memberContextLabels = members.map(m => m.contextLabel).filter(Boolean) as string[];
        if (memberContextLabels.some(l =>
            l === 'Enclosed Settlement / Farmstead' || l === 'Habitation Cluster / Settlement Nucleus',
        )) {
            context += 5;
            explanation.push('Settlement structure indicators');
        }
        if (memberContextLabels.some(l => l === 'Primary Access Route into Settlement')) {
            behaviour += 3;
            explanation.push('Access route into settlement detected');
        }
        if (memberContextLabels.some(l => l === 'Organized Field System / Celtic Fields')) {
            explanation.push('Field system indicators');
        }

        // ── Route scoring ─────────────────────────────────────────────────────
        // Base proximity → behaviour.
        // Junction / crossing / convergence bonuses → convergence metric,
        // since these represent multi-signal agreement rather than a single route.
        //
        // Roman roads: only score when a physical signal (LiDAR, satellite,
        // hydrology, or raised ground) is already present. A Roman road nearby
        // is context; it should strengthen a signal, not create one.
        const hasPhysicalSignal = hasLidar || hasSatellite || hasHydrology || isRaised;

        let routeScore = 0;
        const routeReasons: string[] = [];
        let hasRomanProximity = false;
        let hasHistProximity  = false;
        let routeCount = 0;

        for (const route of routes) {
            const dist = getDistanceToLine(center, route.geometry, route.bbox);
            if (route.type === 'roman_road') {
                // Always track proximity for classification and convergence bonuses.
                if (dist < 500) { hasRomanProximity = true; }
                // Only add to behaviour score when a physical signal is present.
                if (hasPhysicalSignal) {
                    if (dist < 100)       { routeScore += 5; routeCount++; }
                    else if (dist < 250)  { routeScore += 4; routeCount++; }
                    else if (dist < 500)  { routeScore += 2; routeCount++; }
                }
            } else {
                // Route type hierarchy: trackways/holloways > green lanes > suspected routes
                const tw = getRouteTypeWeight(route);
                if (dist < 75)        { routeScore += Math.round(5 * tw); hasHistProximity = true; routeCount++; }
                else if (dist < 200)  { routeScore += Math.round(3 * tw); hasHistProximity = true; routeCount++; }
                else if (dist < 400)  { routeScore += Math.round(1 * tw); hasHistProximity = true; routeCount++; }
            }
        }

        // Junction bonuses → convergence (multiple routes meeting = convergence event)
        if (routeCount >= 2) {
            const nearbyRoutes = routes.filter(r => getDistanceToLine(center, r.geometry, r.bbox) < 500);
            const romanCount = nearbyRoutes.filter(r => r.type === 'roman_road').length;
            const histCount  = nearbyRoutes.length - romanCount;
            if (romanCount >= 2)                        { convergence += 7; routeReasons.push('Near Roman route junction'); }
            else if (romanCount >= 1 && histCount >= 1) { convergence += 6; routeReasons.push('Near historic route convergence'); }
            else if (histCount >= 2)                    { convergence += 4; routeReasons.push('Route junction nearby'); }
        }

        // Water crossing bonuses → convergence (route + hydrology = convergence event)
        let isHighConfidenceCrossing = false;
        if (hasHydrology) {
            if (hasRomanProximity)     { convergence += 7; routeReasons.push('Likely Roman water crossing'); isHighConfidenceCrossing = true; }
            else if (hasHistProximity) { convergence += 5; routeReasons.push('Historic crossing point'); isHighConfidenceCrossing = true; }
        }

        // Raised access beside route → convergence (terrain + route = convergence event)
        if (isRaised) {
            if (hasRomanProximity)     { convergence += 6; routeReasons.push('Raised access point beside Roman route'); }
            else if (hasHistProximity) { convergence += 4; routeReasons.push('Raised ground beside movement corridor'); }
        }

        if (hasRomanProximity && routeScore > 5)     explanation.push('Near probable Roman road corridor');
        else if (hasHistProximity && routeScore > 3)  explanation.push('Historic movement corridor nearby');
        routeReasons.forEach(r => { if (!explanation.includes(r)) explanation.push(r); });
        behaviour += routeScore;

        // ── Signal class diversity ─────────────────────────────────────────────
        // Rewards independent breadth of evidence across five signal classes.
        // Applied to convergence — combines with junction/crossing bonuses.
        // Classes: terrain (LiDAR/slope), hydrology, spectral (satellite),
        //          historic (AIM), movement (routes).
        const signalClasses = new Set<string>();
        if (sources.has('terrain') || sources.has('terrain_global') || sources.has('slope')) signalClasses.add('terrain');
        if (sources.has('hydrology'))                                                          signalClasses.add('hydrology');
        if (sources.has('satellite_spring') || sources.has('satellite_summer'))               signalClasses.add('spectral');
        if (hasAimEnrichment)                                                                 signalClasses.add('historic');
        if (hasRomanProximity || hasHistProximity)                                            signalClasses.add('movement');
        const signalClassCount = signalClasses.size;
        const diversityBonus   = signalClassCount >= 4 ? 10 : signalClassCount === 3 ? 6 : signalClassCount === 2 ? 3 : 0;
        convergence += diversityBonus;

        // ── Slope break scoring ───────────────────────────────────────────────
        // Slope clusters were present in sources but had no explicit scoring.
        // Large/clear breaks are meaningful; small/noisy clusters are not.
        if (hasSlope) {
            const bestSlope = members
                .filter(m => m.sources.includes('slope'))
                .sort((a, b) => (b.metrics?.area ?? 0) - (a.metrics?.area ?? 0))[0];
            const slopeArea = bestSlope?.metrics?.area ?? 0;
            if (slopeArea >= 80) {
                anomaly += 5;
                explanation.push('Slope break / terrace edge detected');
            } else {
                anomaly += 1; // noisy / tiny slope cluster — minimal contribution
            }
            // Slope is most meaningful alongside a corroborating signal
            if (hasHydrology)                          context += 2;
            if (hasRomanProximity || hasHistProximity) context += 2;
        }

        // ── Aspect scoring (south-facing support boost) ───────────────────────
        // Minor reinforcing boost only — aspect alone cannot create a hotspot.
        // Explanation only surfaces when other evidence already supports the site.
        if (isSouthFacing) {
            context += 3;
            if (hasLidar || hasHydrology || hasRomanProximity || hasHistProximity) {
                explanation.push('South-facing slope supports activity potential');
            }
        }

        // ── Landscape reading (microTopo + dryMargin score, others explanation) ─
        // Runs after all primary signals are scored. Capped at +10 here so landscape
        // context supports signal rather than dominating it — a series of micro-topo
        // indicators should not outweigh a physical LiDAR or satellite detection.
        const landscape = computeLandscapeReading(members, routes);
        if (landscape.score > 0) context += Math.min(landscape.score, 10);
        landscape.reasons.forEach(r => { if (!explanation.includes(r)) explanation.push(r); });

        // ── Penalties (hotspot-level with caps to prevent over-stacking) ──────
        // Applied once per hotspot rather than per member, so a merged group of
        // disturbed clusters isn't penalised multiple times for the same issue.
        const highDisturbanceCount = members.filter(m => m.disturbanceRisk === 'High').length;
        const featurelessCount     = members.filter(m => m.metrics && m.metrics.density < 0.05).length;

        // Signal-count-aware penalties: heavily suppress weak isolated signals but
        // protect multi-source results where several independent layers agree.
        if (highDisturbanceCount > 0) {
            penalty += sources.size >= 3 ? -3 : sources.size >= 2 ? -6 : -8;
            explanation.push('IGNORE: High risk of modern disturbance');
        }
        if (featurelessCount > 0) {
            penalty += sources.size >= 3 ? -2 : sources.size >= 2 ? -4 : -6;
            if (featurelessCount / members.length > 0.5) explanation.push('IGNORE: Uniform/Featureless terrain');
        }

        // ── Disturbance gate ──────────────────────────────────────────────────
        // High-disturbance hotspots are only kept if there is strong independent
        // evidence — AIM data, 3+ sources, multi-season satellite, or LiDAR +
        // hydrology agreement. Without this they are dropped entirely rather
        // than appearing as a penalised but still-surfaced result.
        if (highDisturbanceCount > 0) {
            const hasStrongEvidence = hasAimEnrichment || sources.size >= 3 || hasMultiSeasonSat || (hasLidar && hasHydrology);
            if (!hasStrongEvidence) continue;
        }

        // Hotspot-level disturbance label (for display badge).
        const hotspotDisturbanceRisk: 'Low' | 'Medium' | 'High' =
            highDisturbanceCount > 0 ? 'High' :
            members.some(m => m.disturbanceRisk === 'Medium') ? 'Medium' : 'Low';

        // ── Low disturbance reward ────────────────────────────────────────────
        // Quiet, undisturbed land is archaeologically meaningful — low context
        // means the ground is more likely to retain its original character.
        if (hotspotDisturbanceRisk === 'Low') context += 2;

        // ── Dimension caps ────────────────────────────────────────────────────
        // Prevents any one dimension from stacking into a false high-confidence
        // result. Raw values are preserved in metrics for the debug breakdown.
        const cappedAnomaly     = Math.min(anomaly,     30);
        const cappedContext     = Math.min(context,     25);
        const cappedConvergence = Math.min(convergence, 20);
        const cappedBehaviour   = Math.min(behaviour,   15);
        const cappedPenalty     = Math.max(penalty,    -20);
        const score       = Math.min(98, Math.max(0, cappedAnomaly + cappedContext + cappedConvergence + cappedBehaviour + cappedPenalty));
        const signalCount = sources.size;
        let confidence    = evaluateHotspotConfidence({ score, signalCount, behaviour, context, convergence });

        // ── Edge-of-scan check ────────────────────────────────────────────────
        // Clusters within 10% of the 768px canvas edge may be partial features.
        // Downgrade confidence one tier and flag for the user.
        const CANVAS_EDGE_PX = 768 * 0.1; // 77px
        const isEdgeOfScan = members.some(m =>
            m.minX < CANVAS_EDGE_PX ||
            m.minY < CANVAS_EDGE_PX ||
            m.maxX > 768 - CANVAS_EDGE_PX ||
            m.maxY > 768 - CANVAS_EDGE_PX
        );
        if (isEdgeOfScan) {
            if      (confidence === 'Strongest Signal')  confidence = 'Strong Signal';
            else if (confidence === 'Strong Signal')     confidence = 'Developing Signal';
            else if (confidence === 'Developing Signal') confidence = 'Weak Signal';
            explanation.push('Feature near scan edge — wider scan may improve confidence');
        }

        // ── Legacy type field (kept for call-site compatibility) ──────────────
        let type: Hotspot['type'] = 'General Activity Zone';
        if (hasHydrology && isRaised) type = 'Raised Dry Area (Likely)';
        else if (members.some(m => m.type.includes('Corridor'))) type = 'Movement Corridor (Likely)';

        // ── Classification layer ──────────────────────────────────────────────
        const { classification, reason: classificationReason, secondaryTag } = classifyHotspot({
            hasLidar, hasSatellite, satelliteIsPrimary,
            hasHydrology, isRaised,
            hasRomanProximity, hasHistProximity,
            routeCount, isHighConfidenceCrossing,
            anomaly, context, convergence, behaviour,
            signalCount: sources.size,
            signalClassCount,
        });

        // ── Suggested focus ───────────────────────────────────────────────────
        // One short, actionable field hint for the user. Derived here while all
        // signal flags are in scope so the UI does not need to re-derive them.
        // Every string must describe something visible in the field or readable
        // from a map shape. No engine terminology, no invisible signals.
        // If no clear visible guidance exists, leave undefined — show nothing.
        let suggestedFocus: string | undefined;
        const hasRouteAlignment = members.some(m => m.routeAlignment !== undefined);
        if (isHighConfidenceCrossing) {
            suggestedFocus = 'Check crossing point';
        } else if (classification === 'Junction / Convergence Zone') {
            suggestedFocus = 'Focus where the routes meet';
        } else if (hasRouteAlignment || classification === 'Route-Side Activity Zone') {
            suggestedFocus = 'Follow movement line';
        } else if (hasHydrology && members.some(m => m.polarity === 'Sunken')) {
            suggestedFocus = 'Focus along lowest ground';
        } else if (hasHydrology && isRaised) {
            suggestedFocus = 'Focus on the dry edge beside wetter ground';
        } else if (isRaised) {
            suggestedFocus = 'Target highest ground edge';
        } else if (hasRomanProximity) {
            suggestedFocus = 'Focus along the Roman road edge';
        } else if (hasHistProximity) {
            suggestedFocus = 'Focus along the route edge';
        } else if (hasLidar && !hasHydrology) {
            suggestedFocus = 'Focus where the ground begins to change shape';
        }
        // satelliteIsPrimary: spectral signal is not visible in the field — no suggestion shown

        // ── Primary evidence gate ─────────────────────────────────────────────
        // Drop context-only hotspots: must have LiDAR, multi-season satellite,
        // or AIM/known archaeology. Route proximity, raised ground, and
        // place-name signals alone cannot create a hotspot.
        if (!hasPrimaryEvidence) continue;

        let minLon = members[0].center[0], maxLon = members[0].center[0];
        let minLat = members[0].center[1], maxLat = members[0].center[1];
        members.forEach(m => {
            minLon = Math.min(minLon, m.center[0]); maxLon = Math.max(maxLon, m.center[0]);
            minLat = Math.min(minLat, m.center[1]); maxLat = Math.max(maxLat, m.center[1]);
        });

        results.push({
            id:                   `hs-${Math.round(c.center[0] * 1e5)}-${Math.round(c.center[1] * 1e5)}`,
            number:               0,
            score,
            confidence,
            type,
            classification,
            classificationReason,
            secondaryTag,
            suggestedFocus,
            explanation:          prioritiseExplanations(explanation, 4),
            center:               [(minLon + maxLon) / 2, (minLat + maxLat) / 2],
            bounds:               [[minLon - 0.0004, minLat - 0.0004], [maxLon + 0.0004, maxLat + 0.0004]],
            memberIds:            members.map(m => m.id),
            isHighConfidenceCrossing,
            role:        members.find(m => m.role)?.role,
            scale:       members.find(m => m.scale)?.scale,
            isOnCorridor: members.some(m => m.isOnCorridor),
            linkedCount: (() => { const ids = new Set<string>(); members.forEach(m => (m.linkedClusterIds ?? []).forEach(id => ids.add(id))); return ids.size; })(),
            disturbanceRisk:      hotspotDisturbanceRisk === 'Low' ? undefined : hotspotDisturbanceRisk,
            metrics:              { anomaly, context, convergence, behaviour, penalty, signalCount, signalClassCount },
        });
    }

    return results
        .filter(h => h.score >= 25)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map((h, i) => ({ ...h, number: i + 1 }));
}

// ─── Stage 2: historic enrichment ────────────────────────────────────────────
// Boosts hotspot scores using historic evidence points, monument proximity, and
// place-name signals. Purely additive — scores only go up, never above 98.
// Confidence is re-evaluated using the same shared model as stage 1.
// Classification carries through unchanged — it is based on terrain signals.

export function enhanceHotspotsWithHistoric(
    hotspots:       Hotspot[],
    historicFinds:  HistoricFind[],
    monumentPoints: [number, number][],
    placeSignals:   PlaceSignal[],
    targetPeriod:   string = 'All',
): Hotspot[] {
    const enhanced = hotspots.map(h => {
        let boost = 0;
        const notes: string[] = [];

        // Historic evidence points within 500m
        const nearbyFinds = historicFinds.filter(f =>
            getDistanceKm(h.center[1], h.center[0], f.lat, f.lon) < 0.5,
        );
        if (nearbyFinds.length > 0) {
            boost += Math.min(8, nearbyFinds.length * 3);
            notes.push(`${nearbyFinds.length} heritage site${nearbyFinds.length > 1 ? 's' : ''} within 500m`);
            if (targetPeriod !== 'All') {
                const periodMatch = nearbyFinds.some(f =>
                    f.broadperiod.toLowerCase().includes(targetPeriod.toLowerCase()),
                );
                if (periodMatch) { boost += 4; notes.push(`${targetPeriod} period activity recorded nearby`); }
            }
        }

        // Scheduled monument points within 300m (lon, lat GeoJSON order)
        const nearbyMonuments = monumentPoints.filter(([lon, lat]) =>
            getDistanceKm(h.center[1], h.center[0], lat, lon) < 0.3,
        );
        if (nearbyMonuments.length > 0) {
            boost += 5;
            notes.push('Near recorded scheduled monument');
        }

        // High-confidence place-name signals (area-level proxy — distance from scan centre)
        const strongSignals = placeSignals.filter(s => s.confidence >= 0.8 && s.distance < 1.0);
        if (strongSignals.length > 0) {
            boost += Math.min(4, strongSignals.length * 2);
            notes.push(`Place-name signal: "${strongSignals[0].name}" (${strongSignals[0].meaning})`);
        }

        if (boost === 0) return h;

        const newScore   = Math.min(98, h.score + boost);

        // Re-evaluate confidence using the shared model so historic boosts
        // cannot silently inflate labels beyond what the evidence supports.
        const confidence = evaluateHotspotConfidence({
            score:       newScore,
            signalCount: h.metrics.signalCount,
            behaviour:   h.metrics.behaviour,
            context:     h.metrics.context,
            convergence: h.metrics.convergence,
        });

        const allNotes = prioritiseExplanations([...h.explanation, ...notes], 5);
        return { ...h, score: newScore, confidence, explanation: allNotes };
    });

    return enhanced
        .sort((a, b) => b.score - a.score)
        .map((h, i) => ({ ...h, number: i + 1 }));
}

// ─── Combined entry point ─────────────────────────────────────────────────────
// Kept for call-site compatibility where both stages run in one call.

export function generateHotspots(
    clusters:     Cluster[],
    pas:          HistoricFind[]     = [],
    monuments:    [number, number][] = [],
    period:       string             = 'All',
    _perms:       unknown[]          = [],
    _flds:        unknown[]          = [],
    routes:       HistoricRoute[]    = [],
    placeSignals: PlaceSignal[]      = [],
): Hotspot[] {
    const terrain = buildTerrainHotspots(clusters, routes, monuments);
    if (pas.length === 0 && monuments.length === 0 && placeSignals.length === 0) return terrain;
    return enhanceHotspotsWithHistoric(terrain, pas, monuments, placeSignals, period);
}
