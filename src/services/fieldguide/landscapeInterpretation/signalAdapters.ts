// ─── Signal Adapters — pure extraction layer ─────────────────────────────────
// Reads already-fetched feature data and terrain values.
// No scoring, no side effects.

import type { NHLEFeature, AIMFeature } from '../../../services/historicScanService';
import type { HistoricRoute } from '../../../pages/fieldGuideTypes';
import type { ArchaeologicalPeriod, PASInterpretationInput, PersonalFindsInput, PeriodSignalAggregate } from '../../../types/landscapeInterpretation';

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
    hasNHLECeremonialRecord: boolean;
    ceremonialRecordCount: number;

    // All feature descriptions for matching
    nhleDescriptions: string[];
    aimPeriods: string[];
    aimTypes: string[];
}

// ─── Period mapping ───────────────────────────────────────────────────────────

const BURIAL_TYPES = ['barrow', 'cemetery', 'tumulus', 'round barrow', 'long barrow', 'cairn', 'ring ditch'];
// Multi-word / unambiguous terms — safe for substring matching
const CEREMONIAL_TYPES_PHRASE = ['henge', 'stone circle', 'stone setting', 'standing stone', 'cursus', 'causewayed enclosure', 'timber circle'];
// Short terms — require word-boundary matching to avoid "covered", "territorial", etc.
const CEREMONIAL_TYPES_WORD = ['cove', 'sarsen', 'monolith', 'ceremonial', 'ritual'];
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

function containsAnyWord(text: string, terms: string[]): boolean {
    const lower = text.toLowerCase();
    return terms.some(t => new RegExp(`\\b${t}\\b`).test(lower));
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

    const ceremonialDescriptions = [...nhleDescriptions, ...aimTypes.map(t => t.toLowerCase())];
    const ceremonialRecordCount = ceremonialDescriptions.filter(d =>
        containsAny(d, CEREMONIAL_TYPES_PHRASE) || containsAnyWord(d, CEREMONIAL_TYPES_WORD),
    ).length;
    const hasNHLECeremonialRecord = ceremonialRecordCount > 0;

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
        hasNHLECeremonialRecord,
        ceremonialRecordCount,
        nhleDescriptions,
        aimPeriods,
        aimTypes,
    };
}

// ─── PAS interpretation adapter (Phase B) ────────────────────────────────────
// Regional context only — PAS never dominates or contradicts. See P1-P4.

// Density tier threshold: p75 of the real pas-density-gb.json distribution.
// 4 456 cells, p75 = 133.  Rounded to 130 for a clean boundary.
export const TIER_NOTABLE = 130;

// Maximum summed PAS certaintyWeightedCount contribution per period.
// Weakest existing monument-derived signal = 0.5 (single NHLE/AIM record).
// Cap = 0.5 × 0.5 = 0.25 — PAS can never match even one monument record.
export const PAS_PERIOD_CAP = 0.25;

// Minimum per-period find count to emit a period signal.
// Single stray finds are noise at H3-res-6 scale (~36 km²).
const PAS_PERIOD_MIN_COUNT = 3;

/** Map PAS broad-period labels to the 7-period enum.
 *  Deliberately unmapped: PALAEOLITHIC, MESOLITHIC, NEOLITHIC (no honest
 *  bucket — do NOT fold early prehistory into prehistoric_bronze_age),
 *  UNKNOWN, and any unrecognised label. */
const PAS_PERIOD_MAP: Record<string, ArchaeologicalPeriod> = {
    'BRONZE AGE':     'prehistoric_bronze_age',
    'IRON AGE':       'iron_age',
    'ROMAN':          'romano_british',
    'EARLY MEDIEVAL': 'early_medieval',
    'MEDIEVAL':       'medieval',
    'POST MEDIEVAL':  'post_medieval',
    'MODERN':         'modern_industrial',
};

export type PASDensityTier = 'none' | 'present' | 'notable';

export interface PASAdapterOutput {
    periodSignals: PeriodSignalAggregate[];
    densityTier: PASDensityTier;
    cellCount: number;
    topMappedPeriod: ArchaeologicalPeriod | null;
}

export function extractPASSignals(
    pas: PASInterpretationInput | null | undefined,
): PASAdapterOutput {
    const EMPTY: PASAdapterOutput = { periodSignals: [], densityTier: 'none', cellCount: 0, topMappedPeriod: null };
    if (!pas || pas.cellCount === 0) return EMPTY;

    // ── Density tier ──────────────────────────────────────────────────────────
    const densityTier: PASDensityTier =
        pas.cellCount >= TIER_NOTABLE ? 'notable' : 'present';

    // ── Period signals ────────────────────────────────────────────────────────
    // Map labels case-insensitively, trimmed; skip unmapped.
    const mapped: { period: ArchaeologicalPeriod; count: number }[] = [];
    for (const [rawLabel, count] of pas.periodCounts) {
        const key = rawLabel.trim().toUpperCase();
        const period = PAS_PERIOD_MAP[key];
        if (period && count >= PAS_PERIOD_MIN_COUNT) {
            mapped.push({ period, count });
        }
    }

    const mappedTotal = mapped.reduce((sum, m) => sum + m.count, 0);
    if (mappedTotal === 0) return { periodSignals: [], densityTier, cellCount: pas.cellCount, topMappedPeriod: null };

    // Cap total PAS contribution per period to PAS_PERIOD_CAP
    const periodSignals: PeriodSignalAggregate[] = mapped.map(m => {
        const share = m.count / mappedTotal;
        const raw = share * PAS_PERIOD_CAP;
        return {
            period: m.period,
            recordCount: 0,           // PAS does not add to monument record count
            certaintyWeightedCount: Math.min(raw, PAS_PERIOD_CAP),
        };
    });

    // Top mapped period: highest count, ties broken alphabetically for determinism
    const sorted = [...mapped].sort((a, b) =>
        b.count - a.count || a.period.localeCompare(b.period),
    );
    const topMappedPeriod = sorted[0]?.period ?? null;

    return { periodSignals, densityTier, cellCount: pas.cellCount, topMappedPeriod };
}

// ─── Personal finds interpretation adapter ──────────────────────────────────
// Primary local evidence — unlike PAS, personal finds MAY introduce a period
// the monuments haven't signalled, but only above the n-floors below (L1).
// Absence of finds says nothing (L2 — supporting polarity only).

/** Minimum per mapped period (post-merge) to emit a presence signal. */
export const PERSONAL_N_PRESENCE = 5;
/** Minimum per mapped period AND share >= 0.5 for dominant. */
export const PERSONAL_N_DOMINANT = 10;
/** Personal share >= ANOMALY_FACTOR × PAS share to flag anomaly. */
export const PERSONAL_ANOMALY_FACTOR = 2;
/** Cap per-period contribution — below monument-tier 0.5, above PAS 0.25.
 *  Primary local evidence but the landscape engines stay in charge. */
export const PERSONAL_PERIOD_CAP = 0.4;

/** Map Find.period labels to the 7-period enum.
 *  Deliberately unmapped: 'Prehistoric' (no honest bucket — mirrors the
 *  PAS NEOLITHIC decision), 'Unknown', and any unrecognised label.
 *  'Celtic' + 'Iron Age' merge into one iron_age count before floors. */
export const FIND_PERIOD_MAP: Record<string, ArchaeologicalPeriod> = {
    'Bronze Age':     'prehistoric_bronze_age',
    'Iron Age':       'iron_age',
    'Celtic':         'iron_age',        // La Tène-era material
    'Roman':          'romano_british',
    'Anglo-Saxon':    'early_medieval',
    'Early Medieval': 'early_medieval',
    'Medieval':       'medieval',
    'Post-medieval':  'post_medieval',
    'Modern':         'modern_industrial',
};

export interface PersonalFindsEvidenceDirective {
    id: 'personal_period_presence' | 'personal_period_dominant' | 'personal_base_rate_anomaly';
    weight: number;
    label: string;
    polarity: 'supporting';
}

export interface PersonalFindsAdapterOutput {
    periodSignals: PeriodSignalAggregate[];
    evidenceDirectives: PersonalFindsEvidenceDirective[];
    topMappedPeriod: ArchaeologicalPeriod | null;
    mappedTotal: number;
}

export function extractPersonalFindsSignals(
    input: PersonalFindsInput | null | undefined,
    pas: PASInterpretationInput | null | undefined,
): PersonalFindsAdapterOutput {
    const EMPTY: PersonalFindsAdapterOutput = {
        periodSignals: [], evidenceDirectives: [], topMappedPeriod: null, mappedTotal: 0,
    };
    if (!input || input.totalWithCoords === 0) return EMPTY;

    // ── Map and merge periods ────────────────────────────────────────────────
    const merged = new Map<ArchaeologicalPeriod, number>();
    for (const [rawLabel, count] of input.periodCounts) {
        const period = FIND_PERIOD_MAP[rawLabel];
        if (!period) continue;
        merged.set(period, (merged.get(period) ?? 0) + count);
    }

    const mappedTotal = [...merged.values()].reduce((s, c) => s + c, 0);
    if (mappedTotal === 0) return EMPTY;

    // ── Period signals (introduction allowed — no corroboration gate) ─────
    const periodSignals: PeriodSignalAggregate[] = [];
    for (const [period, count] of merged) {
        if (count < PERSONAL_N_PRESENCE) continue;
        const share = count / mappedTotal;
        const raw = share * PERSONAL_PERIOD_CAP;
        periodSignals.push({
            period,
            recordCount: 0, // personal finds don't add to monument record count
            certaintyWeightedCount: Math.min(raw, PERSONAL_PERIOD_CAP),
        });
    }

    // ── Top mapped period: highest count, ties alphabetically ────────────
    const sorted = [...merged.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    const topMappedPeriod = sorted[0]?.[0] ?? null;
    const topCount = sorted[0]?.[1] ?? 0;

    // ── Evidence directives ──────────────────────────────────────────────────
    const evidenceDirectives: PersonalFindsEvidenceDirective[] = [];

    if (topMappedPeriod && topCount >= PERSONAL_N_PRESENCE) {
        const topShare = topCount / mappedTotal;
        const isDominant = topCount >= PERSONAL_N_DOMINANT && topShare >= 0.5;

        if (isDominant) {
            // Dominant replaces presence — never both
            evidenceDirectives.push({
                id: 'personal_period_dominant',
                weight: 14,
                label: `Your own finds here are predominantly ${PERIOD_LABELS_PERSONAL[topMappedPeriod]} (${topCount} of ${mappedTotal} recorded nearby)`,
                polarity: 'supporting',
            });
        } else {
            evidenceDirectives.push({
                id: 'personal_period_presence',
                weight: 12,
                label: `Your own recorded finds here include repeated ${PERIOD_LABELS_PERSONAL[topMappedPeriod]} material (${topCount} finds)`,
                polarity: 'supporting',
            });
        }

        // ── Anomaly: personal share >= 2× PAS share (additional) ─────────
        if (isDominant && pas && Array.isArray(pas.periodCounts)) {
            // Compute PAS mapped total and period share
            const pasMerged = new Map<ArchaeologicalPeriod, number>();
            for (const [rawLabel, count] of pas.periodCounts) {
                const key = rawLabel.trim().toUpperCase();
                const pasPeriod = PAS_PERIOD_MAP[key];
                if (pasPeriod) pasMerged.set(pasPeriod, (pasMerged.get(pasPeriod) ?? 0) + count);
            }
            const pasMappedTotal = [...pasMerged.values()].reduce((s, c) => s + c, 0);

            if (pasMappedTotal >= 20) {
                const pasShareOfPeriod = (pasMerged.get(topMappedPeriod) ?? 0) / pasMappedTotal;
                const personalShareOfPeriod = topCount / mappedTotal;

                if (pasShareOfPeriod > 0 && personalShareOfPeriod >= PERSONAL_ANOMALY_FACTOR * pasShareOfPeriod) {
                    evidenceDirectives.push({
                        id: 'personal_base_rate_anomaly',
                        weight: 8,
                        label: `That pattern stands out against the wider landscape, where ${PERIOD_LABELS_PERSONAL[topMappedPeriod]} makes up a smaller share of recorded finds`,
                        polarity: 'supporting',
                    });
                }
            }
        }
    }

    return { periodSignals, evidenceDirectives, topMappedPeriod, mappedTotal };
}

// Period display labels for personal finds evidence templates.
// Reuses the same labels as the evidence model.
const PERIOD_LABELS_PERSONAL: Record<ArchaeologicalPeriod, string> = {
    prehistoric_bronze_age: 'Prehistoric / Bronze Age',
    iron_age:               'Iron Age',
    romano_british:         'Roman',
    early_medieval:         'Early Medieval',
    medieval:               'Medieval',
    post_medieval:          'Post-Medieval',
    modern_industrial:      'Modern',
};
