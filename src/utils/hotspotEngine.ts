// ─── Hotspot engine ───────────────────────────────────────────────────────────
// Two-stage pipeline:
//   buildTerrainHotspots        – terrain signal scoring (routes, LiDAR, spectral)
//   enhanceHotspotsWithHistoric – additive historic enrichment layer
//
// generateHotspots is the combined entry point kept for call-site compatibility.

import { Cluster, Hotspot, HotspotClassification, HistoricFind, PlaceSignal, HistoricRoute } from '../pages/fieldGuideTypes';
import { getDistance, getDistanceToLine, getDistanceKm } from './fieldGuideAnalysis';

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

    let confidence: Hotspot['confidence'] = 'Low Confidence';
    if      (score > 80 && hasStrongAgreement)   confidence = 'High Probability';
    else if (score > 60 && hasModerateAgreement) confidence = 'Strong Signal';
    else if (score > 35)                         confidence = 'Developing Signal';

    // Downgrade checks: strong route/hydrology context is required to hold
    // upper labels — pure score is not enough.
    if (confidence === 'Strong Signal'    && behaviour < 5 && context < 5 && convergence < 5) confidence = 'Developing Signal';
    if (confidence === 'High Probability' && behaviour < 8 && convergence < 8)                confidence = 'Strong Signal';

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
    ['LiDAR + Hydrology',                 70],
    ['Island effect',                     70],
    ['Historic river crossing',           65],
    ['Historic crossing',                 65],
    ['Route junction',                    60],
    ['Near historic route convergence',   60],
    ['LiDAR + Spectral',                  55],
    ['IGNORE:',                           50],  // below positive signals; still visible but does not crowd them out
    ['Reliable LiDAR',                    45],
    ['Spectral vegetation',               40],
    ['Raised dry footing',                35],
    ['Strategic dry point',               35],
    ['Historic movement corridor',        25],
    ['Near probable Roman',               25],
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
            reason:         'Hydrology, route proximity, and strong convergence suggest a likely crossing location.',
            secondaryTag:   ctx.hasRomanProximity ? 'Roman corridor influence' : undefined,
        };
    }

    // 2. Junction / Convergence Zone — multiple routes meeting without dominant crossing identity
    if (ctx.convergence >= 8 && ctx.routeCount >= 2) {
        return {
            classification: 'Junction / Convergence Zone',
            reason:         'Multiple route influences converge at this location.',
            secondaryTag:   ctx.hasRomanProximity ? 'Roman corridor influence' : undefined,
        };
    }

    // 3. Settlement Edge Candidate — raised LiDAR anomaly with meaningful context.
    // Requires behaviour OR convergence >= 4 so purely topographic bumps without
    // any route or landscape activity logic don't over-trigger this class.
    if (ctx.anomaly >= 15 && ctx.context >= 8 && ctx.isRaised && ctx.hasLidar &&
        (ctx.behaviour >= 4 || ctx.convergence >= 4)) {
        return {
            classification: 'Settlement Edge Candidate',
            reason:         'Raised topography with strong LiDAR signal and good context suggest practical settlement edge conditions.',
            secondaryTag:   ctx.hasHydrology ? 'Water margin setting' : undefined,
        };
    }

    // 4. Wetland Margin Activity Zone — raised dry island in wet context, no dominant junction
    if (ctx.hasHydrology && ctx.isRaised && ctx.context >= 8 && ctx.convergence < 8) {
        return {
            classification: 'Wetland Margin Activity Zone',
            reason:         'Dry elevated ground beside wetter terrain — a practical margin for repeated activity.',
        };
    }

    // 5. Route-Side Activity Zone — route-led but not a junction or crossing
    if (ctx.behaviour >= 8 && (ctx.hasRomanProximity || ctx.hasHistProximity) && ctx.convergence < 8) {
        return {
            classification: 'Route-Side Activity Zone',
            reason:         'Activity clustering beside a movement corridor without dominant crossing or junction identity.',
            secondaryTag:   ctx.hasRomanProximity ? 'Roman corridor influence' : undefined,
        };
    }

    // 6. Terrain Structure Candidate — LiDAR anomaly without route or hydrology reinforcement.
    // Requires context >= 4 as a landscape stabiliser so minor relief noise or
    // isolated bumps do not trigger a structural interpretation on anomaly alone.
    if (ctx.hasLidar && ctx.anomaly >= 15 && ctx.context >= 4 && !ctx.hasHydrology && ctx.behaviour < 8) {
        return {
            classification: 'Terrain Structure Candidate',
            reason:         'Relief-defined feature with structural potential — possible bank, platform, or enclosure form.',
        };
    }

    // 7. Spectral Activity Candidate — satellite only, no LiDAR confirmation
    if (ctx.satelliteIsPrimary && !ctx.hasLidar) {
        return {
            classification: 'Spectral Activity Candidate',
            reason:         'Potential cropmark or vegetation response. No LiDAR confirmation — treat as candidate for field assessment.',
        };
    }

    // 8. General Activity Zone — fallback
    return {
        classification: 'General Activity Zone',
        reason:         'Multiple signals suggest activity but no dominant landscape identity has been identified.',
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
        const hasLidar     = sources.has('terrain') || sources.has('terrain_global');
        const hasSatellite = sources.has('satellite_spring') || sources.has('satellite_summer');
        const hasHydrology = sources.has('hydrology');

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

        const center   = c.center;
        const isRaised = members.some(m => m.polarity === 'Raised');

        if (isRaised) {
            context += 8;
            explanation.push('Raised dry footing');
            if (hasHydrology) { context += 4; explanation.push('Strategic dry point near water'); }
        }

        if (hasHydrology) {
            anomaly += 5;
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

        // ── Route scoring ─────────────────────────────────────────────────────
        // Base proximity → behaviour.
        // Junction / crossing / convergence bonuses → convergence metric,
        // since these represent multi-signal agreement rather than a single route.
        let routeScore = 0;
        const routeReasons: string[] = [];
        let hasRomanProximity = false;
        let hasHistProximity  = false;
        let routeCount = 0;

        for (const route of routes) {
            const dist = getDistanceToLine(center, route.geometry, route.bbox);
            if (route.type === 'roman_road') {
                if (dist < 100)       { routeScore += 8; hasRomanProximity = true; routeCount++; }
                else if (dist < 250)  { routeScore += 6; hasRomanProximity = true; routeCount++; }
                else if (dist < 500)  { routeScore += 3; hasRomanProximity = true; routeCount++; }
            } else {
                if (dist < 75)        { routeScore += 5; hasHistProximity = true; routeCount++; }
                else if (dist < 200)  { routeScore += 3; hasHistProximity = true; routeCount++; }
                else if (dist < 400)  { routeScore += 1; hasHistProximity = true; routeCount++; }
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

        // Scale base route score by all independent signal presence (including spring satellite)
        const independentSignals = [hasLidar, hasSatellite, hasHydrology, isRaised].filter(Boolean).length;
        if (routeScore > 0) {
            if (independentSignals === 0)     routeScore = Math.round(routeScore * 0.7);
            else if (independentSignals >= 2) routeScore = Math.round(routeScore * 1.3);
        }

        if (hasRomanProximity && routeScore > 5)     explanation.push('Near probable Roman road corridor');
        else if (hasHistProximity && routeScore > 3)  explanation.push('Historic movement corridor nearby');
        routeReasons.forEach(r => { if (!explanation.includes(r)) explanation.push(r); });
        behaviour += routeScore;

        // ── Penalties (hotspot-level with caps to prevent over-stacking) ──────
        // Applied once per hotspot rather than per member, so a merged group of
        // disturbed clusters isn't penalised multiple times for the same issue.
        const highDisturbanceCount = members.filter(m => m.disturbanceRisk === 'High').length;
        const featurelessCount     = members.filter(m => m.metrics && m.metrics.density < 0.05).length;

        if (highDisturbanceCount > 0) {
            penalty -= Math.min(highDisturbanceCount * 20, 20); // cap at -20
            explanation.push('IGNORE: High risk of modern disturbance');
        }
        if (featurelessCount > 0) {
            penalty -= Math.min(featurelessCount * 10, 10); // cap at -10
            if (featurelessCount / members.length > 0.5) explanation.push('IGNORE: Uniform/Featureless terrain');
        }

        const score       = Math.min(98, Math.max(0, anomaly + context + convergence + behaviour + penalty));
        const signalCount = sources.size;
        const confidence  = evaluateHotspotConfidence({ score, signalCount, behaviour, context, convergence });

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
        });

        // ── Suggested focus ───────────────────────────────────────────────────
        // One short, actionable field hint for the user. Derived here while all
        // signal flags are in scope so the UI does not need to re-derive them.
        // Every string must describe something visible in the field or readable
        // from a map shape. No engine terminology, no invisible signals.
        // If no clear visible guidance exists, leave undefined — show nothing.
        let suggestedFocus: string | undefined;
        if (classification === 'Crossing Point Candidate') {
            suggestedFocus = 'Focus where the route meets the water';
        } else if (classification === 'Junction / Convergence Zone') {
            suggestedFocus = 'Focus where the routes meet';
        } else if (hasHydrology && isRaised) {
            suggestedFocus = 'Focus on the dry edge beside wetter ground';
        } else if (hasHydrology && members.some(m => m.polarity === 'Sunken')) {
            suggestedFocus = 'Focus along the lowest part of the ground';
        } else if (hasRomanProximity) {
            suggestedFocus = 'Focus along the Roman road edge';
        } else if (hasHistProximity) {
            suggestedFocus = 'Focus along the route edge';
        } else if (hasLidar && !hasHydrology) {
            suggestedFocus = 'Focus where the ground begins to change shape';
        }
        // satelliteIsPrimary: spectral signal is not visible in the field — no suggestion shown

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
            metrics:              { anomaly, context, convergence, behaviour, penalty, signalCount },
        });
    }

    return results
        .filter(h => h.score >= 15)
        .sort((a, b) => b.score - a.score)
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
