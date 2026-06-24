// ─── Glance Card reading helpers ──────────────────────────────────────────────
// Pure functions that derive the headline and "why?" chip content from the
// existing ALIE v5 output. No engine imports — pure consumer of output types.

import type {
    ArchaeologicalEvidenceAssessment,
    EvidenceSource,
    LandscapeInterpretation,
} from '../../types/landscapeInterpretation';
import { INTERPRETATION_LABELS, CONFIDENCE_LABELS } from '../../utils/landscapeLabels';

// ─── Source chip labels ───────────────────────────────────────────────────────
// Short plain-language phrases mapped by EvidenceSource.
// These read as DIFFERENT reasons — one chip per distinct source.

export const SOURCE_CHIP_LABELS: Record<EvidenceSource, string> = {
    terrain:          'Elevated / terrain position',
    hydrology:        'Water relationship',
    geology:          'Favourable geology',
    historic_routes:  'Historic movement',
    historic_records: 'Recorded heritage nearby',
    remote_sensing:   'Cropmark / survey signal',
    derived_model:    'Model inference',
};

export interface GlanceReason {
    source: EvidenceSource;
    label: string;
}

// ─── glanceReasons ────────────────────────────────────────────────────────────
// Returns up to `max` source-distinct "why?" chips from the supporting evidence.
// supportingEvidence is already weight-sorted and supporting-polarity-only (upstream).
// Never pads — returns fewer than max when fewer distinct sources exist.

export function glanceReasons(
    assessment: ArchaeologicalEvidenceAssessment,
    max = 3,
): GlanceReason[] {
    const seen = new Set<EvidenceSource>();
    const result: GlanceReason[] = [];
    for (const item of assessment.supportingEvidence) {
        if (seen.has(item.source)) continue;
        seen.add(item.source);
        result.push({ source: item.source, label: SOURCE_CHIP_LABELS[item.source] });
        if (result.length >= max) break;
    }
    return result;
}

// ─── glanceHeadline ───────────────────────────────────────────────────────────
// Returns a hedged title and the softened signal-strength label.
// NEVER returns a bald "High" — always uses CONFIDENCE_LABELS.

export function glanceHeadline(interp: LandscapeInterpretation): {
    title: string;
    strengthLabel: string;
} {
    const primaryScore = interp.interpretationScores.find(
        s => s.interpretationId === interp.primaryInterpretationId,
    );
    const title = interp.primaryInterpretationId
        ? `This area reads as ${INTERPRETATION_LABELS[interp.primaryInterpretationId]}`
        : 'Mixed signals — no single dominant reading';
    const strengthLabel = primaryScore
        ? CONFIDENCE_LABELS[primaryScore.confidenceTier]
        : CONFIDENCE_LABELS['lower'];
    return { title, strengthLabel };
}
