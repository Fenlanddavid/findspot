import { describe, expect, it } from 'vitest';
import {
  calculateElevationDerivatives,
  decodeTerrariumPixel,
} from '../../src/engines/terrain/elevationAnalysis';

describe('physical elevation analysis', () => {
  it('decodes Terrarium RGB values in metres', () => {
    expect(decodeTerrariumPixel(128, 0, 0)).toBe(0);
    expect(decodeTerrariumPixel(128, 10, 128)).toBe(10.5);
  });

  function plane(dx: number, dyNorth: number) {
    const size = 21;
    const elevations = new Float32Array(size * size);
    const valid = new Uint8Array(size * size).fill(1);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Array y increases south, hence the subtraction for northward rise.
        elevations[y * size + x] = 100 + x * dx - y * dyNorth;
      }
    }
    return calculateElevationDerivatives(elevations, valid, size, size, 10, 10, 2, 5);
  }

  it('reports downhill aspect independently for all four cardinal planes', () => {
    const eastRising = plane(1, 0);
    const westRising = plane(-1, 0);
    const northRising = plane(0, 1);
    const southRising = plane(0, -1);

    expect(eastRising?.aspectDegrees).toBeCloseTo(270, 6);
    expect(westRising?.aspectDegrees).toBeCloseTo(90, 6);
    expect(northRising?.aspectDegrees).toBeCloseTo(180, 6);
    expect(southRising?.aspectDegrees).toBeCloseTo(0, 6);
  });

  it('preserves slope magnitude while reporting the east-rising plane as west-facing', () => {
    const result = plane(1, 0);
    expect(result).not.toBeNull();
    expect(result!.elevationM).toBe(110);
    expect(result!.slopePercent).toBeCloseTo(50, 6);
    expect(result!.aspectDegrees).toBeCloseTo(270, 6);
    expect(result!.relativeReliefM).toBeCloseTo(0, 6);
  });

  it('abstains at nodata edges instead of creating a false measurement', () => {
    const size = 21;
    const elevations = new Float32Array(size * size).fill(100);
    const valid = new Uint8Array(size * size).fill(1);
    valid[10 * size + 11] = 0;
    expect(calculateElevationDerivatives(elevations, valid, size, size, 10, 10, 2, 5)).toBeNull();
  });

  it('does not silently shrink a requested ground-scale support window', () => {
    const size = 21;
    const elevations = new Float32Array(size * size).fill(100);
    const valid = new Uint8Array(size * size).fill(1);
    // A 12-pixel radius cannot be supported at the centre of a 21-pixel tile.
    expect(calculateElevationDerivatives(elevations, valid, size, size, 10, 10, 5, 12)).toBeNull();
  });

  it('reports no aspect for flat ground', () => {
    const size = 21;
    const elevations = new Float32Array(size * size).fill(42);
    const valid = new Uint8Array(size * size).fill(1);
    const result = calculateElevationDerivatives(elevations, valid, size, size, 10, 10, 2, 5);
    expect(result?.slopePercent).toBe(0);
    expect(result?.aspectDegrees).toBeNull();
  });
});
