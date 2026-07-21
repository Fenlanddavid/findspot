export const SM_INDEX_SCHEMA_VERSION = 2;
export const AIM_INDEX_SCHEMA_VERSION = 1;
export const SM_BUNDLE_PREFIX_LENGTH = 4;
export const AIM_BUNDLE_PREFIX_LENGTH = 4;
export const STATIC_DATA_GENERATION = 'v2';
export const SUPPORTED_STATIC_DATA_GENERATIONS = ['v1', STATIC_DATA_GENERATION] as const;

export type CurrentSmIndexMeta = {
  generationVersion: typeof STATIC_DATA_GENERATION;
  schemaVersion: typeof SM_INDEX_SCHEMA_VERSION;
  geometryMode: 'full-geojson';
  coverage?: string[];
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
      || (Array.isArray(value.coverage) && value.coverage.every(item => typeof item === 'string')));
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
