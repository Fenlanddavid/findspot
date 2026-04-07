// ─── Hotspot engine ───────────────────────────────────────────────────────────
// Two-stage pipeline:
//   buildTerrainHotspots        – terrain signal scoring (routes, LiDAR, spectral)
//   enhanceHotspotsWithHistoric – additive historic enrichment layer
//
// generateHotspots is the combined entry point kept for call-site compatibility.

import { Cluster, Hotspot, PASFind, PlaceSignal, HistoricRoute } from '../pages/fieldGuideTypes';
import { getDistance, getDistanceToLine, getDistanceKm } from './fieldGuideAnalysis';

// ─── Stage 1: terrain-based scoring ──────────────────────────────────────────

export function buildTerrainHotspots(
    clusters:       Cluster[],
    routes:         HistoricRoute[]    = [],
    monumentPoints: [number, number][] = [],
): Hotspot[] {
    const results: Hotspot[] = [];
    const usedIds = new Set<string>();

    for (const c of clusters) {
        if (usedIds.has(c.id)) continue;

        let radiusM = 40;
        if (c.type.includes('Roundhouse') || c.type.includes('Barrow')) radiusM = 20;
        else if (c.metrics && c.metrics.ratio > 4) radiusM = 80;

        const members = clusters.filter(n => !usedIds.has(n.id) && getDistance(c.center, n.center) < radiusM);
        if (members.length === 0) continue;
        members.forEach(m => usedIds.add(m.id));

        // Suppress if any member centre is inside a monument polygon (via isProtected flag)
        // or within 80m of a monument point — catches clusters just outside polygon edges
        // whose padded bounds box would visually overlap the monument.
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
        const hasLidar     = sources.has('terrain') || sources.has('terrain_global');
        const hasSatellite = (sources.has('satellite_spring') || sources.has('satellite_summer')) && !sources.has('terrain');
        const hasHydrology = sources.has('hydrology');

        if (hasLidar) {
            const bestLidar = members.find(m => m.sources.includes('terrain') || m.sources.includes('terrain_global'));
            let lidarScore = bestLidar?.confidence === 'High' ? 18 : (bestLidar?.confidence === 'Medium' ? 10 : 5);
            if (hasHydrology)              { lidarScore += 5; explanation.push('LiDAR + Hydrology correlation'); }
            if (sources.has('satellite_summer')) { lidarScore += 4; explanation.push('LiDAR + Spectral agreement'); }
            anomaly += lidarScore;
            explanation.push('Reliable LiDAR relief signature');
        }

        if (hasSatellite) {
            const hasSummer = sources.has('satellite_summer');
            const hasSpring = sources.has('satellite_spring');
            anomaly += (hasSummer && hasSpring) ? 10 : (hasSummer ? 6 : 3);
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
        // The existing LiDAR+Hydrology correlation covers basic co-location (+5).
        // This checks whether BOTH independently identify a depression (Sunken polarity),
        // which is a much stronger indicator of a real palaeochannel or hollow.
        if (hasHydrology && hasLidar) {
            const hydroSunken  = members.some(m => m.source === 'hydrology' && m.polarity === 'Sunken');
            const terrainSunken = members.some(m => (m.source === 'terrain' || m.source === 'terrain_global') && m.polarity === 'Sunken');
            if (hydroSunken && terrainSunken) {
                anomaly += 5;
                explanation.push('Hydrology + terrain depression agreement');
            } else if (hydroSunken || terrainSunken) {
                anomaly += 2;
            }
        }

        // ── Route scoring ─────────────────────────────────────────────────────
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

        if (routeCount >= 2) {
            const nearbyRoutes = routes.filter(r => getDistanceToLine(center, r.geometry, r.bbox) < 500);
            const romanCount = nearbyRoutes.filter(r => r.type === 'roman_road').length;
            const histCount  = nearbyRoutes.length - romanCount;
            if (romanCount >= 2)              { routeScore += 7; routeReasons.push('Near Roman route junction'); }
            else if (romanCount >= 1 && histCount >= 1) { routeScore += 6; routeReasons.push('Near historic route convergence'); }
            else if (histCount >= 2)          { routeScore += 4; routeReasons.push('Route junction nearby'); }
        }

        let isHighConfidenceCrossing = false;
        if (hasHydrology) {
            if (hasRomanProximity) { routeScore += 7; routeReasons.push('Likely Roman water crossing'); isHighConfidenceCrossing = true; }
            else if (hasHistProximity) { routeScore += 5; routeReasons.push('Historic crossing point'); isHighConfidenceCrossing = true; }
        }
        if (isRaised) {
            if (hasRomanProximity)    { routeScore += 6; routeReasons.push('Raised access point beside Roman route'); }
            else if (hasHistProximity){ routeScore += 4; routeReasons.push('Raised ground beside movement corridor'); }
        }

        const independentSignals = [hasLidar, sources.has('satellite_summer'), hasHydrology, isRaised].filter(Boolean).length;
        if (routeScore > 0) {
            if (independentSignals === 0) routeScore = Math.round(routeScore * 0.7);
            else if (independentSignals >= 2) {
                routeScore = Math.round(routeScore * 1.3);
                routeReasons.push(hasRomanProximity ? 'Confidence boosted by Roman road corridor' : 'Confidence boosted by historic route proximity');
            }
        }

        if (hasRomanProximity && routeScore > 5)   explanation.push('Near probable Roman road corridor');
        else if (hasHistProximity && routeScore > 3) explanation.push('Historic movement corridor nearby');
        routeReasons.forEach(r => { if (!explanation.includes(r)) explanation.push(r); });
        behaviour += routeScore;

        // ── Penalties ─────────────────────────────────────────────────────────
        members.forEach(m => {
            if (m.disturbanceRisk === 'High') {
                penalty -= 20;
                explanation.push('IGNORE: High risk of modern disturbance');
            }
            if (m.metrics && m.metrics.density < 0.05) {
                penalty -= 10;
                explanation.push('IGNORE: Uniform/Featureless terrain');
            }
        });

        const score = Math.min(98, Math.max(0, anomaly + context + convergence + behaviour + penalty));

        const signalCount         = sources.size;
        const hasStrongAgreement  = signalCount >= 3;
        const hasModerateAgreement = signalCount >= 2;

        let confidence: Hotspot['confidence'] = 'Low Confidence';
        if      (score > 80 && hasStrongAgreement)   confidence = 'High Probability';
        else if (score > 60 && hasModerateAgreement) confidence = 'Strong Signal';
        else if (score > 35)                         confidence = 'Developing Signal';
        if (confidence === 'Strong Signal'   && behaviour < 5 && context < 5) confidence = 'Developing Signal';
        if (confidence === 'High Probability' && behaviour < 8)               confidence = 'Strong Signal';

        let type: Hotspot['type'] = 'General Activity Zone';
        if (hasHydrology && isRaised) type = 'Raised Dry Area (Likely)';
        else if (members.some(m => m.type.includes('Corridor'))) type = 'Movement Corridor (Likely)';

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
            explanation:          Array.from(new Set(explanation)).slice(0, 4),
            center:               [(minLon + maxLon) / 2, (minLat + maxLat) / 2],
            bounds:               [[minLon - 0.0004, minLat - 0.0004], [maxLon + 0.0004, maxLat + 0.0004]],
            memberIds:            members.map(m => m.id),
            isHighConfidenceCrossing,
            metrics:              { anomaly, context, convergence, behaviour, penalty },
        });
    }

    return results
        .filter(h => h.score >= 15)
        .sort((a, b) => b.score - a.score)
        .map((h, i) => ({ ...h, number: i + 1 }));
}

// ─── Stage 2: historic enrichment ────────────────────────────────────────────
// Boosts hotspot scores using OSM heritage finds, monument points, and
// place-name signals from the historic phase. Purely additive — scores only
// go up, never down, and never above 98.

export function enhanceHotspotsWithHistoric(
    hotspots:       Hotspot[],
    pasFinds:       PASFind[],
    monumentPoints: [number, number][],
    placeSignals:   PlaceSignal[],
    targetPeriod:   string = 'All',
): Hotspot[] {
    const enhanced = hotspots.map(h => {
        let boost = 0;
        const notes: string[] = [];

        // PAS / OSM heritage finds within 500m
        const nearbyFinds = pasFinds.filter(f =>
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

        // Scheduled monument points within 300m
        // (monument point = [lon, lat] in GeoJSON order)
        const nearbyMonuments = monumentPoints.filter(([lon, lat]) =>
            getDistanceKm(h.center[1], h.center[0], lat, lon) < 0.3,
        );
        if (nearbyMonuments.length > 0) {
            boost += 5;
            notes.push('Near recorded scheduled monument');
        }

        // High-confidence place-name signals (area-level proxy — distance is from scan centre)
        const strongSignals = placeSignals.filter(s => s.confidence >= 0.8 && s.distance < 1.0);
        if (strongSignals.length > 0) {
            boost += Math.min(4, strongSignals.length * 2);
            notes.push(`Place-name signal: "${strongSignals[0].name}" (${strongSignals[0].meaning})`);
        }

        if (boost === 0) return h;

        const newScore = Math.min(98, h.score + boost);
        const allNotes = Array.from(new Set([...h.explanation, ...notes])).slice(0, 5);

        // Re-evaluate confidence label at the enhanced score
        let confidence = h.confidence;
        const signalCount = h.memberIds.length;
        if      (newScore > 80 && signalCount >= 2) confidence = 'High Probability';
        else if (newScore > 60 && signalCount >= 1) confidence = 'Strong Signal';

        return { ...h, score: newScore, confidence, explanation: allNotes };
    });

    // Re-sort and re-number after enhancement
    return enhanced
        .sort((a, b) => b.score - a.score)
        .map((h, i) => ({ ...h, number: i + 1 }));
}

// ─── Combined entry point ─────────────────────────────────────────────────────
// Kept for call-site compatibility where both stages run in one call.

export function generateHotspots(
    clusters: Cluster[],
    pas:      PASFind[]        = [],
    monuments:[number, number][] = [],
    period:   string           = 'All',
    _perms:   unknown[]        = [],
    _flds:    unknown[]        = [],
    routes:   HistoricRoute[]  = [],
): Hotspot[] {
    const terrain = buildTerrainHotspots(clusters, routes, monuments);
    if (pas.length === 0 && monuments.length === 0) return terrain;
    return enhanceHotspotsWithHistoric(terrain, pas, monuments, [], period);
}
