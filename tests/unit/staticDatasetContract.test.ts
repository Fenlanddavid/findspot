import { stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  AIM_INDEX_SCHEMA_VERSION,
  ROMAN_ROADS_DATASET,
  SM_INDEX_SCHEMA_VERSION,
  STATIC_DATA_GENERATION,
  isCurrentAimIndexMeta,
  isCurrentSmIndexMeta,
  smBundleIndexKey,
  smBundleKey,
} from '../../src/shared/staticDatasetContract';

describe('static dataset generation metadata', () => {
  it('accepts only current full-geometry SM metadata', () => {
    expect(isCurrentSmIndexMeta({
      generationVersion: STATIC_DATA_GENERATION,
      schemaVersion: SM_INDEX_SCHEMA_VERSION,
      geometryMode: 'full-geojson',
      coverage: ['england', 'wales', 'scotland'],
    })).toBe(true);
    expect(isCurrentSmIndexMeta({
      schemaVersion: SM_INDEX_SCHEMA_VERSION,
      geometryMode: 'full-geojson',
    })).toBe(false);
    expect(isCurrentSmIndexMeta({
      generationVersion: 'v1',
      schemaVersion: SM_INDEX_SCHEMA_VERSION,
      geometryMode: 'full-geojson',
    })).toBe(false);
  });

  it('accepts only current AIM metadata', () => {
    expect(isCurrentAimIndexMeta({
      generationVersion: STATIC_DATA_GENERATION,
      schemaVersion: AIM_INDEX_SCHEMA_VERSION,
    })).toBe(true);
    expect(isCurrentAimIndexMeta({ schemaVersion: AIM_INDEX_SCHEMA_VERSION })).toBe(false);
    expect(isCurrentAimIndexMeta({
      generationVersion: STATIC_DATA_GENERATION,
      schemaVersion: AIM_INDEX_SCHEMA_VERSION + 1,
    })).toBe(false);
  });

  it('maps SM cells to generation-scoped range bundle objects', () => {
    expect(smBundleKey('gcpvj0')).toBe('v2/sm-index/bundles/gcpv.bin');
    expect(smBundleIndexKey('gcpvj0')).toBe('v2/sm-index/bundles/gcpv.index.json');
  });

  it('pins the RRRA Roman-road generation and single-asset decision', async () => {
    expect(ROMAN_ROADS_DATASET).toEqual({
      assetPath: 'roman-roads-gb.geojson',
      generation: 'rrra-digital-britannia-v1.0-2026-07-26',
      inputFeatureCount: 3_572,
      builtFeatureCount: 3_505,
      builtBytes: 1_417_865,
      inputSha256: 'ff4caff0b4446554660b117304554b51e7e9b1420c262f3dbdf60c0f1454b9d2',
    });
    const asset = await stat(new URL(
      `../../public/${ROMAN_ROADS_DATASET.assetPath}`,
      import.meta.url,
    ));
    expect(asset.size).toBe(ROMAN_ROADS_DATASET.builtBytes);
    expect(asset.size).toBeLessThanOrEqual(3 * 1024 * 1024);
  });
});
