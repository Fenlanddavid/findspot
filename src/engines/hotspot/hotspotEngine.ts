// ─── Hotspot engine ───────────────────────────────────────────────────────────
// Two-stage pipeline:
//   buildTerrainHotspots        – terrain signal scoring (routes, LiDAR, spectral)
//   enhanceHotspotsWithHistoric – additive historic enrichment layer
//
// generateHotspots is the combined entry point kept for call-site compatibility.

import { Cluster, Hotspot, HotspotClassification, SoilMechanics, HistoricFind, PlaceSignal, HistoricRoute } from '../../pages/fieldGuideTypes';
import type { PASCellLookup } from '../../services/pasDensityService';
import { getDistance, getDistanceToLine, getDistanceKm, getRouteTypeWeight, computeFieldReliabilityScore } from '../../utils/fieldGuideAnalysis';
import { computeLandscapeReading } from '../landscape/landscapeReadingEngine';
import type { GeologyContext } from '../geologyContext/geologyContextTypes';
import { netGeologyScore } from '../geologyContext/geologyModifiers';
import {
    hotspotExplanation,
    prioritiseHotspotExplanations,
    supportingExplanation,
    type HotspotExplanation,
} from './hotspotExplanations';

export const HOTSPOT_ENGINE_VERSION = 'FG-2026.07.21a';

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

// ─── A: Landscape Positioning Model ──────────────────────────────────────────
// Asks: "Is this in the kind of position humans repeatedly chose to use?"
// Covers three positioning patterns not captured by existing scoring:
//   - Offset from movement (beside a route, not on it)
//   - Sheltered raised position (slope backing + water nearby, confirmed by LiDAR)
//   - Negative-space preservation (quiet undisturbed raised ground away from routes)
//
// Feeds into context, capped at +6 so landscape positioning supports signal
// rather than substituting for physical evidence.

function computeLandscapePositioning(params: {
    members:                Cluster[];
    routes:                 HistoricRoute[];
    center:                 [number, number];
    isRaised:               boolean;
    hasHydrology:           boolean;
    hasSlope:               boolean;
    hasLidar:               boolean;
    hasRomanProximity:      boolean;
    hasHistProximity:       boolean;
    isHighConfidenceCrossing: boolean;
}): { score: number; explanations: HotspotExplanation[] } {
    const {
        members, routes, center, isRaised, hasHydrology, hasSlope, hasLidar,
        hasRomanProximity, hasHistProximity, isHighConfidenceCrossing,
    } = params;
    let score = 0;
    const explanations: HotspotExplanation[] = [];
    const hasAnyRoute = hasRomanProximity || hasHistProximity;

    // 1. Offset positioning: raised ground near a route but not directly on it.
    //    Classic settlement-edge pattern — habitation beside movement rather than on it.
    //    Excluded when the site is already a confirmed crossing (which IS on the route).
    if (isRaised && hasAnyRoute && !isHighConfidenceCrossing && routes.length > 0) {
        const nearestDist = Math.min(...routes.map(r => getDistanceToLine(center, r.geometry, r.bbox)));
        if (nearestDist > 80 && nearestDist < 350) {
            score += 2;
            explanations.push(hotspotExplanation('movement_offset', 'Offset position beside movement corridor'));
        }
    }

    // 2. Sheltered raised position: raised + slope break + hydrology + LiDAR.
    //    Proxy for the "backed by hill, fronted by water" pattern — common in
    //    settlement placement across all periods. LiDAR required to avoid firing
    //    on speculative combinations without physical confirmation.
    if (isRaised && hasSlope && hasHydrology && hasLidar) {
        score += 2;
        explanations.push(hotspotExplanation('sheltered_position', 'Sheltered raised position — slope backing, water nearby'));
    }

    // 3. Negative-space preservation zone: raised, undisturbed, not route-adjacent.
    //    Quiet ground passed over by later activity — archaeologically meaningful because
    //    isolation often protects buried material from disturbance and truncation.
    //    Requires 2+ member clusters so a single weak cluster cannot trigger this alone.
    const allLowDisturbance = members.length >= 2 && members.every(m => m.disturbanceRisk !== 'High');
    const routeDistance = routes.length > 0
        ? Math.min(...routes.map(r => getDistanceToLine(center, r.geometry, r.bbox)))
        : Infinity;
    if (allLowDisturbance && isRaised && !hasAnyRoute && routeDistance > 250) {
        score += 2;
        explanations.push(hotspotExplanation('quiet_preservation', 'Quiet raised ground — low disturbance, away from main routes'));
    }

    return { score: Math.min(score, 6), explanations };
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
    // New flags for Burial/Barrow and Field System classifications
    hasCircularFeature:     boolean;
    hasLinearPattern:       boolean;
    hasSettlementContext:   boolean;
    disturbanceIsHigh:      boolean;
    // B: Multi-period classification
    hasMultiSeasonSat:      boolean;
    hasAimEnrichment:       boolean;
    hasPalaeoChannel:       boolean;
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

    // 3. Burial / Barrow Candidate — isolated compact circular raised feature confirmed by LiDAR.
    // Requires the cluster to have a circular earthwork type and high circularity, but must NOT
    // sit within a settlement cluster (which would indicate a domestic rather than funerary feature).
    // Ranked before Multi-Period: Bronze Age barrows are the highest-yield single site type for
    // metal detecting in England. Specific morphological identity should win over broad periodisation.
    if (ctx.hasLidar && ctx.isRaised && ctx.hasCircularFeature &&
        !ctx.hasSettlementContext && ctx.anomaly >= 10) {
        return {
            classification: 'Burial / Barrow Candidate',
            reason:         'Compact circular raised feature — check heritage records before investigating',
        };
    }

    // B: Multi-Period Occupation Zone — physical earthwork (LiDAR) and seasonal spectral signal
    // (multi-season satellite) represent independent time-depths of deposition. Together with
    // diverse signal classes, this indicates repeated human use rather than a single episode.
    // Circular burial features take priority above this (already handled); non-circular
    // multi-period evidence sits above broad settlement/wetland/route buckets.
    if (!ctx.hasCircularFeature && ctx.hasLidar && ctx.hasMultiSeasonSat && ctx.signalClassCount >= 3 && ctx.anomaly >= 10) {
        return {
            classification: 'Multi-Period Occupation Zone',
            reason:         'Physical earthwork and multi-season spectral signals — activity from more than one period',
            secondaryTag:   ctx.hasAimEnrichment ? 'Historically recorded activity nearby' : undefined,
        };
    }

    // 4. Settlement Edge Candidate — raised LiDAR anomaly with meaningful context.
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

    // 5. Organised Field System Candidate — 2+ parallel or rectilinear linear features without
    // strong settlement or route-junction context. Suppressed when disturbance is high (risk of
    // confusing modern ridge-and-furrow) unless independent physical evidence is present.
    if (ctx.hasLinearPattern && !ctx.hasSettlementContext &&
        !ctx.disturbanceIsHigh &&
        (ctx.hasLidar || ctx.hasSatellite) &&
        (ctx.convergence >= 4 || ctx.signalClassCount >= 2)) {
        return {
            classification: 'Organised Field System Candidate',
            reason:         'Repeated linear signals suggest an organised field or boundary system',
        };
    }

    // 5b. Palaeochannel Activity Zone — confirmed ancient watercourse without a
    //     strong route-junction identity. Weak route proximity can still be part
    //     of the watercourse story, so only convergence >= 6 suppresses this.
    if (ctx.hasPalaeoChannel && ctx.convergence < 6) {
        return {
            classification: 'Palaeochannel Activity Zone',
            reason:         'Former watercourse — potential activity focus at channel edge or silted deposit zone',
            secondaryTag:   ctx.hasRomanProximity ? 'Roman corridor influence' : undefined,
        };
    }

    // 6. Wetland Margin Activity Zone — raised dry island in wet context, no dominant junction
    if (ctx.hasHydrology && ctx.isRaised && ctx.context >= 8 && ctx.convergence < 6) {
        return {
            classification: 'Wetland Margin Activity Zone',
            reason:         'Dry elevated ground beside wetter terrain',
        };
    }

    // 7. Route-Side Activity Zone — route-led but not a junction or crossing
    // P2: behaviour threshold 8 → 6
    if (ctx.behaviour >= 6 && (ctx.hasRomanProximity || ctx.hasHistProximity) && ctx.convergence < 6) {
        return {
            classification: 'Route-Side Activity Zone',
            reason:         'Signals cluster alongside a movement corridor',
            secondaryTag:   ctx.hasRomanProximity ? 'Roman corridor influence' : undefined,
        };
    }

    // 9. Terrain Structure Candidate — LiDAR anomaly without route or hydrology reinforcement.
    // P2: anomaly 15 → 12, behaviour guard 8 → 6
    if (ctx.hasLidar && ctx.anomaly >= 12 && ctx.context >= 4 && !ctx.hasHydrology && ctx.behaviour < 6) {
        return {
            classification: 'Terrain Structure Candidate',
            reason:         'Distinct structural relief detected in LiDAR',
        };
    }

    // 10. Spectral Activity Candidate — satellite only, no LiDAR confirmation
    if (ctx.satelliteIsPrimary && !ctx.hasLidar) {
        return {
            classification: 'Spectral Activity Candidate',
            reason:         'Cropmark or vegetation response — field verification recommended',
        };
    }

    // ── Contextual fallbacks ──────────────────────────────────────────────────
    // Signal-derived labels so outputs feel distinct and meaningful even when
    // primary thresholds are not met.

    // 11. Lowland Activity Zone — hydrology present but below Wetland Margin threshold
    if (ctx.hasHydrology && ctx.convergence < 6) {
        return {
            classification: 'Lowland Activity Zone',
            reason:         'Hydrological signal near water',
        };
    }

    // 12. Raised Activity Area — elevated terrain without strong structural signal
    if (ctx.isRaised) {
        return {
            classification: 'Raised Activity Area',
            reason:         'Slightly elevated ground favoured for settlement or use',
        };
    }

    // 13. Route-Influenced Area — route nearby but below route-side threshold
    if (ctx.hasRomanProximity || ctx.hasHistProximity) {
        return {
            classification: 'Route-Influenced Area',
            reason:         'Route proximity with activity signal clustering nearby',
            secondaryTag:   ctx.hasRomanProximity ? 'Roman corridor influence' : undefined,
        };
    }

    // 14. Cropmark Activity Zone — satellite signal present without exclusive spectral trigger
    if (ctx.hasSatellite && !ctx.hasLidar) {
        return {
            classification: 'Cropmark Activity Zone',
            reason:         'Spectral signal alongside other sources detected',
        };
    }

    // 15. Multi-Signal Activity Zone — multiple weak signals from different sources
    if (ctx.signalCount >= 2) {
        return {
            classification: 'Multi-Signal Activity Zone',
            reason:         'Mixed signals from multiple independent sources',
        };
    }

    // 16. General Activity Zone — ultimate fallback
    return {
        classification: 'General Activity Zone',
        reason:         'Multiple independent signals detected',
    };
}

// ─── Soil mechanics class derivation ─────────────────────────────────────────
// Derives a single interpretationClass for a hotspot from signals already
// computed during scoring. Called per-hotspot after classification is known.
// Crossing points, junctions, and barrows are excluded — their identity is
// already fully characterised and soil mechanics would add noise, not insight.
//
// Note: 'colluvial_accumulation' and the corresponding 'hilltop_source_zone'
// upgrade are assigned by analyzeHotspotRelationships, which can compare pairs
// of hotspots. This function only assigns classes that can be derived from a
// single hotspot's own signals.

function deriveSoilMechanicsClass(params: {
    isRaised:             boolean;
    hasHydrology:         boolean;
    hasSlope:             boolean;
    context:              number;
    disturbanceIsHigh:    boolean;
    highDisturbanceCount: number;
    isHighConfidenceCrossing: boolean;
    classification:       HotspotClassification;
}): SoilMechanics | undefined {
    const { isRaised, hasHydrology, hasSlope, context, disturbanceIsHigh,
            highDisturbanceCount, isHighConfidenceCrossing, classification } = params;

    // Skip hotspots where another identity already dominates interpretation.
    if (isHighConfidenceCrossing ||
        classification === 'Crossing Point Candidate'   ||
        classification === 'Junction / Convergence Zone' ||
        classification === 'Burial / Barrow Candidate') return undefined;

    // 1. Disturbed plough slope — slope + high disturbance.
    //    Repeated ploughing on a gradient moves material downslope season by season.
    if (hasSlope && !isRaised && highDisturbanceCount > 0) {
        return {
            interpretationClass: 'disturbed_plough_slope',
            userNote: 'Sloping disturbed ground — artefacts may have shifted downslope. Check nearby lower ground for accumulation.',
        };
    }

    // 2. Wet margin preservation — low wet ground favours burial survival,
    //    but signals may be offset from the actual original deposition point.
    if (hasHydrology && !isRaised &&
        (classification === 'Lowland Activity Zone' || classification === 'Wetland Margin Activity Zone')) {
        return {
            interpretationClass: 'wet_margin_preservation',
            userNote: 'Low wet ground favours preservation — finds may survive well but could be buried deeper than on drier slopes.',
        };
    }

    // 3. Stable plateau — raised, no slope transport risk, low disturbance.
    //    Artefacts are more likely to remain close to their original deposition point.
    if (isRaised && !hasSlope && !hasHydrology && !disturbanceIsHigh) {
        return {
            interpretationClass: 'stable_plateau',
            userNote: 'Raised stable ground — artefacts here are more likely to be where they were originally deposited.',
        };
    }

    // 4. Hilltop source zone — raised with slope below; material may have moved.
    //    Context cap of 14 avoids tagging strong settlement candidates where the
    //    raised signal is already well-explained by archaeological context.
    if (isRaised && hasSlope && context < 14) {
        return {
            interpretationClass: 'hilltop_source_zone',
            userNote: 'Raised ground with slope below — this may be the activity source area. Check adjacent lower ground too.',
        };
    }

    return undefined;
}

// ─── Stage 1: terrain-based scoring ──────────────────────────────────────────

export function buildTerrainHotspots(
    clusters:       Cluster[],
    routes:         HistoricRoute[]    = [],
    monumentPoints: [number, number][] = [],
): Hotspot[] {
    const results: Hotspot[] = [];
    const usedIds = new Set<string>();

    // Field-level reliability — computed once from the full cluster population.
    // Used at the end to proportionally soften confidence in noisy/disturbed fields.
    const fieldReliability = computeFieldReliabilityScore(clusters);

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
        const explanation: HotspotExplanation[] = [];

        const sources = new Set(members.flatMap(m => m.sources));

        // ── Signal presence flags (what data exists) ──────────────────────────
        const hasLidar              = sources.has('terrain') || sources.has('terrain_global');
        const hasSatellite          = sources.has('satellite_spring') || sources.has('satellite_summer');
        const hasHydrology          = sources.has('hydrology');
        const hasMultiSeasonSat     = sources.has('satellite_summer') && sources.has('satellite_spring');
        const hasAimEnrichment      = members.some(m => m.aimInfo !== undefined);
        const hasPalaeoChannel      = members.some(m => m.type.includes('Palaeochannel') && m.polarity === 'Sunken');
        // Primary evidence: at least one hard physical or archaeological signal.
        // Context-only hotspots (route proximity, place-names, raised ground alone)
        // are excluded by this gate — they cannot create a hotspot by themselves.
        // A confirmed palaeochannel from the hydrology worker is observable
        // physical evidence, but it is scored conservatively below LiDAR.
        const hasPrimaryEvidence    = hasLidar || hasMultiSeasonSat || hasAimEnrichment || hasPalaeoChannel;

        // ── Signal weighting roles (how each signal contributes) ──────────────
        // Satellite is either the primary terrain signal (no LiDAR) or a
        // supporting corroboration layer (alongside LiDAR). These are separate
        // concepts — presence and role — so they are tracked independently.
        const satelliteIsPrimary    = hasSatellite && !hasLidar;
        const satelliteIsSupporting = hasSatellite && hasLidar;

        if (hasLidar) {
            const bestLidar = members.find(m => m.sources.includes('terrain') || m.sources.includes('terrain_global'));
            let lidarScore = bestLidar?.confidence === 'High' ? 18 : (bestLidar?.confidence === 'Medium' ? 10 : 5);
            if (hasHydrology)            { lidarScore += 5; explanation.push(hotspotExplanation('lidar_hydrology', 'LiDAR + Hydrology correlation')); }
            if (satelliteIsSupporting && sources.has('satellite_summer')) { lidarScore += 4; explanation.push(hotspotExplanation('lidar_spectral', 'LiDAR + Spectral agreement')); }
            anomaly += lidarScore;
            explanation.push(hotspotExplanation('lidar_relief', 'Reliable LiDAR relief signature'));
        }

        if (satelliteIsPrimary) {
            const hasSummer = sources.has('satellite_summer');
            const hasSpring = sources.has('satellite_spring');
            // Summer = 7 (raised: +8 → 15, clears hotspot threshold without needing routes)
            anomaly += (hasSummer && hasSpring) ? 10 : (hasSummer ? 7 : 3);
            explanation.push(hotspotExplanation('spectral_anomaly', 'Spectral vegetation anomaly'));
        }

        const center        = c.center;
        const isRaised      = members.some(m => m.polarity === 'Raised');
        const hasSlope      = sources.has('slope');
        const isSouthFacing = members.some(m => typeof m.aspect === 'number' && m.aspect >= 135 && m.aspect <= 225);

        if (isRaised) {
            context += 8;
            explanation.push(hotspotExplanation('raised_footing', 'Raised dry footing'));
            if (hasHydrology) { context += 4; explanation.push(hotspotExplanation('raised_water_margin', 'Raised dry margin near water')); }
        }

        if (hasHydrology) {
            // Raised ground near water is a strong signal; flat/wet ground alone is weak
            anomaly += isRaised ? 5 : 2;
            if (isRaised) {
                behaviour += 6 + (hasLidar ? 4 : 0);
                explanation.push(hotspotExplanation('raised_wetland_island', 'Island effect: Dry ground in wet zone'));
            }
            if (members.some(m => m.type.includes('Corridor'))) {
                behaviour += 5 + (hasLidar ? 3 : 0);
                explanation.push(hotspotExplanation('historic_crossing', 'Historic river crossing / Ford potential'));
            }
        }

        // ── Palaeochannel: treat as primary evidence contribution ─────────────
        // A confirmed ancient watercourse is observable physical evidence.
        // Capped at +8 anomaly — supports but does not dominate a hotspot.
        if (hasPalaeoChannel) {
            anomaly += 8;
            explanation.push(hotspotExplanation('palaeochannel', 'Palaeochannel — ancient watercourse signal'));
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
                explanation.push(hotspotExplanation('terrain_hydrology_depression', 'Hydrology + terrain depression agreement'));
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
            explanation.push(hotspotExplanation('multi_season_cropmark', 'Multi-season cropmark agreement'));
        }

        // ── Persistence (verified signal via repeat detection) ────────────────────
        if (members.some(m => (m.rescanCount || 0) >= 3)) {
            context += 3;
            explanation.push(hotspotExplanation('repeated_detection', 'Repeated detection across scans'));
        }

        // ── Context labels from cluster analysis ──────────────────────────────────
        // analyzeContext runs before buildTerrainHotspots in the pipeline, so
        // contextLabel and role are fully populated by the time we reach here.
        const memberContextLabels = members.map(m => m.contextLabel).filter(Boolean) as string[];
        if (memberContextLabels.some(l =>
            l === 'Enclosed Settlement / Farmstead' || l === 'Habitation Cluster / Settlement Nucleus',
        )) {
            context += 5;
            explanation.push(hotspotExplanation('settlement_structure', 'Settlement structure indicators'));
        }
        if (memberContextLabels.some(l => l === 'Primary Access Route into Settlement')) {
            behaviour += 3;
            explanation.push(hotspotExplanation('settlement_access', 'Access route into settlement detected'));
        }
        if (memberContextLabels.some(l => l === 'Organized Field System / Celtic Fields')) {
            explanation.push(hotspotExplanation('field_system', 'Field system indicators'));
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

        // Palaeochannel crossing — same logic, slightly discounted because the
        // channel is inferred rather than directly observed as active water.
        // Only fires when a live-water crossing has not already been identified.
        if (hasPalaeoChannel && !isHighConfidenceCrossing) {
            if (hasRomanProximity) {
                convergence += 6; routeReasons.push('Likely Roman palaeochannel crossing'); isHighConfidenceCrossing = true;
            } else if (hasHistProximity) {
                convergence += 4; routeReasons.push('Palaeochannel crossing point'); isHighConfidenceCrossing = true;
            }
        }

        // Raised access beside route → convergence (terrain + route = convergence event)
        if (isRaised) {
            if (hasRomanProximity)     { convergence += 6; routeReasons.push('Raised access point beside Roman route'); }
            else if (hasHistProximity) { convergence += 4; routeReasons.push('Raised ground beside movement corridor'); }
        }

        if (hasRomanProximity && routeScore > 5)     explanation.push(hotspotExplanation('roman_proximity', 'Near probable Roman road corridor'));
        else if (hasHistProximity && routeScore > 3) explanation.push(hotspotExplanation('historic_movement', 'Historic movement corridor nearby'));
        routeReasons.forEach(r => explanation.push(supportingExplanation(r)));
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
                explanation.push(hotspotExplanation('landscape_edge', 'Slope break / terrace edge detected'));
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
                explanation.push(hotspotExplanation('slope_aspect', 'South-facing slope supports activity potential'));
            }
        }

        // ── Landscape reading (microTopo + dryMargin score, others explanation) ─
        // Runs after all primary signals are scored. Capped at +10 here so landscape
        // context supports signal rather than dominating it — a series of micro-topo
        // indicators should not outweigh a physical LiDAR or satellite detection.
        const landscape = computeLandscapeReading(members, routes);
        if (landscape.score > 0) context += Math.min(landscape.score, 10);
        landscape.reasons.forEach(r => explanation.push(supportingExplanation(r)));

        // ── A: Landscape Positioning Model ────────────────────────────────────
        // Asks whether this is in a position humans repeatedly chose.
        // Covers offset positioning, sheltered raised sites, and negative-space
        // preservation — patterns not captured by existing signal scoring.
        const positioning = computeLandscapePositioning({
            members, routes, center, isRaised, hasHydrology, hasSlope, hasLidar,
            hasRomanProximity, hasHistProximity, isHighConfidenceCrossing,
        });
        if (positioning.score > 0) context += positioning.score;
        explanation.push(...positioning.explanations);

        // ── D: Viewshed Proxy ─────────────────────────────────────────────────
        // Cheap observational advantage: raised + LiDAR-confirmed point that
        // commands a position over a crossing, route, or water margin.
        // Does not compute actual line-of-sight — uses elevation + proximity as proxy.
        if (isRaised && hasLidar) {
            const nearestRouteDist = routes.length > 0
                ? Math.min(...routes.map(r => getDistanceToLine(center, r.geometry, r.bbox)))
                : Infinity;
            if (isHighConfidenceCrossing) {
                context += 4;
                explanation.push(hotspotExplanation('observational_vantage', 'Observational vantage over crossing point'));
            } else if (hasHydrology && nearestRouteDist < 150) {
                context += 3;
                explanation.push(hotspotExplanation('raised_overlook', 'Raised position overlooking route and water', 'route_water'));
            } else if (nearestRouteDist < 200) {
                context += 2;
                explanation.push(hotspotExplanation('raised_overlook', 'Raised position overlooking movement corridor', 'movement'));
            }
        }

        // ── Penalties (hotspot-level with caps to prevent over-stacking) ──────
        // Applied once per hotspot rather than per member, so a merged group of
        // disturbed clusters isn't penalised multiple times for the same issue.
        const highDisturbanceCount = members.filter(m => m.disturbanceRisk === 'High').length;
        const featurelessCount     = members.filter(m => m.metrics && m.metrics.density < 0.05).length;

        // Signal-count-aware penalties: heavily suppress weak isolated signals but
        // protect multi-source results where several independent layers agree.
        if (highDisturbanceCount > 0) {
            penalty += sources.size >= 3 ? -3 : sources.size >= 2 ? -6 : -8;
            explanation.push(hotspotExplanation('ignore_modern_disturbance', 'IGNORE: High risk of modern disturbance'));
        }
        if (featurelessCount > 0) {
            penalty += sources.size >= 3 ? -2 : sources.size >= 2 ? -4 : -6;
            if (featurelessCount / members.length > 0.5) explanation.push(hotspotExplanation('ignore_featureless', 'IGNORE: Uniform/Featureless terrain'));
        }

        // ── Negative evidence penalties ───────────────────────────────────────
        // Anti-archaeological behaviour patterns that reduce overconfident interpretation.
        // Applied after all positive scoring so they act as calibration, not suppression.
        {
            const _hasCircularFeature   = members.some(m =>
                m.type.includes('Roundhouse') || m.type.includes('Barrow') ||
                m.type.includes('Ring Ditch') || (m.metrics?.circularity ?? 0) > 0.65
            );
            const _hasSettlementContext = members.some(m =>
                m.type.includes('Settlement') || m.type.includes('Building') || m.type.includes('Structure')
            );
            const _hasLinearPattern     = members.filter(m =>
                m.type.includes('Linear') || m.type.includes('Ditch') ||
                m.type.includes('Boundary') || m.type.includes('Enclosure')
            ).length >= 2;

            // Route proximity without any archaeological form — context should strengthen
            // a signal, not substitute for one. Penalise route-only behaviour.
            if ((hasRomanProximity || hasHistProximity) &&
                !_hasCircularFeature && !_hasSettlementContext && !isHighConfidenceCrossing &&
                !hasHydrology && anomaly < 12) {
                penalty -= 4;
                explanation.push(hotspotExplanation('ignore_route_only', 'IGNORE: Route proximity without archaeological form'));
            }

            // All linear signals, no circular or structural, no hydrology — field grid or drainage.
            if (_hasLinearPattern && !_hasCircularFeature && !_hasSettlementContext &&
                !hasHydrology && signalClassCount <= 2 && !hasRomanProximity) {
                penalty -= 3;
            }
        }

        // ── Route assessment adjustments ──────────────────────────────────────
        // Applied from member cluster route assessments, averaged across all members
        // so a single noisy cluster in a multi-member hotspot has proportional impact.
        // Caps: noise penalty max -15, movement boost max +8.
        // modern_route_artefact members (-999) are excluded by getHotspotInput before
        // reaching here, so the effective range is roughly -15 to +8.
        {
            const adjValues = members.map(m => m.routeAssessment?.hotspotScoreAdjustment ?? 0);
            const hasAny    = adjValues.some(v => v !== 0);
            if (hasAny) {
                const avg      = adjValues.reduce((s, v) => s + v, 0) / adjValues.length;
                const clamped  = Math.max(-15, Math.min(8, avg));
                if (clamped < 0) {
                    penalty += clamped;
                } else if (clamped > 0) {
                    context += clamped;
                }
            }
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
        const cappedBehaviour   = Math.min(behaviour,   20);  // raised 15→20: Roman roads are strongest predictor
        const cappedPenalty     = Math.max(penalty,    -20);
        const score       = Math.min(98, Math.max(0, cappedAnomaly + cappedContext + cappedConvergence + cappedBehaviour + cappedPenalty));
        const signalCount = sources.size;
        let confidence    = evaluateHotspotConfidence({ score, signalCount, behaviour, context, convergence });

        // ── Edge-of-scan check ────────────────────────────────────────────────
        // Flag only when the hotspot's own pixel centre is within 10% of the
        // canvas edge. Using `some` over member bounds was too aggressive —
        // a single outlier cluster at the edge would flag hotspots centred
        // in the scan area. Centre-based check matches user expectation.
        const CANVAS_EDGE_PX = 768 * 0.1; // 77px
        const cxPx = members.reduce((s, m) => s + (m.minX + m.maxX) / 2, 0) / members.length;
        const cyPx = members.reduce((s, m) => s + (m.minY + m.maxY) / 2, 0) / members.length;
        const isEdgeOfScan = (
            cxPx < CANVAS_EDGE_PX ||
            cyPx < CANVAS_EDGE_PX ||
            cxPx > 768 - CANVAS_EDGE_PX ||
            cyPx > 768 - CANVAS_EDGE_PX
        );
        if (isEdgeOfScan) {
            if      (confidence === 'Strongest Signal')  confidence = 'Strong Signal';
            else if (confidence === 'Strong Signal')     confidence = 'Developing Signal';
            else if (confidence === 'Developing Signal') confidence = 'Weak Signal';
            explanation.push(hotspotExplanation('scan_edge', 'Feature near scan edge — wider scan may improve confidence'));
        }

        // ── Steep-slope confidence suppressor ─────────────────────────────────
        // A hotspot centred mid-slope (not on raised ground, no hydrology context,
        // no AIM corroboration) with weak landscape context is more likely to
        // reflect colluvially moved material than in-situ activity. Downgrade one
        // tier. Does not affect raised terrace edges or water-margin slopes, which
        // are archaeologically meaningful in their own right.
        if (hasSlope && !isRaised && !hasHydrology && context < 6 && !hasAimEnrichment) {
            if      (confidence === 'Strongest Signal')  confidence = 'Strong Signal';
            else if (confidence === 'Strong Signal')     confidence = 'Developing Signal';
            else if (confidence === 'Developing Signal') confidence = 'Weak Signal';
        }

        // ── Legacy type field (kept for call-site compatibility) ──────────────
        let type: Hotspot['type'] = 'General Activity Zone';
        if (hasHydrology && isRaised) type = 'Raised Dry Area (Likely)';
        else if (members.some(m => m.type.includes('Corridor'))) type = 'Movement Corridor (Likely)';

        // ── Classification layer ──────────────────────────────────────────────
        const hasCircularFeature   = members.some(m =>
            m.type.includes('Roundhouse') || m.type.includes('Barrow') ||
            m.type.includes('Ring Ditch') || (m.metrics?.circularity ?? 0) > 0.65
            // Threshold lowered 0.7→0.65: ring ditches on ploughed fields are rarely
            // perfectly circular — ploughing distorts the signal.
        );
        const hasLinearPattern     = members.filter(m =>
            m.type.includes('Linear') || m.type.includes('Ditch') ||
            m.type.includes('Boundary') || m.type.includes('Enclosure')
        ).length >= 2;
        const hasSettlementContext = members.some(m =>
            m.type.includes('Settlement') || m.type.includes('Building') || m.type.includes('Structure')
        );
        const disturbanceIsHigh    = hotspotDisturbanceRisk === 'High';

        const { classification, reason: classificationReason, secondaryTag } = classifyHotspot({
            hasLidar, hasSatellite, satelliteIsPrimary,
            hasHydrology, isRaised,
            hasRomanProximity, hasHistProximity,
            routeCount, isHighConfidenceCrossing,
            anomaly, context, convergence, behaviour,
            signalCount: sources.size,
            signalClassCount,
            hasCircularFeature, hasLinearPattern, hasSettlementContext, disturbanceIsHigh,
            hasMultiSeasonSat, hasAimEnrichment, hasPalaeoChannel,
        });

        // ── Soil mechanics class (per-hotspot) ───────────────────────────────
        // Derived from signals already computed above — no new data needed.
        // 'colluvial_accumulation' requires comparing two hotspots so it is
        // assigned later in analyzeHotspotRelationships, not here.
        const soilMechanics = deriveSoilMechanicsClass({
            isRaised, hasHydrology, hasSlope, context,
            disturbanceIsHigh,
            highDisturbanceCount,
            isHighConfidenceCrossing,
            classification,
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
        } else if (hasPalaeoChannel && classification === 'Palaeochannel Activity Zone') {
            suggestedFocus = 'Focus on both edges of the former channel — activity concentrates at the margins';
        } else if (classification === 'Junction / Convergence Zone') {
            suggestedFocus = 'Focus where the routes meet';
        } else if (classification === 'Multi-Period Occupation Zone') {
            suggestedFocus = 'Look for variation across the area — periods may be spatially offset';
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

        // GEOLOGY_RULE assertion (dev-only)
        // Geology must never be the sole source of a hotspot. If geology is ever
        // added to the sources set, this fires immediately in development so the
        // violation is caught before it reaches production.
        if (import.meta.env.DEV) {
            const nonGeologySources = [...sources].filter(s => (s as string) !== 'geology');
            if (nonGeologySources.length === 0) {
                console.error('[GEOLOGY_RULE] Hotspot emitted with geology as sole source.', { sources: [...sources], center: c.center });
            }
        }

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
            explanation:          prioritiseHotspotExplanations(explanation, 4),
            center:               [(minLon + maxLon) / 2, (minLat + maxLat) / 2],
            bounds:               [[minLon - 0.0004, minLat - 0.0004], [maxLon + 0.0004, maxLat + 0.0004]],
            memberIds:            members.map(m => m.id),
            isHighConfidenceCrossing,
            role:        members.find(m => m.role)?.role,
            scale:       members.find(m => m.scale)?.scale,
            isOnCorridor: members.some(m => m.isOnCorridor),
            linkedCount: (() => { const ids = new Set<string>(); members.forEach(m => (m.linkedClusterIds ?? []).forEach(id => ids.add(id))); return ids.size; })(),
            disturbanceRisk:      hotspotDisturbanceRisk === 'Low' ? undefined : hotspotDisturbanceRisk,
            soilMechanics:        soilMechanics ?? undefined,
            metrics:              { anomaly, context, convergence, behaviour, penalty, signalCount, signalClassCount },
        });
    }

    return results
        .filter(h => h.score >= 25)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map((h, i) => {
            // Proportional confidence softening in low-reliability fields.
            // Prevents weak signals in heavily-disturbed scans being labelled
            // with the same confidence as strong signals in clean fields.
            let confidence = h.confidence;
            if (fieldReliability.label === 'low') {
                if (confidence === 'Developing Signal') confidence = 'Weak Signal';
            } else if (fieldReliability.label === 'moderate') {
                if (confidence === 'Strongest Signal' && h.score < 85) confidence = 'Strong Signal';
            }
            return { ...h, number: i + 1, confidence };
        });
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
    aimFeatures:    { center: [number, number]; type: string; period: string }[] = [],
): Hotspot[] {
    const enhanced = hotspots.map(h => {
        let boost = 0;
        const notes: HotspotExplanation[] = [];

        // Historic evidence points within 500m
        const nearbyFinds = historicFinds.filter(f =>
            getDistanceKm(h.center[1], h.center[0], f.lat, f.lon) < 0.5,
        );
        if (nearbyFinds.length > 0) {
            boost += Math.min(8, nearbyFinds.length * 3);
            notes.push(hotspotExplanation(
                'historic_overlap',
                `${nearbyFinds.length} heritage site${nearbyFinds.length > 1 ? 's' : ''} within 500m`,
                `count_${nearbyFinds.length}`,
            ));
            if (targetPeriod !== 'All') {
                const periodMatch = nearbyFinds.some(f =>
                    f.broadperiod.toLowerCase().includes(targetPeriod.toLowerCase()),
                );
                if (periodMatch) {
                    boost += 4;
                    notes.push(hotspotExplanation('historic_overlap', `${targetPeriod} period activity recorded nearby`, `period_${targetPeriod.toLowerCase()}`));
                }
            }
        }

        // Scheduled monument points within 300m (lon, lat GeoJSON order)
        const nearbyMonuments = monumentPoints.filter(([lon, lat]) =>
            getDistanceKm(h.center[1], h.center[0], lat, lon) < 0.3,
        );
        if (nearbyMonuments.length > 0) {
            boost += 5;
            notes.push(hotspotExplanation('historic_overlap', 'Near recorded scheduled monument', 'scheduled_monument'));
        }

        // AIM cropmark polygons within 200m
        // Only fires when Stage 1 did not already enrich this hotspot via direct
        // cluster overlap — checked via structured explanation text since members
        // are not available in Stage 2.
        const alreadyAimEnriched = h.explanation.some(e =>
            /cropmark|aerial.*monument|AIM/i.test(e.text)
        );
        if (!alreadyAimEnriched && aimFeatures.length > 0) {
            const nearbyAIM = aimFeatures.filter(f =>
                getDistanceKm(h.center[1], h.center[0], f.center[1], f.center[0]) < 0.2
            );
            if (nearbyAIM.length > 0) {
                boost += Math.min(6, nearbyAIM.length * 3);
                const topType   = nearbyAIM[0].type;
                const topPeriod = nearbyAIM[0].period;
                notes.push(hotspotExplanation(
                    'historic_overlap',
                    `AIM cropmark within 200m — ${topType}` + (topPeriod ? ` (${topPeriod})` : ''),
                    `aim_${topType.toLowerCase().replace(/\W+/g, '_')}_${topPeriod.toLowerCase().replace(/\W+/g, '_')}`,
                ));
            }
        }

        // High-confidence place-name signals (area-level proxy — distance from scan centre)
        const strongSignals = placeSignals.filter(s => s.confidence >= 0.8 && s.distance < 1.0);
        if (strongSignals.length > 0) {
            boost += Math.min(4, strongSignals.length * 2);
            notes.push(hotspotExplanation(
                'historic_overlap',
                `Place-name signal: "${strongSignals[0].name}" (${strongSignals[0].meaning})`,
                `place_${strongSignals[0].name.toLowerCase().replace(/\W+/g, '_')}`,
            ));
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

        const allNotes = prioritiseHotspotExplanations([...h.explanation, ...notes], 5);
        return { ...h, score: newScore, confidence, explanation: allNotes };
    });

    // C: inter-hotspot relationship pass — detects connected activity landscapes
    const withRelationships = analyzeHotspotRelationships(enhanced);

    return withRelationships
        .sort((a, b) => b.score - a.score)
        .map((h, i) => ({ ...h, number: i + 1 }));
}

// ─── C: Inter-Hotspot Relationship Engine ────────────────────────────────────
// Post-processing pass that asks: "Do these hotspots make sense together?"
// Looks at the full hotspot set and detects:
//   - Settlement systems (diverse classifications clustered within 600m)
//   - Route corridor systems (hotspots strung along movement lines)
//   - Isolated clusters (3+ hotspots with varied signals)
//
// Applies secondaryTag and explanation notes only — does not change scores or
// primary classifications. Keeps the engine deterministic and explainable.

function analyzeHotspotRelationships(hotspots: Hotspot[]): Hotspot[] {
    if (hotspots.length < 2) return hotspots;

    // ── System detection ──────────────────────────────────────────────────────
    // For each hotspot, find which others are within 600m
    const neighborMap = new Map<string, string[]>();
    for (const h of hotspots) {
        const neighbors = hotspots
            .filter(o => o.id !== h.id && getDistanceKm(h.center[1], h.center[0], o.center[1], o.center[0]) < 0.6)
            .map(o => o.id);
        if (neighbors.length > 0) neighborMap.set(h.id, neighbors);
    }

    // Find all hotspots that are part of a cluster of 3+
    // Uses flood-fill so a chain of overlapping pairs is treated as one system
    const visited   = new Set<string>();
    const systems: Set<string>[] = [];

    for (const h of hotspots) {
        if (visited.has(h.id)) continue;
        const cluster = new Set<string>();
        const queue   = [h.id];
        while (queue.length > 0) {
            const id = queue.shift()!;
            if (cluster.has(id)) continue;
            cluster.add(id);
            visited.add(id);
            (neighborMap.get(id) ?? []).forEach(n => { if (!cluster.has(n)) queue.push(n); });
        }
        if (cluster.size >= 3) systems.push(cluster);
    }

    // Build a lookup: hotspot id → which system it belongs to
    const idToSystem = new Map<string, Set<string>>();
    for (const sys of systems) {
        for (const id of sys) idToSystem.set(id, sys);
    }

    // ── Colluvial pair detection ──────────────────────────────────────────────
    // Pairs a raised-type hotspot (likely activity source) with a nearby
    // lowland or wetland hotspot (likely accumulation or preservation zone).
    // Distance window: 40–200m covers realistic slope-wash transport without
    // merging pairs that would already have clustered into a single hotspot.
    // Each lowland hotspot is only tagged once (closest raised partner wins).
    // Colluvial annotations override per-hotspot soilMechanics because spatial
    // relationships between hotspots are more diagnostic than single-hotspot heuristics.

    const COLLUVIAL_MIN_M = 40;
    const COLLUVIAL_MAX_M = 200;

    const isRaisedType = (h: Hotspot): boolean =>
        ['Raised Activity Area', 'Settlement Edge Candidate', 'Terrain Structure Candidate',
         'Multi-Period Occupation Zone'].includes(h.classification) ||
        h.explanation.some(e => e.tag === 'raised_footing' || e.tag === 'raised_wetland_island');

    const isLowlandType = (h: Hotspot): boolean =>
        ['Lowland Activity Zone', 'Wetland Margin Activity Zone'].includes(h.classification) ||
        (!isRaisedType(h) && h.explanation.some(e => e.tag === 'lidar_hydrology' || e.tag === 'raised_wetland_island'));

    const colluvialAnnotations = new Map<string, SoilMechanics>();

    for (const a of hotspots) {
        if (!isRaisedType(a)) continue;
        for (const b of hotspots) {
            if (a.id === b.id || !isLowlandType(b)) continue;
            if (colluvialAnnotations.has(b.id)) continue; // only tag each accumulation zone once
            const distM = getDistanceKm(a.center[1], a.center[0], b.center[1], b.center[0]) * 1000;
            if (distM < COLLUVIAL_MIN_M || distM > COLLUVIAL_MAX_M) continue;

            // Tag B as the likely accumulation / preservation zone
            colluvialAnnotations.set(b.id, {
                interpretationClass: 'colluvial_accumulation',
                userNote: 'Finds may have moved downslope into this area. Check the higher ground above this target as well.',
            });
            // Tag A as the likely source zone (only if no more specific class already set)
            if (!colluvialAnnotations.has(a.id)) {
                colluvialAnnotations.set(a.id, {
                    interpretationClass: 'hilltop_source_zone',
                    userNote: 'This may be the original activity area. Lower ground nearby may hold accumulated finds.',
                });
            }
        }
    }

    // ── Apply all annotations ─────────────────────────────────────────────────
    return hotspots.map(h => {
        // Colluvial annotation overrides per-hotspot soilMechanics — inter-hotspot
        // relationships are more diagnostic than single-hotspot heuristics.
        const colluvial = colluvialAnnotations.get(h.id);
        let result = colluvial ? { ...h, soilMechanics: colluvial } : h;

        const system = idToSystem.get(h.id);
        if (!system) return result;

        const systemHotspots = hotspots.filter(o => system.has(o.id));
        const classifications = systemHotspots.map(o => o.classification);

        // Characterise the system type
        const hasCore      = classifications.some(c => c === 'Settlement Edge Candidate' || c === 'Terrain Structure Candidate' || c === 'Multi-Period Occupation Zone');
        const hasPeriphery = classifications.some(c => c === 'Wetland Margin Activity Zone' || c === 'Lowland Activity Zone' || c === 'Organised Field System Candidate');
        const hasMovement  = classifications.some(c => c === 'Route-Side Activity Zone' || c === 'Junction / Convergence Zone' || c === 'Crossing Point Candidate');
        const uniqueTypes  = new Set(classifications).size;

        // Only annotate when the cluster shows meaningful diversity
        if (uniqueTypes < 2) return result;

        // Identify the core site (highest score in the system)
        const systemSorted = [...systemHotspots].sort((a, b) => b.score - a.score);
        const isCore       = systemSorted[0]?.id === h.id;

        let systemTag: string;
        let systemNote: string;

        if (hasCore && hasPeriphery && hasMovement) {
            systemTag  = isCore ? 'Landscape system: core site' : 'Landscape system: peripheral activity';
            systemNote = isCore
                ? `Anchor site in ${system.size}-hotspot activity landscape`
                : `Part of ${system.size}-site activity landscape`;
        } else if (hasMovement && uniqueTypes >= 2) {
            systemTag  = 'Route corridor system';
            systemNote = `Part of ${system.size}-site route corridor cluster`;
        } else {
            systemTag  = 'Connected activity cluster';
            systemNote = `Part of ${system.size}-site activity cluster`;
        }

        // Keep 'Roman corridor influence' secondary tags — don't overwrite Roman context
        const keepExisting    = result.secondaryTag?.includes('Roman') || result.secondaryTag?.includes('Historically');
        const newSecondaryTag = keepExisting ? result.secondaryTag : systemTag;

        // Append system note to explanation if not already present (capped at 5)
        const systemExplanation = hotspotExplanation('landscape_system', systemNote, systemTag.toLowerCase().replace(/\W+/g, '_'));
        const newExplanation = prioritiseHotspotExplanations([...result.explanation, systemExplanation], 5);

        return { ...result, secondaryTag: newSecondaryTag, explanation: newExplanation };
    });
}

// ─── Geology modifier application ────────────────────────────────────────────
// Applied after both terrain and historic enhancement are complete.
// GEOLOGY_RULE: modifiers only apply when a primary non-geology signal is present.
// Combined effect is clamped to [-15, +12] per the Phase 2 cap.

export type GeologyApplyResult = {
    hotspots:    Hotspot[];
    appliedCount: number;
    suppressedCount: number;
    netScore:    number;
};

export function applyGeologyModifiers(
    hotspots:       Hotspot[],
    geologyContext: GeologyContext,
): GeologyApplyResult {
    const net = netGeologyScore(geologyContext.modifiers);
    const clampedNet = Math.max(-15, Math.min(12, net));

    if (clampedNet === 0) {
        return { hotspots, appliedCount: 0, suppressedCount: 0, netScore: 0 };
    }

    let appliedCount   = 0;
    let suppressedCount = 0;

    const updated = hotspots.map(h => {
        // Primary signal gate: at least one terrain or historic signal must be present.
        // Prevents geology from being the sole reason a weak cluster scores high.
        const hasPrimarySignal = h.metrics.anomaly > 0 || h.metrics.context > 0;
        if (!hasPrimarySignal) {
            suppressedCount++;
            return h;
        }
        appliedCount++;
        const score = Math.min(98, Math.max(0, h.score + clampedNet));
        const confidence = evaluateHotspotConfidence({
            score,
            signalCount: h.metrics.signalCount,
            behaviour:   h.metrics.behaviour,
            context:     h.metrics.context,
            convergence: h.metrics.convergence,
        });
        return {
            ...h,
            score,
            confidence,
        };
    });

    const sorted = updated
        .sort((a, b) => b.score - a.score)
        .map((h, i) => ({ ...h, number: i + 1 }));

    return { hotspots: sorted, appliedCount, suppressedCount, netScore: clampedNet };
}

// ─── PAS density modifier application ────────────────────────────────────────
// Applied after geology modifiers. PAS is supporting evidence only — it never
// creates hotspots, only adds a small additive modifier to existing ones.
// Max contribution: +0.08 confidence modifier (≈10% of total weight budget).
// A null pasCell means the index failed to load: no modification applied.

const PAS_DENSITY_THRESHOLDS = {
    low:      15,   // c >= 15:  +1 score, note "few records"
    moderate: 60,   // c >= 60:  +2 score, note "moderate density"
    high:     200,  // c >= 200: +4 score
    veryHigh: 500,  // c >= 500 + period match: +6 score
} as const;

export function applyPASDensityModifiers(
    hotspots:  Hotspot[],
    pasCell:   PASCellLookup | null,
    targetPeriod?: string,
): Hotspot[] {
    if (!pasCell || pasCell.c === 0) return hotspots;

    const { c, p } = pasCell;

    // Period match: target period appears in the cell's top recorded periods
    const normalised = (targetPeriod ?? '').toUpperCase();
    const periodMatch = normalised.length > 0 &&
        p.some(period => period.toUpperCase().includes(normalised) || normalised.includes(period.toUpperCase()));

    let scoreBoost = 0;
    let explanation = '';

    if (c >= PAS_DENSITY_THRESHOLDS.veryHigh && periodMatch) {
        scoreBoost = 6;
        explanation = 'Numerous PAS finds recorded in this landscape, including period-matching types';
    } else if (c >= PAS_DENSITY_THRESHOLDS.high) {
        scoreBoost = 4;
        explanation = 'Numerous PAS finds recorded in this landscape';
    } else if (c >= PAS_DENSITY_THRESHOLDS.moderate) {
        scoreBoost = 2;
        explanation = 'Moderate PAS find density recorded nearby';
    } else if (c >= PAS_DENSITY_THRESHOLDS.low) {
        scoreBoost = 1;
        explanation = 'Few PAS records nearby — may reflect access or reporting';
    }

    if (scoreBoost === 0) return hotspots;

    const updated = hotspots.map(h => {
        // Only boost hotspots with a primary signal — PAS must not be the sole basis
        const hasPrimarySignal = h.metrics.anomaly > 0 || h.metrics.context > 0;
        if (!hasPrimarySignal) return h;

        const score = Math.min(98, Math.max(0, h.score + scoreBoost));
        const confidence = evaluateHotspotConfidence({
            score,
            signalCount: h.metrics.signalCount,
            behaviour:   h.metrics.behaviour,
            context:     h.metrics.context,
            convergence: h.metrics.convergence,
        });
        return {
            ...h,
            score,
            confidence,
            explanation: prioritiseHotspotExplanations([
                ...(h.explanation ?? []),
                hotspotExplanation('pas_density', explanation, `score_${scoreBoost}`),
            ], 5),
        };
    });

    return updated
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
    if (pas.length === 0 && monuments.length === 0 && placeSignals.length === 0)
        return analyzeHotspotRelationships(terrain);
    return enhanceHotspotsWithHistoric(terrain, pas, monuments, placeSignals, period);
}
