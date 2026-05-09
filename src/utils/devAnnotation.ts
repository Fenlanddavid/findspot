// ─── Dev Annotation types ─────────────────────────────────────────────────────
// Temporary in-session validation markers for engine tuning.
// Never saved to Dexie or shown to normal users.
// Exported via Engine Lab only.

export type AnnotationType =
    | 'missed_hotspot'
    | 'under_scored_signal'
    | 'wrong_classification'
    | 'false_negative'
    | 'interesting_landscape_position'
    | 'possible_multi_period_reuse'
    | 'modern_noise_not_suppressed';

export type BroadPeriod =
    | 'Prehistoric' | 'Roman' | 'Early Medieval' | 'Medieval'
    | 'Post-Medieval' | 'Multi-period' | 'Unknown';

export type LandscapeType =
    | 'route_edge' | 'wetland_margin' | 'crossing' | 'raised_ground'
    | 'terrace_edge' | 'field_system' | 'settlement_edge'
    | 'circular_feature' | 'negative_space' | 'unknown';

export type AnnotationConfidence = 'low' | 'medium' | 'high';

export interface EngineContextAtPoint {
    clustersWithin50m:    number;
    clustersWithin100m:   number;
    clustersWithin250m:   number;
    nearestHotspotId:     string | null;
    nearestHotspotDist:   number | null;
    nearestTargetId:      string | null;
    nearestTargetDist:    number | null;
    sourceAvailability:   Record<string, boolean> | null;
    hadSuppressionNearby: boolean;
    suppressionReasons:   string[];
    belowHotspotThreshold: boolean;
}

export interface DevAnnotation {
    id:             string;
    lat:            number;
    lon:            number;
    timestamp:      number;
    engineVersion:  string;
    annotationType: AnnotationType;
    broadPeriod:    BroadPeriod;
    landscapeType:  LandscapeType;
    confidence:     AnnotationConfidence;
    reviewerNote:   string;
    engineContext:  EngineContextAtPoint;
}

export const ANNOTATION_TYPE_LABELS: Record<AnnotationType, string> = {
    missed_hotspot:                 'Missed Hotspot',
    under_scored_signal:            'Under-scored Signal',
    wrong_classification:           'Wrong Classification',
    false_negative:                 'False Negative',
    interesting_landscape_position: 'Interesting Landscape Position',
    possible_multi_period_reuse:    'Possible Multi-period Reuse',
    modern_noise_not_suppressed:    'Modern Noise Not Suppressed',
};

export const LANDSCAPE_TYPE_LABELS: Record<LandscapeType, string> = {
    route_edge:       'Route Edge',
    wetland_margin:   'Wetland Margin',
    crossing:         'Crossing',
    raised_ground:    'Raised Ground',
    terrace_edge:     'Terrace Edge',
    field_system:     'Field System',
    settlement_edge:  'Settlement Edge',
    circular_feature: 'Circular Feature',
    negative_space:   'Negative Space',
    unknown:          'Unknown',
};
