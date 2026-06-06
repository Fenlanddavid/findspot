import type { GeologyContext, GeologyLandscapeClass, GeologyConfidence } from './geologyContextTypes';

// ─── Landscape class labels ───────────────────────────────────────────────────
// Human-readable, detecting-focused descriptions. Do not lead with jargon.

const LANDSCAPE_LABELS: Record<GeologyLandscapeClass, { label: string; detail: string }> = {
    peat_fen: {
        label: 'Peat / Fen',
        detail: 'Organic and wetland deposits. High preservation potential — organic finds, leather and bone may survive. Detecting depth and signal can be variable.',
    },
    alluvial_floodplain: {
        label: 'Alluvial Floodplain',
        detail: 'Flood-deposited silts and clays. Wet margin context — river crossing and settlement patterns are more significant here.',
    },
    river_gravel_terrace: {
        label: 'River Terrace Gravel',
        detail: 'Well-drained gravel terrace above the floodplain. Favoured for settlement. Route and crossing context carries strong weight.',
    },
    chalk_downland: {
        label: 'Chalk Downland',
        detail: 'Free-draining chalk. Dry valley ends, ridge tips and spring lines are the key signals. Minor elevation changes carry less weight here.',
    },
    heavy_clay: {
        label: 'Heavy Clay',
        detail: 'Clay-dominant landscape. Surface signals may be less reliable. Route corridors and settlement proximity are more significant indicators.',
    },
    sand_gravel: {
        label: 'Sand and Gravel',
        detail: 'Permeable sandy or gravelly ground. Artefacts can spread or shift — check upslope source areas when interpreting scatter patterns.',
    },
    foreshore: {
        label: 'Foreshore / Estuarine',
        detail: 'Tidal or estuarine deposits. Artefact survival is highly variable — erosion can expose finds but also disperse them. Check local erosion patterns and consult tide tables for safe access windows.',
    },
    mixed_uncertain: {
        label: 'Mixed Geology',
        detail: 'Geology data was returned but the landscape classification is uncertain for this tile. Signals interpreted without geology weighting.',
    },
    unknown: {
        label: 'Unknown',
        detail: 'No geology data available for this tile. FieldGuide used terrain, hydrology, route and historic signals only.',
    },
};

const CONFIDENCE_LABELS: Record<GeologyConfidence, string> = {
    high:   'High confidence',
    medium: 'Moderate confidence',
    low:    'Low confidence',
};

// ─── Raw name translation ─────────────────────────────────────────────────────
// Converts raw BGS geological names into plain English where possible.
// Falls back to the raw name with basic title-casing.

function formatRawName(raw: string | undefined): string {
    if (!raw) return '';
    const cleaned = raw.trim();
    if (!cleaned) return '';
    // Title-case the raw BGS string (which is often all-caps)
    return cleaned
        .toLowerCase()
        .replace(/\b(\w)/g, c => c.toUpperCase());
}

// ─── Caution strings ──────────────────────────────────────────────────────────

function buildCautions(context: GeologyContext): string[] {
    const cautions: string[] = [];

    if (context.raw.artificialGround?.present) {
        const type = context.raw.artificialGround.type;
        const typeLabel = type === 'made_ground'     ? 'made ground'
                        : type === 'worked_ground'   ? 'worked ground'
                        : type === 'disturbed_ground' ? 'disturbed ground'
                        : 'artificial ground';
        cautions.push(
            `Mapped ${typeLabel} is present in this area. Modern disturbance risk is increased — treat surface signals with additional caution.`
        );
    }

    if (context.raw.massMovement) {
        cautions.push(
            'Mapped mass movement (landslip or slope instability) is present. Artefacts may have moved downslope from their original position.'
        );
    }

    return cautions;
}

// ─── Display output type ──────────────────────────────────────────────────────

export type GeologyDisplayData = {
    landscapeLabel: string;
    landscapeDetail: string;
    confidenceLabel: string;
    bedrockLabel: string;
    superficialLabel: string;
    cautions: string[];
    phaseNote: string;
};

// ─── Main export ──────────────────────────────────────────────────────────────

export function buildGeologyDisplay(context: GeologyContext): GeologyDisplayData {
    const { label, detail } = LANDSCAPE_LABELS[context.landscapeClass];

    return {
        landscapeLabel:  label,
        landscapeDetail: detail,
        confidenceLabel: CONFIDENCE_LABELS[context.confidence],
        bedrockLabel:    formatRawName(context.raw.bedrockName || context.raw.bedrockLithology),
        superficialLabel: formatRawName(context.raw.superficialName || context.raw.superficialLithology),
        cautions:        buildCautions(context),
        phaseNote:       'FieldGuide has applied mapped geology to landscape interpretation. Scoring adjustments are active for this scan area.',
    };
}
