export const SM_INDEX_SCHEMA_VERSION = 2;
export const AIM_INDEX_SCHEMA_VERSION = 1;
export const AIM_BUNDLE_PREFIX_LENGTH = 4;

export const STATIC_DATASET_KEYS = {
  smMeta: 'sm-index/_meta.json',
  aimMeta: 'aim-index/_meta.json',
} as const;

export function smShardKey(cell: string): string {
  return `sm-index/${cell}.json`;
}

export function aimShardKey(cell: string): string {
  return `aim-index/${cell}.json`;
}

export function aimBundleKey(cell: string): string {
  return `aim-index/bundles/${cell.slice(0, AIM_BUNDLE_PREFIX_LENGTH)}.json`;
}

export function staticDatasetUrl(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${key}`;
}
