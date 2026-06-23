// ─── P1 fallback guard ────────────────────────────────────────────────────────
// Proves that deriveTerrainSignals, when no measured terrain is present, returns
// EXACTLY the same elevationM / slopePercent / aspectDegrees as deriveTerrainProxy.
// This is the safety contract: the measured path must never silently alter the
// fallback behaviour, and cached / no-DEM scans must continue to work identically.

import { describe, it, expect } from 'vitest';
import {
    deriveTerrainSignals,
    deriveTerrainProxy,
} from '../../src/services/fieldguide/terrainSignals';
import type { Cluster } from '../../src/pages/fieldGuideTypes';

// ─── Fixture ──────────────────────────────────────────────────────────────────
// Minimal cluster — only the fields the terrain helpers actually read.

function c(over: Partial<Cluster> = {}): Cluster {
    return {
        id:            'c1',
        points:        [],
        minX: 0, maxX: 1, minY: 0, maxY: 1,
        type:          'x',
        score:         50,
        number:        1,
        isProtected:   false,
        confidence:    'Medium',
        findPotential: 0.5,
        center:        [52.5, -1.5] as [number, number],
        source:        'terrain',
        sources:       ['terrain'],
        aspect:        180,
        ...over,
    };
}

// ─── Fallback path ────────────────────────────────────────────────────────────

describe('deriveTerrainSignals — fallback path (no measured terrain)', () => {
    it('flags terrainMeasured:false and matches deriveTerrainProxy EXACTLY', () => {
        // Clusters with NO slopeGradient / relativeReliefNorm → must fall back.
        const clusters = [
            c({ id: 'a', relativeElevation: 'Ridge', polarity: 'Raised',  aspect: 90  }),
            c({ id: 'b', relativeElevation: 'Slope', sources: ['slope'],   aspect: 270 }),
        ];
        const out   = deriveTerrainSignals(clusters, null);
        const proxy = deriveTerrainProxy(clusters, null);

        expect(out.terrainMeasured).toBe(false);
        // Byte-for-byte parity on all three legacy fields — the safety contract.
        expect(out.elevationM).toBe(proxy.elevationM);
        expect(out.slopePercent).toBe(proxy.slopePercent);
        expect(out.aspectDegrees).toBe(proxy.aspectDegrees);
    });

    it('treats a cluster missing BOTH new fields as unmeasured', () => {
        const out = deriveTerrainSignals([c({ relativeElevation: 'Flat' })], null);
        expect(out.terrainMeasured).toBe(false);
    });

    it('treats a cluster with only relativeElevation (no slopeGradient) as unmeasured', () => {
        const out = deriveTerrainSignals([c({ relativeElevation: 'Ridge' })], null);
        expect(out.terrainMeasured).toBe(false);
    });

    it('fallback relativeReliefNorm and slopeGradient are 0 (not proxy-fabricated)', () => {
        const out = deriveTerrainSignals([c({ relativeElevation: 'Ridge' })], null);
        expect(out.relativeReliefNorm).toBe(0);
        expect(out.slopeGradient).toBe(0);
    });

    it('empty cluster list returns terrainMeasured:false + proxy defaults', () => {
        const out   = deriveTerrainSignals([], null);
        const proxy = deriveTerrainProxy([], null);
        expect(out.terrainMeasured).toBe(false);
        expect(out.elevationM).toBe(proxy.elevationM);
        expect(out.slopePercent).toBe(proxy.slopePercent);
        expect(out.aspectDegrees).toBe(proxy.aspectDegrees);
    });
});

// ─── Proxy values ─────────────────────────────────────────────────────────────

describe('deriveTerrainProxy — categorical bands', () => {
    it('Ridge → elevationM=18, slopePercent=3', () => {
        const p = deriveTerrainProxy([c({ relativeElevation: 'Ridge' })], null);
        expect(p.elevationM).toBe(18);
        expect(p.slopePercent).toBe(3);
    });

    it('Hollow → elevationM=-2', () => {
        const p = deriveTerrainProxy([c({ relativeElevation: 'Hollow' })], null);
        expect(p.elevationM).toBe(-2);
    });

    it('Slope → elevationM=6, slopePercent=6', () => {
        const p = deriveTerrainProxy([c({ relativeElevation: 'Slope', sources: ['slope'] })], null);
        expect(p.elevationM).toBe(6);
        expect(p.slopePercent).toBe(6);
    });

    it('Flat → elevationM=0, slopePercent=0', () => {
        const p = deriveTerrainProxy([c({ relativeElevation: 'Flat' })], null);
        expect(p.elevationM).toBe(0);
        expect(p.slopePercent).toBe(0);
    });
});

// ─── Measured path ────────────────────────────────────────────────────────────

describe('deriveTerrainSignals — measured path', () => {
    it('flags terrainMeasured:true when slopeGradient is present', () => {
        const out = deriveTerrainSignals([c({ slopeGradient: 0.10 })], null);
        expect(out.terrainMeasured).toBe(true);
    });

    it('flags terrainMeasured:true when relativeReliefNorm is present', () => {
        const out = deriveTerrainSignals([c({ relativeReliefNorm: 0.05 })], null);
        expect(out.terrainMeasured).toBe(true);
    });

    it('averages slopeGradient and relativeReliefNorm across measured clusters', () => {
        const clusters = [
            c({ id: 'a', slopeGradient: 0.10, relativeReliefNorm: 0.30, aspect: 0   }),
            c({ id: 'b', slopeGradient: 0.30, relativeReliefNorm: 0.10, aspect: 90  }),
        ];
        const out = deriveTerrainSignals(clusters, null);
        expect(out.terrainMeasured).toBe(true);
        expect(out.slopeGradient).toBeCloseTo(0.20, 5);      // mean(0.10, 0.30)
        expect(out.relativeReliefNorm).toBeCloseTo(0.20, 5); // mean(0.30, 0.10)
        expect(out.slopePercent).toBe(0);                    // legacy proxy, not normalised gradient × 100
    });

    it('keeps legacy slopePercent on the categorical proxy path', () => {
        const out = deriveTerrainSignals([
            c({ slopeGradient: 0.155, relativeElevation: 'Slope', sources: ['slope'] }),
        ], null);
        expect(out.slopeGradient).toBeCloseTo(0.155, 5);
        expect(out.slopePercent).toBe(6);
    });

    it('keeps legacy elevationM on the categorical proxy path', () => {
        const out = deriveTerrainSignals([
            c({ slopeGradient: 0.9, relativeReliefNorm: 0.9, relativeElevation: 'Ridge' }),
        ], null);
        expect(out.elevationM).toBe(18);
    });

    it('uses only the measured subset when clusters are mixed', () => {
        const clusters = [
            c({ id: 'm', slopeGradient: 0.40, relativeReliefNorm: 0.40 }),
            c({ id: 'u', relativeElevation: 'Flat' }), // no measured fields → excluded
        ];
        const out = deriveTerrainSignals(clusters, null);
        expect(out.terrainMeasured).toBe(true);
        expect(out.slopeGradient).toBeCloseTo(0.40, 5);
        expect(out.relativeReliefNorm).toBeCloseTo(0.40, 5);
    });
});

// ─── Hotspot member scoping ───────────────────────────────────────────────────

describe('deriveTerrainSignals — primaryHotspot member scoping', () => {
    it('restricts to hotspot member clusters, ignoring non-members', () => {
        const clusters = [
            c({ id: 'in',  slopeGradient: 0.50, relativeReliefNorm: 0.50 }),
            c({ id: 'out', slopeGradient: 0.00, relativeReliefNorm: 0.00 }),
        ];
        // Only 'in' is a member
        const hotspot = { memberIds: ['in'] } as any;
        const out = deriveTerrainSignals(clusters, hotspot);
        expect(out.terrainMeasured).toBe(true);
        expect(out.slopeGradient).toBeCloseTo(0.50, 5); // 'out' excluded
    });

    it('uses all clusters when hotspot has no members (empty memberIds)', () => {
        const clusters = [
            c({ id: 'a', slopeGradient: 0.20 }),
            c({ id: 'b', slopeGradient: 0.40 }),
        ];
        const hotspot = { memberIds: [] } as any;
        const out = deriveTerrainSignals(clusters, hotspot);
        expect(out.slopeGradient).toBeCloseTo(0.30, 5); // mean of both
    });

    it('proxy scoping also restricts to hotspot members', () => {
        const clusters = [
            c({ id: 'in',  relativeElevation: 'Ridge' }),
            c({ id: 'out', relativeElevation: 'Flat'  }),
        ];
        const hotspot = { memberIds: ['in'] } as any;
        const proxy = deriveTerrainProxy(clusters, hotspot);
        expect(proxy.elevationM).toBe(18); // only 'in' (Ridge) counted
    });
});
