import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AIM_INDEX_SCHEMA_VERSION,
  SM_INDEX_SCHEMA_VERSION,
  STATIC_DATASET_KEYS,
  aimBundleKey,
  aimShardKey,
  smShardKey,
} from '../../src/shared/staticDatasetContract';

const CELL = 'gcpvj0';

const fixtures = [
  {
    key: STATIC_DATASET_KEYS.smMeta,
    value: { schemaVersion: SM_INDEX_SCHEMA_VERSION, geometryMode: 'full-geojson' },
  },
  {
    key: STATIC_DATASET_KEYS.aimMeta,
    value: { schemaVersion: AIM_INDEX_SCHEMA_VERSION },
  },
  { key: smShardKey(CELL), value: [] },
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

  it('treats a missing known shard as an empty dataset', async () => {
    const response = await exports.default.fetch('https://static.test/aim-index/zzzzzz.json');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual([]);
  });

  it('rejects unknown keys', async () => {
    const response = await exports.default.fetch('https://static.test/aim-index/not-a-cell.json');
    expect(response.status).toBe(404);
  });
});
