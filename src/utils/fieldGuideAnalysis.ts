// ─── Pure analysis functions: consensus merging, context analysis,
//     disturbance suppression, asset enrichment, drift detection ──────────────

import { Cluster, HistoricRoute } from '../pages/fieldGuideTypes';

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

// ─── Drift detection ─────────────────────────────────────────────────────────
// Returns the distance in metres between two scan centres.
// Returns 0 when no previous centre is available (first scan).

export function getDriftMetres(
    previous: { lat: number; lng: number } | null,
    current:  { lat: number; lng: number },
): number {
    if (!previous) return 0;
    return getDistanceKm(previous.lat, previous.lng, current.lat, current.lng) * 1000;
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

function _getFlatDistanceSq(p1: [number, number], p2: [number, number]): number {
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


// ─── Scoring helpers ──────────────────────────────────────────────────────────

// Anti-inflation logistic boost: converts currentScore to raw space, adds boost,
// re-compresses. Each additional boost yields diminishing returns as scores
// approach 100, making "High potential" actually mean something.
function boostScore(base: number, boost: number): number {
    if (base <= 0) return Math.min(96, 100 * (1 - Math.exp(-boost / 100)));
    const raw = -Math.log(Math.max(0.001, 1 - Math.min(0.999, base / 100))) * 100;
    return Math.min(96, 100 * (1 - Math.exp(-(raw + boost) / 100)));
}

// Source weights for confidence scoring — quality over count.
// Historic source gets the highest weight; satellite_spring is the weakest.
const SOURCE_WEIGHTS: Record<string, number> = {
    terrain:          1.0,
    terrain_global:   0.9,
    hydrology:        0.9,
    satellite_summer: 0.8,
    satellite_spring: 0.7,
    historic:         1.2,
};

// ─── Route bearing ────────────────────────────────────────────────────────────

// Approximate route bearing from first → last geometry vertex.
// Used to populate Cluster.routeAlignment for movement corridor analysis.
function computeRouteBearing(geometry: [number, number][]): number {
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

// Shortest angular difference between two bearings (handles 0°/360° wrap).
function bearingDiff(a: number, b: number): number {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
}

// Weight factor for non-roman route types. Reflects archaeological confidence:
// established hollow ways and droveways > green lanes > suspected routes.
export function getRouteTypeWeight(route: HistoricRoute): number {
    if (route.type === 'historic_trackway' || route.type === 'holloway' || route.type === 'droveway') return 1.0;
    if (route.type === 'green_lane')      return 0.7;
    if (route.type === 'suspected_route') return 0.5;
    return 0.6; // unknown / other
}

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

                m.findPotential = boostScore(m.findPotential, c.findPotential * 0.4 * getWeight(c.source));

                if (c.source === 'hydrology') {
                    m.type = "Ancient Watercourse Signal";
                }

                // Weighted confidence: quality > count — historic + terrain = high trust,
                // satellite-only stays lower even with multiple spring/summer passes.
                const weightedConf = m.sources.reduce((acc, s) => acc + (SOURCE_WEIGHTS[s] ?? 0.5), 0);
                if (weightedConf >= 2.5) m.confidence = 'High';
                else if (weightedConf >= 1.5) m.confidence = 'Medium';

                // Track merge count for persistence scoring (applied post-loop)
                m.rescanCount = (m.rescanCount || 1) + 1;

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

    // ── Post-processing: confidence explanations + temporal + persistence ────────
    // Applied once per merged cluster, after all merging is complete, so the
    // satellite_summer bonus and temporal agreement bonus cannot double-stack.
    for (const m of merged) {
        if (!m.explanationLines) m.explanationLines = [];

        // Confidence explanation: surface the reason behind the quality label
        // so the output layer can show "why this signal is trusted".
        if (m.confidence === 'High' && m.sources.includes('historic')) {
            m.explanationLines.push('Historic data overlaps terrain signal');
        } else if (m.confidence === 'High' || m.confidence === 'Medium') {
            if (m.sources.length >= 2) m.explanationLines.push('Multiple independent sources agree');
        }

        const hasSummer = m.sources.includes('satellite_summer');
        const hasSpring = m.sources.includes('satellite_spring');

        if (hasSummer && hasSpring) {
            // Multi-season agreement: strong archaeological signal — both summer
            // drought stress and spring moisture response detected independently.
            m.findPotential = boostScore(m.findPotential, 17);
            m.explanationLines.push('Multi-season cropmark agreement');
            m.type = 'Cropmark Signal (Drought Response)';
        } else if (hasSummer) {
            // Summer-only: useful but single-season
            m.findPotential = boostScore(m.findPotential, 15);
            m.type = 'Cropmark Signal (Drought Response)';
        }

        // Persistence: repeated detection across scan passes = verified signal
        if ((m.rescanCount || 0) >= 3) {
            m.findPotential = boostScore(m.findPotential, 10);
            m.confidence = 'High';
            m.explanationLines.push('Repeated detection across scans');
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

        // Feature scale classification — area-based, independent of scan tier.
        // Used for UI grouping and interpretation context.
        if (c.metrics) {
            if (c.metrics.area < 200)       c.scale = 'Micro';
            else if (c.metrics.area < 1000) c.scale = 'Local';
            else                             c.scale = 'Landscape';
        }

        // Role-based interpretation — moves from classification to meaning.
        // Enables enhanced contextLabels when combined with route/landscape context.
        if (c.type.includes('Roundhouse') || c.type.includes('Foundation') || c.type.includes('Settlement')) {
            c.role = 'Domestic Core';
        } else if (c.type.includes('Enclosure') || c.type.includes('Ring') || c.type.includes('Barrow')) {
            c.role = 'Boundary';
        } else if (c.type.includes('Linear') || c.type.includes('Corridor')) {
            c.role = 'Access / Division';
        }

        const neighbors = results.filter(n => n.id !== c.id && getDistance(c.center, n.center) < proximityM);

        if (neighbors.length >= 2) {
            const houses = neighbors.filter(n => n.type.includes('Roundhouse') || n.type.includes('Foundation'));
            const enclosures = neighbors.filter(n => n.type.includes('Enclosure') || n.type.includes('Ring'));
            const ditches = neighbors.filter(n => n.type.includes('Linear') || n.type.includes('Corridor'));

            if (enclosures.length > 0 && houses.length > 0) {
                c.contextLabel = "Enclosed Settlement / Farmstead";
                c.findPotential = boostScore(c.findPotential, 10);
            } else if (houses.length >= 2) {
                c.contextLabel = "Habitation Cluster / Settlement Nucleus";
                c.findPotential = boostScore(c.findPotential, 5);
            } else if (ditches.length >= 2) {
                c.contextLabel = "Organized Field System / Celtic Fields";
            }
        }

        let hasRouteProximity = false;
        for (const route of routes) {
            const dist = getDistanceToLine(c.center, route.geometry, route.bbox);
            if (route.type === 'roman_road' && dist < 150) {
                c.findPotential = boostScore(c.findPotential, 12);
                c.explanationLines.push("Roman road proximity");
                if (c.sources.includes('terrain') || c.sources.includes('terrain_global')) {
                    c.explanationLines.push("LiDAR relief agrees with movement corridor");
                }
                hasRouteProximity = true;
                if (c.routeAlignment === undefined) c.routeAlignment = computeRouteBearing(route.geometry);
                c.isOnCorridor = true;
            } else if (dist < 100) {
                c.findPotential = boostScore(c.findPotential, 7 * getRouteTypeWeight(route));
                c.explanationLines.push("Historic route proximity");
                hasRouteProximity = true;
                if (c.routeAlignment === undefined) c.routeAlignment = computeRouteBearing(route.geometry);
                c.isOnCorridor = true;
            }
        }

        if (c.sources.includes('hydrology') && hasRouteProximity) {
            c.explanationLines.push("Near likely crossing point");
            c.isHighConfidenceCrossing = true;
        }

        if (c.polarity === 'Raised' && hasRouteProximity) {
            c.explanationLines.push("Strong route-to-terrain relationship");
        }

        // Role + corridor context → richer interpretation
        if (c.role === 'Access / Division' && hasRouteProximity) {
            c.contextLabel = "Primary Access Route into Settlement";
        }
    }

    // ── Second pass: cluster linking by route alignment ───────────────────────
    // Connects clusters that share the same movement corridor (same bearing ±10°,
    // within 200m). Enables flow visualisation and settlement structure mapping.
    // Run after the first pass so routeAlignment is set on all clusters.
    for (const c of results) {
        if (c.routeAlignment === undefined) continue;
        const aligned = results.filter(n =>
            n.id !== c.id &&
            n.routeAlignment !== undefined &&
            bearingDiff(c.routeAlignment!, n.routeAlignment!) <= 10 &&
            getDistance(c.center, n.center) <= 200,
        );
        if (aligned.length > 0) c.linkedClusterIds = aligned.map(n => n.id);
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

        // Ridge-and-furrow: 3+ parallel linear features in a wider 200m radius,
        // bearing within 3°. Catches systematic medieval agricultural patterns
        // that survive as faint regular ridges under LiDAR.
        if (risk === 'Low' && c.metrics!.ratio > 3.0) {
            const ridgeFurrowNeighbors = results.filter(n =>
                n.id !== c.id &&
                n.metrics &&
                getDistance(c.center, n.center) < 200 &&
                Math.abs((c.bearing || 0) - (n.bearing || 0)) < 3 &&
                n.metrics.ratio > 3.0,
            );
            if (ridgeFurrowNeighbors.length >= 2) {
                risk   = 'High';
                reason = "Ridge-and-Furrow Pattern (Agricultural)";
            }
        }

        // Thin-line downgrade: very narrow high-ratio features are likely noise
        // (faint plough scars, hedgerow shadows) — flag as Medium disturbance risk.
        if (risk === 'Low' && c.metrics!.ratio > 5.0 && c.metrics!.density < 0.25) {
            const minAxis = Math.min(
                (c.maxX ?? 0) - (c.minX ?? 0) + 1,
                (c.maxY ?? 0) - (c.minY ?? 0) + 1,
            );
            if (minAxis < 5) {
                risk   = 'Medium';
                reason = "Thin Linear (Possible Noise or Modern Feature)";
            }
        }

        // Field boundary network: a linear feature flanked by both parallel
        // AND perpendicular linear neighbors — the signature of a field grid.
        if (risk === 'Low' && c.metrics!.ratio > 5.0) {
            const perpNeighbors = results.filter(n => {
                if (n.id === c.id || !n.metrics || n.metrics.ratio < 4.0) return false;
                if (getDistance(c.center, n.center) > 150) return false;
                const diff = Math.abs((c.bearing || 0) - (n.bearing || 0));
                return (diff > 75 && diff < 105) || (diff > 255 && diff < 285);
            });
            if (perpNeighbors.length >= 1 && parallelNeighbors.length >= 1) {
                risk   = 'Medium';
                reason = "Field Boundary Network";
            }
        }

        if (risk !== 'Low') {
            c.disturbanceRisk = risk;
            c.disturbanceReason = reason;
            // Proportional penalty: preserves signal in heavily-worked landscapes.
            // A High-risk cluster at 60 becomes 36 (not 0 as flat −60 would give),
            // so disturbance flags downgrade rather than delete useful signals.
            const penaltyFactor = risk === 'High' ? 0.4 : 0.2;
            c.findPotential = Math.max(5, Math.round(c.findPotential * (1 - penaltyFactor)));
        } else {
            c.disturbanceRisk = 'Low';
        }
    }
    return results;
}

// generateHotspots has moved to hotspotEngine.ts.
// Import { buildTerrainHotspots, enhanceHotspotsWithHistoric, generateHotspots }
// from '../utils/hotspotEngine' instead.
