import type { EvidenceProvenance } from '../../types/evidenceProvenance';

export interface TerrainMeasurementSupportSample {
  coordinate: [number, number];
  /** Bilinear contribution to the feature-location result. */
  weight: number;
  provenance: EvidenceProvenance[];
}

export interface TerrainMeasurement {
  lon: number;
  lat: number;
  elevationM: number;
  slopePercent: number;
  aspectDegrees: number | null;
  relativeReliefM: number;
  relativeReliefNorm: number;
  role: 'landscape_context' | 'feature_location' | 'feature_footprint_summary';
  method: 'grid_sample' | 'direct_sample' | 'bilinear_interpolation' | 'footprint_summary';
  analysisWindowRadiusM: number;
  outputPixelSpacingM: number;
  /** Null when the provider does not establish native/effective resolution. */
  sourceResolutionM: number | null;
  supportCoordinates: Array<[number, number]>;
  /** Source lineage retained for every sample with non-zero contribution. */
  supportSamples: TerrainMeasurementSupportSample[];
  distanceFromFeatureM?: number;
  maxSupportDistanceM?: number;
  limitations: string[];
  provenance: EvidenceProvenance[];
}

export function decodeTerrariumPixel(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export function metresPerPixel(latitude: number, zoom: number): number {
  return 156543.03392804097 * Math.cos(latitude * Math.PI / 180) / 2 ** zoom;
}

export interface ElevationDerivatives {
  elevationM: number;
  slopePercent: number;
  aspectDegrees: number | null;
  relativeReliefM: number;
  relativeReliefNorm: number;
}

/**
 * Calculate physical derivatives from an elevation grid. `windowRadiusPx` is
 * a ground-unit analysis window converted by the caller. Null/nodata cells and
 * incomplete neighbourhoods abstain rather than creating seam artefacts.
 */
export function calculateElevationDerivatives(
  elevations: Float32Array,
  valid: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  groundResolutionM: number,
  windowRadiusPx: number,
): ElevationDerivatives | null {
  if (!Number.isFinite(groundResolutionM) || groundResolutionM <= 0) return null;
  if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) return null;
  const at = (px: number, py: number) => py * width + px;
  for (let py = y - 1; py <= y + 1; py++) {
    for (let px = x - 1; px <= x + 1; px++) if (!valid[at(px, py)]) return null;
  }

  const z1 = elevations[at(x - 1, y - 1)], z2 = elevations[at(x, y - 1)], z3 = elevations[at(x + 1, y - 1)];
  const z4 = elevations[at(x - 1, y)],     z5 = elevations[at(x, y)],     z6 = elevations[at(x + 1, y)];
  const z7 = elevations[at(x - 1, y + 1)], z8 = elevations[at(x, y + 1)], z9 = elevations[at(x + 1, y + 1)];
  const dzdx = ((z3 + 2 * z6 + z9) - (z1 + 2 * z4 + z7)) / (8 * groundResolutionM);
  const dzdyNorth = ((z1 + 2 * z2 + z3) - (z7 + 2 * z8 + z9)) / (8 * groundResolutionM);
  const gradient = Math.hypot(dzdx, dzdyNorth);
  // Aspect is the direction water would travel: the downhill (negative
  // gradient) vector. atan2(east, north) yields compass degrees clockwise
  // from north for the coordinate convention used by this grid.
  const aspectDegrees = gradient < 1e-8
    ? null
    : (Math.atan2(-dzdx, -dzdyNorth) * 180 / Math.PI + 360) % 360;

  const radius = Math.max(2, Math.floor(windowRadiusPx));
  if (x < radius || y < radius || x >= width - radius || y >= height - radius) return null;
  let ringSum = 0;
  let ringCount = 0;
  for (let py = y - radius; py <= y + radius; py++) {
    for (let px = x - radius; px <= x + radius; px++) {
      const distance = Math.hypot(px - x, py - y);
      if (distance < radius * 0.75 || distance > radius) continue;
      const i = at(px, py);
      if (!valid[i]) return null;
      ringSum += elevations[i];
      ringCount++;
    }
  }
  if (ringCount < 8) return null;
  const relativeReliefM = z5 - ringSum / ringCount;
  return {
    elevationM: z5,
    slopePercent: gradient * 100,
    aspectDegrees,
    relativeReliefM,
    relativeReliefNorm: relativeReliefM / Math.max(1, radius * groundResolutionM),
  };
}
