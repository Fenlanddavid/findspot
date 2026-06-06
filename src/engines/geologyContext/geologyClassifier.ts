// GEOLOGY_RULE:
// Geology is modifier-only.
// It may alter interpretation, confidence and explanation.
// It must never create hotspots or targets.

import type { RawGeologyData, GeologyLandscapeClass, GeologyConfidence } from './geologyContextTypes';

// ─── Classification result ────────────────────────────────────────────────────
export type ClassificationResult = {
    landscapeClass: GeologyLandscapeClass;
    confidence: GeologyConfidence;
    explanation: string[];
};

// ─── Normalise helper ─────────────────────────────────────────────────────────
// Converts raw BGS text to uppercase for consistent matching.
function up(s: string | undefined): string {
    return (s ?? '').toUpperCase();
}

function contains(haystack: string, ...needles: string[]): boolean {
    return needles.some(n => haystack.includes(n.toUpperCase()));
}

// ─── Classification rules ─────────────────────────────────────────────────────
// Each rule tests raw BGS lithology/name strings.
// Rules are ordered from most specific to least specific.
// The first matching rule wins.

export function classifyGeology(raw: RawGeologyData): ClassificationResult {
    const bedrockLith = up(raw.bedrockLithology);
    const bedrockName = up(raw.bedrockName);
    const bedrockAge  = up(raw.bedrockAge);
    const superfLith  = up(raw.superficialLithology);
    const superfName  = up(raw.superficialName);

    const hasArtificial  = raw.artificialGround?.present === true;
    const hasMassMovement = raw.massMovement === true;
    const hasAnyBedrock   = !!(raw.bedrockName || raw.bedrockLithology);
    const hasAnySuperficial = !!(raw.superficialName || raw.superficialLithology);

    const explanation: string[] = [];

    // ── Artificial ground / mass movement cautions (applied regardless of class) ──
    if (hasArtificial) {
        explanation.push('Mapped artificial ground present — modern disturbance risk increased.');
    }
    if (hasMassMovement) {
        explanation.push('Mapped mass movement present — artefacts may have moved downslope.');
    }

    // ── Peat / fen / alluvium (superficial takes priority) ──
    if (
        contains(superfLith, 'PEAT', 'ALLUVIUM', 'ALLUVIAL', 'LACUSTRINE', 'TIDAL FLAT', 'ESTUARINE', 'MARSH') ||
        contains(superfName, 'PEAT', 'ALLUVIUM', 'ALLUVIAL', 'LACUSTRINE', 'TIDAL FLAT', 'ESTUARINE', 'FENLAND')
    ) {
        const isTidalOrEstuarine =
            contains(superfLith, 'TIDAL FLAT', 'ESTUARINE') ||
            contains(superfName, 'TIDAL', 'ESTUARINE');

        const landscapeClass: GeologyLandscapeClass = isTidalOrEstuarine
            ? 'peat_fen'
            : contains(superfLith, 'PEAT') || contains(superfName, 'PEAT', 'FEN')
                ? 'peat_fen'
                : 'alluvial_floodplain';

        explanation.push(
            landscapeClass === 'peat_fen'
                ? 'Peat or fen deposits mapped — high preservation potential, but detecting depth and signal reliability may vary.'
                : 'Alluvial deposits mapped — potential wet margin and flood plain context.'
        );

        return { landscapeClass, confidence: 'high', explanation };
    }

    // ── River terrace gravel ──
    if (
        contains(superfLith, 'RIVER TERRACE', 'TERRACE DEPOSIT', 'TERRACE GRAVEL', 'SAND AND GRAVEL', 'FLUVIOGLACIAL') ||
        contains(superfName, 'RIVER TERRACE', 'TERRACE DEPOSIT', 'TERRACE GRAVEL', 'FLUVIOGLACIAL')
    ) {
        explanation.push('River terrace gravel deposits mapped — dry well-drained ground near historic water crossing potential.');
        return { landscapeClass: 'river_gravel_terrace', confidence: 'high', explanation };
    }

    // ── Chalk ──
    if (
        contains(bedrockLith, 'CHALK') ||
        contains(bedrockName, 'CHALK')
    ) {
        explanation.push('Chalk bedrock mapped — dry valley, ridge end and spring line context relevant.');
        return { landscapeClass: 'chalk_downland', confidence: 'high', explanation };
    }

    // ── Heavy clay ──
    if (
        contains(bedrockLith, 'CLAY', 'MUDSTONE', 'ARGILLACEOUS') ||
        contains(bedrockName,
            'OXFORD CLAY', 'KIMMERIDGE CLAY', 'LIAS', 'LONDON CLAY',
            'GAULT', 'WEALD CLAY', 'CLAY', 'MUDSTONE'
        ) ||
        contains(superfLith, 'CLAY', 'LACUSTRINE CLAY') ||
        contains(superfName, 'BOULDER CLAY', 'TILL', 'CLAY')
    ) {
        explanation.push('Heavy clay landscape — surface signals may be less reliable; route and settlement context carry more weight.');
        return { landscapeClass: 'heavy_clay', confidence: 'high', explanation };
    }

    // ── Sand and gravel (non-terrace) ──
    if (
        contains(bedrockLith, 'SANDSTONE', 'SAND', 'GRAVEL', 'QUARTZITE') ||
        contains(superfLith, 'SAND', 'GRAVEL', 'BLOWN SAND') ||
        contains(superfName, 'SAND', 'GRAVEL', 'BLOWN SAND')
    ) {
        explanation.push('Sandy or gravelly deposits mapped — artefact spread or movement risk may be increased; check upslope source area.');
        return { landscapeClass: 'sand_gravel', confidence: 'medium', explanation };
    }

    // ── Mixed / uncertain — data present but no clear match ──
    if (hasAnyBedrock || hasAnySuperficial) {
        explanation.push('Geology data returned but landscape classification is uncertain for this tile.');
        return { landscapeClass: 'mixed_uncertain', confidence: 'low', explanation };
    }

    // ── Unknown — no data ──
    return {
        landscapeClass: 'unknown',
        confidence: 'low',
        explanation: ['No geology data returned for this tile.'],
    };
}
