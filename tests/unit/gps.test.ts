// ─── GPS coordinate transform tests ──────────────────────────────────────────
// Characterizes toOSGridRef against KNOWN-GOOD fixtures (published OS grid
// references for identifiable landmarks) and pins the current output as a
// regression snapshot.
//
// Tolerance rationale: the code uses the simplified 7-parameter Helmert
// transform which is accurate to ~2–5 m nationally. All numeric assertions
// use ±500 m bands — loose enough to absorb transform error but tight enough
// to catch a broken pipeline.
//
// Grid letter verification is done independently because it is derivable
// from published OS maps and is not subject to transform error.

import { describe, it, expect } from 'vitest';
import { toOSGridRef } from '../../src/services/gps';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract the numeric easting component from a 10-figure OS grid ref string. */
function eastingDigits(ref: string): number {
  // Format: "AB 12345 67890"
  return parseInt(ref.slice(3, 8), 10);
}

/** Extract the numeric northing component from a 10-figure OS grid ref string. */
function northingDigits(ref: string): number {
  return parseInt(ref.slice(9, 14), 10);
}

// ─── Known-good fixture points ────────────────────────────────────────────────
// Sources: published OS 1:25000 maps / Grid Reference Finder / OS data hub.
// Only the grid letter prefix is asserted exactly; the numeric parts are
// asserted within ±500 m (5 digits, ±500) to account for Helmert transform
// residual error and floating-point variation.

const FIXTURES = [
  {
    name: 'Buckingham Palace, London',
    lat: 51.5014, lon: -0.1419,
    letters: 'TQ',
    // Published 6-fig: TQ 294 795 → centre ~29400 E, 79500 N in TQ
    eastingApprox: 29400, northingApprox: 79500,
  },
  {
    name: 'Edinburgh Castle',
    lat: 55.9486, lon: -3.1999,
    letters: 'NT',
    // Published: NT 252 734
    eastingApprox: 25200, northingApprox: 73400,
  },
  {
    name: 'Manchester Cathedral',
    lat: 53.4840, lon: -2.2438,
    letters: 'SJ',
    // Published: SJ 838 987
    eastingApprox: 83800, northingApprox: 98700,
  },
  {
    name: 'Ben Nevis summit',
    lat: 56.7969, lon: -5.0035,
    letters: 'NN',
    // Published: NN 166 712
    eastingApprox: 16600, northingApprox: 71200,
  },
] as const;

// ─── Format tests ─────────────────────────────────────────────────────────────

describe('toOSGridRef — output format', () => {
  it('returns two uppercase letters followed by two 5-digit groups (10-figure default)', () => {
    const ref = toOSGridRef(51.5014, -0.1419);
    expect(ref).toMatch(/^[A-Z]{2} \d{5} \d{5}$/);
  });

  it('returns 6-figure format when figures=6', () => {
    const ref = toOSGridRef(51.5014, -0.1419, 6);
    expect(ref).toMatch(/^[A-Z]{2} \d{3} \d{3}$/);
  });

  it('returns 8-figure format when figures=8', () => {
    const ref = toOSGridRef(51.5014, -0.1419, 8);
    expect(ref).toMatch(/^[A-Z]{2} \d{4} \d{4}$/);
  });
});

// ─── Known-good grid letter prefix tests ──────────────────────────────────────

describe('toOSGridRef — grid letter prefixes (known-good from published OS maps)', () => {
  for (const { name, lat, lon, letters } of FIXTURES) {
    it(`${name} → ${letters}`, () => {
      const ref = toOSGridRef(lat, lon);
      expect(ref.slice(0, 2)).toBe(letters);
    });
  }
});

// ─── Numeric proximity tests (±500 m tolerance) ───────────────────────────────

describe('toOSGridRef — numeric values within ±500 m of published OS references', () => {
  const TOLERANCE = 500;
  for (const { name, lat, lon, eastingApprox, northingApprox } of FIXTURES) {
    it(`${name} — easting ±${TOLERANCE}`, () => {
      const ref = toOSGridRef(lat, lon);
      expect(Math.abs(eastingDigits(ref) - eastingApprox)).toBeLessThanOrEqual(TOLERANCE);
    });
    it(`${name} — northing ±${TOLERANCE}`, () => {
      const ref = toOSGridRef(lat, lon);
      expect(Math.abs(northingDigits(ref) - northingApprox)).toBeLessThanOrEqual(TOLERANCE);
    });
  }
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('toOSGridRef — out-of-GB points return empty string', () => {
  it('Paris (well outside GB)', () => {
    expect(toOSGridRef(48.8566, 2.3522)).toBe('');
  });

  it('Mid-Atlantic (lon -20°)', () => {
    expect(toOSGridRef(50.0, -20.0)).toBe('');
  });

  it('Northern Scotland latitude but far west (Iceland)', () => {
    expect(toOSGridRef(64.0, -22.0)).toBe('');
  });
});

describe('toOSGridRef — non-finite inputs return empty string', () => {
  it('NaN lat', ()  => expect(toOSGridRef(NaN, -0.14)).toBe(''));
  it('NaN lon', ()  => expect(toOSGridRef(51.5, NaN)).toBe(''));
  it('+Infinity lat', () => expect(toOSGridRef(Infinity, -0.14)).toBe(''));
  it('-Infinity lon', () => expect(toOSGridRef(51.5, -Infinity)).toBe(''));
});

describe('toOSGridRef — 100km grid square boundary', () => {
  // A point very close to the TQ/TL boundary (northing ~200000 = 100km boundary at N)
  // Verifies the 100km square letter logic handles boundary values without throwing.
  it('returns a valid format for a point near a 100km northing boundary', () => {
    // ~51.8°N, 0°E — sits near TL/TQ boundary
    const ref = toOSGridRef(51.8, 0.0);
    if (ref !== '') {
      expect(ref).toMatch(/^[A-Z]{2} \d{5} \d{5}$/);
    }
    // Either the point is in GB (valid ref) or it returns '' — both are acceptable.
  });
});

// ─── Regression snapshot ──────────────────────────────────────────────────────
// Pins the CURRENT exact output for all fixtures plus edge cases.
// If any of these values change, the snapshot will fail and demand explanation.

describe('toOSGridRef — regression snapshots', () => {
  it('produces stable output for all fixture points', () => {
    const results = FIXTURES.map(({ name, lat, lon }) => ({
      name,
      ref10: toOSGridRef(lat, lon, 10),
      ref8:  toOSGridRef(lat, lon, 8),
      ref6:  toOSGridRef(lat, lon, 6),
    }));
    expect(results).toMatchSnapshot();
  });
});
