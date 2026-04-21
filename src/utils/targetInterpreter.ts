// ─── Target interpretation layer ───────────────────────────────────────────────
// Produces hook, why-focus, and expanded reasoning for a Cluster (target point).
// Mirrors the structure of hotspotInterpreter.ts but tuned for precise, tactical
// language — "start here" rather than "investigate this zone".

import { Cluster } from '../pages/fieldGuideTypes';

// ─── Output types ─────────────────────────────────────────────────────────────

export type TargetSignalStrength = 'Strong Signal' | 'Moderate Signal' | 'Supporting Signal';

export interface TargetInterpretation {
    signalStrength:  TargetSignalStrength;
    hook:            string;
    focus:           string;
    summary:         string;
    whyItStandsOut:  string;
    howToApproach:   string;
}

// ─── Signal strength ──────────────────────────────────────────────────────────

export function getTargetSignalStrength(findPotential: number): TargetSignalStrength {
    if (findPotential >= 75) return 'Strong Signal';
    if (findPotential >= 50) return 'Moderate Signal';
    return 'Supporting Signal';
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

function buildHook(strength: TargetSignalStrength): string {
    switch (strength) {
        case 'Strong Signal':     return 'One of the clearest signal concentrations — start here';
        case 'Moderate Signal':   return 'Clear signal concentration — start here';
        case 'Supporting Signal': return 'A weaker point — use alongside stronger nearby targets';
    }
}

// ─── Focus ────────────────────────────────────────────────────────────────────

function buildFocus(f: Cluster): string {
    if (f.isOnCorridor)                     return 'Follow the alignment through this exact point';
    if (f.relativeElevation === 'Ridge')    return 'Work along the slope break — signals concentrate here';
    if (f.relativeElevation === 'Hollow')   return 'Start on the slightly raised edge beside lower ground';
    if (f.sources.includes('hydrology'))    return 'Start on the slightly raised edge beside lower ground';
    if (f.polarity === 'Raised')            return 'Start directly on the raised feature and work outward in a tight radius';
    if (f.polarity === 'Sunken')            return 'Work around the edge of this feature rather than the centre';
    return 'Start directly on this point and work outward in a tight radius';
}

// ─── Expanded reasoning ───────────────────────────────────────────────────────

function buildSummary(strength: TargetSignalStrength): string {
    switch (strength) {
        case 'Strong Signal':     return 'Multiple independent signals align strongly at this point.';
        case 'Moderate Signal':   return 'Signals from multiple sources align clearly at this point.';
        case 'Supporting Signal': return 'This point shows limited but notable signal agreement.';
    }
}

function buildWhyItStandsOut(f: Cluster, strength: TargetSignalStrength): string {
    if (strength === 'Strong Signal') {
        return f.sources.length >= 3
            ? 'Agreement across three or more independent data sources gives this point strong weight.'
            : 'Consistent detection across scans and terrain response increases confidence here.';
    }
    if (strength === 'Moderate Signal') {
        return 'Consistent detection across scans, terrain response, and nearby context increase confidence here.';
    }
    return 'Some terrain or signal indicators are present, but they do not align as strongly as higher-confidence points.';
}

function buildHowToApproach(strength: TargetSignalStrength): string {
    switch (strength) {
        case 'Strong Signal':     return 'Start directly on this point — this is one of the strongest signal concentrations.';
        case 'Moderate Signal':   return 'Start on this point and expand outward — signals are focused here.';
        case 'Supporting Signal': return 'Use this as a secondary point after checking stronger targets nearby.';
    }
}

// ─── Public entry point ───────────────────────────────────────────────────────

export function buildTargetInterpretation(f: Cluster): TargetInterpretation {
    const signalStrength = getTargetSignalStrength(f.findPotential);
    return {
        signalStrength,
        hook:           buildHook(signalStrength),
        focus:          buildFocus(f),
        summary:        buildSummary(signalStrength),
        whyItStandsOut: buildWhyItStandsOut(f, signalStrength),
        howToApproach:  buildHowToApproach(signalStrength),
    };
}
