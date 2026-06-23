// ─── Shared types & constants for the Field Guide feature ───────────────────

export interface Cluster {
    id: string; points: {x: number, y: number}[];
    minX: number; maxX: number; minY: number; maxY: number;
    type: string; score: number; number: number;
    isProtected: boolean;
    monumentName?: string;
    monumentBufferM?: number;
    aimInfo?: { type: string; period: string; evidence: string };
    confidence: 'High' | 'Medium' | 'Subtle';
    findPotential: number;
    center: [number, number];
    source: 'terrain' | 'satellite' | 'historic' | 'terrain_global' | 'slope' | 'hydrology' | 'satellite_spring' | 'satellite_summer';
    sources: ('terrain' | 'satellite' | 'historic' | 'terrain_global' | 'slope' | 'hydrology' | 'satellite_spring' | 'satellite_summer')[];
    polarity?: 'Raised' | 'Sunken' | 'Unknown';
    bearing?: number;
    contextLabel?: string;
    scaleTier?: 'Micro' | 'Structural' | 'Enclosure' | 'Landscape';
    persistenceScore?: number;
    rescanCount?: number;
    disturbanceRisk?: 'Low' | 'Medium' | 'High';
    disturbanceReason?: string;
    aspect?: number;
    relativeElevation?: 'Ridge' | 'Hollow' | 'Slope' | 'Flat';
    metrics?: {
        circularity: number;
        density: number;
        ratio: number;
        area: number;
        ridgeStrength?: number;
        dirConsistency?: number;
        interiorDensity?: number;
        // Terrain-derived hydrology heuristics (terrain-hydro-v1)
        dryMarginScore?: number;          // 0–1: raised usable ground beside local wet/low terrain
        flowConvergence?: number;         // 0–1: local D8-derived terrain convergence tendency
        hydrologicalContext?: number;     // 0–1: composite of dryMargin + flowConvergence
        hydrologyHeuristicVersion?: string;
        hydrologyUsed?: boolean;
        hydrologyIgnoredReason?: string;
    };
    multiScale?: boolean;
    multiScaleLevel?: number;
    explanationLines?: string[];
    isHighConfidenceCrossing?: boolean;
    role?: string;
    routeAlignment?: number;
    isOnCorridor?: boolean;
    linkedClusterIds?: string[];
    scale?: 'Micro' | 'Local' | 'Landscape';
    // Set when a target centroid or linear form aligns too closely with a modern road,
    // track, or path. Derived from routeAssessment.hideFromDefaultView; suppressed
    // from target display but may still inform hotspots when independently corroborated.
    isRouteArtefactRisk?: boolean;
    routeArtefactReason?: string;
    // Full route interpretation — single source of truth for all route-related logic.
    // Attached by applyRouteAssessments() after AIM/NHLE/context enrichment, before
    // hotspot and trace systems consume it.
    routeAssessment?: RouteAssessment;
    // Suppression audit trail — populated by each suppression function.
    // Gives the Engine Lab visibility into why each cluster was rejected.
    suppressedBy?: string[];
    // Signal strength decomposition for confidence transparency.
    signalBreakdown?: { terrain: number; hydrology: number; spectral: number; disturbance: number; };
    // Measured terrain values emitted by terrainScanWorker (vNext-P1).
    // Derived from the same normalised DEM used for aspect/relativeElevation —
    // NOT absolute metres. relativeReliefNorm is signed (raised +, sunken −).
    slopeGradient?:      number;  // 0–1 local gradient magnitude
    relativeReliefNorm?: number;  // centre value minus ring mean (normalised DEM units)
    // Relationship annotation set by analyzeContext relationship pass.
    relationshipTag?: string;
}

// A modern mapped way (road, track, path) from OSM — used only for target
// artefact suppression; never displayed or scored archaeologically.
export interface ModernWay {
    geometry: [number, number][];
    bbox:     [[number, number], [number, number]];
    highwayTag: string;
}

// ─── Route relationship classification ───────────────────────────────────────
// Produced by assessRouteRelationship() and attached to each enriched cluster.
// All downstream systems (hotspot engine, trace engine, display filter) read
// from this object — there is no independent route logic elsewhere.

export type RouteRelationship =
    | 'modern_route_artefact'          // likely caused by modern road/track infrastructure
    | 'possible_modern_route_noise'    // close to a route, some archaeological potential but contaminated
    | 'route_edge_activity_candidate'  // offset from route, possibly meaningful route-edge archaeology
    | 'historic_movement_candidate'    // supported by AIM/historic evidence — older movement corridor
    | 'not_route_related';             // not meaningfully associated with any nearby modern way

export interface RouteAssessment {
    relationship:            RouteRelationship;
    risk:                    number;   // computed risk score (higher = more likely modern artefact)
    confidence:              number;   // 0–1, derived from risk
    nearestWay?:             ModernWay;
    distanceM?:              number;
    alignedWithWay?:         boolean;
    hotspotScoreAdjustment:  number;   // applied by buildTerrainHotspots (averaged across members)
    traceScoreAdjustment:    number;   // applied by computeTraceScore
    hideFromDefaultView:     boolean;  // primary suppression gate — sets isRouteArtefactRisk
    reasons:                 string[];
    debugFlags?:             string[]; // for Engine Lab / debug exports
}

export interface HistoricFind {
    id: string;
    internalId: string;
    objectType: string;
    broadperiod: string;
    county: string;
    workflow: "PAS";
    lat: number;
    lon: number;
    isApprox?: boolean;
    osmType?: string;
}

export interface PlaceSignal {
    name: string;
    meaning: string;
    distance: number;
    period: string;
    confidence: number;
    type: string;
}

export interface HistoricRoute {
    id: string;
    type: "roman_road" | "historic_trackway" | "holloway" | "green_lane" | "droveway" | "suspected_route";
    source: "osm" | "itinere" | "historic_map_digitised" | "lidar_interpreted" | "manual";
    name?: string;
    confidenceClass: "A" | "B" | "C" | "D";
    certaintyScore: number;
    geometry: [number, number][];
    bbox: [[number, number], [number, number]];
    period?: "roman" | "medieval" | "post-medieval" | "unknown";
}

export type HotspotClassification =
    | 'Crossing Point Candidate'
    | 'Junction / Convergence Zone'
    | 'Settlement Edge Candidate'
    | 'Burial / Barrow Candidate'
    | 'Organised Field System Candidate'
    | 'Palaeochannel Activity Zone'
    | 'Wetland Margin Activity Zone'
    | 'Route-Side Activity Zone'
    | 'Multi-Period Occupation Zone'
    | 'Terrain Structure Candidate'
    | 'Spectral Activity Candidate'
    | 'Lowland Activity Zone'
    | 'Raised Activity Area'
    | 'Route-Influenced Area'
    | 'Cropmark Activity Zone'
    | 'Multi-Signal Activity Zone'
    | 'General Activity Zone';

// ─── Soil Mechanics ───────────────────────────────────────────────────────────
// Derived per-hotspot and inter-hotspot annotation describing how artefacts may
// have moved, accumulated, or been preserved due to landform position.
// Modifier-only — never creates standalone targets. Populated by the engine
// and relationship pass; consumed by the interpretation layer.

export type SoilMechanicsClass =
    | 'colluvial_accumulation'   // downslope from a raised source zone — receives moved material
    | 'wet_margin_preservation'  // low wet ground — good preservation, finds may be deeper
    | 'hilltop_source_zone'      // raised with slope below — original activity; check downslope too
    | 'stable_plateau'           // raised, flat, undisturbed — artefacts likely in-situ
    | 'disturbed_plough_slope';  // sloping + disturbed — artefacts may have shifted downslope

export interface SoilMechanics {
    interpretationClass: SoilMechanicsClass;
    userNote:            string;
}

// ─── Landscape Intelligence ───────────────────────────────────────────────────
// Synthesis and classification layer operating on existing FieldGuide outputs.
// Consumes already-scored hotspots and cluster signals — no new analysis,
// no new datasets, no additional scan stages.

export type CrossingType =
    | 'Likely Crossing Point'
    | 'Crossing Corridor'
    | 'Route-Water Convergence'
    | 'Movement Bottleneck';

export type LandformType =
    | 'Ridge End'
    | 'Raised Spur'
    | 'Dry Island'
    | 'Gravel Island'
    | 'Promontory'
    | 'Fen Edge Rise'
    | 'Knoll';

export type OccupationPotential =
    | 'Possible Activity Focus'
    | 'Occupation Potential Area'
    | 'Strong Occupation Potential'
    | 'Sustained Landscape Use Candidate';

export type TransitionType =
    | 'Wet-Dry Boundary'
    | 'Floodplain Edge'
    | 'Terrace Margin'
    | 'Fen Edge'
    | 'Geological Boundary'
    | 'Environmental Transition Zone';

export type VisibilityContext =
    | 'High Visibility Ground'
    | 'Valley Overlook'
    | 'Route Oversight Position'
    | 'Strategic Position'
    | 'Open Prospect';

export type WetlandContext =
    | 'Wetland Margin'
    | 'Fen Edge Activity Zone'
    | 'Island-Wetland Interface'
    | 'Causeway Landscape';

export interface LandscapeIntelligence {
    crossingType:        CrossingType | null;
    landformType:        LandformType | null;
    occupationPotential: OccupationPotential | null;
    transitionType:      TransitionType | null;
    visibilityContext:   VisibilityContext | null;
    wetlandContext:      WetlandContext | null;
    narrative:           string;
}

export interface LandscapeSummary {
    fieldNarrative:     string;
    movementSummary:    string[];
    occupationSummary:  string[];
    environmentSummary: string[];
    wetlandSummary:     string[];
}

export interface Hotspot {
    id: string;
    number: number;
    score: number;
    confidence: 'Weak Signal' | 'Developing Signal' | 'Strong Signal' | 'Strongest Signal';
    type: 'Likely Settlement Edge' | 'Water Interaction Zone' | 'Movement Corridor (Likely)' | 'Raised Dry Area (Likely)' | 'General Activity Zone';
    classification:       HotspotClassification;
    classificationReason: string;
    secondaryTag?:        string;
    suggestedFocus?:      string;
    explanation: string[];
    center: [number, number];
    bounds: [[number, number], [number, number]];
    memberIds: string[];
    isHighConfidenceCrossing?: boolean;
    role?: string;
    scale?: 'Micro' | 'Local' | 'Landscape';
    isOnCorridor?: boolean;
    linkedCount?: number;
    disturbanceRisk?: 'Low' | 'Medium' | 'High';
    soilMechanics?: SoilMechanics;
    landscapeIntelligence?: LandscapeIntelligence;
    metrics: {
        anomaly:          number;
        context:          number;
        convergence:      number;
        behaviour:        number;
        penalty:          number;
        signalCount:      number;
        signalClassCount: number;
    };
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const ETYMOLOGY_SIGNALS = [
    // --- ROMAN (90%+) ---
    { pattern: "chester", meaning: "Roman fort", period: "Roman", confidence: 0.95 },
    { pattern: "caster", meaning: "Roman fort", period: "Roman", confidence: 0.95 },
    { pattern: "cester", meaning: "Roman fort", period: "Roman", confidence: 0.95 },
    { pattern: "street", meaning: "Roman road", period: "Roman", confidence: 0.9 },
    { pattern: "strat", meaning: "Roman road", period: "Roman", confidence: 0.9 },
    { pattern: "foss", meaning: "Roman ditch/road", period: "Roman", confidence: 0.85 },

    // --- SAXON / EARLY MEDIEVAL ---
    { pattern: "bury", meaning: "Fortified place", period: "Saxon", confidence: 0.85 },
    { pattern: "borough", meaning: "Fortified settlement", period: "Saxon", confidence: 0.85 },
    { pattern: "burgh", meaning: "Fortified settlement", period: "Saxon", confidence: 0.85 },
    { pattern: "ham", meaning: "Settlement", period: "Saxon", confidence: 0.50 },
    { pattern: "ton", meaning: "Farmstead or enclosure", period: "Saxon", confidence: 0.75 },
    { pattern: "stow", meaning: "Meeting / holy place", period: "Saxon", confidence: 0.85 },
    { pattern: "ley", meaning: "Clearing in woodland", period: "Saxon", confidence: 0.7 },
    { pattern: "leigh", meaning: "Clearing", period: "Saxon", confidence: 0.7 },
    { pattern: "ing", meaning: "People of...", period: "Early Saxon", confidence: 0.8 },

    // --- VIKING / NORSE ---
    { pattern: "by", meaning: "Viking settlement", period: "Viking", confidence: 0.95 },
    { pattern: "thorpe", meaning: "Secondary Viking settlement", period: "Viking", confidence: 0.9 },
    { pattern: "kirk", meaning: "Church site", period: "Viking/Saxon", confidence: 0.85 },

    // --- MEDIEVAL & TRADE ---
    { pattern: "wick", meaning: "Trading settlement", period: "Early Medieval", confidence: 0.8 },
    { pattern: "wich", meaning: "Specialised settlement (salt/trade)", period: "Early Medieval", confidence: 0.8 },
    { pattern: "port", meaning: "Market town", period: "Medieval", confidence: 0.75 },
    { pattern: "bridge", meaning: "Crossing point", period: "Medieval+", confidence: 0.85 },
    { pattern: "field", meaning: "Open land", period: "Medieval+", confidence: 0.6 },

    // --- TOPOGRAPHICAL / WATER ---
    { pattern: "ford", meaning: "River crossing", period: "Multi-period", confidence: 0.85 },
    { pattern: "mere", meaning: "Lake or wetland", period: "Prehistoric+", confidence: 0.8 },
    { pattern: "marsh", meaning: "Wetland", period: "Multi-period", confidence: 0.7 },
    { pattern: "low", meaning: "Burial mound / barrow", period: "Prehistoric/Saxon", confidence: 0.85 },
    { pattern: "howe", meaning: "Burial mound / barrow", period: "Viking/Saxon", confidence: 0.85 }
];

export const SCAN_PROFILE = {
    TERRAIN: {
        threshold: 0.15,
        minSize: 20,
        dilation: 1,
        minSolidity: 0.12,
        minLinearity: 1.0
    },
    SLOPE: {
        threshold: 0.20,
        minSize: 25,
        dilation: 1,
        minSolidity: 0.15,
        minLinearity: 1.2
    },
    HYDROLOGY: {
        threshold: 0.22,
        minSize: 350,
        dilation: 2,
        minSolidity: 0.10,
        minLinearity: 5.5
    },
    AERIAL: {
        threshold: 0.22,
        minSize: 160,
        dilation: 3,
        minSolidity: 0.36,
        minLinearity: 4.5
    },
    HISTORIC: {
        threshold: 0.10,
        minSize: 20,
        dilation: 2,
        minSolidity: 0.15,
        minLinearity: 1.5
    }
};

// ─── Trace Signals ────────────────────────────────────────────────────────────

/** Why a trace candidate didn't make it to displayTargets */
export type TraceRejectionReason =
    | 'failed_target_evidence'
    | 'failed_local_physical_evidence'
    | 'below_display_cut'
    | 'merged_echo'
    | 'single_source_signal'
    | 'disturbance_limited';

/** Category that describes what kind of weaker signal the trace represents */
export type TraceType =
    | 'suppressed_physical'       // failed a strict gate but has physical basis
    | 'below_cut_supporting'      // passed all gates but ranked #13+
    | 'merged_echo'               // sub-signal offset from a display target
    | 'single_source_landscape'   // single credible source, below displayTargets bar
    | 'hydrology_trace'           // palaeochannel or wet-margin signal
    | 'spectral_trace'            // satellite-derived without LiDAR confirmation
    | 'boundary_trace'            // linear ditch/bank form below evidence threshold
    | 'suppressed_circular'       // ring/circular morphology below confidence bar
    | 'weak_structural'           // structural signal with insufficient corroboration
    | 'fragmented_enclosure'      // enclosure-like form without full perimeter
    | 'corridor_trace'            // movement signal near a historic route
    | 'dry_margin_trace'          // raised ground beside hydrology-backed margin
    | 'wet_margin_trace'          // strong terrain-water relationship (dryMarginScore + flowConvergence)
    | 'terrain_dry_margin_trace'  // terrain geometry suggests dry-margin edge, no hydrology source
    | 'weak_multiscale';          // multi-scale agreement but failed evidence gate

/**
 * A secondary-tier archaeological clue that failed at least one strict gate
 * but has enough physical basis to be worth surfacing as an exploratory hint.
 *
 * Trace Signals are NOT targets and must never feed back into the main engine.
 */
export interface TraceTarget {
    // Positional / identity
    id: string;
    center: [number, number];
    type: string;
    sources: Cluster['sources'];
    findPotential: number;
    confidence: Cluster['confidence'];
    // Optional physical descriptors (carried through from source cluster)
    disturbanceRisk?: Cluster['disturbanceRisk'];
    multiScale?: boolean;
    polarity?: Cluster['polarity'];
    relativeElevation?: Cluster['relativeElevation'];
    aimInfo?: Cluster['aimInfo'];
    isRouteArtefactRisk?: boolean;
    routeAssessment?: RouteAssessment;
    // Trace-specific fields
    traceScore: number;                      // 0–100 trace confidence (own scale)
    traceType: TraceType;
    traceLabel: string;                      // display label e.g. "Hydrology Trace"
    traceReason: string;                     // one-line human explanation
    rejectedBy: TraceRejectionReason;
    distanceToNearestTarget: number;         // metres from nearest displayTarget centre
}

// ─── Score / label helpers ────────────────────────────────────────────────────

export function getConfidenceLabel(score: number): 'Weak Signal' | 'Developing Signal' | 'Strong Signal' | 'Strongest Signal' {
    if (score > 80) return 'Strongest Signal';
    if (score > 60) return 'Strong Signal';
    if (score > 35) return 'Developing Signal';
    return 'Weak Signal';
}

export const HOTSPOT_INTERPRETATION: Record<string, string> = {
    'Likely Settlement Edge': 'Signals suggest activity along a settlement boundary',
    'Water Interaction Zone': 'Signals suggest activity linked to nearby water',
    'Movement Corridor (Likely)': 'Signals suggest past movement through this area',
    'Raised Dry Area (Likely)': 'Slight elevation may indicate favourable settlement or use',
    'General Activity Zone': 'Multiple weak signals suggest dispersed activity',
};
