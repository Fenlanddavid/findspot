// ─── Pure analysis functions: consensus merging, context analysis,
//     disturbance suppression, hotspot generation, asset enrichment ──────────

import { Cluster, Hotspot, PASFind, HistoricRoute } from '../pages/fieldGuideTypes';

// ─── Polygon hit test (used by NHLE protection and AIM enrichment) ────────────

export function isPointInPolygon(lat: number, lon: number, rings: number[][][]): boolean {
    let inside = false;
    for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
            if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
        }
    }
    return inside;
}

// ─── Kilometre-scale distance (for historic scan proximity checks) ────────────

export function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── NHLE protection marking ──────────────────────────────────────────────────
// Marks clusters that fall inside a Scheduled Monument boundary as protected.
// Must run after all terrain tiles have resolved (assetsGeoJSON is fetched in parallel).

type NHLELike = {
    features: Array<{ geometry?: { type: string; coordinates: unknown }; properties?: { Name?: string } }>;
};

export function applyNHLEProtection(clusters: Cluster[], nhleData: NHLELike): Cluster[] {
    for (const cluster of clusters) {
        const [lon, lat] = cluster.center;
        for (const asset of nhleData.features) {
            if (!asset.geometry) continue;
            if (asset.geometry.type === 'Polygon') {
                if (isPointInPolygon(lat, lon, asset.geometry.coordinates as number[][][])) {
                    cluster.isProtected = true;
                    cluster.monumentName = asset.properties?.Name;
                    break;
                }
            } else if (asset.geometry.type === 'MultiPolygon') {
                for (const poly of asset.geometry.coordinates as number[][][][]) {
                    if (isPointInPolygon(lat, lon, poly)) {
                        cluster.isProtected = true;
                        cluster.monumentName = asset.properties?.Name;
                        break;
                    }
                }
                if (cluster.isProtected) break;
            }
        }
    }
    return clusters;
}

// ─── AIM aerial archaeology enrichment ───────────────────────────────────────
// Tags clusters that fall within AIM monument polygons with aimInfo metadata.

type AIMLike = {
    features: Array<{
        geometry?: { type: string; coordinates: unknown };
        properties?: { MONUMENT_TYPE?: string; PERIOD?: string; EVIDENCE_1?: string };
    }>;
};

export function applyAIMEnrichment(clusters: Cluster[], aimData: AIMLike): Cluster[] {
    return clusters.map(c => {
        for (const aim of aimData.features) {
            const coords = aim.geometry?.coordinates;
            if (!coords) continue;
            let isMatch = false;
            if (aim.geometry!.type === 'Polygon' || aim.geometry!.type === 'MultiPolygon') {
                const rings = aim.geometry!.type === 'Polygon' ? [coords as number[][][]] : coords as number[][][][];
                for (const ring of rings) {
                    if (isPointInPolygon(c.center[1], c.center[0], ring as number[][][])) { isMatch = true; break; }
                }
            } else if (aim.geometry!.type === 'Point' && getDistance(c.center, coords as [number, number]) < 50) {
                isMatch = true;
            }
            if (isMatch) {
                if (!c.sources.includes('historic')) c.sources.push('historic');
                c.aimInfo = {
                    type:     String(aim.properties?.MONUMENT_TYPE || ''),
                    period:   String(aim.properties?.PERIOD || ''),
                    evidence: String(aim.properties?.EVIDENCE_1 || ''),
                };
                c.confidence   = 'High';
                c.findPotential = 96;
                break;
            }
        }
        return c;
    });
}

// ─── Distance helpers ─────────────────────────────────────────────────────────

export function getDistance(c1: [number, number], c2: [number, number]): number {
    const R = 6371e3;
    const φ1 = c1[1] * Math.PI/180;
    const φ2 = c2[1] * Math.PI/180;
    const Δφ = (c2[1]-c1[1]) * Math.PI/180;
    const Δλ = (c2[0]-c1[0]) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getFlatDistanceSq(p1: [number, number], p2: [number, number]): number {
    const dx = (p1[0] - p2[0]) * Math.cos(p1[1] * Math.PI / 180);
    const dy = p1[1] - p2[1];
    return (dx * dx + dy * dy) * 12346344456;
}

function getDistanceSqToSegment(pt: [number, number], p1: [number, number], p2: [number, number]): number {
    const x = pt[0], y = pt[1];
    const x1 = p1[0], y1 = p1[1];
    const x2 = p2[0], y2 = p2[1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len_sq = dx * dx + dy * dy;
    let param = -1;
    if (len_sq !== 0) {
        param = ((x - x1) * dx + (y - y1) * dy) / len_sq;
    }
    let xx, yy;
    if (param < 0) { xx = x1; yy = y1; }
    else if (param > 1) { xx = x2; yy = y2; }
    else { xx = x1 + param * dx; yy = y1 + param * dy; }
    const dxFinal = (x - xx) * Math.cos(y * Math.PI / 180);
    const dyFinal = y - yy;
    return (dxFinal * dxFinal + dyFinal * dyFinal) * 12346344456;
}

export function getDistanceToLine(
    pt: [number, number],
    line: [number, number][],
    bbox: [[number, number], [number, number]]
): number {
    const lat = pt[1], lon = pt[0];
    if (lon < bbox[0][0] - 0.002 || lon > bbox[1][0] + 0.002 || lat < bbox[0][1] - 0.002 || lat > bbox[1][1] + 0.002) {
        return Infinity;
    }
    let minDistSq = Infinity;
    for (let i = 0; i < line.length - 1; i++) {
        const dSq = getDistanceSqToSegment(pt, line[i], line[i+1]);
        if (dSq < minDistSq) minDistSq = dSq;
    }
    return Math.sqrt(minDistSq);
}

// Keep unused export to avoid linting issues with helpers that are only used internally
void getFlatDistanceSq;

// ─── Consensus merging ────────────────────────────────────────────────────────

export function findConsensus(rawClusters: Cluster[]): Cluster[] {
    const merged: Cluster[] = [];
    const thresholdM = 40;

    for (const c of rawClusters) {
        let found = false;
        for (const m of merged) {
            const dist = getDistance(c.center, m.center);

            const angleDiff = Math.abs((c.bearing || 0) - (m.bearing || 0));
            const isAligned = angleDiff < 15 || angleDiff > 165;

            const gapLimit = 60;
            const canStitch = isAligned && dist < gapLimit && c.metrics!.ratio > 3.0 && m.metrics!.ratio > 3.0;

            if (dist < thresholdM || canStitch) {
                c.sources.forEach(src => {
                    if (!m.sources.includes(src)) m.sources.push(src);
                });
                if (!m.sources.includes(c.source)) m.sources.push(c.source);

                if (canStitch && dist > thresholdM) {
                    m.type = "Linear Pattern Anomaly";
                    m.confidence = dist > 45 ? 'Medium' : 'High';
                }

                const getWeight = (s: string) => {
                    if (s.startsWith('terrain')) return 1.0;
                    if (s === 'hydrology') return 0.9;
                    if (s.startsWith('satellite_summer')) return 0.8;
                    if (s.startsWith('satellite_spring')) return 0.7;
                    return 0.5;
                };

                if (c.source === 'terrain') m.center = [c.center[0], c.center[1]];
                else m.center = [(m.center[0] + c.center[0]) / 2, (m.center[1] + c.center[1]) / 2];

                m.findPotential = Math.min(96, m.findPotential + (c.findPotential * 0.4 * getWeight(c.source)));

                if (c.source === 'hydrology') {
                    m.type = "Ancient Watercourse Signal";
                }

                if (m.sources.includes('satellite_summer') && !m.sources.includes('satellite_spring')) {
                    m.type = "Cropmark Signal (Drought Response)";
                    m.findPotential = Math.min(96, m.findPotential + 15);
                }

                if (m.sources.length >= 3) m.confidence = 'High';
                else if (m.sources.length >= 2 && m.confidence === 'Subtle') m.confidence = 'Medium';

                let score = (m.sources.length * 15);
                if (m.sources.includes('terrain') && m.sources.includes('terrain_global')) score += 10;
                if (m.sources.includes('slope')) score += 5;
                if (c.scaleTier !== m.scaleTier) score += 20;
                m.persistenceScore = Math.min(100, (m.persistenceScore || 0) + score);

                found = true;
                break;
            }
        }
        if (!found) {
            const initialType = c.source === 'satellite_summer' ? "Cropmark Signal (Drought Response)" : c.type;
            merged.push({ ...c, type: initialType, sources: [c.source], persistenceScore: 25, rescanCount: 1 });
        }
    }
    return merged;
}

// ─── Context analysis ─────────────────────────────────────────────────────────

export function analyzeContext(clusters: Cluster[], routes: HistoricRoute[] = []): Cluster[] {
    const results = [...clusters];
    const proximityM = 60;

    for (let i = 0; i < results.length; i++) {
        const c = results[i];
        if (!c.explanationLines) c.explanationLines = [];

        const neighbors = results.filter(n => n.id !== c.id && getDistance(c.center, n.center) < proximityM);

        if (neighbors.length >= 2) {
            const houses = neighbors.filter(n => n.type.includes('Roundhouse') || n.type.includes('Foundation'));
            const enclosures = neighbors.filter(n => n.type.includes('Enclosure') || n.type.includes('Ring'));
            const ditches = neighbors.filter(n => n.type.includes('Linear') || n.type.includes('Corridor'));

            if (enclosures.length > 0 && houses.length > 0) {
                c.contextLabel = "Enclosed Settlement / Farmstead";
                c.findPotential = Math.min(96, c.findPotential + 10);
            } else if (houses.length >= 2) {
                c.contextLabel = "Habitation Cluster / Settlement Nucleus";
                c.findPotential = Math.min(96, c.findPotential + 5);
            } else if (ditches.length >= 2) {
                c.contextLabel = "Organized Field System / Celtic Fields";
            }
        }

        let hasRouteProximity = false;
        for (const route of routes) {
            const dist = getDistanceToLine(c.center, route.geometry, route.bbox);
            if (route.type === 'roman_road' && dist < 150) {
                c.findPotential = Math.min(96, c.findPotential + 12);
                c.explanationLines.push("Roman road proximity");
                if (c.sources.includes('terrain') || c.sources.includes('terrain_global')) {
                    c.explanationLines.push("LiDAR relief agrees with movement corridor");
                }
                hasRouteProximity = true;
            } else if (dist < 100) {
                c.findPotential = Math.min(96, c.findPotential + 7);
                c.explanationLines.push("Historic route proximity");
                hasRouteProximity = true;
            }
        }

        if (c.sources.includes('hydrology') && hasRouteProximity) {
            c.explanationLines.push("Near likely crossing point");
            c.isHighConfidenceCrossing = true;
        }

        if (c.polarity === 'Raised' && hasRouteProximity) {
            c.explanationLines.push("Strong route-to-terrain relationship");
        }
    }
    return results;
}

// ─── Disturbance suppression ──────────────────────────────────────────────────

export function suppressDisturbance(clusters: Cluster[]): Cluster[] {
    const results = [...clusters];

    for (let i = 0; i < results.length; i++) {
        const c = results[i];
        let risk: Cluster['disturbanceRisk'] = 'Low';
        let reason = "";

        const parallelNeighbors = results.filter(n =>
            n.id !== c.id &&
            getDistance(c.center, n.center) < 100 &&
            Math.abs((c.bearing || 0) - (n.bearing || 0)) < 1.5 &&
            c.metrics!.ratio > 4.0 && n.metrics!.ratio > 4.0
        );

        if (parallelNeighbors.length >= 2) {
            risk = 'High';
            reason = "Systematic Parallelism (Drainage/Plough)";
        }

        if (c.metrics!.density > 0.85 && c.metrics!.area < 300 && !c.type.includes('Roundhouse')) {
            risk = 'Medium';
            reason = "High Gradient Sharpness (Recent Cut)";
        }

        if (c.metrics!.ratio > 8.0 && parallelNeighbors.length >= 1) {
            risk = 'High';
            reason = "Machinery / Track Scar";
        }

        if (risk !== 'Low') {
            c.disturbanceRisk = risk;
            c.disturbanceReason = reason;
            c.findPotential = Math.max(5, c.findPotential - (risk === 'High' ? 60 : 30));
        } else {
            c.disturbanceRisk = 'Low';
        }
    }
    return results;
}

// ─── Hotspot generation ───────────────────────────────────────────────────────

export function generateHotspots(
    clusters: Cluster[],
    pas: PASFind[],
    monuments: [number, number][],
    period: string = 'All',
    perms: unknown[] = [],
    flds: unknown[] = [],
    routes: HistoricRoute[] = []
): Hotspot[] {
    void pas; void monuments; void period; void perms; void flds; // used for future filtering

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

        // Don't show hotspots that overlap a scheduled monument boundary
        if (members.some(m => m.isProtected)) continue;

        let anomaly = 0;
        let context = 0;
        let convergence = 0;
        let behaviour = 0;
        let penalty = 0;
        const explanation: string[] = [];

        const sources = new Set(members.flatMap(m => m.sources));
        const hasLidar = sources.has('terrain') || sources.has('terrain_global');
        const hasSatellite = (sources.has('satellite_spring') || sources.has('satellite_summer')) && !sources.has('terrain');
        const hasHydrology = sources.has('hydrology');

        if (hasLidar) {
            const bestLidar = members.find(m => m.sources.includes('terrain') || m.sources.includes('terrain_global'));
            let lidarScore = bestLidar?.confidence === 'High' ? 18 : (bestLidar?.confidence === 'Medium' ? 10 : 5);

            if (hasHydrology) { lidarScore += 5; explanation.push("LiDAR + Hydrology correlation"); }
            if (sources.has('satellite_summer')) { lidarScore += 4; explanation.push("LiDAR + Spectral agreement"); }

            anomaly += lidarScore;
            explanation.push("Reliable LiDAR relief signature");
        }

        if (hasSatellite) {
            const hasSummer = sources.has('satellite_summer');
            const hasSpring = sources.has('satellite_spring');
            const satScore = (hasSummer && hasSpring) ? 10 : (hasSummer ? 6 : 3);
            anomaly += satScore;
            explanation.push("Spectral vegetation anomaly");
        }

        const center = c.center;
        const isRaised = members.some(m => m.polarity === 'Raised');
        if (isRaised) {
            context += 8;
            explanation.push("Raised dry footing");
            if (hasHydrology) { context += 4; explanation.push("Strategic dry point near water"); }
        }

        if (hasHydrology) {
            anomaly += 5;
            if (isRaised) {
                const convergenceBonus = hasLidar ? 4 : 0;
                behaviour += (6 + convergenceBonus);
                explanation.push("Island effect: Dry ground in wet zone");
            }
            if (members.some(m => m.type.includes('Corridor'))) {
                const corridorBonus = hasLidar ? 3 : 0;
                behaviour += (5 + corridorBonus);
                explanation.push("Historic river crossing / Ford potential");
            }
        }

        let routeScore = 0;
        const routeReasons: string[] = [];
        let hasRomanProximity = false;
        let hasHistProximity = false;
        let routeCount = 0;

        for (const route of routes) {
            const dist = getDistanceToLine(center, route.geometry, route.bbox);
            if (route.type === 'roman_road') {
                if (dist < 100) { routeScore += 8; hasRomanProximity = true; routeCount++; }
                else if (dist < 250) { routeScore += 6; hasRomanProximity = true; routeCount++; }
                else if (dist < 500) { routeScore += 3; hasRomanProximity = true; routeCount++; }
            } else {
                if (dist < 75) { routeScore += 5; hasHistProximity = true; routeCount++; }
                else if (dist < 200) { routeScore += 3; hasHistProximity = true; routeCount++; }
                else if (dist < 400) { routeScore += 1; hasHistProximity = true; routeCount++; }
            }
        }

        if (routeCount >= 2) {
            const nearbyRoutes = routes.filter(r => getDistanceToLine(center, r.geometry, r.bbox) < 500);
            const romanCount = nearbyRoutes.filter(r => r.type === 'roman_road').length;
            const histCount = nearbyRoutes.length - romanCount;
            if (romanCount >= 2) { routeScore += 7; routeReasons.push("Near Roman route junction"); }
            else if (romanCount >= 1 && histCount >= 1) { routeScore += 6; routeReasons.push("Near historic route convergence"); }
            else if (histCount >= 2) { routeScore += 4; routeReasons.push("Route junction nearby"); }
        }

        let isHighConfidenceCrossing = false;
        if (hasHydrology) {
            if (hasRomanProximity) { routeScore += 7; routeReasons.push("Likely Roman water crossing"); isHighConfidenceCrossing = true; }
            else if (hasHistProximity) { routeScore += 5; routeReasons.push("Historic crossing point"); isHighConfidenceCrossing = true; }
        }

        if (isRaised) {
            if (hasRomanProximity) { routeScore += 6; routeReasons.push("Raised access point beside Roman route"); }
            else if (hasHistProximity) { routeScore += 4; routeReasons.push("Raised ground beside movement corridor"); }
        }

        const independentSignals = [hasLidar, sources.has('satellite_summer'), hasHydrology, isRaised].filter(Boolean).length;

        if (routeScore > 0) {
            if (independentSignals === 0) {
                routeScore = Math.round(routeScore * 0.7);
            } else if (independentSignals >= 2) {
                routeScore = Math.round(routeScore * 1.3);
                if (hasRomanProximity) routeReasons.push("Confidence boosted by Roman road corridor");
                else routeReasons.push("Confidence boosted by historic route proximity");
            }
        }

        if (hasRomanProximity && routeScore > 5) explanation.push("Near probable Roman road corridor");
        else if (hasHistProximity && routeScore > 3) explanation.push("Historic movement corridor nearby");

        routeReasons.forEach(r => { if (!explanation.includes(r)) explanation.push(r); });
        behaviour += routeScore;

        members.forEach(m => {
            if (m.disturbanceRisk === 'High') {
                penalty -= 20;
                explanation.push("IGNORE: High risk of modern disturbance");
            }
            if (m.metrics && m.metrics.density < 0.05) {
                penalty -= 10;
                explanation.push("IGNORE: Uniform/Featureless terrain");
            }
        });

        const score = Math.min(98, Math.max(0, anomaly + context + convergence + behaviour + penalty));

        const signalCount = sources.size;
        const hasStrongAgreement = signalCount >= 3;
        const hasModerateAgreement = signalCount >= 2;

        let confidence: Hotspot['confidence'] = 'Low Confidence';
        if (score > 80 && hasStrongAgreement) confidence = 'High Probability';
        else if (score > 60 && hasModerateAgreement) confidence = 'Strong Signal';
        else if (score > 35) confidence = 'Developing Signal';

        if (confidence === 'Strong Signal' && behaviour < 5 && context < 5) confidence = 'Developing Signal';
        if (confidence === 'High Probability' && behaviour < 8) confidence = 'Strong Signal';

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
            id: Math.random().toString(36).substring(7),
            number: 0,
            score,
            confidence,
            type,
            explanation: Array.from(new Set(explanation)).slice(0, 4),
            center: [ (minLon + maxLon) / 2, (minLat + maxLat) / 2 ],
            bounds: [[minLon - 0.0004, minLat - 0.0004], [maxLon + 0.0004, maxLat + 0.0004]],
            memberIds: members.map(m => m.id),
            isHighConfidenceCrossing,
            metrics: { anomaly, context, convergence, behaviour, penalty }
        });
    }

    return results
        .filter(h => h.score >= 15)
        .sort((a, b) => b.score - a.score)
        .map((h, i) => ({ ...h, number: i + 1 }));
}
