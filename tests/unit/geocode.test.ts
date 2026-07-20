import { describe, expect, it } from 'vitest';
import {
  normaliseGeocodeCoordinate,
  normaliseGeocodeQuery,
} from '../../src/services/geocode';

describe('geocode request normalisation', () => {
  it('normalises equivalent search queries to one cache key form', () => {
    expect(normaliseGeocodeQuery('  Market   Harborough  ')).toBe('market harborough');
  });

  it('rounds coordinates to roughly eleven metres', () => {
    expect(normaliseGeocodeCoordinate(52.205337)).toBe('52.2053');
    expect(normaliseGeocodeCoordinate(-0.121849)).toBe('-0.1218');
  });

  it('rejects non-finite coordinates', () => {
    expect(() => normaliseGeocodeCoordinate(Number.NaN)).toThrow(TypeError);
  });
});
