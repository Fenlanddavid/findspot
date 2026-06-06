// GEOLOGY_RULE:
// Geology is modifier-only.
// It may alter interpretation, confidence and explanation.
// It must never create hotspots or targets.
// It must never elevate a location above threshold without support from existing primary signals.

// ─── Version constants ────────────────────────────────────────────────────────
// Bump GEOLOGY_CLASSIFIER_VERSION when classification logic changes (invalidates cache).
// Bump GEOLOGY_SOURCE_VERSION when the BGS service or layer names change.
export const GEOLOGY_CLASSIFIER_VERSION = 1;
export const GEOLOGY_SOURCE_VERSION = 'bgs625k-v2';

export const GEOLOGY_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
export const GEOLOGY_REQUEST_TIMEOUT_MS = 8_000;                // 8 seconds

// ─── Landscape classes ────────────────────────────────────────────────────────
// Defined classes must have complete classification rules in geologyClassifier.ts.
// Do not add a class here unless the corresponding rules exist.
export type GeologyLandscapeClass =
    | 'peat_fen'
    | 'alluvial_floodplain'
    | 'river_gravel_terrace'
    | 'chalk_downland'
    | 'heavy_clay'
    | 'sand_gravel'
    | 'mixed_uncertain'
    | 'unknown';

export type GeologyConfidence = 'low' | 'medium' | 'high';

export type ArtificialGroundType =
    | 'made_ground'
    | 'worked_ground'
    | 'disturbed_ground'
    | 'unknown';

// ─── Raw BGS response data ────────────────────────────────────────────────────
// Parsed directly from WMS GetFeatureInfo — no interpretation applied yet.
export type RawGeologyData = {
    bedrockName?: string;
    bedrockLithology?: string;
    bedrockAge?: string;
    superficialName?: string;
    superficialLithology?: string;
    artificialGround?: {
        present: boolean;
        type?: ArtificialGroundType;
    };
    massMovement?: boolean;
    linearFeatures?: string[];
};

// ─── Main context type ────────────────────────────────────────────────────────
export type GeologyContext = {
    tileKey: string;
    centroid: { lat: number; lon: number };

    source: {
        bedrock?: 'BGS_625K';
        superficial?: 'BGS_625K';
    };

    raw: RawGeologyData;

    landscapeClass: GeologyLandscapeClass;
    confidence: GeologyConfidence;

    // Phase 1: all zeros — scoring modifiers deferred to Phase 2.
    // Phase 2 will populate these with bounded adjustments (+12 max / -15 min).
    modifiers: {
        hydrology: number;
        terrain: number;
        spectral: number;
        route: number;
        soilMechanics: number;
        preservation: number;
        movementRisk: number;
    };

    explanation: string[];
    fetchedAt: number;
    classifierVersion: number;
    sourceVersion: string;
};

// ─── Audit entry ──────────────────────────────────────────────────────────────
export type GeologyAuditAction =
    | 'applied'
    | 'not_applied'
    | 'suppressed'
    | 'timeout'
    | 'error'
    | 'disabled'
    | 'cache_hit'
    | 'cors_fail'
    | 'empty_response';

export type GeologyAuditEntry = {
    timestamp: number;
    tileKey: string;
    action: GeologyAuditAction;
    reason: string;
    scoreEffect?: number;
};
