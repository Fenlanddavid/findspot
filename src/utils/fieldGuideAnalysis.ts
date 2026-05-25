// ─── Pure analysis functions: consensus merging, context analysis,
//     disturbance suppression, asset enrichment, drift detection ──────────────

import { Cluster, HistoricRoute, ModernWay, RouteAssessment, RouteRelationship } from '../pages/fieldGuideTypes';

export const MONUMENT_BOUNDARY_BUFFER_M = 20;

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

function getRingBbox(ring: number[][]): [[number, number], [number, number]] {
    const lons = ring.map(p => p[0]);
    const lats = ring.map(p => p[1]);
    return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
}

function isPointNearAnyRing(pt: [number, number], rings: number[][][]): boolean {
    return rings.some(ring => {
        if (!Array.isArray(ring) || ring.length < 2) return false;
        return getDistanceToLine(pt, ring as [number, number][], getRingBbox(ring)) <= MONUMENT_BOUNDARY_BUFFER_M;
    });
}

function getMonumentProtectionMatch(lat: number, lon: number, geometry: { type: string; coordinates: unknown }): { inside: boolean; bufferOnly: boolean } {
    const pt: [number, number] = [lon, lat];
    if (geometry.type === 'Polygon') {
        const rings = geometry.coordinates as number[][][];
        const inside = isPointInPolygon(lat, lon, rings);
        return { inside, bufferOnly: !inside && isPointNearAnyRing(pt, rings) };
    }
    if (geometry.type === 'MultiPolygon') {
        for (const poly of geometry.coordinates as number[][][][]) {
            const inside = isPointInPolygon(lat, lon, poly);
            if (inside) return { inside: true, bufferOnly: false };
            if (isPointNearAnyRing(pt, poly)) return { inside: false, bufferOnly: true };
        }
    }
    return { inside: false, bufferOnly: false };
}

export function applyNHLEProtection(clusters: Cluster[], nhleData: NHLELike): Cluster[] {
    for (const cluster of clusters) {
        const [lon, lat] = cluster.center;
        for (const asset of nhleData.features) {
            if (!asset.geometry) continue;
            const match = getMonumentProtectionMatch(lat, lon, asset.geometry);
            if (match.inside || match.bufferOnly) {
                cluster.isProtected = true;
                cluster.monumentName = asset.properties?.Name;
                if (match.bufferOnly) cluster.monumentBufferM = MONUMENT_BOUNDARY_BUFFER_M;
                break;
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
                // Route through the logistic so AIM cannot bypass anti-inflation.
                // AIM includes low-certainty cropmark transcriptions — a +25 boost
                // is strong without capping at 96 unconditionally.
                c.findPotential = boostScore(c.findPotential, 25);
                // High confidence only when independently corroborated by a physical
                // sensor — AIM polygons alone are not sufficient ground-truth.
                const hasPhysicalCorroboration =
                    c.sources.includes('terrain') || c.sources.includes('terrain_global') ||
                    (c.sources.includes('satellite_summer') && c.sources.includes('satellite_spring'));
                if (hasPhysicalCorroboration) c.confidence = 'High';
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

    for (const c of rawClusters) {
        let found = false;
        for (const m of merged) {
            const dist = getDistance(c.center, m.center);

            const angleDiff = Math.abs((c.bearing || 0) - (m.bearing || 0));
            const isAligned = angleDiff < 15 || angleDiff > 165;

            const gapLimit = 60;
            const canStitch = isAligned && dist < gapLimit && c.metrics!.ratio > 3.0 && m.metrics!.ratio > 3.0;

            // Same-source merging uses a tighter 25m threshold — distinct features
            // seen by the same sensor (e.g. two separate LiDAR pit features 30m apart)
            // should not be collapsed. Cross-source merging keeps 40m to account for
            // positional offsets between different data sources.
            const mergeThresholdM = c.source === m.source ? 25 : 40;

            if (dist < mergeThresholdM || canStitch) {
                c.sources.forEach(src => {
                    if (!m.sources.includes(src)) m.sources.push(src);
                });
                if (!m.sources.includes(c.source)) m.sources.push(c.source);

                if (canStitch && dist > mergeThresholdM) {
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

        const hasSummer = m.sources.includes('satellite_summer');
        const hasSpring = m.sources.includes('satellite_spring');
        const hasHistoric = m.sources.includes('historic');
        const hasHardCorroboration = hasSummer || hasSpring || hasHistoric;

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

        // Persistence here means multiple raw detections merged in one scan, not
        // repeated scans over time. It boosts potential, but only corroborated
        // signals can use it to earn High confidence.
        if ((m.rescanCount || 0) >= 3) {
            m.findPotential = boostScore(m.findPotential, 10);
            if (hasHardCorroboration) m.confidence = 'High';
            m.explanationLines.push('Repeated detection within scan');
        }

        // Terrain-only clusters (including terrain/slope/hydrology combinations
        // without satellite or historic corroboration) cap at Medium. Apply this
        // after all boosts so later logic cannot accidentally re-promote them.
        if (!hasHardCorroboration && m.confidence === 'High') {
            m.confidence = 'Medium';
        }

        // Confidence explanation: surface the reason behind the quality label
        // so the output layer can show "why this signal is trusted".
        if (m.confidence === 'High' && hasHistoric) {
            m.explanationLines.push('Historic data overlaps terrain signal');
        } else if (m.confidence === 'High' || m.confidence === 'Medium') {
            if (m.sources.length >= 2) m.explanationLines.push('Multiple independent sources agree');
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
            if (route.type === 'roman_road') {
                // Graduated decay — roadside activity (vici, mansiones, wayside shrines)
                // routinely sits 150–300m off the agger. A flat 150m cutoff discards
                // genuine Roman-period sites in the wider road corridor.
                if (dist < 100) {
                    c.findPotential = boostScore(c.findPotential, 12);
                    c.explanationLines.push("Roman road proximity");
                    if (c.sources.includes('terrain') || c.sources.includes('terrain_global')) {
                        c.explanationLines.push("LiDAR relief agrees with movement corridor");
                    }
                    hasRouteProximity = true;
                    if (c.routeAlignment === undefined) c.routeAlignment = computeRouteBearing(route.geometry);
                    c.isOnCorridor = true;
                } else if (dist < 200) {
                    c.findPotential = boostScore(c.findPotential, 7);
                    c.explanationLines.push("Near Roman road corridor");
                    hasRouteProximity = true;
                    if (c.routeAlignment === undefined) c.routeAlignment = computeRouteBearing(route.geometry);
                    c.isOnCorridor = true;
                } else if (dist < 350) {
                    c.findPotential = boostScore(c.findPotential, 3);
                    c.explanationLines.push("Roman road in wider landscape");
                    if (c.routeAlignment === undefined) c.routeAlignment = computeRouteBearing(route.geometry);
                }
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

    // ── Third pass: target relationship annotations ───────────────────────────
    // Finds archaeologically meaningful cluster pairings within 200m and adds
    // explanationLines + a relationshipTag. No score changes — interpretation only.
    for (const c of results) {
        if (!c.explanationLines) c.explanationLines = [];
        const nearby = results.filter(n => n.id !== c.id && getDistance(c.center, n.center) < 200);
        if (nearby.length === 0) continue;

        // Circular/ring near another circular — possible barrow group or ring ditch cemetery
        const isCircular = c.type.includes('Ring') || c.type.includes('Circular') ||
                           c.type.includes('Barrow') || c.type.includes('Roundhouse');
        const nearCircular = nearby.filter(n =>
            n.type.includes('Ring') || n.type.includes('Circular') ||
            n.type.includes('Barrow') || n.type.includes('Roundhouse')
        );
        if (isCircular && nearCircular.length >= 1 && !c.explanationLines.some(l => l.includes('barrow'))) {
            c.relationshipTag = 'barrow_group';
            c.explanationLines.push('Clustered circular features — possible barrow group or ring ditch cemetery');
        }

        // Settlement-type near a crossing — roadside/vicus activity
        const isSettlement = c.contextLabel?.includes('Settlement') || c.type.includes('Settlement') || c.type.includes('Foundation');
        if (isSettlement && nearby.some(n => n.isHighConfidenceCrossing) &&
            !c.explanationLines.some(l => l.includes('crossing'))) {
            c.relationshipTag = c.relationshipTag ?? 'route_settlement';
            c.explanationLines.push('Settlement near movement crossing — roadside activity possible');
        }

        // Raised hydrology + nearby raised hydrology — dry-margin chain
        const isRaisedHydro = c.sources.includes('hydrology') && c.polarity === 'Raised';
        if (isRaisedHydro &&
            nearby.some(n => n.sources.includes('hydrology') && n.polarity === 'Raised') &&
            !c.explanationLines.some(l => l.includes('dry-margin chain'))) {
            c.relationshipTag = c.relationshipTag ?? 'hydrology_chain';
            c.explanationLines.push('Part of dry-margin chain — multiple raised areas along water edge');
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
        let suppressCode = '';

        const parallelNeighbors = results.filter(n =>
            n.id !== c.id &&
            getDistance(c.center, n.center) < 100 &&
            Math.abs((c.bearing || 0) - (n.bearing || 0)) < 1.5 &&
            c.metrics!.ratio > 4.0 && n.metrics!.ratio > 4.0
        );

        if (parallelNeighbors.length >= 2) {
            risk = 'High'; reason = "Systematic Parallelism (Drainage/Plough)"; suppressCode = 'systematic_parallelism';
        }

        if (c.metrics!.density > 0.85 && c.metrics!.area < 300 && !c.type.includes('Roundhouse')) {
            risk = 'Medium'; reason = "High Gradient Sharpness (Recent Cut)"; suppressCode = 'high_gradient_sharpness';
        }

        if (c.metrics!.ratio > 8.0 && parallelNeighbors.length >= 1) {
            risk = 'High'; reason = "Machinery / Track Scar"; suppressCode = 'machinery_track_scar';
        }

        // Ridge-and-furrow: 3+ parallel linear features in a wider 200m radius,
        // bearing within 3°. Catches systematic medieval agricultural patterns
        // that survive as faint regular ridges under LiDAR.
        // Ratio threshold raised to 5.0 (from 3.0) to avoid suppressing genuine
        // prehistoric linears (cursus, pit alignments) that share modest elongation.
        // Additionally requires alternating Raised/Sunken polarity — ridge-and-furrow
        // is defined by its strip alternation; two features with identical polarity
        // are more likely genuine archaeology than plough ridges.
        if (risk === 'Low' && c.metrics!.ratio > 5.0) {
            const ridgeFurrowNeighbors = results.filter(n =>
                n.id !== c.id &&
                n.metrics &&
                getDistance(c.center, n.center) < 200 &&
                Math.abs((c.bearing || 0) - (n.bearing || 0)) < 3 &&
                n.metrics.ratio > 5.0,
            );
            if (ridgeFurrowNeighbors.length >= 2) {
                // True ridge-and-furrow alternates Raised/Sunken across adjacent strips.
                // If all neighbors share the same polarity as the target, this is more
                // likely a genuine ancient linear system — do not suppress it.
                const hasAlternatingPolarity = ridgeFurrowNeighbors.some(n => n.polarity !== c.polarity);
                if (hasAlternatingPolarity) {
                    risk         = 'High';
                    reason       = "Ridge-and-Furrow Pattern (Agricultural)";
                    suppressCode = 'ridge_and_furrow';
                }
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
                risk         = 'Medium';
                reason       = "Thin Linear (Possible Noise or Modern Feature)";
                suppressCode = 'thin_linear';
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
                risk         = 'Medium';
                reason       = "Field Boundary Network";
                suppressCode = 'field_boundary_network';
            }
        }

        if (risk !== 'Low') {
            c.disturbanceRisk = risk;
            c.disturbanceReason = reason;
            if (suppressCode) {
                if (!c.suppressedBy) c.suppressedBy = [];
                if (!c.suppressedBy.includes(suppressCode)) c.suppressedBy.push(suppressCode);
            }
            // Proportional penalty: preserves signal in heavily-worked landscapes.
            const penaltyFactor = risk === 'High' ? 0.4 : 0.2;
            c.findPotential = Math.max(5, Math.round(c.findPotential * (1 - penaltyFactor)));
        } else {
            c.disturbanceRisk = 'Low';
        }
    }

    // ── Signal breakdown ──────────────────────────────────────────────────────
    // Computed once after all disturbance passes so disturbanceRisk is final.
    // Gives the UI and Engine Lab a per-cluster confidence decomposition.
    for (const c of results) {
        const hasLidar   = c.sources.includes('terrain') || c.sources.includes('terrain_global');
        const hasHydro   = c.sources.includes('hydrology');
        const hasSummer  = c.sources.includes('satellite_summer');
        const hasSpring  = c.sources.includes('satellite_spring');
        c.signalBreakdown = {
            terrain:    hasLidar  ? (c.confidence === 'High' ? 85 : c.confidence === 'Medium' ? 65 : 40) : 0,
            hydrology:  hasHydro  ? 60 : 0,
            spectral:   (hasSummer && hasSpring) ? 80 : hasSummer ? 60 : hasSpring ? 40 : 0,
            disturbance: c.disturbanceRisk === 'High' ? 80 : c.disturbanceRisk === 'Medium' ? 45 : 10,
        };
    }

    return results;
}

// generateHotspots has moved to hotspotEngine.ts.
// Import { buildTerrainHotspots, enhanceHotspotsWithHistoric, generateHotspots }
// from '../utils/hotspotEngine' instead.

// ─── Route movement interpretation ───────────────────────────────────────────
// Single authoritative model for assessing whether a cluster is a modern route
// artefact or an archaeologically meaningful movement signal.
//
// Replaces the old binary applyRouteArtefactSuppression(). All downstream
// systems (hotspot engine, trace engine, display filter) read from the
// RouteAssessment object attached to each cluster — no independent route logic
// elsewhere.
//
// Pipeline position: runs AFTER AIM/NHLE enrichment and analyzeContext so the
// assessment has full archaeological context (aimInfo, isOnCorridor,
// isHighConfidenceCrossing, hydrology relationships) before deciding.

// ── Distance thresholds ───────────────────────────────────────────────────────
export const ROUTE_ON_LINE_M    =   8;   // 0–8m: likely directly on modern route
export const ROUTE_CLOSE_M      =  20;   // 8–20m: possible verge/drainage/track-edge
export const ROUTE_EDGE_MIN_M   =  20;   // 20m: start of potentially interesting offset zone
export const ROUTE_EDGE_MAX_M   =  70;   // 70m: end of route-edge activity zone
export const ROUTE_CONTEXT_MAX_M = 120;  // 120m+: generally unrelated

// ── Way type risk weights ─────────────────────────────────────────────────────
// Used to scale distance-based risk by road importance. Major engineered roads
// have large embankment profiles; minor tracks/paths have minimal infrastructure.
// Scale: divide by 50 to get a 0–1 multiplier.
const WAY_TYPE_RISK_WEIGHT: Record<string, number> = {
    motorway:     50,
    trunk:        45,
    primary:      40,
    secondary:    35,
    tertiary:     30,
    unclassified: 24,
    residential:  20,
    service:      22,
    track:        18,
    path:         10,
    footway:       8,
    bridleway:     8,
};

// ── Geometry helpers ──────────────────────────────────────────────────────────

function isStronglyLinear(c: Cluster): boolean {
    return (c.metrics?.ratio ?? 0) > 4.0;
}

// Long thin linears are the dominant drain/track-scar false-positive shape.
// Uses the pixel bounding box minor axis (same approach as suppressDisturbance).
function isLongThinLinear(c: Cluster): boolean {
    if ((c.metrics?.ratio ?? 0) <= 6.0) return false;
    const minAxis = Math.min(
        (c.maxX ?? 0) - (c.minX ?? 0) + 1,
        (c.maxY ?? 0) - (c.minY ?? 0) + 1,
    );
    return minAxis < 8;
}

function alignedWithWayBearing(c: Cluster, way: ModernWay): boolean {
    if (typeof c.bearing !== 'number') return false;
    const wb = computeRouteBearing(way.geometry);
    return bearingDiff(c.bearing, wb) <= 20 || bearingDiff(c.bearing, (wb + 180) % 360) <= 20;
}

function singleSourceOnly(c: Cluster): boolean {
    return c.sources.length === 1;
}

// ── Evidence helpers ──────────────────────────────────────────────────────────

function hasMultiScaleConfirmation(c: Cluster): boolean {
    return c.multiScale === true;
}

function hasBothSatelliteSeasons(c: Cluster): boolean {
    return c.sources.includes('satellite_spring') && c.sources.includes('satellite_summer');
}

function hasHydrologyOrWetMarginSupport(c: Cluster): boolean {
    return c.sources.includes('hydrology') ||
        (c.metrics?.dryMarginScore  ?? 0) >= 0.55 ||
        (c.metrics?.flowConvergence ?? 0) >= 0.55;
}

function hasHistoricMapOrAIMSupport(c: Cluster): boolean {
    return c.aimInfo !== undefined || c.sources.includes('historic');
}

// On clusters, PAS find enrichment has not yet run (it applies to hotspot
// objects in enhanceHotspotsWithHistoric). Use NHLE protection and monument
// proximity as the best available proxy for recorded heritage context.
function hasPASOrHistoricContextNearby(c: Cluster): boolean {
    if (c.monumentBufferM) return false;
    return c.isProtected === true || c.monumentName !== undefined;
}

function hasMultiSourceSupport(c: Cluster): boolean {
    const physicalSources = c.sources.filter(s =>
        s === 'terrain' || s === 'terrain_global' || s === 'hydrology' ||
        s === 'satellite_spring' || s === 'satellite_summer' || s === 'historic',
    );
    return physicalSources.length >= 2;
}

// Junction / crossing / wet-margin convergence points are archaeologically
// meaningful beside routes regardless of road type. Do NOT require OSM spring
// nodes — hydrology context and flow convergence are more useful.
function isAtRouteJunctionCrossingOrSpring(c: Cluster): boolean {
    if (c.isHighConfidenceCrossing) return true;
    if (c.sources.includes('hydrology') && c.isOnCorridor) return true;
    if ((c.metrics?.flowConvergence ?? 0) >= 0.65 && c.isOnCorridor) return true;
    return false;
}

function passesRouteEvidenceGate(c: Cluster): boolean {
    return (
        hasMultiSourceSupport(c)          ||
        hasBothSatelliteSeasons(c)        ||
        hasHistoricMapOrAIMSupport(c)     ||
        hasHydrologyOrWetMarginSupport(c) ||
        hasPASOrHistoricContextNearby(c)  ||
        isAtRouteJunctionCrossingOrSpring(c)
    );
}

// ── Core assessment ───────────────────────────────────────────────────────────

const NOT_ROUTE_RELATED: RouteAssessment = {
    relationship: 'not_route_related',
    risk: 0, confidence: 1,
    hotspotScoreAdjustment: 0, traceScoreAdjustment: 0,
    hideFromDefaultView: false, reasons: [], debugFlags: [],
};

export function assessRouteRelationship(
    cluster: Cluster,
    modernWays: ModernWay[],
): RouteAssessment {
    // Protected clusters inside scheduled monument boundaries are never
    // suppressed. Buffer-only hits are still route-assessed so modern road/track
    // artefacts do not re-enter the target list via the advisory buffer.
    if ((cluster.isProtected && !cluster.monumentBufferM) || modernWays.length === 0) return NOT_ROUTE_RELATED;

    // Find nearest mapped way within the context radius.
    let nearestWay: ModernWay | undefined;
    let nearestDist = Infinity;
    for (const way of modernWays) {
        const d = getDistanceToLine(cluster.center, way.geometry, way.bbox);
        if (d < nearestDist) { nearestDist = d; nearestWay = way; }
    }
    if (!nearestWay || nearestDist > ROUTE_CONTEXT_MAX_M) return NOT_ROUTE_RELATED;

    const wayWeight   = WAY_TYPE_RISK_WEIGHT[nearestWay.highwayTag] ?? 5;
    const weightScale = wayWeight / 50.0; // 0.16 (bridleway) → 1.0 (motorway)

    let risk = 0;
    const reasons:    string[] = [];
    const debugFlags: string[] = [];

    // ── Distance-based risk (scaled by way-type importance) ───────────────────
    // Major roads contribute full distance risk; minor tracks/paths contribute
    // a fraction, so geometry evidence is required to reach suppression threshold.
    if (nearestDist <= ROUTE_ON_LINE_M) {
        risk += Math.round(35 * weightScale);
        reasons.push(`Within ${nearestDist.toFixed(0)}m of mapped ${nearestWay.highwayTag}`);
        debugFlags.push('distance_on_line');
    } else if (nearestDist <= ROUTE_CLOSE_M) {
        risk += Math.round(18 * weightScale);
        reasons.push(`Within ${nearestDist.toFixed(0)}m of mapped ${nearestWay.highwayTag}`);
        debugFlags.push('distance_close');
    } else if (nearestDist >= ROUTE_EDGE_MIN_M && nearestDist <= ROUTE_EDGE_MAX_M) {
        risk -= 8;   // offset from route is archaeologically interesting
        debugFlags.push('distance_offset_edge_zone');
    }

    // ── Geometry-based risk additions (cluster shape, not road type) ──────────
    if (isStronglyLinear(cluster))             { risk += 18; debugFlags.push('strongly_linear'); }
    if (alignedWithWayBearing(cluster, nearestWay)) { risk += 22; debugFlags.push('aligned_with_way'); }
    if (singleSourceOnly(cluster))             { risk += 12; debugFlags.push('single_source'); }
    if (isLongThinLinear(cluster))             { risk += 15; debugFlags.push('long_thin_linear'); }

    // Parallel to any secondary mapped way within 50m (field-edge tracks, drainage lines).
    if (isStronglyLinear(cluster) && typeof cluster.bearing === 'number') {
        for (const way of modernWays) {
            if (way === nearestWay) continue;
            const d = getDistanceToLine(cluster.center, way.geometry, way.bbox);
            if (d > 50) continue;
            const wb = computeRouteBearing(way.geometry);
            if (bearingDiff(cluster.bearing, wb) <= 25 || bearingDiff(cluster.bearing, (wb + 180) % 360) <= 25) {
                risk += 10;
                debugFlags.push('parallel_to_secondary_way');
                break;
            }
        }
    }

    // ── Evidence-based risk reductions ────────────────────────────────────────
    if (hasMultiScaleConfirmation(cluster))        { risk -= 15; debugFlags.push('has_multiscale'); }
    if (hasBothSatelliteSeasons(cluster))          { risk -= 15; debugFlags.push('has_both_sat_seasons'); }
    if (hasHydrologyOrWetMarginSupport(cluster))   { risk -= 10; debugFlags.push('has_hydrology_wetmargin'); }
    if (hasHistoricMapOrAIMSupport(cluster))        {
        risk -= 25;
        reasons.push('AIM/historic map evidence present');
        debugFlags.push('has_historic_aim');
    }
    if (hasPASOrHistoricContextNearby(cluster))    { risk -=  8; debugFlags.push('has_monument_context'); }
    if (nearestDist >= ROUTE_EDGE_MIN_M && nearestDist <= ROUTE_EDGE_MAX_M) {
        risk -= 10;
        debugFlags.push('offset_from_route');
    }
    if (isAtRouteJunctionCrossingOrSpring(cluster)) {
        risk -= 12;
        reasons.push('Junction / crossing / wet-margin convergence');
        debugFlags.push('junction_or_crossing');
    }

    // ── Classification ────────────────────────────────────────────────────────
    const linear       = isStronglyLinear(cluster);
    const aligned      = alignedWithWayBearing(cluster, nearestWay);
    const evidenceGate = passesRouteEvidenceGate(cluster);
    const isOffset     = nearestDist >= ROUTE_EDGE_MIN_M && nearestDist <= ROUTE_EDGE_MAX_M;

    // ── Major road hard-suppress floor ────────────────────────────────────────
    // Unconditional distance-threshold suppression for engineered roads
    // (motorway → service). Thresholds mirror the former waySuppressionDistance().
    //
    // No evidence override here — the old display filter was unconditional.
    // getHotspotInput() handles the separate question of whether a suppressed
    // cluster can still contribute to hotspot scoring (it checks
    // hasStrongIndependentEvidence independently of this flag).
    //
    // Tracks, paths, and bridleways (weight < 20) have NO hard floor — their
    // suppression is entirely governed by the risk model above, which requires
    // geometry + evidence conditions. That is the key architectural change from
    // the old system.
    const majorRoadHardThreshold =
        wayWeight >= 40 ? 20 :   // motorway / trunk / primary
        wayWeight >= 35 ? 15 :   // secondary
        wayWeight >= 20 ? 10 :   // tertiary / unclassified / residential / service
        0;

    // Protected clusters already returned early at the top of this function,
    // so isProtected === true can never reach here.
    const majorRoadHardSuppress =
        majorRoadHardThreshold > 0 &&
        nearestDist <= majorRoadHardThreshold;

    let relationship: RouteRelationship;
    let hotspotScoreAdjustment = 0;
    let traceScoreAdjustment   = 0;
    let hideFromDefaultView    = false;

    if (majorRoadHardSuppress || (risk >= 45 && linear && aligned && !evidenceGate)) {
        relationship           = 'modern_route_artefact';
        hideFromDefaultView    = true;
        hotspotScoreAdjustment = -999; // belt-and-braces: primary suppression is hideFromDefaultView
        traceScoreAdjustment   = -999;
        if (majorRoadHardSuppress) {
            reasons.push(`Within ${nearestDist.toFixed(0)}m of ${nearestWay.highwayTag} — suppressed by major-road threshold`);
            debugFlags.push('hidden_modern_route_noise', 'major_road_hard_suppress');
        } else {
            reasons.push(`Signal follows mapped ${nearestWay.highwayTag} alignment without archaeological corroboration`);
            debugFlags.push('hidden_modern_route_noise', `strong_alignment_with_mapped_${nearestWay.highwayTag}`);
        }
        if (singleSourceOnly(cluster)) debugFlags.push('single_source_linear');

    } else if (risk >= 45) {
        // High risk but some evidence present — visible with strong caution penalty.
        relationship           = 'possible_modern_route_noise';
        hotspotScoreAdjustment = -12;
        traceScoreAdjustment   = -18;
        reasons.push(`High route-noise risk near mapped ${nearestWay.highwayTag}`);
        debugFlags.push('possible_route_noise_high');

    } else if (risk >= 25) {
        relationship           = 'possible_modern_route_noise';
        hotspotScoreAdjustment = -8;
        traceScoreAdjustment   = -15;
        reasons.push(`Close to mapped ${nearestWay.highwayTag} — interpret cautiously`);
        debugFlags.push('possible_route_noise');

    } else if (hasHistoricMapOrAIMSupport(cluster) && (!linear || !aligned)) {
        // AIM/historic support and not strongly matching modern route geometry —
        // most likely an older movement corridor rather than a modern artefact.
        relationship           = 'historic_movement_candidate';
        hotspotScoreAdjustment = +8;
        traceScoreAdjustment   = +5;
        reasons.push('AIM or historic evidence suggests older movement corridor');
        debugFlags.push('historic_movement_candidate');

    } else if (isOffset && evidenceGate) {
        // Offset from route with supporting evidence — route-edge archaeology candidate.
        relationship           = 'route_edge_activity_candidate';
        hotspotScoreAdjustment = +3;
        traceScoreAdjustment   =  0;
        reasons.push('Offset from route with supporting evidence — possible route-edge archaeology');
        debugFlags.push('route_edge_activity');

    } else if (nearestDist > ROUTE_CLOSE_M && evidenceGate) {
        // Not close to route, has evidence — retain without penalty.
        relationship           = 'route_edge_activity_candidate';
        hotspotScoreAdjustment =  0;
        traceScoreAdjustment   =  0;
        reasons.push('Near route but offset, supported by evidence');

    } else {
        relationship = 'not_route_related';
    }

    const confidence = Math.max(0, Math.min(1, 1 - risk / 100));

    return {
        relationship,
        risk,
        confidence,
        nearestWay,
        distanceM:          nearestDist,
        alignedWithWay:     aligned,
        hotspotScoreAdjustment,
        traceScoreAdjustment,
        hideFromDefaultView,
        reasons,
        debugFlags,
    };
}

// ── Pipeline entry point ──────────────────────────────────────────────────────
// Runs assessRouteRelationship once per enriched consensus cluster and attaches
// the result. Also sets isRouteArtefactRisk / routeArtefactReason for backward
// compatibility with display filters, map layers, and field reliability scoring.

export function applyRouteAssessments(
    clusters:   Cluster[],
    modernWays: ModernWay[],
): void {
    if (modernWays.length === 0) return;

    for (const c of clusters) {
        const assessment = assessRouteRelationship(c, modernWays);
        c.routeAssessment = assessment;

        if (assessment.hideFromDefaultView) {
            c.isRouteArtefactRisk  = true;
            c.routeArtefactReason  = assessment.reasons[0] ?? 'modern_route_artefact';
            if (!c.suppressedBy) c.suppressedBy = [];
            if (!c.suppressedBy.includes('route_assessment')) c.suppressedBy.push('route_assessment');
            (assessment.debugFlags ?? []).forEach(f => {
                if (!c.suppressedBy!.includes(f)) c.suppressedBy!.push(f);
            });
        }
    }
}

// When the mapped-road service is unavailable, do not treat "no road data" as
// proof that linear signals are safe. Fail closed for road-like target shapes.
// The hasStrongIndependentEvidence exemption is intentionally NOT applied here:
// in flat fenland / drained landscapes, terrain + hydrology just means "there's
// a ditch" — it does not rule out a modern road embankment alongside it.
export function applyRouteUnavailableFallback(clusters: Cluster[]): number {
    let hidden = 0;

    for (const c of clusters) {
        if ((c.isProtected && !c.monumentBufferM) || c.isRouteArtefactRisk) continue;

        const routeLikeType =
            c.type.includes('Linear') ||
            c.type.includes('Movement Signal') ||
            c.type.includes('Corridor');

        if (!routeLikeType) continue;

        c.isRouteArtefactRisk = true;
        c.routeArtefactReason = 'Modern road data unavailable; linear signal hidden until route suppression can verify it';
        c.routeAssessment = {
            relationship: 'modern_route_artefact',
            risk: 60,
            confidence: 0.4,
            hotspotScoreAdjustment: -999,
            traceScoreAdjustment: -999,
            hideFromDefaultView: true,
            reasons: [c.routeArtefactReason],
            debugFlags: ['fallback_modern_way_unavailable', 'linear_route_like_signal'],
        };
        if (!c.suppressedBy) c.suppressedBy = [];
        if (!c.suppressedBy.includes('route_data_unavailable_fallback')) c.suppressedBy.push('route_data_unavailable_fallback');
        hidden++;
    }

    return hidden;
}

// ─── Field reliability scoring ────────────────────────────────────────────────
// Per-scan measure of how much modern noise dominates the cluster population.
// Used by buildTerrainHotspots to proportionally soften confidence in noisy fields.

export interface FieldReliabilityResult {
    score:   number;                         // 0–100, 100 = clean/high reliability
    label:   'high' | 'moderate' | 'low';
    reasons: string[];
}

export function computeFieldReliabilityScore(clusters: Cluster[]): FieldReliabilityResult {
    if (clusters.length === 0) return { score: 100, label: 'high', reasons: [] };
    const total = clusters.length;

    const highDistRatio      = clusters.filter(c => c.disturbanceRisk === 'High').length / total;
    const routeArtefactRatio = clusters.filter(c => c.isRouteArtefactRisk).length / total;
    const genericLinearRatio = clusters.filter(c =>
        (c.type.includes('Linear') || c.type.includes('Movement Signal')) &&
        (c.metrics?.ratio ?? 0) > 4.5 && !c.multiScale
    ).length / total;

    const reasons: string[] = [];
    let score = 100;

    if      (highDistRatio > 0.5)  { score -= 35; reasons.push('High disturbance dominance'); }
    else if (highDistRatio > 0.25) { score -= 18; reasons.push('Elevated disturbance pattern'); }

    if      (routeArtefactRatio > 0.35) { score -= 25; reasons.push('Route artefact dominance'); }
    else if (routeArtefactRatio > 0.15) { score -= 10; reasons.push('Moderate route artefact presence'); }

    if      (genericLinearRatio > 0.5)  { score -= 20; reasons.push('Linear feature dominance'); }
    else if (genericLinearRatio > 0.3)  { score -=  8; reasons.push('Elevated linear signal ratio'); }

    score = Math.max(0, Math.min(100, score));
    const label: 'high' | 'moderate' | 'low' =
        score >= 70 ? 'high' : score >= 40 ? 'moderate' : 'low';
    return { score, label, reasons };
}

// ─── Hotspot input filter ────────────────────────────────────────────────────
// Route artefacts are hidden from hotspot scoring unless they carry strong,
// independent evidence. Keep this shared so terrain and historic re-scoring use
// the same gate and historic enhancement cannot reintroduce suppressed signals.

function hasStrongIndependentEvidence(c: Cluster): boolean {
    const hasLidar = c.sources.includes('terrain') || c.sources.includes('terrain_global');
    const hasMultiSeasonSat = c.sources.includes('satellite_spring') && c.sources.includes('satellite_summer');

    return (
        (hasLidar && (hasMultiSeasonSat || c.sources.includes('hydrology') || c.multiScale === true)) ||
        hasMultiSeasonSat ||
        c.aimInfo !== undefined
    );
}

export function getHotspotInput(clusters: Cluster[]): Cluster[] {
    return clusters.filter(c => !c.isRouteArtefactRisk || hasStrongIndependentEvidence(c));
}
