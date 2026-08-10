/**
 * Surface-observation periods follow the PAS broad-period vocabulary so a
 * user's field impression has one stable local value and one direct external
 * mapping. Keep UNKNOWN: absence of a period impression is a valid record.
 */
export const SURFACE_PERIOD_VALUES = [
  'palaeolithic',
  'mesolithic',
  'neolithic',
  'bronze_age',
  'iron_age',
  'roman',
  'early_medieval',
  'medieval',
  'post_medieval',
  'modern',
  'unknown',
] as const;

export type SurfacePeriod = typeof SURFACE_PERIOD_VALUES[number];
export type LegacySurfacePeriod = 'anglo_saxon' | 'prehistoric';

/**
 * Vocabulary-only normalization. It must never append reassessment history:
 * Anglo-Saxon is an Early Medieval synonym, while broad Prehistoric cannot be
 * narrowed honestly and therefore becomes unknown.
 */
export function canonicalSurfacePeriod(value: unknown): unknown {
  if (value === 'anglo_saxon') return 'early_medieval';
  if (value === 'prehistoric') return 'unknown';
  return value;
}
