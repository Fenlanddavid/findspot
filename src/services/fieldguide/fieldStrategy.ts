import type { HistoricRoute, Hotspot, SoilMechanicsClass } from '../../pages/fieldGuideTypes';
import type { PrimaryProcessId, PrimaryProcessScore } from '../../types/landscapeInterpretation';

export interface BehaviourPriority {
    processId: PrimaryProcessId;
    label: string;
    stars: string;
    emphasis: 'Primary' | 'Strong' | 'Secondary' | 'Background';
    representedBy: string | null;
    representativeHotspotId: string | null;
    reason: string;
}
export interface SearchStep {
    rank: number;
    hotspotId: string;
    title: string;
    stars: string;
    behaviour: PrimaryProcessId | null;
    technique: string;
    approach: string;
    focus: string;
    reasoning: string[];
    caution?: string;
}
export interface AvoidZone {
    hotspotId: string;
    title: string;
    reason: string;
}
export interface FieldStrategy {
    hasPlan: boolean;
    behaviours: BehaviourPriority[];
    leadLine: string | null;
    searchOrder: SearchStep[];
    avoidZones: AvoidZone[];
    landscapeNote: string | null;
    uncertaintyReasons: string[];
    confidenceLabel: 'Very High' | 'High' | 'Moderate' | 'Lower';
    confidenceReason: string;
    surveyorNote: string | null;
}

export interface FieldStrategyContext {
    historicRoutes?: HistoricRoute[];
    pasFindPeriods?: string[];
    potentialBreakdown?: { terrain: number; hydro: number; historic: number; signals: number } | null;
}

const PROCESS_LABELS: Record<PrimaryProcessId, string> = {
    occupation_potential: 'Occupation',
    movement: 'Movement',
    resource_exploitation: 'Resources',
    water_relationships: 'Water',
    landscape_prominence: 'Prominence',
    boundary_relationships: 'Boundaries',
};

// classification → representative behaviour (unmapped = null, intentionally)
const CLASS_TO_PROCESS: Partial<Record<string, PrimaryProcessId>> = {
    'Crossing Point Candidate':          'movement',
    'Junction / Convergence Zone':       'movement',
    'Route-Side Activity Zone':          'movement',
    'Route-Influenced Area':             'movement',
    'Settlement Edge Candidate':         'occupation_potential',
    'Multi-Period Occupation Zone':      'occupation_potential',
    'Raised Activity Area':              'occupation_potential',
    'Palaeochannel Activity Zone':       'water_relationships',
    'Wetland Margin Activity Zone':      'water_relationships',
    'Burial / Barrow Candidate':         'landscape_prominence',
    'Terrain Structure Candidate':       'landscape_prominence',
    'Organised Field System Candidate':  'boundary_relationships',
};

const TECHNIQUE: Record<string, string> = {
    'Crossing Point Candidate':           'Cross-search the convergence from two directions; work outward from the crossing.',
    'Junction / Convergence Zone':        'Cross-search from opposite directions; investigate the junction before expanding.',
    'Settlement Edge Candidate':          'Slow overlapping grid; check the edge transition between zones.',
    'Burial / Barrow Candidate':          'Work contour lines around any rise; wider spacing first, then tighten on concentrations.',
    'Organised Field System Candidate':   'Long parallel transects following the field alignment.',
    'Palaeochannel Activity Zone':        'Search the dry margins first; material in wet ground may sit deeper.',
    'Wetland Margin Activity Zone':       'Work the wet–dry boundary; prioritise slight rises along the margin.',
    'Route-Side Activity Zone':           'Walk parallel to the route corridor; check breaks of slope along it.',
    'Route-Influenced Area':              'Walk parallel to the route; investigate where it meets rising ground.',
    'Multi-Period Occupation Zone':       'Tight overlapping grid; investigate concentrations before expanding.',
    'Multi-Signal Activity Zone':         'Tight overlapping grid; cross-search from a second direction.',
    'Terrain Structure Candidate':        'Focus on the crest and break of slope; work the contour.',
    'Raised Activity Area':               'Concentrate on the raised ground; sweep the slope below as well.',
    'Spectral Activity Candidate':        'Grid the marked extent slowly; cross-search from the opposite direction.',
    'Cropmark Activity Zone':             'Grid the cropmark extent methodically; tighten on responses.',
    'Lowland Activity Zone':              'Systematic grid; prioritise any slight rises within the zone.',
    'General Activity Zone':              'Systematic grid; prioritise slight rises and any edge transitions.',
};
const TECHNIQUE_DEFAULT = 'Systematic grid; prioritise slight rises and edge transitions.';

const APPROACH: Record<SoilMechanicsClass, string> = {
    colluvial_accumulation:   'Downslope catchment — material here may be displaced; also check the source ground upslope.',
    wet_margin_preservation:  'Good preservation but finds may be deeper — go slow and recover signals fully.',
    hilltop_source_zone:      'Likely primary activity — also sweep the slope below for moved material.',
    stable_plateau:           'Undisturbed ground — artefacts likely in-situ; a methodical grid pays off.',
    disturbed_plough_slope:   'Ploughed/disturbed — material may have shifted downslope; treat scatters cautiously.',
};

const DISPLACEMENT: Record<SoilMechanicsClass, string> = {
    disturbed_plough_slope:   'plough movement',
    colluvial_accumulation:   'hillwash and downslope movement',
    wet_margin_preservation:  'flooding or waterlogging',
    hilltop_source_zone:      'later disturbance',
    stable_plateau:           'later disturbance',
};

const STARS_BY_CONF: Record<Hotspot['confidence'], string> = {
    'Strongest Signal':   '★★★★★',
    'Strong Signal':      '★★★★☆',
    'Developing Signal':  '★★★☆☆',
    'Weak Signal':        '★★☆☆☆',
};
const CONF_RANK: Record<Hotspot['confidence'], number> = {
    'Strongest Signal':   4,
    'Strong Signal':      3,
    'Developing Signal':  2,
    'Weak Signal':        1,
};

const bandStars = (r: number) =>
    r >= 0.85 ? '★★★★★' : r >= 0.55 ? '★★★★☆' : r >= 0.30 ? '★★★☆☆' : '★★☆☆☆';
const bandEmph = (r: number): BehaviourPriority['emphasis'] =>
    r >= 0.85 ? 'Primary' : r >= 0.55 ? 'Strong' : r >= 0.30 ? 'Secondary' : 'Background';

function priority(h: Hotspot): number {
    const conf = CONF_RANK[h.confidence] ?? 1;
    const dist = h.disturbanceRisk === 'High' ? 20 : h.disturbanceRisk === 'Medium' ? 8 : 0;
    return conf * 100 + (h.score ?? 0) + (h.metrics?.convergence ?? 0) * 10
        + (h.isHighConfidenceCrossing ? 15 : 0) + (h.isOnCorridor ? 8 : 0) - dist;
}

function isAvoid(h: Hotspot): boolean {
    const low = (CONF_RANK[h.confidence] ?? 1) <= 2;
    return low && (h.disturbanceRisk === 'High' || h.soilMechanics?.interpretationClass === 'disturbed_plough_slope');
}

export function buildFieldStrategy(
    hotspots: Hotspot[],
    processScores: PrimaryProcessScore[],
    context: FieldStrategyContext = {},
): FieldStrategy {
    const base: FieldStrategy = {
        hasPlan: false, behaviours: [], leadLine: null, searchOrder: [],
        avoidZones: [], landscapeNote: null, uncertaintyReasons: [],
        confidenceLabel: 'Lower', confidenceReason: '', surveyorNote: null,
    };

    const romanRoutes = context.historicRoutes?.filter(r => r.type === 'roman_road') ?? [];
    const medievalFinds = (context.pasFindPeriods ?? []).filter(p => /medieval/i.test(p)).length;
    const historicScore = context.potentialBreakdown?.historic ?? 0;
    const terrainScore = context.potentialBreakdown?.terrain ?? 0;
    const spectralScore = context.potentialBreakdown?.signals ?? 0;
    const alignedSignalCount = [historicScore, terrainScore, spectralScore].filter(v => v >= 50).length;
    const hasRouteContext = romanRoutes.length > 0 || (context.historicRoutes?.length ?? 0) > 0;
    const hasStrongHistoricContext = hasRouteContext || medievalFinds > 0 || alignedSignalCount >= 2 || historicScore >= 50;

    if (!hotspots?.length && !hasStrongHistoricContext) {
        return {
            ...base,
            landscapeNote: 'Limited archaeological convergence detected in this scan.',
            uncertaintyReasons: [
                'genuinely low archaeological activity',
                'later landscape disturbance',
                'agricultural truncation',
                'limitations within currently available datasets',
            ],
        };
    }

    const ranked = [...(processScores ?? [])]
        .filter(p => (p.finalScore ?? 0) > 0)
        .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));
    const topScore = ranked[0]?.finalScore ?? 0;

    const plan = hotspots
        .filter(h => !isAvoid(h))
        .sort((a, b) =>
            priority(b) - priority(a) || (b.score ?? 0) - (a.score ?? 0) || a.id.localeCompare(b.id),
        );

    const repFor = (pid: PrimaryProcessId) =>
        plan.find(h => CLASS_TO_PROCESS[h.classification] === pid) ?? null;

    const behaviours = ranked.map(p => {
        const ratio = topScore > 0 ? (p.finalScore ?? 0) / topScore : 0;
        const rep = repFor(p.processId);
        return {
            processId: p.processId,
            label: PROCESS_LABELS[p.processId] ?? p.processId,
            stars: bandStars(ratio),
            emphasis: bandEmph(ratio),
            representedBy: rep ? rep.type : null,
            representativeHotspotId: rep ? rep.id : null,
            reason: rep
                ? 'Multiple independent datasets express this behaviour most clearly here.'
                : 'Indicated by the landscape signal, without a single dominant zone.',
        };
    });

    const hotspotSteps = plan.map((h, i) => {
        const soil = h.soilMechanics?.interpretationClass;
        return {
            rank: i + 1,
            hotspotId: h.id,
            title: h.type,
            stars: STARS_BY_CONF[h.confidence] ?? STARS_BY_CONF['Weak Signal'],
            behaviour: CLASS_TO_PROCESS[h.classification] ?? null,
            technique: TECHNIQUE[h.classification] ?? TECHNIQUE_DEFAULT,
            approach: soil ? APPROACH[soil] : '',
            focus: h.suggestedFocus || h.classificationReason || '',
            reasoning: (h.explanation ?? []).slice(0, 4).map(item => item.text),
            caution: h.disturbanceRisk === 'High'
                ? 'Higher-priority but disturbed ground — material may be displaced.'
                : undefined,
        };
    });

    const hasRouteHotspot = hotspotSteps.some(s =>
        s.behaviour === 'movement' || /route|corridor|crossing|junction/i.test(s.title),
    );

    const contextSteps: SearchStep[] = [];
    if (hasRouteContext && !hasRouteHotspot) {
        const roman = romanRoutes.length > 0;
        contextSteps.push({
            rank: 1,
            hotspotId: roman ? 'historic-route-context-roman' : 'historic-route-context',
            title: roman ? 'Roman road corridor' : 'Historic route corridor',
            stars: roman ? '★★★★☆' : '★★★☆☆',
            behaviour: 'movement',
            technique: roman
                ? 'Walk parallel to the road corridor; prioritise the edge zone, slope breaks and any crossing points rather than the road line itself.'
                : 'Walk parallel to the route corridor; check bends, junctions, slope breaks and field-edge transitions first.',
            approach: medievalFinds > 0
                ? 'Medieval finds nearby strengthen the case for repeated activity along this corridor.'
                : '',
            focus: roman
                ? `${romanRoutes.length} Roman road alignment${romanRoutes.length !== 1 ? 's' : ''} returned in this scan context.`
                : `${context.historicRoutes?.length ?? 0} historic route${(context.historicRoutes?.length ?? 0) !== 1 ? 's' : ''} returned in this scan context.`,
            reasoning: [
                roman ? 'Roman road evidence is a strong movement signal.' : 'Historic route evidence is a movement signal.',
                ...(medievalFinds > 0 ? [`${medievalFinds} medieval-period PAS signal${medievalFinds !== 1 ? 's' : ''} nearby.`] : []),
                ...(alignedSignalCount >= 2 ? [`${alignedSignalCount} broad historic landscape signals align.`] : []),
            ],
        });
    } else if (hotspotSteps.length === 0 && hasStrongHistoricContext) {
        contextSteps.push({
            rank: 1,
            hotspotId: 'historic-context-review',
            title: medievalFinds > 0 ? 'Medieval activity context' : 'Historic activity context',
            stars: alignedSignalCount >= 2 ? '★★★☆☆' : '★★☆☆☆',
            behaviour: null,
            technique: 'Use a broad systematic grid; prioritise slight rises, field edges and any visible route or water transitions.',
            approach: 'No strong target hotspot was isolated, so treat this as a context-led sweep rather than a pin-point target.',
            focus: medievalFinds > 0
                ? `${medievalFinds} medieval-period PAS signal${medievalFinds !== 1 ? 's' : ''} nearby.`
                : 'Historic context is present but not concentrated into one clear hotspot.',
            reasoning: [
                ...(alignedSignalCount >= 2 ? [`${alignedSignalCount} broad historic landscape signals align.`] : []),
                ...(historicScore >= 50 ? ['Historic density is elevated in the scan context.'] : []),
            ],
        });
    }

    const searchOrder = [...contextSteps, ...hotspotSteps].map((step, i) => ({ ...step, rank: i + 1 }));

    const avoidZones = hotspots.filter(isAvoid).map(h => {
        const soil = h.soilMechanics?.interpretationClass;
        const cause = soil ? DISPLACEMENT[soil] : 'later agricultural disturbance';
        return {
            hotspotId: h.id,
            title: h.type,
            reason: `Current evidence suggests this ground is less likely to represent primary activity. `
                + `Any material here may reflect ${cause} rather than in-situ deposition.`,
        };
    });

    const hasContextLead = searchOrder[0]?.hotspotId.startsWith('historic-route-context') ||
        searchOrder[0]?.hotspotId === 'historic-context-review';
    const top = plan[0] ?? hotspots[0] ?? null;
    const classes = top?.metrics?.signalClassCount ?? 0;
    const topRank = top ? (CONF_RANK[top.confidence] ?? 1) : 1;
    const confidenceLabel: FieldStrategy['confidenceLabel'] =
        searchOrder[0]?.hotspotId.startsWith('historic-route-context') && romanRoutes.length > 0 ? 'High'
        : searchOrder[0]?.hotspotId === 'historic-context-review' && alignedSignalCount >= 2 ? 'Moderate'
        :
        topRank >= 4 && classes >= 3 ? 'Very High'
        : topRank >= 3 ? 'High'
        : topRank >= 2 ? 'Moderate'
        : 'Lower';
    const confidenceReason = searchOrder[0]?.hotspotId.startsWith('historic-route-context')
        ? romanRoutes.length > 0
            ? 'Roman road evidence and wider historic context support this search priority.'
            : 'Historic route evidence supports this search priority.'
        : searchOrder[0]?.hotspotId === 'historic-context-review'
            ? 'Historic context is present, but no single target hotspot is dominant.'
        : classes >= 3
        ? `${classes} independent signal classes converge on the leading interpretation.`
        : 'Based on a narrower set of converging signals — corroborate in the field.';

    const maxConv = hotspots.length
        ? Math.max(...hotspots.map(h => h.metrics?.convergence ?? 0))
        : (hasStrongHistoricContext ? 2 : 0);
    const allLow  = hotspots.length > 0 && hotspots.every(h => (CONF_RANK[h.confidence] ?? 1) <= 2);
    const lowConf = confidenceLabel === 'Lower' || confidenceLabel === 'Moderate' || maxConv < 2 || allLow;

    const landscapeNote = searchOrder.length === 0
        ? 'All identified ground is disturbed or low-confidence; expect displaced material rather than primary deposition.'
        : hasContextLead ? null
        : maxConv < 2 ? 'Convergence across datasets is weak — treat these interpretations as tentative.'
        : allLow ? 'No strong occupation signal; interpretations reflect possible rather than sustained activity.'
        : null;

    const uncertaintyReasons = lowConf ? [
        'genuinely low archaeological activity',
        'later landscape disturbance',
        'agricultural truncation',
        'limitations within currently available datasets',
    ] : [];

    const leadLine = searchOrder.length
        ? `Available evidence points first to the ${searchOrder[0].title.toLowerCase()}.`
        : null;

    const b0 = behaviours[0];
    const b1 = behaviours[1];
    const surveyorNote = (searchOrder.length && b0) ? (() => {
        const lead = b0.representedBy
            ? b0.representedBy.toLowerCase()
            : `${b0.label.toLowerCase()} evidence`;
        let s = `A practical first pass would concentrate on the ${lead}, where the landscape signal is strongest`;
        if (b1) {
            const n = b1.representedBy
                ? b1.representedBy.toLowerCase()
                : `${b1.label.toLowerCase()} evidence`;
            if (n !== lead) s += `, before turning to the ${n}`;
        }
        s += '. ';
        if (avoidZones.length) s += 'Treat disturbed, lower-priority ground as secondary. ';
        s += 'Reassess the evidence before continuing.';
        return s;
    })() : null;

    return {
        hasPlan: searchOrder.length > 0,
        behaviours,
        leadLine,
        searchOrder,
        avoidZones,
        landscapeNote,
        uncertaintyReasons,
        confidenceLabel,
        confidenceReason,
        surveyorNote,
    };
}
