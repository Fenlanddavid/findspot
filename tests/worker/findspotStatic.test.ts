import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AIM_INDEX_SCHEMA_VERSION,
  SM_INDEX_SCHEMA_VERSION,
  STATIC_DATA_GENERATION,
  STATIC_DATASET_KEYS,
  aimBundleKey,
  aimShardKey,
  smBundleIndexKey,
  smBundleKey,
  smShardKey,
} from '../../src/shared/staticDatasetContract';

const CELL = 'gcpvj0';

const fixtures = [
  {
    key: STATIC_DATASET_KEYS.smMeta,
    value: { generationVersion: STATIC_DATA_GENERATION, schemaVersion: SM_INDEX_SCHEMA_VERSION, geometryMode: 'full-geojson' },
  },
  {
    key: STATIC_DATASET_KEYS.aimMeta,
    value: { generationVersion: STATIC_DATA_GENERATION, schemaVersion: AIM_INDEX_SCHEMA_VERSION },
  },
] as const;

beforeEach(async () => {
  await Promise.all([
    ...fixtures.map(({ key, value }) => env.STATIC_BUCKET.put(
      key,
      JSON.stringify(value),
      { httpMetadata: { contentType: 'application/json' } },
    )),
    env.STATIC_BUCKET.put(
      aimBundleKey(CELL),
      JSON.stringify({ [CELL]: [{ monumentType: 'ENCLOSURE' }] }),
      { httpMetadata: { contentType: 'application/json' } },
    ),
    env.STATIC_BUCKET.put(smBundleIndexKey(CELL), JSON.stringify({ [CELL]: [2, 39] })),
    env.STATIC_BUCKET.put(smBundleKey(CELL), '[][{"listEntry":"1000001","name":"Test"}]'),
  ]);
});

describe('findspot-static dataset contract', () => {
  for (const { key, value } of fixtures) {
    it(`serves /${key} as JSON`, async () => {
      const response = await exports.default.fetch(`https://static.test/${key}`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(await response.json()).toEqual(value);
    });
  }

  it('serves a virtual AIM cell from its R2 prefix bundle', async () => {
    const response = await exports.default.fetch(`https://static.test/${aimShardKey(CELL)}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual([{ monumentType: 'ENCLOSURE' }]);
  });

  it('serves only the requested SM cell range from its R2 prefix bundle', async () => {
    const response = await exports.default.fetch(`https://static.test/${smShardKey(CELL)}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual([{ listEntry: '1000001', name: 'Test' }]);
  });

  it('treats a missing known shard as an empty dataset', async () => {
    const response = await exports.default.fetch(`https://static.test/${aimShardKey('zzzzzz')}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual([]);
  });

  it('rejects unknown keys', async () => {
    const response = await exports.default.fetch(`https://static.test/${STATIC_DATA_GENERATION}/aim-index/not-a-cell.json`);
    expect(response.status).toBe(404);
  });

  it('retains v1 paths during the generation grace window', async () => {
    const key = smShardKey(CELL, 'v1');
    await env.STATIC_BUCKET.put(key, '[]', { httpMetadata: { contentType: 'application/json' } });
    const response = await exports.default.fetch(`https://static.test/${key}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it('retains v1 metadata during the generation grace window', async () => {
    const key = 'v1/aim-index/_meta.json';
    await env.STATIC_BUCKET.put(key, '{"generationVersion":"v1"}', {
      httpMetadata: { contentType: 'application/json' },
    });
    const response = await exports.default.fetch(`https://static.test/${key}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
  });

  it('retains pre-versioning AIM cell URLs during the grace window', async () => {
    const key = `aim-index/${CELL}.json`;
    await env.STATIC_BUCKET.put(key, '[{"monumentType":"LEGACY"}]', {
      httpMetadata: { contentType: 'application/json' },
    });
    const response = await exports.default.fetch(`https://static.test/${key}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ monumentType: 'LEGACY' }]);
  });
});
