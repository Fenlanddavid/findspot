import type { RegisteredTableName } from '../services/backup/tableRegistry';

export type CacheStorageLayer =
  | 'indexeddb'
  | 'cache-storage'
  | 'local-storage'
  | 'durable-object'
  | 'edge-cache'
  | 'r2'
  | 'service-worker';

export type CacheExpiry =
  | { strategy: 'ttl'; durationMs: number }
  | { strategy: 'versioned'; versionSource: string }
  | { strategy: 'immutable' }
  | { strategy: 'manual' };

export type CachePolicy = {
  owner: string;
  storageLayer: CacheStorageLayer;
  expiry: CacheExpiry;
  versionSource?: string;
  backupClassification: 'excluded' | 'not-applicable';
  indexedDbTable?: RegisteredTableName;
  invalidationOwner: string;
};

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

/**
 * The permanent catalogue of FindSpot caches. A policy describes ownership and
 * invalidation; it does not pretend that ephemeral edge data and durable local
 * data have the same lifecycle.
 */
export const CACHE_POLICIES = {
  fieldGuideTerrain: {
    owner: 'src/services/fieldguide/terrainScanCoordinator.ts',
    storageLayer: 'indexeddb',
    expiry: { strategy: 'ttl', durationMs: DAY },
    versionSource: 'HOTSPOT_ENGINE_VERSION',
    backupClassification: 'excluded',
    indexedDbTable: 'fieldGuideCache',
    invalidationOwner: 'terrain scan coordinator',
  },
  fieldGuideHistoric: {
    owner: 'src/services/fieldguide/historicScanSupport.ts',
    storageLayer: 'indexeddb',
    expiry: { strategy: 'ttl', durationMs: DAY },
    versionSource: 'HISTORIC_CACHE_VERSION',
    backupClassification: 'excluded',
    indexedDbTable: 'fieldGuideCache',
    invalidationOwner: 'historic scan coordinator',
  },
  fieldGuideModernWays: {
    owner: 'src/services/fieldguide/terrainScanCoordinator.ts',
    storageLayer: 'indexeddb',
    expiry: { strategy: 'ttl', durationMs: 7 * DAY },
    backupClassification: 'excluded',
    indexedDbTable: 'fieldGuideCache',
    invalidationOwner: 'terrain scan coordinator',
  },
  geologyContext: {
    owner: 'src/engines/geologyContext/geologyContextTypes.ts',
    storageLayer: 'indexeddb',
    expiry: { strategy: 'ttl', durationMs: 90 * DAY },
    versionSource: 'GEOLOGY_CLASSIFIER_VERSION + GEOLOGY_SOURCE_VERSION',
    backupClassification: 'excluded',
    indexedDbTable: 'geologyContext',
    invalidationOwner: 'geology context cache service',
  },
  landscapeInterpretations: {
    owner: 'src/components/fieldGuide/HistoricLayerManager.tsx',
    storageLayer: 'indexeddb',
    expiry: { strategy: 'versioned', versionSource: 'LANDSCAPE_ENGINE_VERSION' },
    backupClassification: 'excluded',
    indexedDbTable: 'landscapeInterpretations',
    invalidationOwner: 'historic layer manager',
  },
  geocodeBrowser: {
    owner: 'src/services/geocode.ts',
    storageLayer: 'indexeddb',
    expiry: { strategy: 'ttl', durationMs: 180 * DAY },
    backupClassification: 'excluded',
    indexedDbTable: 'geocodeCache',
    invalidationOwner: 'geocode service',
  },
  discoverReferenceData: {
    owner: 'src/pages/Discover.tsx',
    storageLayer: 'local-storage',
    expiry: { strategy: 'ttl', durationMs: HOUR },
    backupClassification: 'not-applicable',
    invalidationOwner: 'Discover page',
  },
  offlinePack: {
    owner: 'src/services/offlinePack.ts',
    storageLayer: 'cache-storage',
    expiry: { strategy: 'manual' },
    versionSource: 'offline pack metadata and resource URL',
    backupClassification: 'not-applicable',
    invalidationOwner: 'offline pack service',
  },
  cacheStorageLookup: {
    owner: 'src/utils/cachedFetch.ts',
    storageLayer: 'cache-storage',
    expiry: { strategy: 'manual' },
    backupClassification: 'not-applicable',
    invalidationOwner: 'owning offline pack',
  },
  bgsEdge: {
    owner: 'workers/bgs-proxy/index.js',
    storageLayer: 'edge-cache',
    expiry: { strategy: 'ttl', durationMs: 7 * DAY },
    backupClassification: 'not-applicable',
    invalidationOwner: 'BGS proxy Worker',
  },
  geocodeEdge: {
    owner: 'workers/geocode-proxy/index.ts',
    storageLayer: 'edge-cache',
    expiry: { strategy: 'ttl', durationMs: 180 * DAY },
    backupClassification: 'not-applicable',
    invalidationOwner: 'geocode proxy Worker',
  },
  geocodeOrigin: {
    owner: 'workers/geocode-proxy/index.ts',
    storageLayer: 'durable-object',
    expiry: { strategy: 'ttl', durationMs: 365 * DAY },
    versionSource: 'GEOCODE_ORIGIN_CACHE_VERSION',
    backupClassification: 'not-applicable',
    invalidationOwner: 'GeocodeCoordinator Durable Object',
  },
  staticPas: {
    owner: 'workers/findspot-static/index.ts',
    storageLayer: 'r2',
    expiry: { strategy: 'ttl', durationMs: 7 * DAY },
    versionSource: 'R2 object key',
    backupClassification: 'not-applicable',
    invalidationOwner: 'static resource publisher',
  },
  staticHeritage: {
    owner: 'workers/findspot-static/index.ts',
    storageLayer: 'r2',
    expiry: { strategy: 'ttl', durationMs: DAY },
    versionSource: 'R2 object key',
    backupClassification: 'not-applicable',
    invalidationOwner: 'static resource publisher',
  },
  pwaPrecache: {
    owner: 'vite.config.ts',
    storageLayer: 'service-worker',
    expiry: { strategy: 'versioned', versionSource: 'Workbox revision manifest' },
    backupClassification: 'not-applicable',
    invalidationOwner: 'Vite PWA build',
  },
} as const satisfies Record<string, CachePolicy>;

export type CachePolicyId = keyof typeof CACHE_POLICIES;

export function cacheTtlMs(
  policy: CachePolicy,
): number {
  if (policy.expiry.strategy !== 'ttl') {
    throw new TypeError(`Cache policy for ${policy.owner} does not use a TTL`);
  }
  return policy.expiry.durationMs;
}
