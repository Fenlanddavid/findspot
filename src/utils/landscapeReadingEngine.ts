// ─── Landscape Reading Engine ─────────────────────────────────────────────────
// Five archaeology-led scoring systems that run over grouped cluster members
// and return a composite reading used to boost hotspot context scores.
//
// Scoring rule: only microTopo and dryMargin contribute numeric points.
// edgeDetect, movementModel, and terrainSuitability are explanation-only —
// they produce reason strings but add 0 to the score, preventing over-inflation.
//
// Combined microTopo + dryMargin contribution is capped at +6 before returning.

import { Cluster, HistoricRoute } from '../pages/fieldGuideTypes';
import { getDistance, getDistanceToLine } from './fieldGuideAnalysis';

export interface LandscapeReading {
    score:   number;    // capped at 6 — only microTopo + dryMargin
    reasons: string[];  // explanation strings for all 5 systems
}

// ─── 1. Microtopography ───────────────────────────────────────────────────────
// Detects compact earthwork-like shapes: circular/sub-circular, raised or sunken,
// confirmed at multiple scales. These are the strongest structural LiDAR signals.

function microTopoScore(members: Cluster[]): { score: number; reason?: string } {
    const earthworkTypes = members.filter(m => {
        const t = m.type;
        return (
            t.includes('Roundhouse') || t.includes('Barrow') || t.includes('Ring') ||
            t.includes('Mound') || t.includes('Foundation') || t.includes('Enclosure') ||
            t.includes('Settlement')
        );
    });

    const multiScaleConfirmed = members.some(m => m.multiScale && (m.multiScaleLevel ?? 0) >= 2);
    const highCircularity = members.some(m => (m.metrics?.circularity ?? 0) > 0.82);
    const polarised = members.some(m => m.polarity === 'Raised' || m.polarity === 'Sunken');

    // +4 (flat/binary): earthwork type confirmed by shape metrics AND polarity.
    // No grading — if it meets the bar it's a strong signal; if not, nothing.
    if (earthworkTypes.length > 0 && (multiScaleConfirmed || highCircularity) && polarised) {
        return { score: 4, reason: 'Subtle earthwork signature' };
    }
    // Shape metrics alone (no type match): also +4 — two independent metrics agreeing is equally selective.
    if (multiScaleConfirmed && highCircularity) {
        return { score: 4, reason: 'Subtle earthwork signature' };
    }
    // Type match + polarity alone: explanation only, no score — too common to be meaningful
    return { score: 0 };
}

// ─── 2. Dry-edge zones ────────────────────────────────────────────────────────
// Raised ground immediately beside hydrology. Classic Romano-British and Iron Age
// pattern — settle on the dry margin, exploit the water. Only scores when both
// hydrology and a raised cluster are present in the same hotspot group.

function dryMarginScore(members: Cluster[]): { score: number; reason?: string } {
    const hasHydro  = members.some(m => m.sources.includes('hydrology'));
    const hasRaised = members.some(m => m.polarity === 'Raised');

    if (!hasHydro || !hasRaised) return { score: 0 };

    // Require a third qualifier to avoid floodplain / long wet-edge creep:
    // slope break (terrain transition), route proximity (human use signal),
    // or multi-season satellite agreement (spectral confirmation of dry margin).
    const hasSlopeBreak = members.some(m =>
        m.sources.includes('slope') && (m.metrics?.area ?? 0) >= 80,
    );
    const hasRouteProximity = members.some(m => m.isOnCorridor);
    const hasMultiSeasonSat = members.some(m => m.sources.includes('satellite_summer')) &&
        members.some(m => m.sources.includes('satellite_spring'));

    const qualifierCount = [hasSlopeBreak, hasRouteProximity, hasMultiSeasonSat].filter(Boolean).length;
    if (qualifierCount === 0) return { score: 0 };

    // Graded: +3 when two or more qualifiers present, +2 when only one.
    const score = qualifierCount >= 2 ? 3 : 2;
    return { score, reason: 'Dry ground beside former wet zone' };
}

// ─── 3. Edge detection ────────────────────────────────────────────────────────
// Explanation-only. Looks for elevation transitions (raised beside sunken),
// slope break clusters, and wet-dry boundaries. Does not add to score.

function edgeReading(members: Cluster[]): string | undefined {
    const hasRaised = members.some(m => m.polarity === 'Raised');
    const hasSunken = members.some(m => m.polarity === 'Sunken');
    const hasSlopeBreak = members.some(m =>
        m.sources.includes('slope') && (m.metrics?.area ?? 0) >= 80,
    );
    const hasWetDryTransition = members.some(m => m.sources.includes('hydrology')) &&
        (hasRaised || hasSunken);

    if ((hasRaised && hasSunken) || hasSlopeBreak || hasWetDryTransition) {
        return 'Landscape edge detected';
    }
    return undefined;
}

// ─── 4. Movement modelling ────────────────────────────────────────────────────
// Explanation-only. Identifies corridor-type clusters with route alignment,
// natural pinch points (hydrology + slope), or crossing geometry.

function movementReading(members: Cluster[], routes: HistoricRoute[]): string | undefined {
    const corridorMembers = members.filter(m =>
        m.type.includes('Corridor') || m.type.includes('Route') || m.isOnCorridor,
    );
    const hasAlignment = members.some(m => m.routeAlignment !== undefined);
    const hasCrossing   = members.some(m => m.isHighConfidenceCrossing);

    if (hasCrossing) return 'Likely movement corridor';
    if (corridorMembers.length > 0 && hasAlignment) return 'Likely movement corridor';

    // Natural pinch: hydrology + slope break in close proximity (≤60m)
    const hydroMembers  = members.filter(m => m.sources.includes('hydrology'));
    const slopeMembers  = members.filter(m => m.sources.includes('slope'));
    const pinch = hydroMembers.some(h =>
        slopeMembers.some(s => getDistance(h.center, s.center) < 60),
    );
    if (pinch) return 'Likely movement corridor';

    // Close to any route (≤100m) and has LiDAR confirmation
    const hasLidar = members.some(m =>
        m.sources.includes('terrain') || m.sources.includes('terrain_global'),
    );
    if (hasLidar && routes.length > 0) {
        const center = members[0].center;
        const nearRoute = routes.some(r => getDistanceToLine(center, r.geometry, r.bbox) < 100);
        if (nearRoute) return 'Likely movement corridor';
    }

    return undefined;
}

// ─── 5. Terrain suitability ───────────────────────────────────────────────────
// Explanation-only. Combines slope and aspect — south-facing gentle slopes are
// the classic preferred location for settlement activity in the British uplands.

function terrainSuitabilityReading(members: Cluster[]): string | undefined {
    const isSouthFacing = members.some(m =>
        typeof m.aspect === 'number' && m.aspect >= 135 && m.aspect <= 225,
    );
    const hasGentleSlope = members.some(m => {
        if (!m.sources.includes('slope')) return false;
        const area = m.metrics?.area ?? 0;
        const ratio = m.metrics?.ratio ?? 0;
        return area > 60 && ratio < 4;
    });
    const isRaised = members.some(m => m.polarity === 'Raised');

    if (isSouthFacing && (hasGentleSlope || isRaised)) {
        return 'Favourable slope and aspect';
    }
    return undefined;
}

// ─── Combined entry point ─────────────────────────────────────────────────────

export function computeLandscapeReading(
    members: Cluster[],
    routes:  HistoricRoute[] = [],
): LandscapeReading {
    const micro    = microTopoScore(members);
    const margin   = dryMarginScore(members);
    const edge     = edgeReading(members);
    const movement = movementReading(members, routes);
    const terrain  = terrainSuitabilityReading(members);

    const rawScore = micro.score + margin.score;
    const score    = Math.min(6, rawScore);   // hard cap

    const reasons: string[] = [];
    if (micro.reason)  reasons.push(micro.reason);
    if (margin.reason) reasons.push(margin.reason);
    if (edge)          reasons.push(edge);
    if (movement)      reasons.push(movement);
    if (terrain)       reasons.push(terrain);

    return { score, reasons };
}
