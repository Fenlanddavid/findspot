import { describe, expect, it } from 'vitest';
import { distanceKilometers, distanceMeters } from '../../src/utils/geo';

describe('geographic distance', () => {
  it('returns zero for the same point', () => {
    expect(distanceMeters({ lat: 52.2053, lon: 0.1218 }, { lat: 52.2053, lon: 0.1218 })).toBe(0);
  });

  it('returns metres with a stable, symmetric great-circle calculation', () => {
    const cambridge = { lat: 52.2053, lon: 0.1218 };
    const london = { lat: 51.5074, lon: -0.1278 };
    const outward = distanceMeters(cambridge, london);
    const returnJourney = distanceMeters(london, cambridge);

    expect(outward).toBeCloseTo(79_474, -1);
    expect(returnJourney).toBeCloseTo(outward, 10);
    expect(distanceKilometers(cambridge, london)).toBeCloseTo(outward / 1000, 10);
  });

  it('remains finite for antipodal points', () => {
    expect(distanceMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(Math.PI * 6_371_000, 5);
  });
});
