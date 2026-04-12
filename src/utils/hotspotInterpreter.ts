// ─── Hotspot interpretation layer ─────────────────────────────────────────────
// Builds a human-readable 3-part interpretation (summary, reasoning, strategy)
// for a hotspot entirely on-device. No external calls, no AI, deterministic.
// Variation is seeded from a hash of the hotspot so each hotspot gets consistent
// but distinct phrasing.

import { Hotspot, HotspotClassification } from '../pages/fieldGuideTypes';

// ─── Output type ──────────────────────────────────────────────────────────────

export interface Interpretation {
    summary:   string;
    reasoning: string;
    strategy:  string;
}

// ─── Confidence tier (internal — simplified from Hotspot confidence labels) ───

type ConfidenceTier = 'High' | 'Strong' | 'Moderate' | 'Low';

function toTier(confidence: Hotspot['confidence']): ConfidenceTier {
    if (confidence === 'High Probability') return 'High';
    if (confidence === 'Strong Signal')    return 'Strong';
    if (confidence === 'Emerging Signal')  return 'Moderate';
    return 'Low';
}

// ─── Deterministic hash ───────────────────────────────────────────────────────

function hash(str: string): number {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = (h << 5) - h + str.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h);
}

function pick<T>(arr: T[], seed: number): T {
    return arr[seed % arr.length];
}

// ─── Tone prefixes ────────────────────────────────────────────────────────────

const summaryPrefix: Record<ConfidenceTier, string> = {
    High:     '',
    Strong:   '',
    Moderate: 'This reads as ',
    Low:      'This area shows signs of ',
};

const strategyPrefix: Record<ConfidenceTier, string> = {
    High:     '',
    Strong:   '',
    Moderate: '',
    Low:      'Focus on testing the area first — ',
};

const reasoningStarters: Record<ConfidenceTier, string[]> = {
    High:     ['It stands out because'],
    Strong:   ['It stands out because', 'This stands out due to'],
    Moderate: ['This stands out due to', 'This is highlighted by'],
    Low:      ['This is suggested by'],
};

// ─── Microcopy pools ──────────────────────────────────────────────────────────

const pools: Record<HotspotClassification, { summaries: string[]; strategies: string[] }> = {
    'Crossing Point Candidate': {
        summaries: [
            'a likely crossing point where movement converges across the landscape.',
            'a natural crossing where activity is drawn into a tighter space.',
            'a convergence point where routes compress into a focused area.',
        ],
        strategies: [
            'start at the tightest crossing point, then work outward into surrounding ground.',
            'focus on the narrowest part of the crossing before expanding your search.',
            'begin where movement is most constrained, then widen out from that point.',
        ],
    },
    'Junction / Convergence Zone': {
        summaries: [
            'a junction where multiple movement routes intersect.',
            'a convergence zone where different movement lines meet.',
            'an intersection point linking multiple pathways through the landscape.',
        ],
        strategies: [
            'start at the intersection point, then follow each route outward.',
            'focus on the central junction before working along the connecting lines.',
            'begin where routes meet, then expand along the strongest directions.',
        ],
    },
    'Settlement Edge Candidate': {
        summaries: [
            'a settlement edge on raised ground with strong surrounding activity context.',
            'the edge of a settlement sitting on slightly higher ground.',
            'a transition zone where settlement activity meets surrounding ground.',
        ],
        strategies: [
            'start along the raised edge first, then widen out from the clearest structural side.',
            'begin on the higher edge and work outward.',
            'focus on the transition line before covering the wider area.',
        ],
    },
    'Wetland Margin Activity Zone': {
        summaries: [
            'activity focused around lower, wetter ground.',
            'use of the landscape around a wet margin or former water feature.',
            'activity concentrated along wetter terrain.',
        ],
        strategies: [
            'focus on edges of wet ground rather than the centre.',
            'work along transition zones between wet and dry ground.',
            'target margins and pinch points first.',
        ],
    },
    'Route-Side Activity Zone': {
        summaries: [
            'a movement corridor shaped by repeated activity through the landscape.',
            'a route-led corridor where movement has focused activity over time.',
            'a consistent movement line rather than a fixed activity point.',
        ],
        strategies: [
            'follow the movement line first, then extend your search to either side.',
            'work along the route before widening out.',
            'start on the clearest linear feature, then expand outward.',
        ],
    },
    'Terrain Structure Candidate': {
        summaries: [
            'a structural feature defined by clear terrain or subsurface signals.',
            'a distinct feature within the landscape suggesting built or defined structure.',
            'a concentrated area of structural signals rather than general activity.',
        ],
        strategies: [
            'start at the strongest structural signal, then work around its edges.',
            'focus on the centre of the feature before expanding outward.',
            'begin with the most defined part of the structure, then cover the surrounding area.',
        ],
    },
    'Spectral Activity Candidate': {
        summaries: [
            'a cropmark signal indicating underlying variation in the ground.',
            'a spectral anomaly visible through aerial response rather than terrain.',
            'a signal driven by crop response rather than physical surface features.',
        ],
        strategies: [
            'start along the clearest cropmark edge, then expand across the feature.',
            'focus on the strongest visible anomaly first, then widen out.',
            'work across the cropmark pattern rather than randomly covering the area.',
        ],
    },
    'Lowland Activity Zone': {
        summaries: [
            'activity concentrated in lower-lying ground within the landscape.',
            'a lowland area where signals cluster around flatter or lower terrain.',
            'activity focused within lower ground rather than elevated areas.',
        ],
        strategies: [
            'start along the lowest ground line, then work outward.',
            'focus on flatter low-lying areas before moving upslope.',
            'begin in the most level ground, then expand toward surrounding terrain.',
        ],
    },
    'Raised Activity Area': {
        summaries: [
            'activity concentrated on higher, drier ground within the landscape.',
            'a raised area where signals cluster on elevated terrain.',
            'activity focused on slight elevation above surrounding ground.',
        ],
        strategies: [
            'start on the highest point, then work downslope.',
            'focus on elevated ground before expanding outward.',
            'begin on the crest or ridge, then widen your search.',
        ],
    },
    'Route-Influenced Area': {
        summaries: [
            'an area influenced by nearby movement routes shaping activity.',
            'activity shaped by proximity to a route rather than a fixed feature.',
            'a zone where route proximity influences how the area was used.',
        ],
        strategies: [
            'start nearest the route, then work outward into the surrounding area.',
            'focus on areas closest to movement lines before expanding away.',
            'begin along the route edge, then widen your search.',
        ],
    },
    'Cropmark Activity Zone': {
        summaries: [
            'activity indicated through consistent cropmark patterns across the area.',
            'a zone where cropmark signals suggest underlying activity.',
            'an area defined by repeated cropmark response rather than terrain.',
        ],
        strategies: [
            'start where cropmarks are strongest, then expand across the pattern.',
            'focus on the clearest cropmark zones before covering weaker areas.',
            'work systematically across the cropmark pattern rather than randomly.',
        ],
    },
    'Multi-Signal Activity Zone': {
        summaries: [
            'an area where multiple independent signals align in the same location.',
            'a zone defined by agreement across different data sources.',
            'activity highlighted by convergence of multiple signal types.',
        ],
        strategies: [
            'start at the strongest point of overlap, then expand outward.',
            'focus on areas where signals align most clearly first.',
            'begin at the centre of convergence, then widen your search.',
        ],
    },
    'General Activity Zone': {
        summaries: [
            'consistent signals of past activity.',
            'repeated activity within the landscape.',
            'multiple aligned signals in one area.',
        ],
        strategies: [
            'start with the strongest signal area, then expand outward.',
            'focus on any visible pattern first before covering the full area.',
            'begin where activity appears most concentrated, then widen your search.',
        ],
    },
};

// ─── Sub-builders ─────────────────────────────────────────────────────────────

function buildSummary(h: Hotspot, tier: ConfidenceTier, seed: number): string {
    const pool = pools[h.classification];
    const base = pool ? pick(pool.summaries, seed) : pick([
        'consistent signals of past activity.',
        'repeated activity within the landscape.',
        'multiple aligned signals in one area.',
    ], seed);
    return summaryPrefix[tier] + base;
}

// Clean a single explanation line for natural-language embedding:
// lowercase + replace " + " with " and " + restore known proper nouns.
function cleanLine(line: string): string {
    return line
        .toLowerCase()
        .replace(/\s*\+\s*/g, ' and ')
        .replace(/\blidar\b/g, 'LiDAR');
}

function joinLines(lines: string[]): string {
    if (lines.length === 0) return '';
    if (lines.length === 1) return lines[0];
    if (lines.length === 2) return `${lines[0]} and ${lines[1]}`;
    return `${lines.slice(0, -1).join(', ')}, and ${lines[lines.length - 1]}`;
}

function buildReasoning(h: Hotspot, tier: ConfidenceTier, seed: number): string {
    const cleaned = h.explanation.slice(0, 3).map(cleanLine);
    const starter = pick(reasoningStarters[tier], seed);
    let reasoning = `${starter} ${joinLines(cleaned)}.`;
    if (tier === 'High') {
        reasoning += ' The level of agreement across signals increases confidence here.';
    }
    return reasoning;
}

function capitalise(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildStrategy(h: Hotspot, tier: ConfidenceTier, seed: number): string {
    const pool = pools[h.classification];
    const base = pool ? pick(pool.strategies, seed) : pick([
        'start with the strongest signal area, then expand outward.',
        'focus on any visible pattern first before covering the full area.',
        'begin where activity appears most concentrated, then widen your search.',
    ], seed);
    return capitalise(strategyPrefix[tier] + base);
}

// ─── Tone anchor label (shown above summary in UI) ────────────────────────────

export function getInterpretationLabel(confidence: Hotspot['confidence']): string {
    return `${toTier(confidence)} Signal Insight`;
}

// ─── Public entry point ───────────────────────────────────────────────────────

export function buildInterpretation(h: Hotspot): Interpretation {
    // Guard: don't interpret a hotspot with no explanation lines
    if (!h.explanation || h.explanation.length === 0) {
        return {
            summary:   'Insufficient signal data to interpret this area.',
            reasoning: 'No explanation lines were produced by the engine.',
            strategy:  'Scan at a closer zoom level to capture more detail.',
        };
    }

    const seed      = hash(h.id + h.classification + h.confidence);
    const tier      = toTier(h.confidence);
    const summary   = buildSummary(h, tier, seed);
    const reasoning = buildReasoning(h, tier, seed);
    const strategy  = buildStrategy(h, tier, seed);

    return { summary, reasoning, strategy };
}
