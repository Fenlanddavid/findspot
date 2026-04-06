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
            if (ridgeFurrowNeighbors.length >= 3) {
                risk   = 'High';
                reason = "Ridge-and-Furrow Pattern (Agricultural)";
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
            c.findPotential = Math.max(5, c.findPotential - (risk === 'High' ? 60 : 30));
        } else {
            c.disturbanceRisk = 'Low';
        }
    }
    return results;
}

// generateHotspots has moved to hotspotEngine.ts.
// Import { buildTerrainHotspots, enhanceHotspotsWithHistoric, generateHotspots }
// from '../utils/hotspotEngine' instead.
