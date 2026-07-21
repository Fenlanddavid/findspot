export const HOTSPOT_EXPLANATION_WEIGHTS = {
    roman_proximity: 90,
    roman_palaeochannel_crossing: 82,
    terrain_hydrology_depression: 80,
    palaeochannel: 78,
    multi_season_cropmark: 75,
    lidar_hydrology: 70,
    raised_wetland_island: 70,
    repeated_detection: 68,
    historic_crossing: 65,
    route_convergence: 60,
    lidar_spectral: 55,
    ignore_modern_disturbance: 50,
    ignore_featureless: 50,
    ignore_route_only: 50,
    settlement_structure: 48,
    lidar_relief: 45,
    settlement_access: 45,
    historic_overlap: 44,
    observational_vantage: 44,
    raised_overlook: 42,
    multi_period_activity: 40,
    spectral_anomaly: 40,
    field_system: 38,
    movement_offset: 38,
    independent_sources: 36,
    sheltered_position: 36,
    raised_footing: 35,
    raised_water_margin: 35,
    historic_movement: 25,
    subtle_earthwork: 22,
    dry_wetland_margin: 20,
    quiet_preservation: 19,
    landscape_edge: 18,
    movement_corridor: 16,
    slope_aspect: 14,
    landscape_relationship: 13,
    landscape_system: 12,
    scan_edge: 11,
    pas_density: 10,
    other: 10,
} as const;

export type ExplanationTag = keyof typeof HOTSPOT_EXPLANATION_WEIGHTS;

export type HotspotExplanation = {
    tag: ExplanationTag;
    qualifier?: string;
    text: string;
};

export function hotspotExplanation(
    tag: ExplanationTag,
    text: string,
    qualifier?: string,
): HotspotExplanation {
    return qualifier ? { tag, qualifier, text } : { tag, text };
}

export function explanationKey(explanation: HotspotExplanation): string {
    return explanation.qualifier
        ? `${explanation.tag}:${explanation.qualifier}`
        : explanation.tag;
}

export function isIgnoreExplanation(explanation: HotspotExplanation): boolean {
    return explanation.tag.startsWith('ignore_');
}

export function prioritiseHotspotExplanations(
    items: HotspotExplanation[],
    limit: number,
): HotspotExplanation[] {
    const unique = new Map<string, HotspotExplanation>();
    for (const item of items) {
        const key = explanationKey(item);
        if (!unique.has(key)) unique.set(key, item);
    }

    const ordered = [...unique.values()].sort(
        (a, b) => HOTSPOT_EXPLANATION_WEIGHTS[b.tag] - HOTSPOT_EXPLANATION_WEIGHTS[a.tag],
    );
    if (ordered.length <= limit) return ordered;

    const sliced = ordered.slice(0, limit);
    if (sliced.some(isIgnoreExplanation) && !sliced.some(item => !isIgnoreExplanation(item))) {
        const firstPositive = ordered.find(item => !isIgnoreExplanation(item));
        if (firstPositive) sliced[sliced.length - 1] = firstPositive;
    }
    return sliced;
}

/** Transitional adapter for explanation text produced by older supporting engines. */
export function supportingExplanation(text: string): HotspotExplanation {
    const lower = text.toLowerCase();
    if (lower.includes('roman')) return hotspotExplanation('roman_proximity', text);
    if (lower.includes('route') || lower.includes('movement')) return hotspotExplanation('historic_movement', text);
    if (lower.includes('slope') || lower.includes('aspect')) return hotspotExplanation('slope_aspect', text);
    if (lower.includes('edge')) return hotspotExplanation('landscape_edge', text);
    return hotspotExplanation('other', text, lower.replace(/\s+/g, '_').slice(0, 80));
}
