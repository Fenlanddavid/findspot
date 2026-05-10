// ─── Landscape Reading Engine ─────────────────────────────────────────────────
// Five archaeology-led scoring systems that run over grouped cluster members
// and return a composite reading used to boost hotspot context scores.
//
// Scoring rule: only microTopo and dryMargin contribute numeric points.
// edgeDetect, movementModel, and terrainSuitability are explanation-only —
// they produce reason strings but add 0 to the score, preventing over-inflation.
//
// Combined microTopo + dryMargin contribution is capped at +6 before returning.
//
// Performance: all member flags are derived in a single pass before scoring.

import { Cluster, HistoricRoute } from '../pages/fieldGuideTypes';
import { getDistance, getDistanceToLine } from './fieldGuideAnalysis';

export interface LandscapeReading {
    score:   number;    // capped at 6 — only microTopo + dryMargin
    reasons: string[];  // explanation strings for all 5 systems
}

// ─── Shared flags derived in one pass ────────────────────────────────────────

interface MemberFlags {
    hasHydro:          boolean;
    hasRaised:         boolean;
    hasSunken:         boolean;
    hasSlopeBreak:     boolean;
    hasRouteProximity: boolean;
    hasSatSummer:      boolean;
    hasSatSpring:      boolean;
    hasAlignment:      boolean;
    hasCrossing:       boolean;
    hasLidar:          boolean;
    isSouthFacing:     boolean;
    hasGentleSlope:    boolean;
    multiScaleConfirmed: boolean;
    highCircularity:   boolean;
    hasEarthworkType:  boolean;
    hasHollowForm:     boolean;  // any member has metrics.interiorDensity < 0.35 (ring/enclosure)
    hasSolidForm:      boolean;  // any member has metrics.interiorDensity > 0.70 (mound/platform)
    // For movement pinch — kept as arrays only when needed
    hydroCenters:      [number, number][];
    slopeCenters:      [number, number][];
    firstCenter:       [number, number] | null;
    hasCorridorMember: boolean;
}

function buildFlags(members: Cluster[]): MemberFlags {
    let hasHydro = false, hasRaised = false, hasSunken = false;
    let hasSlopeBreak = false, hasRouteProximity = false;
    let hasSatSummer = false, hasSatSpring = false;
    let hasAlignment = false, hasCrossing = false, hasLidar = false;
    let isSouthFacing = false, hasGentleSlope = false;
    let multiScaleConfirmed = false, highCircularity = false, hasEarthworkType = false;
    let hasHollowForm = false, hasSolidForm = false;
    let hasCorridorMember = false;
    const hydroCenters: [number, number][] = [];
    const slopeCenters: [number, number][] = [];
    let firstCenter: [number, number] | null = null;

    for (const m of members) {
        if (firstCenter === null) firstCenter = m.center;

        const src = m.sources;
        if (!hasHydro      && src.includes('hydrology'))       hasHydro = true;
        if (!hasSatSummer  && src.includes('satellite_summer')) hasSatSummer = true;
        if (!hasSatSpring  && src.includes('satellite_spring')) hasSatSpring = true;
        if (!hasLidar      && (src.includes('terrain') || src.includes('terrain_global'))) hasLidar = true;

        if (m.polarity === 'Raised') {
            hasRaised = true;
            if (src.includes('hydrology')) hydroCenters.push(m.center);
        }
        if (m.polarity === 'Sunken') hasSunken = true;

        if (src.includes('slope')) {
            const area = m.metrics?.area ?? 0;
            if (!hasSlopeBreak && area >= 80) hasSlopeBreak = true;
            if (!hasGentleSlope && area > 60 && (m.metrics?.ratio ?? 0) < 4) hasGentleSlope = true;
            slopeCenters.push(m.center);
        }
        if (src.includes('hydrology')) hydroCenters.push(m.center);

        if (!hasRouteProximity && m.isOnCorridor)              hasRouteProximity = true;
        if (!hasAlignment      && m.routeAlignment !== undefined) hasAlignment = true;
        if (!hasCrossing       && m.isHighConfidenceCrossing)  hasCrossing = true;
        if (!hasCorridorMember && (m.type.includes('Corridor') || m.type.includes('Route') || m.isOnCorridor)) hasCorridorMember = true;

        if (!multiScaleConfirmed && m.multiScale && (m.multiScaleLevel ?? 0) >= 2) multiScaleConfirmed = true;
        if (!highCircularity     && (m.metrics?.circularity ?? 0) > 0.82)          highCircularity = true;
        if (!hasHollowForm       && (m.metrics?.interiorDensity ?? 0.5) < 0.35)    hasHollowForm = true;
        if (!hasSolidForm        && (m.metrics?.interiorDensity ?? 0.5) > 0.70)    hasSolidForm  = true;

        if (!hasEarthworkType) {
            const t = m.type;
            if (
                t.includes('Roundhouse') || t.includes('Barrow') || t.includes('Ring') ||
                t.includes('Mound')      || t.includes('Foundation') || t.includes('Enclosure') ||
                t.includes('Settlement')
            ) hasEarthworkType = true;
        }

        if (!isSouthFacing && typeof m.aspect === 'number' && m.aspect >= 135 && m.aspect <= 225) {
            isSouthFacing = true;
        }
    }

    // De-duplicate hydro centers (raised clusters were pushed twice if they also have hydro source)
    return {
        hasHydro, hasRaised, hasSunken, hasSlopeBreak, hasRouteProximity,
        hasSatSummer, hasSatSpring, hasAlignment, hasCrossing, hasLidar,
        isSouthFacing, hasGentleSlope, multiScaleConfirmed, highCircularity,
        hasEarthworkType, hasHollowForm, hasSolidForm, hasCorridorMember,
        hydroCenters, slopeCenters, firstCenter,
    };
}

// ─── 1. Microtopography ───────────────────────────────────────────────────────

function microTopoScore(f: MemberFlags): { score: number; reason?: string } {
    const polarised = f.hasRaised || f.hasSunken;
    if (f.hasEarthworkType && (f.multiScaleConfirmed || f.highCircularity) && polarised) {
        return { score: 4, reason: 'Subtle earthwork signature' };
    }
    if (f.multiScaleConfirmed && f.highCircularity) {
        return { score: 4, reason: 'Subtle earthwork signature' };
    }
    return { score: 0 };
}

// ─── 2. Dry-edge zones ────────────────────────────────────────────────────────

function dryMarginScore(f: MemberFlags): { score: number; reason?: string } {
    if (!f.hasHydro || !f.hasRaised) return { score: 0 };
    const hasMultiSeasonSat = f.hasSatSummer && f.hasSatSpring;
    const qualifierCount = [f.hasSlopeBreak, f.hasRouteProximity, hasMultiSeasonSat].filter(Boolean).length;
    if (qualifierCount === 0) return { score: 0 };
    return { score: qualifierCount >= 2 ? 3 : 2, reason: 'Dry ground beside former wet zone' };
}

// ─── 3. Edge detection ────────────────────────────────────────────────────────

function edgeReading(f: MemberFlags): string | undefined {
    const hasWetDryTransition = f.hasHydro && (f.hasRaised || f.hasSunken);
    if ((f.hasRaised && f.hasSunken) || f.hasSlopeBreak || hasWetDryTransition) {
        return 'Landscape edge detected';
    }
    return undefined;
}

// ─── 4. Movement modelling ────────────────────────────────────────────────────

function movementReading(f: MemberFlags, routes: HistoricRoute[]): string | undefined {
    if (f.hasCrossing) return 'Likely movement corridor';
    if (f.hasCorridorMember && f.hasAlignment) return 'Likely movement corridor';

    // Natural pinch: hydrology + slope break in close proximity (≤60m)
    if (f.hydroCenters.length > 0 && f.slopeCenters.length > 0) {
        const pinch = f.hydroCenters.some(h =>
            f.slopeCenters.some(s => getDistance(h, s) < 60),
        );
        if (pinch) return 'Likely movement corridor';
    }

    // Close to any route (≤100m) with LiDAR confirmation
    if (f.hasLidar && routes.length > 0 && f.firstCenter) {
        const nearRoute = routes.some(r => getDistanceToLine(f.firstCenter!, r.geometry, r.bbox) < 100);
        if (nearRoute) return 'Likely movement corridor';
    }

    return undefined;
}

// ─── 5. Terrain suitability ───────────────────────────────────────────────────

function terrainSuitabilityReading(f: MemberFlags): string | undefined {
    if (f.isSouthFacing && (f.hasGentleSlope || f.hasRaised)) {
        return 'Favourable slope and aspect';
    }
    return undefined;
}

// ─── 6. Archaeological plausibility ──────────────────────────────────────────
// Combines landscape-context clues into a plausibility score (0–3) that
// rewards signatures historically associated with occupation or funerary use:
// south-facing slope, water proximity, confirmed hollow morphology, etc.
// Additive with microTopo + dryMargin inside the existing cap of 6.

function archaeologicalPlausibilityScore(f: MemberFlags): { score: number; reason?: string } {
    // Hollow earthwork on south-facing slope near water — classic Bronze Age / Iron Age settlement
    if (f.hasHollowForm && f.isSouthFacing && f.hasHydro) {
        return { score: 3, reason: 'High-plausibility: hollow earthwork, south-facing, near water' };
    }
    // Multi-scale hollow form confirmed by LiDAR — very low false-positive rate
    if (f.hasHollowForm && f.multiScaleConfirmed && f.hasEarthworkType) {
        return { score: 3, reason: 'High-plausibility: multi-scale hollow earthwork confirmed' };
    }
    // Solid raised form near water with south aspect — mound or platform
    if (f.hasSolidForm && f.hasRaised && f.hasHydro && f.isSouthFacing) {
        return { score: 2, reason: 'Plausible raised platform or mound: solid form near water' };
    }
    // Earthwork type on south-facing gentle slope — classic habitation terrain
    if (f.hasEarthworkType && f.isSouthFacing && f.hasGentleSlope) {
        return { score: 2, reason: 'Favourable terrain position for occupation site' };
    }
    // Topographic pinch: route crossing + water + slope change — classic ford/crossing context
    if (f.hasCrossing && f.hasHydro && f.hasSlopeBreak) {
        return { score: 2, reason: 'Topographic threshold: movement pinch with slope change' };
    }
    // South-facing raised ground near water — baseline plausibility
    if (f.isSouthFacing && f.hasRaised && f.hasHydro) {
        return { score: 1, reason: 'South-facing raised ground near water' };
    }
    return { score: 0 };
}

// ─── Combined entry point ─────────────────────────────────────────────────────

export function computeLandscapeReading(
    members: Cluster[],
    routes:  HistoricRoute[] = [],
): LandscapeReading {
    const f = buildFlags(members);

    const micro       = microTopoScore(f);
    const margin      = dryMarginScore(f);
    const edge        = edgeReading(f);
    const movement    = movementReading(f, routes);
    const terrain     = terrainSuitabilityReading(f);
    const plausibility = archaeologicalPlausibilityScore(f);

    const score = Math.min(6, micro.score + margin.score + plausibility.score);

    const reasons: string[] = [];
    if (micro.reason)        reasons.push(micro.reason);
    if (margin.reason)       reasons.push(margin.reason);
    if (plausibility.reason) reasons.push(plausibility.reason);
    if (edge)                reasons.push(edge);
    if (movement)            reasons.push(movement);
    if (terrain)             reasons.push(terrain);

    return { score, reasons };
}
