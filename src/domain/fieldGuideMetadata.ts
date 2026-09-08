import type { Hotspot, HotspotClassification } from '../pages/fieldGuideTypes';

/** Shared domain wording. Engines/services return keys; UI renders these labels. */
export const HOTSPOT_TITLES: Record<HotspotClassification, string> = {
  'Crossing Point Candidate': 'Crossing Point',
  'Junction / Convergence Zone': 'Route Junction',
  'Settlement Edge Candidate': 'Settlement Edge',
  'Burial / Barrow Candidate': 'Legacy Burial / Barrow label',
  'Circular Terrain Feature': 'Circular Terrain Feature',
  'Organised Field System Candidate': 'Field System',
  'Palaeochannel Activity Zone': 'Possible Former Watercourse',
  'Wetland Margin Activity Zone': 'Possible Wetland Margin',
  'Route-Side Activity Zone': 'Movement Corridor',
  'Multi-Period Occupation Zone': 'Legacy Multi-Period label',
  'Terrain Structure Candidate': 'Structural Feature',
  'Spectral Activity Candidate': 'Vegetation Signal',
  'Lowland Activity Zone': 'Lowland Activity Zone',
  'Raised Activity Area': 'Raised Activity Area',
  'Route-Influenced Area': 'Route-Influenced Area',
  'Cropmark Activity Zone': 'Vegetation Activity Zone',
  'Multi-Signal Activity Zone': 'Multi-Signal Activity Zone',
  'General Activity Zone': 'Supporting Activity Zone',
};

export type HotspotResultHierarchy = {
  signalStrength: 'Developing Signal' | 'Strong Signal' | 'Corroborated Signal';
  whatWasObserved: string;
  nextAction: string;
};

const OBSERVATION_WORDING: Record<HotspotClassification, string> = {
  'Crossing Point Candidate': 'Movement geometry narrows at this location; a crossing interpretation remains possible.',
  'Junction / Convergence Zone': 'Several mapped or observed movement lines meet in this area.',
  'Settlement Edge Candidate': 'Raised edge morphology occurs with activity context; settlement function is not confirmed.',
  'Burial / Barrow Candidate': 'A legacy result describes compact raised morphology; its date and funerary function are unconfirmed.',
  'Circular Terrain Feature': 'A circular raised morphology is visible, but its date and function are not established.',
  'Organised Field System Candidate': 'Repeated linear morphology may represent managed land division or a modern/agricultural alternative.',
  'Palaeochannel Activity Zone': 'A channel-like morphology is visible; it is not a confirmed former watercourse without physical hydrology evidence.',
  'Wetland Margin Activity Zone': 'Available evidence suggests a possible wet-margin relationship, with natural and modern drainage alternatives.',
  'Route-Side Activity Zone': 'Landscape observations align with a mapped movement corridor.',
  'Multi-Period Occupation Zone': 'This is a legacy label. Observation sources alone cannot establish chronology or occupation.',
  'Terrain Structure Candidate': 'Measured terrain or rendered-relief observations indicate a defined morphology.',
  'Spectral Activity Candidate': 'An exploratory RGB vegetation response suggests surface variation; cause and date are unknown.',
  'Lowland Activity Zone': 'Observed signals cluster on lower ground; archaeological activity is one possible explanation.',
  'Raised Activity Area': 'Measured terrain indicates locally raised ground with supporting context.',
  'Route-Influenced Area': 'Nearby route context may relate to the observed signal.',
  'Cropmark Activity Zone': 'An exploratory vegetation response is visible; independence and cause depend on source provenance.',
  'Multi-Signal Activity Zone': 'Distinct observations overlap here, while competing interpretations remain possible.',
  'General Activity Zone': 'Several weaker observations overlap without a secure functional interpretation.',
};

export function getHotspotResultHierarchy(
  hotspot: Hotspot,
  strength: 'Strong Zone' | 'Moderate Zone' | 'Developing Zone',
): HotspotResultHierarchy {
  const signalStrength = strength === 'Strong Zone'
    ? 'Corroborated Signal'
    : strength === 'Moderate Zone'
      ? 'Strong Signal'
      : 'Developing Signal';
  const nextAction = hotspot.suggestedFocus
    ?? (hotspot.isOnCorridor
      ? 'Compare the historic layer and review the corridor edge.'
      : hotspot.metrics.signalClassCount >= 3
        ? 'Compare source identities and alternatives before marking a target.'
        : 'Review the evidence breakdown and field coverage.');
  return {
    signalStrength,
    whatWasObserved: hotspot.classificationReason || OBSERVATION_WORDING[hotspot.classification],
    nextAction,
  };
}
