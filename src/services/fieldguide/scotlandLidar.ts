// NLS multi-direction hillshade, derived from Scottish public sector DTM surveys.
// The survey phases have separate tile sets and incomplete, overlapping coverage.
const EARLY_SURVEY_CREDIT = 'Crown copyright Scottish Government, SEPA, Fugro and Scottish Water (2012–2021)';
const PHASE_6_CREDIT = 'Crown copyright Scottish Government and Fugro (2022)';

export const SCOTLAND_LIDAR_PHASES = [
    { name: 'phase1', bounds: [-5.64082049, 54.75447998, -1.75109870, 59.16445469], maxzoom: 16, credit: EARLY_SURVEY_CREDIT },
    { name: 'phase2', bounds: [-6.45731344, 55.42393632, -1.10455815, 60.21362318], maxzoom: 16, credit: EARLY_SURVEY_CREDIT },
    { name: 'phase3', bounds: [-5.20888029, 54.58438826, -1.76291556, 56.16226120], maxzoom: 17, credit: EARLY_SURVEY_CREDIT },
    { name: 'phase4', bounds: [-5.06296279, 55.03117110, -2.00156025, 56.54875244], maxzoom: 17, credit: EARLY_SURVEY_CREDIT },
    { name: 'phase5', bounds: [-4.72643490, 55.67676503, -2.48441827, 56.50383840], maxzoom: 17, credit: EARLY_SURVEY_CREDIT },
    { name: 'phase6', bounds: [-5.03248614, 55.53402677, -4.14607739, 55.98785472], maxzoom: 17, credit: PHASE_6_CREDIT },
    { name: 'hebrides', bounds: [-7.47930274, 57.04121284, -6.12453882, 58.52140630], maxzoom: 17, credit: EARLY_SURVEY_CREDIT },
] as const;

export const SCOTLAND_LIDAR_LAYER_IDS = SCOTLAND_LIDAR_PHASES.map(phase => `overlay-lidar-scotland-${phase.name}`);

export function scotlandLidarAttribution(credit: string): string {
    return `${credit}. Hillshade by Richard Pearson, via National Library of Scotland (OGL v3).`;
}
