// ─── Landscape Intelligence Engine ────────────────────────────────────────────
// Synthesis and classification layer — runs after final hotspot scoring.
// Operates entirely on existing scan outputs: no new API calls, no new datasets,
// no additional raster processing, no new scan stages.
//
// Pipeline position: after applyGeologyModifiers(), before UI render.
// Target overhead: <100ms per hotspot, <50ms for field summary.

import type {
    Cluster, Hotspot,
    LandscapeIntelligence, LandscapeSummary,
    CrossingType, LandformType, OccupationPotential,
    TransitionType, VisibilityContext, WetlandContext,
} from '../../pages/fieldGuideTypes';

// ─── Cluster signal flags ─────────────────────────────────────────────────────
// Derived in a single pass over hotspot member clusters.

interface SignalFlags {
    hasHydro:      boolean;
    hasRaised:     boolean;
    hasSunken:     boolean;
    hasRidge:      boolean;
    hasSlope:      boolean;
    hasMultiScale: boolean;
    bestDryMargin: number;   // highest metrics.dryMarginScore across members
    bestFlowConv:  number;   // highest metrics.flowConvergence across members
}

function buildSignalFlags(members: Cluster[]): SignalFlags {
    let hasHydro = false, hasRaised = false, hasSunken = false;
    let hasRidge = false, hasSlope = false, hasMultiScale = false;
    let bestDryMargin = 0, bestFlowConv = 0;

    for (const m of members) {
        if (!hasHydro      && m.sources.includes('hydrology'))   hasHydro = true;
        if (!hasRaised     && m.polarity === 'Raised')           hasRaised = true;
        if (!hasSunken     && m.polarity === 'Sunken')           hasSunken = true;
        if (!hasRidge      && m.relativeElevation === 'Ridge')   hasRidge = true;
        if (!hasSlope      && m.sources.includes('slope'))       hasSlope = true;
        if (!hasMultiScale && m.multiScale && (m.multiScaleLevel ?? 0) >= 2) hasMultiScale = true;
        const dms = m.metrics?.dryMarginScore ?? 0;
        if (dms > bestDryMargin) bestDryMargin = dms;
        const fcs = m.metrics?.flowConvergence ?? 0;
        if (fcs > bestFlowConv) bestFlowConv = fcs;
    }

    return { hasHydro, hasRaised, hasSunken, hasRidge, hasSlope, hasMultiScale, bestDryMargin, bestFlowConv };
}

// ─── Engine 1: Water Crossing ─────────────────────────────────────────────────
// Identifies likely movement bottlenecks around water using existing crossing
// flags, route assessments, and behaviour scores on the hotspot.

function classifyCrossingType(h: Hotspot, f: SignalFlags): CrossingType | null {
    if (h.isHighConfidenceCrossing) return 'Likely Crossing Point';
    if (h.classification === 'Junction / Convergence Zone') return 'Route-Water Convergence';
    if (h.isOnCorridor && f.hasHydro) return 'Route-Water Convergence';
    if (h.isOnCorridor && h.classification === 'Crossing Point Candidate') return 'Crossing Corridor';
    if (h.metrics.behaviour >= 12 && f.hasHydro && h.isOnCorridor) return 'Movement Bottleneck';
    return null;
}

// ─── Engine 2: Ridge & Spur ───────────────────────────────────────────────────
// Identifies archaeologically favourable landforms using polarity, elevation,
// dry margin scores, and flow convergence. Strong Fenland weighting.

function classifyLandform(f: SignalFlags): LandformType | null {
    // Highest specificity first — wetland landforms require strongest evidence
    if (f.hasHydro && f.hasRaised && f.bestDryMargin >= 0.70 && f.bestFlowConv >= 0.45) return 'Fen Edge Rise';
    if (f.hasHydro && f.hasRaised && f.bestDryMargin >= 0.55) return 'Dry Island';
    if (f.hasHydro && f.hasRaised && f.bestFlowConv >= 0.55) return 'Gravel Island';
    if (f.hasRidge && f.hasRaised) return 'Ridge End';
    if (f.hasRidge) return 'Ridge End';
    if (f.hasRaised && f.hasSlope && f.hasHydro) return 'Promontory';
    if (f.hasRaised && f.hasSlope) return 'Raised Spur';
    if (f.hasRaised && f.hasMultiScale) return 'Knoll';
    if (f.hasRaised) return 'Raised Spur';
    return null;
}

// ─── Engine 3: Occupation Potential ──────────────────────────────────────────
// Assesses suitability for repeated activity — NOT settlement prediction.
// Requires multi-signal convergence; visibility alone never qualifies.

function classifyOccupationPotential(h: Hotspot, f: SignalFlags): OccupationPotential | null {
    const waterScore  = f.hasHydro ? 1 : 0;
    const routeScore  = (h.isOnCorridor || h.isHighConfidenceCrossing) ? 1 : 0;
    const landScore   = (f.hasRaised || f.hasRidge) ? 1 : 0;
    const transScore  = (f.hasHydro && f.hasRaised) ? 1 : 0;
    const total       = waterScore + routeScore + landScore + transScore;

    if (h.score >= 70 && total >= 3) return 'Sustained Landscape Use Candidate';
    if (h.score >= 55 && total >= 2) return 'Strong Occupation Potential';
    if (total >= 2)                  return 'Occupation Potential Area';
    if (total >= 1 && h.score >= 40) return 'Possible Activity Focus';
    return null;
}

// ─── Engine 4: Landscape Transition ──────────────────────────────────────────
// Identifies environmental boundaries — one of the most archaeologically
// valuable components. Human activity frequently concentrates at edges.

function classifyTransition(h: Hotspot, f: SignalFlags): TransitionType | null {
    if (f.hasHydro && f.hasRaised && f.bestDryMargin >= 0.55)    return 'Wet-Dry Boundary';
    if (f.bestFlowConv >= 0.55 && f.hasHydro)                    return 'Floodplain Edge';
    if (f.hasHydro && f.hasSlope)                                 return 'Terrace Margin';
    if (f.hasHydro && (f.hasRaised || f.hasSunken))              return 'Environmental Transition Zone';
    // Geological boundary: inferred from structured explanation display text
    // when geology has modified this hotspot.
    const hasGeologySignal = h.explanation.some(e =>
        /geolog|bedrock|gravel deposit|alluvial|glacial/i.test(e.text),
    );
    if (hasGeologySignal) return 'Geological Boundary';
    return null;
}

// ─── Engine 5: Visibility Context ────────────────────────────────────────────
// Strategic landscape context only — visibility never drives occupation
// potential on its own; it is supporting evidence only.

function classifyVisibility(h: Hotspot, f: SignalFlags): VisibilityContext | null {
    if (f.hasRidge && h.isOnCorridor)              return 'Route Oversight Position';
    if (f.hasRidge && h.score >= 65)               return 'High Visibility Ground';
    if (f.hasRidge && f.hasSunken)                 return 'Valley Overlook';
    if (f.hasRaised && h.isOnCorridor && h.score >= 55) return 'Strategic Position';
    if (f.hasRidge)                                return 'Open Prospect';
    return null;
}

// ─── Wetland context (high confidence only) ───────────────────────────────────
// Only activates when strong hydrology + raised ground + transition are present.
// Should not appear in most scans.

function classifyWetlandContext(
    f: SignalFlags,
    landformType:   LandformType | null,
    transitionType: TransitionType | null,
    h: Hotspot,
): WetlandContext | null {
    if (!f.hasHydro || !f.hasRaised || !transitionType || !landformType) return null;
    if (h.confidence === 'Weak Signal') return null;

    if (h.isHighConfidenceCrossing) return 'Causeway Landscape';
    if (landformType === 'Gravel Island' || landformType === 'Dry Island') return 'Island-Wetland Interface';
    if (landformType === 'Fen Edge Rise') return 'Fen Edge Activity Zone';
    if (f.bestDryMargin >= 0.55 || f.bestFlowConv >= 0.55) return 'Wetland Margin';
    return null;
}

// ─── Engine 6: Landscape Story (per-hotspot) ─────────────────────────────────
// Converts technical signals into archaeological language. Maximum 2–4 sentences.
// Language rules: use may/suggests/could indicate/consistent with.
// Never: was/certainly/definitely.

function buildHotspotNarrative(
    crossingType:        CrossingType | null,
    landformType:        LandformType | null,
    occupationPotential: OccupationPotential | null,
    transitionType:      TransitionType | null,
    wetlandContext:      WetlandContext | null,
): string {
    const parts: string[] = [];

    // Wetland context overrides generic landform when present
    if (wetlandContext) {
        const WETLAND: Record<WetlandContext, string> = {
            'Wetland Margin':
                'This hotspot occupies a raised position at the wetland margin — a landscape setting consistent with repeated activity.',
            'Fen Edge Activity Zone':
                'This hotspot sits at the interface between fen and dry ground, a position frequently associated with movement and use in wetland landscapes.',
            'Island-Wetland Interface':
                'This hotspot occupies a raised island position within a wetter landscape, a setting that may have provided reliable dry access in an otherwise difficult environment.',
            'Causeway Landscape':
                'This hotspot occupies a raised position across probable wetland, consistent with a causeway or crossing landscape.',
        };
        parts.push(WETLAND[wetlandContext]);
    } else if (landformType) {
        const LANDFORM: Record<LandformType, string> = {
            'Dry Island':
                'This hotspot occupies a raised dry position within surrounding lower ground — a landform type consistent with repeated activity.',
            'Fen Edge Rise':
                'This hotspot sits along an edge where drier elevated ground meets wetter terrain, a boundary landscape with strong activity potential.',
            'Gravel Island':
                'The raised position suggests a gravel or terrace deposit — ground that may have remained dry and accessible above surrounding wetter terrain.',
            'Ridge End':
                'This hotspot occupies elevated ground consistent with a ridge end position, offering landscape oversight and favourable access.',
            'Raised Spur':
                'The spur position may have provided dry, accessible ground above surrounding terrain.',
            'Promontory':
                'This hotspot occupies a raised promontory overlooking surrounding ground — a position that could indicate strategic landscape use.',
            'Knoll':
                'The distinct raised form suggests a knoll position that may have attracted use as a visible landmark or activity focus.',
        };
        parts.push(LANDFORM[landformType]);
    }

    // Crossing / movement sentence
    if (crossingType) {
        const CROSSING: Record<CrossingType, string> = {
            'Likely Crossing Point':
                'The position is consistent with a likely crossing point where movement may have concentrated.',
            'Crossing Corridor':
                'The signals here suggest a probable movement corridor through the landscape.',
            'Route-Water Convergence':
                'The combination of route proximity and water context suggests this may have been a point where movement and water met.',
            'Movement Bottleneck':
                'Multiple movement signals converge here, suggesting this location may have acted as a landscape bottleneck.',
        };
        parts.push(CROSSING[crossingType]);
    }

    // Environmental transition (only when landform hasn't already covered it)
    if (transitionType && !wetlandContext && !landformType) {
        const TRANSITION: Record<TransitionType, string> = {
            'Wet-Dry Boundary':
                'This hotspot sits close to a transition between wetter and better-drained ground, a boundary frequently associated with activity.',
            'Floodplain Edge':
                'The position at the floodplain edge may have provided reliable access to water while remaining usable during periods of flooding.',
            'Terrace Margin':
                'The terrace margin position suggests this location may have marked the edge of productive dry ground above lower terrain.',
            'Fen Edge':
                'This hotspot sits at a probable fen edge, a landscape position consistent with movement and activity in wet environments.',
            'Geological Boundary':
                'The signals here could indicate a geological boundary influencing the landscape character and drainage of this area.',
            'Environmental Transition Zone':
                'This hotspot sits within an environmental transition zone where contrasting landscape conditions may have concentrated activity.',
        };
        parts.push(TRANSITION[transitionType]);
    }

    // Occupation potential closing sentence (only when space permits)
    if (occupationPotential && parts.length < 3) {
        const OCC: Record<OccupationPotential, string> = {
            'Possible Activity Focus':
                'The combination of signals suggests this area may have served as a focus for activity.',
            'Occupation Potential Area':
                'The convergence of landscape signals here is consistent with an area of occupation potential.',
            'Strong Occupation Potential':
                'The combination of access, terrain, and water context suggests a location that may have attracted repeated use over time.',
            'Sustained Landscape Use Candidate':
                'The strength and variety of signals here is consistent with a landscape that may have supported sustained use across time.',
        };
        parts.push(OCC[occupationPotential]);
    }

    return parts.length > 0
        ? parts.join(' ')
        : 'This location shows landscape signals consistent with potential past activity.';
}

// ─── Public: per-hotspot intelligence ────────────────────────────────────────

export function computeHotspotLandscapeIntelligence(
    h:       Hotspot,
    members: Cluster[],
): LandscapeIntelligence {
    const f                  = buildSignalFlags(members);
    const crossingType       = classifyCrossingType(h, f);
    const landformType       = classifyLandform(f);
    const occupationPotential = classifyOccupationPotential(h, f);
    const transitionType     = classifyTransition(h, f);
    const visibilityContext  = classifyVisibility(h, f);
    const wetlandContext     = classifyWetlandContext(f, landformType, transitionType, h);
    let narrative = buildHotspotNarrative(crossingType, landformType, occupationPotential, transitionType, wetlandContext);

    // Append PAS density sentence when the hotspot carries a PAS explanation.
    // Match the density language from hotspot scoring so the narrative does
    // not overstate moderate PAS density as numerous records.
    const explanations = h.explanation ?? [];
    const hasManyPAS   = explanations.some(e => e.tag === 'pas_density' && e.text.startsWith('Numerous PAS'));
    const hasSomePAS   = explanations.some(e => e.tag === 'pas_density' && e.text.startsWith('Moderate PAS'));
    const hasFewPAS    = explanations.some(e => e.tag === 'pas_density' && e.text.startsWith('Few PAS'));

    if (hasManyPAS) {
        narrative = narrative
            ? `${narrative} Numerous Portable Antiquities Scheme finds have been recorded within the wider landscape, broadly supporting this interpretation.`
            : 'Numerous Portable Antiquities Scheme finds have been recorded within the wider landscape, broadly supporting this interpretation.';
    } else if (hasSomePAS) {
        narrative = narrative
            ? `${narrative} A moderate density of Portable Antiquities Scheme finds has been recorded within the wider landscape, providing supporting context for this interpretation.`
            : 'A moderate density of Portable Antiquities Scheme finds has been recorded within the wider landscape, providing supporting context for this interpretation.';
    } else if (hasFewPAS) {
        narrative = narrative
            ? `${narrative} Few PAS records are present nearby, although this may reflect recording or detecting activity rather than archaeological absence.`
            : 'Few PAS records are present nearby, although this may reflect recording or detecting activity rather than archaeological absence.';
    }

    return { crossingType, landformType, occupationPotential, transitionType, visibilityContext, wetlandContext, narrative };
}

// ─── Per-target landscape narrative ──────────────────────────────────────────
// Targets are individual clusters. Computes a 2-sentence max landscape narrative
// from the cluster's own signals without referencing hotspot context.

export function computeTargetLandscapeNarrative(c: Cluster): string | null {
    const hasHydro    = c.sources.includes('hydrology');
    const hasRaised   = c.polarity === 'Raised';
    const hasRidge    = c.relativeElevation === 'Ridge';
    const hasSlope    = c.sources.includes('slope');
    const dryMargin   = c.metrics?.dryMarginScore ?? 0;
    const flowConv    = c.metrics?.flowConvergence ?? 0;
    const hasRoute    = c.isOnCorridor ?? false;
    const hasCrossing = c.isHighConfidenceCrossing ?? false;

    const parts: string[] = [];

    if (hasHydro && hasRaised && dryMargin >= 0.55) {
        parts.push('This target sits close to a transition between wetter ground and better-drained terrain.');
    } else if (hasRaised && hasRidge) {
        parts.push('This target occupies elevated ground that may have provided landscape oversight and favourable access conditions.');
    } else if (hasHydro && hasRaised) {
        parts.push('This target sits on raised ground close to a probable water context.');
    } else if (hasHydro && hasSlope) {
        parts.push('This target sits at a probable environmental boundary where slope and water context meet.');
    } else if (hasRaised) {
        parts.push('This target occupies slightly elevated ground within the surrounding landscape.');
    } else if (hasHydro) {
        parts.push('This target sits within a zone of hydrology influence.');
    }

    if (hasCrossing) {
        parts.push('The position is consistent with a likely crossing or movement focus.');
    } else if (hasRoute) {
        parts.push('Adjacent to a likely movement corridor, this location may have seen concentrated past activity.');
    } else if (hasHydro && hasRaised && flowConv >= 0.45) {
        parts.push('The position could indicate a dry island setting within a wetter landscape — a context frequently associated with landscape use.');
    }

    if (parts.length === 0) return null;
    return parts.slice(0, 2).join(' ');
}

// ─── Label converters (used by field summary bullets) ─────────────────────────

function crossingTypeToLabel(t: CrossingType): string {
    const MAP: Record<CrossingType, string> = {
        'Likely Crossing Point':   'Likely crossing corridor present',
        'Crossing Corridor':       'Probable movement corridor identified',
        'Route-Water Convergence': 'Route-water convergence detected',
        'Movement Bottleneck':     'Movement bottleneck identified',
    };
    return MAP[t];
}

function landformTypeToLabel(t: LandformType): string {
    const MAP: Record<LandformType, string> = {
        'Dry Island':    'Dry island landform',
        'Fen Edge Rise': 'Fen edge rise position',
        'Gravel Island': 'Gravel island deposit',
        'Ridge End':     'Ridge end position',
        'Raised Spur':   'Raised spur position',
        'Promontory':    'Promontory overlooking landscape',
        'Knoll':         'Distinct knoll position',
    };
    return MAP[t];
}

function occupationTypeToLabel(t: OccupationPotential): string {
    const MAP: Record<OccupationPotential, string> = {
        'Possible Activity Focus':           'Possible activity focus',
        'Occupation Potential Area':         'Occupation potential area',
        'Strong Occupation Potential':       'Strong occupation potential',
        'Sustained Landscape Use Candidate': 'Sustained landscape use candidate',
    };
    return MAP[t];
}

function transitionTypeToLabel(t: TransitionType): string {
    const MAP: Record<TransitionType, string> = {
        'Wet-Dry Boundary':              'Wet-dry transition present',
        'Floodplain Edge':               'Floodplain edge nearby',
        'Terrace Margin':                'Terrace margin identified',
        'Fen Edge':                      'Fen edge detected',
        'Geological Boundary':           'Geological boundary detected',
        'Environmental Transition Zone': 'Environmental transition zone',
    };
    return MAP[t];
}

function visibilityTypeToLabel(t: VisibilityContext): string {
    const MAP: Record<VisibilityContext, string> = {
        'High Visibility Ground':   'High visibility ground',
        'Valley Overlook':          'Valley overlook position',
        'Route Oversight Position': 'Route oversight position',
        'Strategic Position':       'Strategic landscape position',
        'Open Prospect':            'Open prospect',
    };
    return MAP[t];
}

function wetlandTypeToLabel(t: WetlandContext): string {
    const MAP: Record<WetlandContext, string> = {
        'Wetland Margin':           'Wetland margin context',
        'Fen Edge Activity Zone':   'Fen edge activity zone',
        'Island-Wetland Interface': 'Island-wetland interface',
        'Causeway Landscape':       'Probable causeway landscape',
    };
    return MAP[t];
}

// ─── Field-level narrative builder ────────────────────────────────────────────
// Priority order: Landform > Transition > Movement > Occupation > Visibility

function buildFieldNarrative(
    topLandform:    LandformType | undefined,
    topTransition:  TransitionType | undefined,
    topCrossing:    CrossingType | undefined,
    topOccupation:  OccupationPotential | undefined,
    topVisibility:  VisibilityContext | undefined,
    topWetland:     WetlandContext | undefined,
    hotspotCount:   number,
): string {
    const plural = hotspotCount === 1 ? 'A hotspot' : 'Several hotspots';

    if (topLandform) {
        const LEAD: Record<LandformType, string> = {
            'Dry Island':    `This field appears focused around a raised dry island within a wetter landscape. ${plural} occur close to the boundary between drier elevated ground and lower surrounding terrain.`,
            'Fen Edge Rise': `This field appears centred on a fen edge position where contrasting landscape conditions meet. ${plural} cluster along the boundary where dry ground meets wetter terrain.`,
            'Gravel Island': `This field appears focused around a probable gravel or terrace deposit — ground that may have remained accessible above wetter surroundings. ${plural} occur on or close to this raised position.`,
            'Ridge End':     `This field appears centred on elevated ridge-end ground offering landscape oversight and favourable access. ${plural} cluster on or around the elevated position.`,
            'Raised Spur':   `This field contains a raised spur position that may have provided dry, accessible ground above the surrounding area. ${plural} occur on or close to this elevated ground.`,
            'Promontory':    `This field appears influenced by a promontory position overlooking surrounding terrain. ${plural} cluster around the elevated ground.`,
            'Knoll':         `This field contains a distinct raised knoll position that may have attracted use as a landscape focus. ${plural} occur on or close to this position.`,
        };
        let narrative = LEAD[topLandform];
        if (topWetland) {
            narrative += ` The wider landscape context suggests ${topWetland.toLowerCase()} conditions that may have concentrated movement and activity.`;
        } else if (topTransition) {
            narrative += ` A ${topTransition.toLowerCase()} is also present within the scan area.`;
        }
        return narrative;
    }

    if (topTransition) {
        const TRANS: Record<TransitionType, string> = {
            'Wet-Dry Boundary':              `This field appears centred on an environmental boundary where wetter and better-drained ground meet — a landscape position frequently associated with activity. ${plural} occur close to this transition.`,
            'Floodplain Edge':               `This field appears positioned along a floodplain edge, providing access to water while retaining higher, drier ground. ${plural} occur at or close to this edge.`,
            'Terrace Margin':                `This field appears centred on a terrace margin position where the character of the landscape changes. ${plural} occur at or close to this boundary.`,
            'Fen Edge':                      `This field appears centred on an environmental boundary where contrasting landscape conditions meet. ${plural} cluster near this transition.`,
            'Geological Boundary':           `This field appears influenced by a geological boundary that may have shaped drainage and access conditions. ${plural} occur within this transitional zone.`,
            'Environmental Transition Zone': `This field contains an environmental transition zone where contrasting landscape conditions may have concentrated activity. ${plural} cluster close to this boundary.`,
        };
        return TRANS[topTransition];
    }

    if (topCrossing) {
        const CROSS: Record<CrossingType, string> = {
            'Likely Crossing Point':   `This field appears influenced by a probable crossing point where movement may have concentrated. ${plural} occur close to this convergence.`,
            'Crossing Corridor':       `This field appears influenced by a probable movement corridor through the landscape. ${plural} follow this corridor line.`,
            'Route-Water Convergence': `This field appears influenced by the meeting of a probable movement corridor and water context. ${plural} occur close to this convergence.`,
            'Movement Bottleneck':     `This field appears focused around a movement bottleneck where multiple signals converge in a constrained landscape position. ${plural} cluster at this convergence.`,
        };
        return CROSS[topCrossing];
    }

    if (topOccupation) {
        return `This field shows multiple converging signals consistent with ${topOccupation.toLowerCase()}. ${plural} occur across the scan area with supporting landscape context.`;
    }

    if (topVisibility) {
        return `This field contains elevated positions offering strong landscape visibility. ${plural} occur on or close to this elevated ground.`;
    }

    return `This field shows landscape signals worth reviewing. ${plural} have been identified within the scan area.`;
}

// ─── Public: field-level summary ─────────────────────────────────────────────
// Aggregates intelligence across all hotspots and produces a whole-field narrative
// plus three conditional bullet groups. Sections appear only when signals exist.
// Bullet count rule: 0 signals → section hidden; 1 → max 1 bullet; 2 → max 2; 3+ → max 3.

export function computeLandscapeSummary(
    hotspots:       Hotspot[],
    intelligenceMap: Map<string, LandscapeIntelligence>,
): LandscapeSummary {
    if (hotspots.length === 0) {
        return { fieldNarrative: '', movementSummary: [], occupationSummary: [], environmentSummary: [], wetlandSummary: [] };
    }

    // Aggregate signal counts
    const landformCounts    = new Map<LandformType,    number>();
    const transitionCounts  = new Map<TransitionType,  number>();
    const crossingCounts    = new Map<CrossingType,    number>();
    const occupationCounts  = new Map<OccupationPotential, number>();
    const visibilityCounts  = new Map<VisibilityContext, number>();
    const wetlandCounts     = new Map<WetlandContext,  number>();

    for (const h of hotspots) {
        const li = intelligenceMap.get(h.id);
        if (!li) continue;
        if (li.landformType)        landformCounts.set(li.landformType,       (landformCounts.get(li.landformType)       ?? 0) + 1);
        if (li.transitionType)      transitionCounts.set(li.transitionType,   (transitionCounts.get(li.transitionType)   ?? 0) + 1);
        if (li.crossingType)        crossingCounts.set(li.crossingType,       (crossingCounts.get(li.crossingType)       ?? 0) + 1);
        if (li.occupationPotential) occupationCounts.set(li.occupationPotential, (occupationCounts.get(li.occupationPotential) ?? 0) + 1);
        if (li.visibilityContext)   visibilityCounts.set(li.visibilityContext, (visibilityCounts.get(li.visibilityContext) ?? 0) + 1);
        if (li.wetlandContext)      wetlandCounts.set(li.wetlandContext,       (wetlandCounts.get(li.wetlandContext)      ?? 0) + 1);
    }

    const sortedKeys = <K>(m: Map<K, number>): K[] =>
        [...m.entries()]
            .sort((a, b) => (b[1] - a[1]) || String(a[0]).localeCompare(String(b[0])))
            .map(([key]) => key);

    const top = <K>(m: Map<K, number>): K | undefined => sortedKeys(m)[0];

    const topLandform   = top(landformCounts);
    const topTransition = top(transitionCounts);
    const topCrossing   = top(crossingCounts);
    const topOccupation = top(occupationCounts);
    const topVisibility = top(visibilityCounts);
    const topWetland    = top(wetlandCounts);

    const fieldNarrative = buildFieldNarrative(
        topLandform, topTransition, topCrossing,
        topOccupation, topVisibility, topWetland, hotspots.length,
    );

    // Movement & Access bullets (max 3, scaled by signal count)
    const movementSummary: string[] = [];
    const crossingKeys = sortedKeys(crossingCounts);
    const visibilityKeys = sortedKeys(visibilityCounts);
    const movementSignalCount = crossingKeys.length + visibilityKeys.length;
    const movementMax = Math.min(3, movementSignalCount);
    for (const k of crossingKeys.slice(0, movementMax)) movementSummary.push(crossingTypeToLabel(k));
    for (const k of visibilityKeys) {
        if (movementSummary.length >= movementMax) break;
        movementSummary.push(visibilityTypeToLabel(k));
    }

    // Landform & Occupation bullets (max 3)
    const occupationSummary: string[] = [];
    const landformKeys   = sortedKeys(landformCounts);
    const occupationKeys = sortedKeys(occupationCounts);
    const occupationSignalCount = landformKeys.length + occupationKeys.length;
    const occupationMax = Math.min(3, occupationSignalCount);
    for (const k of landformKeys.slice(0, occupationMax)) occupationSummary.push(landformTypeToLabel(k));
    for (const k of occupationKeys) {
        if (occupationSummary.length >= occupationMax) break;
        occupationSummary.push(occupationTypeToLabel(k));
    }

    // Environmental Context bullets (max 3)
    const environmentSummary: string[] = [];
    const transitionKeys = sortedKeys(transitionCounts);
    const envMax = Math.min(3, transitionKeys.length);
    for (const k of transitionKeys.slice(0, envMax)) environmentSummary.push(transitionTypeToLabel(k));

    // Wetland bullets (max 1 — rare, high-confidence only)
    const wetlandSummary: string[] = [];
    if (topWetland) wetlandSummary.push(wetlandTypeToLabel(topWetland));

    return { fieldNarrative, movementSummary, occupationSummary, environmentSummary, wetlandSummary };
}
