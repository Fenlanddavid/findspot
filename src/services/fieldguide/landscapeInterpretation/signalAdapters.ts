// ─── Signal Adapters — pure extraction layer ─────────────────────────────────
// Reads already-fetched feature data and terrain values.
// No scoring, no side effects.

import type { NHLEFeature, AIMFeature } from '../../../services/historicScanService';
import type { HistoricRoute } from '../../../pages/fieldGuideTypes';
import type { ArchaeologicalPeriod, PeriodSignalAggregate } from '../../../types/landscapeInterpretation';

// ─── Adapted signals output ───────────────────────────────────────────────────

export interface AdaptedSignals {
    periodAggregates: PeriodSignalAggregate[];
    recordSparsity: boolean;

    // Boolean landscape signals
    romanRoadPresent: boolean;
    historicTrackwayPresent: boolean;
    routeConvergence: boolean;
    confluencePresent: boolean;
    waterProximity: boolean;
    wetlandPresent: boolean;
    ridgeAndFurrowPresent: boolean;
    woodlandEdgePresent: boolean;

    // Monument type flags
    hasNHLEBurialRecord: boolean;
    hasNHLEDefenceRecord: boolean;
    hasNHLEIndustrialRecord: boolean;

    // All feature descriptions for matching
    nhleDescriptions: string[];
    aimPeriods: string[];
    aimTypes: string[];
}

// ─── Period mapping ───────────────────────────────────────────────────────────

const BURIAL_TYPES = ['barrow', 'cemetery', 'tumulus', 'round barrow', 'long barrow', 'cairn'];
const DEFENCE_TYPES = ['hillfort', 'hill fort', 'castle', 'fort', 'motte', 'bailey', 'moat', 'moated', 'pillbox', 'anti-tank', 'military', 'battery', 'redoubt'];
const INDUSTRIAL_TYPES = ['ironwork', 'kiln', 'mine', 'quarry', 'furnace', 'smithing', 'pottery', 'industrial', 'manufact', 'brick', 'lime', 'mill', 'extraction'];
const AGRICULTURAL_TYPES = ['ridge and furrow', 'ridge', 'furrow', 'field system', 'field boundary', 'cultivation', 'lynchet', 'plough'];
const WATER_TYPES = ['confluence', 'ford', 'crossing', 'river', 'stream', 'spring', 'watercourse', 'drain', 'dyke', 'dike', 'fen', 'marsh', 'wetland', 'peat'];

function mapPeriodString(raw: string): ArchaeologicalPeriod | null {
    const upper = raw.toUpperCase().trim();
    if (/BRONZE AGE|NEOLITHIC|PREHISTORIC|MESOLITHIC/.test(upper)) return 'prehistoric_bronze_age';
    if (/IRON AGE/.test(upper)) return 'iron_age';
    if (/ROMAN|ROMANO.BRITISH/.test(upper)) return 'romano_british';
    if (/EARLY MEDIEVAL|SAXON|ANGLO.SAXON|VIKING/.test(upper)) return 'early_medieval';
    if (/MEDIEVAL/.test(upper)) return 'medieval';
    if (/POST.MEDIEVAL|TUDOR|GEORGIAN/.test(upper)) return 'post_medieval';
    if (/MODERN|INDUSTRIAL|WORLD WAR|20TH CENTURY/.test(upper)) return 'modern_industrial';
    return null;
}

function mapCertaintyWeight(raw: string | undefined): number {
    if (!raw) return 0.5;
    const lower = raw.toLowerCase();
    if (lower === 'confirmed' || lower === 'certain') return 1.0;
    if (lower === 'probable') return 0.7;
    if (lower === 'possible') return 0.4;
    return 0.5;
}

function containsAny(text: string, terms: string[]): boolean {
    const lower = text.toLowerCase();
    return terms.some(t => lower.includes(t));
}

// ─── Main extraction function ─────────────────────────────────────────────────

export function extractSignals(
    nhleFeatures: NHLEFeature[],
    aimFeatures: AIMFeature[],
    routeFeatures: HistoricRoute[],
    potentialBreakdown: { terrain: number; hydro: number; historic: number; signals: number } | null,
): AdaptedSignals {
    // ── 1. Period aggregates from NHLE features ───────────────────────────────
    // NHLEFeature.properties only has Name and ListEntry — no PERIOD or CERTAINTY
    // from the current API query. We can infer from Name for partial coverage.
    const periodMap = new Map<ArchaeologicalPeriod, { count: number; weighted: number }>();

    // Collect NHLE name strings for monument type detection
    const nhleDescriptions: string[] = nhleFeatures.map(f => (f.properties?.Name ?? '').toLowerCase());

    // Try to infer period from NHLE Name
    for (const f of nhleFeatures) {
        const name = f.properties?.Name ?? '';
        const mapped = mapPeriodString(name);
        if (mapped) {
            const existing = periodMap.get(mapped) ?? { count: 0, weighted: 0 };
            periodMap.set(mapped, { count: existing.count + 1, weighted: existing.weighted + 0.5 });
        }
    }

    // ── 2. Period aggregates from AIM features ────────────────────────────────
    const aimPeriods: string[] = [];
    const aimTypes: string[] = [];

    for (const f of aimFeatures) {
        const period = f.properties?.PERIOD ?? '';
        const type   = f.properties?.MONUMENT_TYPE ?? '';
        if (period) aimPeriods.push(period);
        if (type)   aimTypes.push(type);

        const mapped = mapPeriodString(period);
        if (mapped) {
            const existing = periodMap.get(mapped) ?? { count: 0, weighted: 0 };
            // AIM uses field name PERIOD — no certainty field in current API response
            const w = mapCertaintyWeight(undefined);
            periodMap.set(mapped, { count: existing.count + 1, weighted: existing.weighted + w });
        }
    }

    // ── 3. Augment period aggregates from route types ─────────────────────────
    // Routes carry period information (roman_road → romano_british, etc.) that
    // NHLE names often miss. Add them so temporal persistence reflects route evidence.
    // Weights only need to clear the 0.5 threshold to register as an active period
    // for temporal persistence. Keep them low to avoid inflating evidence support scores —
    // the roman_road already contributes +40 to the movement process score separately.
    const routePeriodContributions: Partial<Record<string, { period: ArchaeologicalPeriod; weight: number }>> = {
        roman_road:       { period: 'romano_british', weight: 0.8 },
        historic_trackway:{ period: 'medieval',       weight: 0.6 },
        holloway:         { period: 'medieval',       weight: 0.6 },
        droveway:         { period: 'medieval',       weight: 0.5 },
        green_lane:       { period: 'post_medieval',  weight: 0.5 },
    };
    for (const r of routeFeatures) {
        const contrib = routePeriodContributions[r.type];
        if (contrib) {
            const existing = periodMap.get(contrib.period) ?? { count: 0, weighted: 0 };
            periodMap.set(contrib.period, { count: existing.count + 1, weighted: existing.weighted + contrib.weight });
        }
    }

    const periodAggregates: PeriodSignalAggregate[] = Array.from(periodMap.entries()).map(([period, v]) => ({
        period,
        recordCount: v.count,
        certaintyWeightedCount: v.weighted,
    }));

    // ── 4. Total feature count for sparsity ───────────────────────────────────
    const totalFeatureCount = nhleFeatures.length + aimFeatures.length;
    const recordSparsity = totalFeatureCount < 3;

    // ── 5. Boolean signals from routes ───────────────────────────────────────
    const romanRoadPresent = routeFeatures.some(r => r.type === 'roman_road');
    const historicTrackwayPresent = routeFeatures.some(r =>
        r.type === 'historic_trackway' || r.type === 'holloway' ||
        r.type === 'droveway' || r.type === 'green_lane' || r.type === 'suspected_route'
    );

    // Route convergence: multiple distinct route types, or 2+ routes in the set
    const routeConvergence = routeFeatures.length >= 2;

    // ── 6. Boolean signals from NHLE names + AIM types ────────────────────────
    const allDescriptions = [...nhleDescriptions, ...aimTypes.map(t => t.toLowerCase()), ...aimPeriods.map(p => p.toLowerCase())];

    const confluencePresent = allDescriptions.some(d =>
        d.includes('confluence') || d.includes('ford') || d.includes('crossing') || d.includes('river')
    );

    // Feature-based water detection — NHLE names rarely contain water terms so
    // supplement with the hydro score from potentialScore.breakdown, which is
    // computed from real DEM/hydrology data. hydro > 25 = meaningful water proximity.
    const featureWaterProximity = allDescriptions.some(d =>
        containsAny(d, WATER_TYPES) ||
        d.includes('well') ||
        d.includes('watermill') ||
        d.includes('pond')
    );
    const hydroScore = potentialBreakdown?.hydro ?? 0;
    const waterProximity = featureWaterProximity || hydroScore > 25;

    const featureWetlandPresent = allDescriptions.some(d =>
        d.includes('wetland') || d.includes('fen') || d.includes('marsh') ||
        d.includes('bog') || d.includes('peat') || d.includes('estuarine') ||
        d.includes('tidal') || d.includes('saltmarsh') || d.includes('salt marsh')
    );
    // hydro > 60 = strong water signal, treat as wetland-adjacent context
    const wetlandPresent = featureWetlandPresent || hydroScore > 60;

    const ridgeAndFurrowPresent = allDescriptions.some(d => containsAny(d, AGRICULTURAL_TYPES));

    const woodlandEdgePresent = allDescriptions.some(d =>
        d.includes('wood') || d.includes('forest') || d.includes('copse') || d.includes('plantation')
    );

    // ── 7. Monument type classification ───────────────────────────────────────
    const hasNHLEBurialRecord = allDescriptions.some(d => containsAny(d, BURIAL_TYPES));
    const hasNHLEDefenceRecord = allDescriptions.some(d => containsAny(d, DEFENCE_TYPES));
    const hasNHLEIndustrialRecord = nhleDescriptions.some(d => containsAny(d, INDUSTRIAL_TYPES)) ||
        aimTypes.some(t => containsAny(t.toLowerCase(), INDUSTRIAL_TYPES));

    return {
        periodAggregates,
        recordSparsity,
        romanRoadPresent,
        historicTrackwayPresent,
        routeConvergence,
        confluencePresent,
        waterProximity,
        wetlandPresent,
        ridgeAndFurrowPresent,
        woodlandEdgePresent,
        hasNHLEBurialRecord,
        hasNHLEDefenceRecord,
        hasNHLEIndustrialRecord,
        nhleDescriptions,
        aimPeriods,
        aimTypes,
    };
}
