import { describe, expect, it } from 'vitest';
import {
  AIM_INDEX_SCHEMA_VERSION,
  SM_INDEX_SCHEMA_VERSION,
  STATIC_DATA_GENERATION,
  isCurrentAimIndexMeta,
  isCurrentSmIndexMeta,
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
});
