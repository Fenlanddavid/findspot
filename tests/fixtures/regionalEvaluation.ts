import type { RawGeologyData } from '../../src/engines/geologyContext/geologyContextTypes';

// Frozen synthetic evaluation partition, 2026-09-09. Not archaeological ground
// truth. Do not tune this version from these outputs; replace any case used in
// future development before claiming another held-out evaluation.
export const regionalEvaluationCases: Array<{ id: string; raw: RawGeologyData }> = [
  { id: 'E01', raw: { bedrockName: 'Upper Cretaceous marine mudstone', bedrockAge: 'Cretaceous' } },
  { id: 'E02', raw: { bedrockName: 'Carboniferous limestone', superficialName: 'Glacial till' } },
  { id: 'E03', raw: { bedrockName: 'Peat-bearing ancient formation', superficialLithology: 'Clay' } },
  { id: 'E04', raw: { bedrockLithology: 'Basalt', superficialName: 'Alluvium with peat' } },
  { id: 'E05', raw: { superficialName: 'Estuarine sand and silt', bedrockAge: 'Jurassic' } },
];
