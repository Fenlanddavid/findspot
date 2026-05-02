// ─── Shared types & constants for the Field Guide feature ───────────────────

export interface Cluster {
    id: string; points: {x: number, y: number}[];
    minX: number; maxX: number; minY: number; maxY: number;
    type: string; score: number; number: number;
    isProtected: boolean;
    monumentName?: string;
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
    metrics?: { circularity: number; density: number; ratio: number; area: number; ridgeStrength?: number; dirConsistency?: number };
    multiScale?: boolean;
    multiScaleLevel?: number;
    explanationLines?: string[];
    isHighConfidenceCrossing?: boolean;
    role?: string;
    routeAlignment?: number;
    isOnCorridor?: boolean;
    linkedClusterIds?: string[];
    scale?: 'Micro' | 'Local' | 'Landscape';
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
    source: "osm" | "historic_map_digitised" | "lidar_interpreted" | "manual";
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
    | 'Wetland Margin Activity Zone'
    | 'Route-Side Activity Zone'
    | 'Terrain Structure Candidate'
    | 'Spectral Activity Candidate'
    | 'Lowland Activity Zone'
    | 'Raised Activity Area'
    | 'Route-Influenced Area'
    | 'Cropmark Activity Zone'
    | 'Multi-Signal Activity Zone'
    | 'General Activity Zone';

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
    { pattern: "ham", meaning: "Settlement", period: "Saxon", confidence: 0.75 },
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
        minSize: 650,
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
