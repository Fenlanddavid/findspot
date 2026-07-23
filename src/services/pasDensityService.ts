// ─── PAS Density Service ──────────────────────────────────────────────────────
// Loads the PAS density index from the git-bundled static asset in /public.
// The index is generated offline via scripts/build-pas-density.mjs from a
// PAS CSV export (finds.org.uk/database/data) and committed to the repo.
//
// The density index provides supporting evidence for ALIE — it is never used
// to create hotspots, only to apply a small confidence modifier (+0.08 max)
// to hotspots that already exist from terrain/geology/historic signals.
//
// Data: CC-BY (confirm exact version on finds.org.uk/terms before shipping).

import { latLngToCell, cellToBoundary } from 'h3-js';
import { cachedFetchAny } from '../utils/cachedFetch';
import { reportNonFatal } from './diagLog';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PASTopCount = [label: string, count: number];

export interface PASCellLookup {
    /** find count in this H3 cell */
    c: number;
    /** top-N broad periods (e.g. "MEDIEVAL", "ROMAN") */
    p: string[];
    /** top-N object types (e.g. "COIN", "BROOCH") */
    t: string[];
    /** top-N broad periods with real counts, schema v2+ */
    pc?: PASTopCount[];
    /** top-N object types with real counts, schema v2+ */
    tc?: PASTopCount[];
}

export interface PASDensityIndex {
    schemaVersion: number;
    resolution: number;
    generatedAt: string;
    recordCount: number;
    sourceDumpUrl: string;
    license: string;
    attribution: string;
    cells: Record<string, PASCellLookup>;
}

// ─── Module-level cache ───────────────────────────────────────────────────────

let _cache: Promise<PASDensityIndex> | null = null;

export function pasDensityAssetUrl(): string {
    return new URL(`${import.meta.env.BASE_URL}pas-density-gb.json`, window.location.origin).toString();
}

function getPASDensityIndex(): Promise<PASDensityIndex> {
    if (!_cache) {
        _cache = cachedFetchAny(pasDensityAssetUrl())
            .then(r => {
                if (!r.ok) throw new Error(`pas-density-gb.json: ${r.status}`);
                return r.json() as Promise<PASDensityIndex>;
            })
            .catch(e => {
                _cache = null; // allow retry
                throw e;
            });
    }
    return _cache;
}

/**
 * Prime the PAS density cache without blocking the call site.
 * Call this at scan start so the asset is in-flight while other
 * requests (NHLE, AIM, Overpass) are also running.
 */
export function prefetchPASDensity(): void {
    getPASDensityIndex().catch(error => {
        reportNonFatal('pas-density', 'Index prefetch failed', error);
    });
}

export function pasPeriodEntries(cell: PASCellLookup): PASTopCount[] {
    return Array.isArray(cell.pc) && cell.pc.length > 0
        ? cell.pc
        : cell.p.map(label => [label, 0]);
}

export function pasTypeEntries(cell: PASCellLookup): PASTopCount[] {
    return Array.isArray(cell.tc) && cell.tc.length > 0
        ? cell.tc
        : cell.t.map(label => [label, 0]);
}

export function pasPeriodLabels(cell: PASCellLookup): string[] {
    return pasPeriodEntries(cell).map(([label]) => label);
}

/**
 * Look up the PAS density cell containing the given point.
 * Returns { c: 0, p: [], t: [] } when the cell has no recorded finds.
 * Returns null if the index failed to load (treated as no data).
 */
export async function getPASDensityNear(lat: number, lon: number): Promise<PASCellLookup | null> {
    const index = await getPASDensityIndex().catch(() => null);
    if (!index) return null;
    const h3Index = latLngToCell(lat, lon, index.resolution);
    return index.cells[h3Index] ?? { c: 0, p: [], t: [], pc: [], tc: [] };
}

/** Density tier for map styling (mirrors hotspotEngine thresholds). */
type DensityTier = 'low' | 'moderate' | 'high' | 'very-high';

function densityTier(count: number): DensityTier {
    if (count >= 500) return 'very-high';
    if (count >= 200) return 'high';
    if (count >= 60)  return 'moderate';
    return 'low';
}

/**
 * Return all non-empty PAS density cells as a GeoJSON FeatureCollection.
 * Each feature is the H3 cell polygon with properties: count, tier, periods, types.
 * cellToBoundary returns [lat, lon] pairs — flipped to [lon, lat] for GeoJSON.
 * Returns an empty FeatureCollection if the index is unavailable.
 */
export async function getPASDensityGeoJSON(): Promise<GeoJSON.FeatureCollection> {
    const index = await getPASDensityIndex().catch(() => null);
    if (!index || Object.keys(index.cells).length === 0) {
        return { type: 'FeatureCollection', features: [] };
    }

    const features: GeoJSON.Feature[] = [];
    for (const [h3Index, cell] of Object.entries(index.cells)) {
        if (cell.c === 0) continue;
        try {
            // cellToBoundary returns [lat, lon][] — flip to [lon, lat][] for GeoJSON
            const boundary = cellToBoundary(h3Index);
            const ring: [number, number][] = boundary.map(([lat, lon]) => [lon, lat]);
            ring.push(ring[0]); // close the ring
            features.push({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [ring] },
                properties: {
                    count:   cell.c,
                    tier:    densityTier(cell.c),
                    periods: pasPeriodEntries(cell).map(([label, count]) => count > 0 ? `${label} (${count})` : label).join(', '),
                    types:   pasTypeEntries(cell).map(([label, count]) => count > 0 ? `${label} (${count})` : label).join(', '),
                },
            });
        } catch (error) {
            reportNonFatal('pas-density', 'Invalid H3 cell skipped', error);
        }
    }

    return { type: 'FeatureCollection', features };
}
