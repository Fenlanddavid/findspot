export const SM_INDEX_SCHEMA_VERSION = 2;
export const AIM_INDEX_SCHEMA_VERSION = 1;
export const SM_BUNDLE_PREFIX_LENGTH = 4;
export const AIM_BUNDLE_PREFIX_LENGTH = 4;
export const STATIC_DATA_GENERATION = 'v2';
export const SUPPORTED_STATIC_DATA_GENERATIONS = ['v1', STATIC_DATA_GENERATION] as const;
export const ROMAN_ROADS_DATASET = {
  assetPath: 'roman-roads-gb.geojson',
  generation: 'rrra-digital-britannia-v1.0-2026-07-26',
  inputFeatureCount: 3_572,
  builtFeatureCount: 3_505,
  builtBytes: 1_417_865,
  inputSha256: 'ff4caff0b4446554660b117304554b51e7e9b1420c262f3dbdf60c0f1454b9d2',
} as const;

export function romanRoadsAssetRequestPath(): string {
  return `${ROMAN_ROADS_DATASET.assetPath}?generation=${encodeURIComponent(ROMAN_ROADS_DATASET.generation)}`;
}

export type CurrentSmIndexMeta = {
  generationVersion: typeof STATIC_DATA_GENERATION;
  schemaVersion: typeof SM_INDEX_SCHEMA_VERSION;
  geometryMode: 'full-geojson';
  coverage?: string[];
  builtAt?: string;
  sources?: Array<{ name: string; licence?: string; attribution?: string }>;
};

export type CurrentAimIndexMeta = {
  generationVersion: typeof STATIC_DATA_GENERATION;
  schemaVersion: typeof AIM_INDEX_SCHEMA_VERSION;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isCurrentSmIndexMeta(value: unknown): value is CurrentSmIndexMeta {
  if (!isRecord(value)) return false;
  return value.generationVersion === STATIC_DATA_GENERATION
    && value.schemaVersion === SM_INDEX_SCHEMA_VERSION
    && value.geometryMode === 'full-geojson'
    && (value.coverage === undefined
      || (Array.isArray(value.coverage) && value.coverage.every(item => typeof item === 'string')))
    && (value.builtAt === undefined || typeof value.builtAt === 'string')
    && (value.sources === undefined || (Array.isArray(value.sources) && value.sources.every(source =>
      isRecord(source)
      && typeof source.name === 'string'
      && (source.licence === undefined || typeof source.licence === 'string')
      && (source.attribution === undefined || typeof source.attribution === 'string')
    )));
}

export function isCurrentAimIndexMeta(value: unknown): value is CurrentAimIndexMeta {
  return isRecord(value)
    && value.generationVersion === STATIC_DATA_GENERATION
    && value.schemaVersion === AIM_INDEX_SCHEMA_VERSION;
}

function generationKey(key: string, generation = STATIC_DATA_GENERATION): string {
  return `${generation}/${key}`;
}

export const STATIC_DATASET_KEYS = {
  smMeta: generationKey('sm-index/_meta.json'),
  aimMeta: generationKey('aim-index/_meta.json'),
} as const;

export function smShardKey(cell: string, generation = STATIC_DATA_GENERATION): string {
  return generationKey(`sm-index/${cell}.json`, generation);
}

export function smBundleKey(cell: string, generation = STATIC_DATA_GENERATION): string {
  return generationKey(`sm-index/bundles/${cell.slice(0, SM_BUNDLE_PREFIX_LENGTH)}.bin`, generation);
}

export function smBundleIndexKey(cell: string, generation = STATIC_DATA_GENERATION): string {
  return generationKey(`sm-index/bundles/${cell.slice(0, SM_BUNDLE_PREFIX_LENGTH)}.index.json`, generation);
}

export function aimShardKey(cell: string, generation = STATIC_DATA_GENERATION): string {
  return generationKey(`aim-index/${cell}.json`, generation);
}

export function aimBundleKey(cell: string, generation = STATIC_DATA_GENERATION): string {
  return generationKey(`aim-index/bundles/${cell.slice(0, AIM_BUNDLE_PREFIX_LENGTH)}.json`, generation);
}

export function staticDatasetUrl(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${key}`;
}
