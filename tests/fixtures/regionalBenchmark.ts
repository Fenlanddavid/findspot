import type { GeologyContext, RawGeologyData } from '../../src/engines/geologyContext/geologyContextTypes';
import type { TerrainRegionType } from '../../src/services/fieldguide/landscapeInterpretation/regionalCalibration';

export function geology(raw: RawGeologyData): GeologyContext {
  return { raw, tileKey: 'synthetic', centroid: { lat: 52, lon: 0 }, source: {},
    landscapeClass: 'unknown', confidence: 'low', scoreModifier: 0, explanation: [],
    fetchedAt: 0, classifierVersion: 3, sourceVersion: 'synthetic' };
}

// Development examples. Expected values assert evidence handling, not
// archaeological truth. No real permission or field record is included.
export const regionalDevelopmentCases: Array<{ name: string; raw: RawGeologyData; expected: TerrainRegionType }> = [
  { name: 'Jurassic clay bedrock', raw: { bedrockName: 'Jurassic mudstone' }, expected: 'unknown' },
  { name: 'ancient marine sandstone', raw: { bedrockLithology: 'Marine sandstone' }, expected: 'unknown' },
  { name: 'chalk without measured relief', raw: { bedrockLithology: 'Chalk', bedrockAge: 'Cretaceous' }, expected: 'unknown' },
  { name: 'granite without land cover or relief', raw: { bedrockLithology: 'Granite' }, expected: 'unknown' },
  { name: 'mapped peat deposit', raw: { superficialLithology: 'Peat' }, expected: 'fen_peat' },
  { name: 'mapped alluvium', raw: { superficialName: 'Alluvium' }, expected: 'lowland_river_valley' },
  { name: 'mixed peat and alluvium', raw: { superficialName: 'Peat and alluvium' }, expected: 'unknown' },
  { name: 'unqualified sand and gravel', raw: { superficialLithology: 'Sand and gravel' }, expected: 'unknown' },
  { name: 'missing geology', raw: {}, expected: 'unknown' },
];
