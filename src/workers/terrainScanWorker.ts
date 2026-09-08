// ─── Terrain scan worker ──────────────────────────────────────────────────────
// Runs inside a Web Worker. Receives tile parameters, fetches tiles via
// fetch() + createImageBitmap(), composites them onto OffscreenCanvas, runs the
// full pixel-processing pipeline, and posts back a Cluster[].
//
// No DOM access (document/window) — OffscreenCanvas only.

import { Cluster, SCAN_PROFILE } from '../pages/fieldGuideTypes';
import { waybackTileUrl, waybackVersionA, waybackVersionB } from '../utils/waybackService';
import { cachedFetchAnyWithMetadata } from '../utils/cachedFetch';
import { dispatchWorkerRequest } from './protocol';
import type { DeliveredDataType, EvidenceProvenance } from '../types/evidenceProvenance';
import {
    calculateElevationDerivatives,
    decodeTerrariumPixel,
    metresPerPixel,
    type TerrainMeasurement,
} from '../engines/terrain/elevationAnalysis';

type SourceType = 'terrain' | 'terrain_global' | 'slope' | 'hydrology' | 'satellite_spring' | 'satellite_summer' | 'elevation_dem';

export interface WorkerParams {
    sourceType: SourceType;
    zoom: number;
    tX_start: number;
    tY_start: number;
    /** Plain bounds object — no MapLibre LngLatBounds methods in the worker */
    bounds: { west: number; east: number; south: number; north: number };
    n: number;
    /** Resolved by the main thread before the worker starts — avoids duplicate catalog fetches */
    waybackIds: { versionA?: number; versionB?: number; spring?: number; summer?: number } | null;
}

export interface WorkerResult {
    clusters:    Cluster[];
    tilesLoaded: number;
    provenance?: EvidenceProvenance[];
    terrainMeasurements?: TerrainMeasurement[];
    processingError?: boolean;
}

const TILE_SIZE = 256;
const TILE_GRID_SIZE = 3;
const UNLOADED_TILE_EDGE_MARGIN_PX = 8;

// ─── Tile fetch helper ────────────────────────────────────────────────────────

async function sha256(bytes: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function fetchBitmapTimed(url: string): Promise<{
    bitmap: ImageBitmap;
    retrievedAt: string;
    fromCache: boolean;
    contentIdentity: string;
    decodedContentIdentity: string;
} | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
        // cachedFetchAny checks all open Cache Storage caches first (offline pack),
        // then falls through to network. caches.match() is available in dedicated
        // Workers in Chrome 43+, Firefox 44+, Safari 16+.
        const { response: res, fromCache } = await cachedFetchAnyWithMetadata(url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) return null;
        const blob = await res.blob();
        const bitmap = await createImageBitmap(blob);
        const identityCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const identityContext = identityCanvas.getContext('2d', { willReadFrequently: true });
        if (!identityContext) return null;
        identityContext.drawImage(bitmap, 0, 0);
        const decoded = identityContext.getImageData(0, 0, bitmap.width, bitmap.height).data;
        const [contentIdentity, decodedContentIdentity] = await Promise.all([
            sha256(await blob.arrayBuffer()),
            sha256(decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength) as ArrayBuffer),
        ]);
        return { bitmap, retrievedAt: new Date().toISOString(), fromCache, contentIdentity, decodedContentIdentity };
    } catch {
        clearTimeout(timer);
        return null;
    }
}

type DeliveredSource = {
    id: string;
    dataset: string;
    parent: string;
    dataType: DeliveredDataType;
    resolutionM?: number;
    sourceLineageIdentity?: string;
    lineageConfidence?: 'verified' | 'unknown';
};

function sourceDescriptor(
    sourceType: SourceType,
    fallback: boolean,
    waybackIds: WorkerParams['waybackIds'],
): DeliveredSource {
    if (sourceType === 'elevation_dem') return { id: 'aws-terrain-tiles-terrarium', dataset: 'AWS Terrain Tiles (Terrarium elevation)', parent: 'aws-terrain-tiles-terrarium', dataType: 'elevation_dem', sourceLineageIdentity: 'aws-terrain-tiles-terrarium', lineageConfidence: 'verified' };
    // The publication year is not itself proof of a new acquisition. Group EA
    // composite renderings under the underlying LiDAR composite lineage.
    if (sourceType === 'terrain' && !fallback) return { id: 'ea-lidar-2025-hillshade', dataset: 'Environment Agency LiDAR Composite 1m DTM 2025 hillshade', parent: 'ea-lidar-composite-2025', dataType: 'rendered_hillshade', resolutionM: 1, sourceLineageIdentity: 'ea-lidar-composite', lineageConfidence: 'verified' };
    if (sourceType === 'terrain_global' && !fallback) return { id: 'ea-lidar-2022-multidirectional-hillshade', dataset: 'Environment Agency LiDAR Composite 1m DTM 2022 multidirectional hillshade', parent: 'ea-lidar-composite-2022', dataType: 'rendered_hillshade', resolutionM: 1, sourceLineageIdentity: 'ea-lidar-composite', lineageConfidence: 'verified' };
    if (sourceType === 'slope' && !fallback) return { id: 'ea-lidar-2022-rendered-slope', dataset: 'Environment Agency LiDAR Composite DTM 1m 2022 slope rendering', parent: 'ea-lidar-composite-2022', dataType: 'rendered_slope', resolutionM: 1, sourceLineageIdentity: 'ea-lidar-composite', lineageConfidence: 'verified' };
    if (sourceType === 'satellite_spring' && !fallback) {
        const id = waybackIds ? waybackVersionA(waybackIds) : 0;
        return { id: `esri-wayback-${id}`, dataset: `Esri World Imagery Wayback version ${id}`, parent: `esri-world-imagery-wayback-${id}`, dataType: 'rgb_imagery' };
    }
    if (sourceType === 'satellite_summer' && !fallback) {
        const id = waybackIds ? waybackVersionB(waybackIds) : 0;
        return { id: `esri-wayback-${id}`, dataset: `Esri World Imagery Wayback version ${id}`, parent: `esri-world-imagery-wayback-${id}`, dataType: 'rgb_imagery' };
    }
    if (sourceType.startsWith('satellite_')) return { id: 'esri-world-imagery-current', dataset: 'Esri World Imagery current mosaic', parent: 'esri-world-imagery-current', dataType: 'rgb_imagery' };
    if (sourceType === 'slope') return { id: 'esri-world-shaded-relief', dataset: 'Esri World Shaded Relief', parent: 'esri-world-shaded-relief', dataType: 'rendered_relief' };
    if (sourceType === 'hydrology' && !fallback) return { id: 'esri-world-hillshade', dataset: 'Esri World Hillshade', parent: 'esri-world-elevation-hillshade', dataType: 'rendered_hillshade' };
    if (sourceType === 'hydrology') return { id: 'esri-world-shaded-relief', dataset: 'Esri World Shaded Relief', parent: 'esri-world-shaded-relief', dataType: 'rendered_relief' };
    return { id: fallback ? 'esri-world-hillshade-fallback' : 'esri-world-hillshade', dataset: fallback ? 'Esri World Hillshade fallback' : 'Esri World Hillshade', parent: 'esri-world-elevation-hillshade', dataType: 'rendered_hillshade' };
}

// ─── Convex hull perimeter ────────────────────────────────────────────────────
// Andrew's monotone chain. Returns the perimeter of the convex hull of the
// given points, or 0 on degenerate input. Used to replace the bounding-box
// perimeter in the circularity formula — avoids overestimating circularity
// for irregular or elongated blobs.

function hullCross(O: {x: number; y: number}, A: {x: number; y: number}, B: {x: number; y: number}): number {
    return (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);
}

function convexHullPerimeter(pts: {x: number; y: number}[]): number {
    if (pts.length < 3) return 0;
    const s = [...pts].sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);
    const lo: {x: number; y: number}[] = [];
    const hi: {x: number; y: number}[] = [];
    for (const p of s) {
        while (lo.length >= 2 && hullCross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
        lo.push(p);
    }
    for (let i = s.length - 1; i >= 0; i--) {
        const p = s[i];
        while (hi.length >= 2 && hullCross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop();
        hi.push(p);
    }
    hi.pop(); lo.pop();
    const hull = [...lo, ...hi];
    if (hull.length < 2) return 0;
    let perim = 0;
    for (let i = 0; i < hull.length; i++) {
        const a = hull[i], b = hull[(i + 1) % hull.length];
        perim += Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    }
    return perim;
}

// ─── Local anti-inflation logistic ───────────────────────────────────────────
// Mirrors boostScore() in fieldGuideAnalysis.ts — kept local to avoid importing
// from outside the worker bundle. Each additional boost yields diminishing returns
// as scores approach 100, making "High potential" actually mean something.

export function boostScoreLocal(base: number, boost: number): number {
    if (base <= 0) return Math.min(96, 100 * (1 - Math.exp(-boost / 100)));
    const raw = -Math.log(Math.max(0.001, 1 - Math.min(0.999, base / 100))) * 100;
    return Math.min(96, 100 * (1 - Math.exp(-(raw + boost) / 100)));
}

// ─── Terrain-derived archaeological hydrology heuristics ─────────────────────
// Lightweight terrain-water interpretation derived live from the local DTM window.
// NOT engineering hydrology — archaeological terrain interpretation only.
// Only meaningful for terrain/terrain_global sources (post-macro-blur, normalised).
//
// processed[] after macro-blur removal represents LOCAL relief:
//   > 0.5 = locally raised  |  < 0.5 = locally low  |  ≈ 0.5 = mean
//
// Both functions operate on pixel coordinates (cx, cy) for the cluster centre.

/**
 * dryMarginScore — is this cluster raised usable ground beside likely wet/low terrain?
 * Returns 0–1; 0 = no signal, 1 = strong dry-margin position.
 */
function computeDryMarginScore(
    cx: number,
    cy: number,
    processed: Float32Array,
    stitchSize: number,
): number {
    if (cx < 3 || cx >= stitchSize - 3 || cy < 3 || cy >= stitchSize - 3) return 0;

    const centerVal = processed[cy * stitchSize + cx];

    // Must be above local mean to qualify as raised margin
    if (centerVal < 0.50) return 0;

    // Collect ring samples with their angular index so we can:
    //   (a) compute a ring-relative mean (removes hillshade/aspect bias), and
    //   (b) test whether lower samples concentrate in one arc (removes quarry/
    //       hollow false positives — at Barnack every hill is beside a hole,
    //       so lowerFrac is high in all directions).
    const RING_R = 40;
    const RING_N = 16;
    const ring: { v: number; i: number }[] = [];

    for (let i = 0; i < RING_N; i++) {
        const angle = (i / RING_N) * 2 * Math.PI;
        const sx = Math.round(cx + Math.cos(angle) * RING_R);
        const sy = Math.round(cy + Math.sin(angle) * RING_R);
        if (sx < 0 || sx >= stitchSize || sy < 0 || sy >= stitchSize) continue;
        ring.push({ v: processed[sy * stitchSize + sx], i });
    }

    const validCount = ring.length;
    if (validCount < 6) return 0;

    // Ring mean — hillshade-neutral local reference
    const ringMean = ring.reduce((s, r) => s + r.v, 0) / validCount;

    let lowerCount   = 0;
    let nearLowCount = 0;
    const lowerIndices: number[] = [];

    for (const r of ring) {
        if (r.v < centerVal - 0.06) { lowerCount++; lowerIndices.push(r.i); }
        if (r.v < ringMean - 0.12)  nearLowCount++;   // ring-relative, not absolute
    }

    const lowerFrac = lowerCount / validCount;
    if (lowerFrac < 0.30) return 0;   // not meaningfully raised above surroundings

    // ── Directional concentration gate ───────────────────────────────────────
    // A genuine dry margin has its low zone on one side (river bank, fen edge).
    // Quarry pits, chalk hollows, and hilltops have low values all around.
    // Sliding 180° arc test: find the half-ring (8 of 16 positions) that captures
    // the most lower-samples. If < 65 % of lower samples fit in any single arc,
    // the lowness is too scattered to represent a directional water margin.
    if (lowerCount >= 3) {
        let maxArcCount = 0;
        for (let start = 0; start < RING_N; start++) {
            let arcCount = 0;
            for (const idx of lowerIndices) {
                if (((idx - start + RING_N) % RING_N) < RING_N / 2) arcCount++;
            }
            if (arcCount > maxArcCount) maxArcCount = arcCount;
        }
        if (maxArcCount / lowerCount < 0.65) return 0;
    }

    // Map 0.30 → 0.80 to 0 → 1
    let score = Math.min(1.0, (lowerFrac - 0.30) / 0.50);

    // Amplify when a genuine low zone (wet proxy) exists within the ring
    if (nearLowCount >= 3) score = Math.min(1.0, score * 1.4);

    // Scale by how far above 0.5 the centre sits (genuine raisedness)
    const raisedness = (centerVal - 0.50) / 0.50;   // 0 → 1
    score *= (0.5 + 0.5 * raisedness);

    return Math.max(0, Math.min(1, score));
}

/**
 * computeFlowConvergence — does local terrain converge toward this cluster?
 * Lightweight D8-style approximation on a single outer ring; no propagation.
 * Returns 0–1; 0 = no convergence, 1 = strong local convergence.
 */
function computeFlowConvergence(
    cx: number,
    cy: number,
    processed: Float32Array,
    stitchSize: number,
): number {
    if (cx < 4 || cx >= stitchSize - 4 || cy < 4 || cy >= stitchSize - 4) return 0;

    // If the cluster centre is below local mean (< 0.50) it is inside a depression —
    // a quarry pit, natural bowl, or watercourse. Convergence toward a depression
    // scores identically to convergence toward an archaeological site; this gate
    // removes that false-positive path. Archaeological flow-convergence sites sit
    // on or above local mean, not inside the low zone.
    if (processed[cy * stitchSize + cx] < 0.50) return 0;

    const OUTER_R = 32;
    const STEPS   = 16;
    const D8: [number, number][] = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];

    let convergingCount = 0;
    let validCount      = 0;

    for (let i = 0; i < STEPS; i++) {
        const angle = (i / STEPS) * 2 * Math.PI;
        const sx = Math.round(cx + Math.cos(angle) * OUTER_R);
        const sy = Math.round(cy + Math.sin(angle) * OUTER_R);
        if (sx < 1 || sx >= stitchSize - 1 || sy < 1 || sy >= stitchSize - 1) continue;
        validCount++;

        // D8: steepest-descent direction from this sample pixel
        const selfVal = processed[sy * stitchSize + sx];
        let bestDrop = 0;
        let bestDx = 0, bestDy = 0;
        for (const [ndx, ndy] of D8) {
            const nx = sx + ndx, ny = sy + ndy;
            if (nx < 0 || nx >= stitchSize || ny < 0 || ny >= stitchSize) continue;
            const drop = selfVal - processed[ny * stitchSize + nx];
            if (drop > bestDrop) { bestDrop = drop; bestDx = ndx; bestDy = ndy; }
        }

        if (bestDrop < 0.005) continue;   // effectively flat — skip

        // Positive dot product with (centre − sample) vector ⟹ draining toward centre
        if (bestDx * (cx - sx) + bestDy * (cy - sy) > 0) convergingCount++;
    }

    if (validCount < 8) return 0;

    const convergingFrac = convergingCount / validCount;

    // Geometric baseline: ~50% of ring pixels face inward by position alone.
    // Only score meaningful excess above this.
    if (convergingFrac <= 0.50) return 0;

    // Map 0.50 → 0.90 to 0 → 1
    return Math.min(1.0, (convergingFrac - 0.50) / 0.40);
}

function bboxTouchesUnloadedTile(
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    loadedTiles: boolean[],
): boolean {
    if (loadedTiles.every(Boolean)) return false;

    const startX = Math.max(0, Math.floor((minX - UNLOADED_TILE_EDGE_MARGIN_PX) / TILE_SIZE));
    const endX   = Math.min(TILE_GRID_SIZE - 1, Math.floor((maxX + UNLOADED_TILE_EDGE_MARGIN_PX) / TILE_SIZE));
    const startY = Math.max(0, Math.floor((minY - UNLOADED_TILE_EDGE_MARGIN_PX) / TILE_SIZE));
    const endY   = Math.min(TILE_GRID_SIZE - 1, Math.floor((maxY + UNLOADED_TILE_EDGE_MARGIN_PX) / TILE_SIZE));

    for (let ty = startY; ty <= endY; ty++) {
        for (let tx = startX; tx <= endX; tx++) {
            if (!loadedTiles[ty * TILE_GRID_SIZE + tx]) return true;
        }
    }
    return false;
}

// ─── Main processing function ─────────────────────────────────────────────────

async function processSource(params: WorkerParams): Promise<WorkerResult> {
    const { sourceType, zoom, tX_start, tY_start, bounds, n, waybackIds } = params;
    const stitchSize = 768;

    const canvas = new OffscreenCanvas(stitchSize, stitchSize);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { clusters: [], tilesLoaded: 0 };

    // ── Tile loading ──────────────────────────────────────────────────────────

    const promises: Promise<void>[] = [];
    const loadedTiles = new Array<boolean>(TILE_GRID_SIZE * TILE_GRID_SIZE).fill(false);
    const tileProvenance: EvidenceProvenance[] = [];
    let successCount = 0;

    for (let dy = 0; dy < 3; dy++) {
        for (let dx = 0; dx < 3; dx++) {
            const tx = tX_start + dx;
            const ty = tY_start + dy;

            let primaryUrl = '';
            let fallbackUrl: string | undefined;

            if (sourceType === 'terrain') {
                primaryUrl  = `https://services.arcgis.com/JJT1S6cy9mS999Xy/arcgis/rest/services/LIDAR_Composite_1m_DTM_2025_Hillshade/MapServer/tile/${zoom}/${ty}/${tx}`;
                fallbackUrl = `https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/${zoom}/${ty}/${tx}`;
            } else if (sourceType === 'terrain_global') {
                primaryUrl  = `https://services.arcgis.com/JJT1S6cy9mS999Xy/arcgis/rest/services/LIDAR_Composite_1m_DTM_2022_Multi_Directional_Hillshade/MapServer/tile/${zoom}/${ty}/${tx}`;
                fallbackUrl = `https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/${zoom}/${ty}/${tx}`;
            } else if (sourceType === 'slope') {
                primaryUrl  = `https://environment.data.gov.uk/image/rest/services/SURVEY/LIDAR_Composite_DTM_1m_2022_Slope/ImageServer/tile/${zoom}/${ty}/${tx}`;
                fallbackUrl = `https://services.arcgisonline.com/arcgis/rest/services/World_Shaded_Relief/MapServer/tile/${zoom}/${ty}/${tx}`;
            } else if (sourceType === 'hydrology') {
                primaryUrl  = `https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/${zoom}/${ty}/${tx}`;
                fallbackUrl = `https://services.arcgisonline.com/arcgis/rest/services/World_Shaded_Relief/MapServer/tile/${zoom}/${ty}/${tx}`;
            } else if (sourceType === 'elevation_dem') {
                primaryUrl = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${tx}/${ty}.png`;
            } else if (sourceType === 'satellite_spring') {
                primaryUrl  = waybackIds ? waybackTileUrl(waybackVersionA(waybackIds), zoom, ty, tx) : '';
                fallbackUrl = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;
            } else if (sourceType === 'satellite_summer') {
                primaryUrl  = waybackIds ? waybackTileUrl(waybackVersionB(waybackIds), zoom, ty, tx) : '';
                fallbackUrl = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;
            }

            const dxCopy = dx, dyCopy = dy;
            promises.push((async () => {
                let fetched = primaryUrl ? await fetchBitmapTimed(primaryUrl) : null;
                let usedFallback = false;
                if (!fetched && fallbackUrl) {
                    fetched = await fetchBitmapTimed(fallbackUrl);
                    usedFallback = fetched !== null;
                }
                if (fetched) {
                    ctx.drawImage(fetched.bitmap, dxCopy * TILE_SIZE, dyCopy * TILE_SIZE);
                    fetched.bitmap.close();
                    loadedTiles[dyCopy * TILE_GRID_SIZE + dxCopy] = true;
                    successCount++;
                    const delivered = sourceDescriptor(sourceType, usedFallback, waybackIds);
                    tileProvenance.push({
                        observationId: `${delivered.parent}:${zoom}/${tx}/${ty}`,
                        requestedSource: sourceType,
                        deliveredSource: delivered.id,
                        datasetIdentity: delivered.dataset,
                        parentSourceIdentity: delivered.parent,
                        ...(delivered.sourceLineageIdentity ? { sourceLineageIdentity: delivered.sourceLineageIdentity } : {}),
                        ...(delivered.lineageConfidence ? { lineageConfidence: delivered.lineageConfidence } : {}),
                        contentIdentity: fetched.contentIdentity,
                        decodedContentIdentity: fetched.decodedContentIdentity,
                        deliveredDataType: delivered.dataType,
                        ...(delivered.resolutionM ? { resolutionM: delivered.resolutionM, sourceResolutionM: delivered.resolutionM } : {}),
                        horizontalCrs: 'EPSG:3857',
                        retrievalDate: fetched.retrievedAt,
                        fallbackStatus: usedFallback ? 'fallback' : fetched.fromCache ? 'offline_cache' : 'requested',
                        tile: { z: zoom, x: tx, y: ty },
                    });
                }
            })());
        }
    }

    await Promise.all(promises);
    if (successCount === 0) return { clusters: [], tilesLoaded: 0, provenance: [] };
    const coverageStatus = successCount === TILE_GRID_SIZE * TILE_GRID_SIZE ? 'complete' : 'partial';
    for (const item of tileProvenance) item.coverageStatus = coverageStatus;

    // ── Pixel extraction ──────────────────────────────────────────────────────

    const rawData = ctx.getImageData(0, 0, stitchSize, stitchSize).data;

    if (sourceType === 'elevation_dem') {
        const elevations = new Float32Array(stitchSize * stitchSize);
        const valid = new Uint8Array(stitchSize * stitchSize);
        for (let pixel = 0; pixel < elevations.length; pixel++) {
            const offset = pixel * 4;
            if (rawData[offset + 3] === 0) continue;
            const elevationM = decodeTerrariumPixel(rawData[offset], rawData[offset + 1], rawData[offset + 2]);
            // Terrarium's all-zero sentinel decodes to -32768 m. Treat values
            // outside physical Earth bounds as nodata so their edges cannot
            // create artificial slope or relief.
            if (elevationM < -12_000 || elevationM > 9_000) continue;
            elevations[pixel] = elevationM;
            valid[pixel] = 1;
        }
        const measurements: TerrainMeasurement[] = [];
        const centerResolutionM = metresPerPixel((bounds.north + bounds.south) / 2, zoom);
        // About 20 m between context samples at every supported latitude/zoom.
        // Feature values are interpolated later only from a valid enclosing cell.
        const SAMPLE_STEP_PX = Math.max(2, Math.round(20 / centerResolutionM));
        for (let y = SAMPLE_STEP_PX; y < stitchSize - SAMPLE_STEP_PX; y += SAMPLE_STEP_PX) {
            for (let x = SAMPLE_STEP_PX; x < stitchSize - SAMPLE_STEP_PX; x += SAMPLE_STEP_PX) {
                const lon = (tX_start + x / TILE_SIZE) / n * 360 - 180;
                const yNorm = (tY_start + y / TILE_SIZE) / n;
                const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * yNorm))) - Math.PI / 2);
                if (lon < bounds.west || lon > bounds.east || lat < bounds.south || lat > bounds.north) continue;
                const resolutionM = metresPerPixel(lat, zoom);
                // Never shrink the nominal 50 m radius through a pixel cap.
                const windowRadiusPx = Math.max(2, Math.ceil(50 / resolutionM));
                const derivatives = calculateElevationDerivatives(
                    elevations, valid, stitchSize, stitchSize, x, y, resolutionM, windowRadiusPx,
                );
                if (!derivatives) continue;
                const tileX = tX_start + Math.floor(x / TILE_SIZE);
                const tileY = tY_start + Math.floor(y / TILE_SIZE);
                const provenance = tileProvenance.find(item => item.tile?.x === tileX && item.tile?.y === tileY);
                if (!provenance) continue;
                const measurementProvenance: EvidenceProvenance = {
                    ...provenance,
                    verticalUnits: 'metres',
                    limitations: [
                        'Terrarium map-tile pixel spacing is not a native source-resolution claim.',
                    ],
                };
                measurements.push({
                    lon, lat, ...derivatives,
                    role: 'landscape_context',
                    method: 'grid_sample',
                    analysisWindowRadiusM: windowRadiusPx * resolutionM,
                    outputPixelSpacingM: resolutionM,
                    sourceResolutionM: null,
                    supportCoordinates: [[lon, lat]],
                    supportSamples: [{
                        coordinate: [lon, lat],
                        weight: 1,
                        provenance: [measurementProvenance],
                    }],
                    limitations: [
                        'Native/effective source resolution is not established by this tile request.',
                        'This regular-grid sample describes surrounding landscape context until attached by valid local interpolation.',
                    ],
                    provenance: [measurementProvenance],
                });
            }
        }
        return { clusters: [], tilesLoaded: successCount, provenance: tileProvenance, terrainMeasurements: measurements };
    }

    const preBlur = new Float32Array(stitchSize * stitchSize);

    for (let i = 0; i < rawData.length; i += 4) {
        preBlur[i / 4] = (rawData[i] + rawData[i + 1] + rawData[i + 2]) / 3;
    }

    const processed = new Float32Array(stitchSize * stitchSize);
    for (let y = 1; y < stitchSize - 1; y++) {
        for (let x = 1; x < stitchSize - 1; x++) {
            let sum = 0;
            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    sum += preBlur[(y + ky) * stitchSize + (x + kx)];
                }
            }
            processed[y * stitchSize + x] = sum / 9;
        }
    }

    // Terrain sources get a macro-blur contrast-enhancement pass
    if (sourceType.startsWith('terrain')) {
        const macroBlur = new Float32Array(stitchSize * stitchSize);
        const temp      = new Float32Array(stitchSize * stitchSize);
        const radius = 12;

        for (let y = 0; y < stitchSize; y++) {
            for (let x = 0; x < stitchSize; x++) {
                let sum = 0, count = 0;
                for (let k = -radius; k <= radius; k++) {
                    const nx = x + k;
                    if (nx >= 0 && nx < stitchSize) { sum += processed[y * stitchSize + nx]; count++; }
                }
                temp[y * stitchSize + x] = sum / count;
            }
        }
        for (let y = 0; y < stitchSize; y++) {
            for (let x = 0; x < stitchSize; x++) {
                let sum = 0, count = 0;
                for (let k = -radius; k <= radius; k++) {
                    const ny = y + k;
                    if (ny >= 0 && ny < stitchSize) { sum += temp[ny * stitchSize + x]; count++; }
                }
                macroBlur[y * stitchSize + x] = sum / count;
            }
        }
        for (let i = 0; i < processed.length; i++) {
            processed[i] = (processed[i] - macroBlur[i]) + 0.5;
        }
    }

    // Normalise or compute ExG (satellite sources)
    if (sourceType.startsWith('terrain') || sourceType === 'slope' || sourceType === 'hydrology') {
        let minG = 255, maxG = 0;
        for (let i = 0; i < processed.length; i++) {
            const v = processed[i];
            if (v < minG) minG = v;
            if (v > maxG) maxG = v;
        }
        if (maxG - minG < 3) return { clusters: [], tilesLoaded: successCount };
        for (let i = 0; i < processed.length; i++) processed[i] = (processed[i] - minG) / (maxG - minG || 1);
    } else {
        const exgData = new Float32Array(stitchSize * stitchSize);
        let minE = 255, maxE = -255;
        for (let i = 0; i < rawData.length; i += 4) {
            const exg = 2 * rawData[i + 1] - (rawData[i] + rawData[i + 2]);
            exgData[i / 4] = exg;
            if (exg < minE) minE = exg;
            if (exg > maxE) maxE = exg;
        }
        for (let y = 2; y < stitchSize - 2; y++) {
            for (let x = 2; x < stitchSize - 2; x++) {
                let sum = 0, sqSum = 0;
                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        const v = exgData[(y + ky) * stitchSize + (x + kx)];
                        sum += v; sqSum += v * v;
                    }
                }
                const mean = sum / 9;
                const variance = sqSum / 9 - mean * mean;
                const smoothness = 1.0 / (1.0 + Math.sqrt(Math.max(0, variance)));
                processed[y * stitchSize + x] = ((mean - minE) / (maxE - minE || 1)) * smoothness;
            }
        }
    }

    // ── Per-tier ridge detection + BFS cluster detection ──────────────────────

    const config = sourceType.startsWith('terrain') ? SCAN_PROFILE.TERRAIN :
                   sourceType === 'slope'            ? SCAN_PROFILE.SLOPE   :
                   sourceType === 'hydrology'        ? SCAN_PROFILE.HYDROLOGY
                                                     : SCAN_PROFILE.AERIAL;

    const TIERS = [
        { label: 'Micro',      step: 1, minSize: config.minSize,       dilation: config.dilation,     threshMult: 1.1, edgeMargin: 20, edgeSizeThreshold: 150, edgePenalty: 0.10 },
        { label: 'Structural', step: 3, minSize: config.minSize * 5,   dilation: config.dilation + 1, threshMult: 1.0, edgeMargin: 14, edgeSizeThreshold: 80,  edgePenalty: 0.06 },
        { label: 'Enclosure',  step: 8, minSize: config.minSize * 15,  dilation: config.dilation + 2, threshMult: 0.9, edgeMargin: 8,  edgeSizeThreshold: 0,   edgePenalty: 0.03 },
    ];

    const allClusters: Cluster[] = [];
    const globalVisited = new Uint8Array(stitchSize * stitchSize);

    for (const tier of TIERS) {
        const tierRidgeMap = new Float32Array(stitchSize * stitchSize);
        const tierLapMap   = new Float32Array(stitchSize * stitchSize);
        let tierMaxRidge = 0;
        const s = tier.step;

        for (let y = s * 2; y < stitchSize - s * 2; y++) {
            for (let x = s * 2; x < stitchSize - s * 2; x++) {
                const f   = processed[y * stitchSize + x];
                const fxx = processed[y * stitchSize + (x + s)] + processed[y * stitchSize + (x - s)] - 2 * f;
                const fyy = processed[(y + s) * stitchSize + x] + processed[(y - s) * stitchSize + x] - 2 * f;
                const fxy = (processed[(y + s) * stitchSize + (x + s)] + processed[(y - s) * stitchSize + (x - s)] - processed[(y + s) * stitchSize + (x - s)] - processed[(y - s) * stitchSize + (x + s)]) / 4;
                const lap   = fxx + fyy;
                const ridge = Math.max(Math.abs(lap), Math.sqrt(Math.max(0, (fxx - fyy) * (fxx - fyy) + 4 * fxy * fxy)));
                tierRidgeMap[y * stitchSize + x] = ridge;
                tierLapMap[y * stitchSize + x]   = lap;
                if (ridge > tierMaxRidge) tierMaxRidge = ridge;
            }
        }

        const threshold = tierMaxRidge * config.threshold * tier.threshMult;

        const featureMap = new Float32Array(stitchSize * stitchSize);
        for (let y = 15; y < stitchSize - 15; y++) {
            for (let x = 15; x < stitchSize - 15; x++) {
                const val    = tierRidgeMap[y * stitchSize + x];
                const lapVal = tierLapMap[y * stitchSize + x];
                const isSlopeIntensity = sourceType === 'slope' && processed[y * stitchSize + x] < 0.4;
                const isHydrology      = sourceType === 'hydrology' && lapVal > 0.20;

                let strength = 0;
                if (val > threshold) {
                    strength = tierMaxRidge > 0 ? val / tierMaxRidge : 1.0;
                } else if (isSlopeIntensity) {
                    strength = (0.4 - processed[y * stitchSize + x]) / 0.4;
                } else if (isHydrology) {
                    strength = Math.min(1.0, (lapVal - 0.20) / 0.30 + 0.4);
                }

                if (strength > 0) {
                    for (let dy2 = -tier.dilation; dy2 <= tier.dilation; dy2++) {
                        for (let dx2 = -tier.dilation; dx2 <= tier.dilation; dx2++) {
                            const fi = (y + dy2) * stitchSize + (x + dx2);
                            if (featureMap[fi] < strength) featureMap[fi] = strength;
                        }
                    }
                }
            }
        }

        const visited = new Uint8Array(stitchSize * stitchSize);
        for (let y = 0; y < stitchSize; y++) {
            for (let x = 0; x < stitchSize; x++) {
                const idx = y * stitchSize + x;
                if (featureMap[idx] === 0 || visited[idx] !== 0 || globalVisited[idx] !== 0) continue;

                const cluster: Cluster = {
                    id: `${sourceType}-${tier.label}-${x}-${y}`,
                    points: [], minX: x, maxX: x, minY: y, maxY: y,
                    type: 'Anomaly', score: 0, number: 0, isProtected: false,
                    confidence: 'Medium', findPotential: 0, center: [0, 0],
                    source: sourceType as Cluster['source'],
                    sources: [sourceType as Cluster['source']],
                    polarity: 'Unknown',
                    scaleTier: tier.label as Cluster['scaleTier'],
                    observationKind: 'image_anomaly',
                    terrainMeasured: false,
                };

                let head = 0;
                const queue: [number, number][] = [[x, y]];
                visited[idx] = 1; globalVisited[idx] = 1;

                let sumLap = 0, sumRidge = 0;
                let sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0, sumXY = 0;
                let sumSin = 0, sumCos = 0, dirSamples = 0, dirCounter = 0;

                while (head < queue.length) {
                    const [cx, cy] = queue[head++];
                    cluster.points.push({ x: cx, y: cy });

                    const lapV = tierLapMap[cy * stitchSize + cx];
                    sumLap   += lapV;
                    sumRidge += featureMap[cy * stitchSize + cx];
                    sumX  += cx; sumY  += cy;
                    sumX2 += cx * cx; sumY2 += cy * cy; sumXY += cx * cy;

                    if (dirCounter % 4 === 0 && cx > 0 && cx < stitchSize - 1 && cy > 0 && cy < stitchSize - 1) {
                        const dz_dx = (processed[cy * stitchSize + (cx + 1)] - processed[cy * stitchSize + (cx - 1)]) / 2;
                        const dz_dy = (processed[(cy + 1) * stitchSize + cx] - processed[(cy - 1) * stitchSize + cx]) / 2;
                        const angle2 = 2 * Math.atan2(dz_dy, dz_dx);
                        sumCos += Math.cos(angle2); sumSin += Math.sin(angle2);
                        dirSamples++;
                    }
                    dirCounter++;

                    cluster.minX = Math.min(cluster.minX, cx); cluster.maxX = Math.max(cluster.maxX, cx);
                    cluster.minY = Math.min(cluster.minY, cy); cluster.maxY = Math.max(cluster.maxY, cy);

                    for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as [number, number][]) {
                        if (nx >= 0 && nx < stitchSize && ny >= 0 && ny < stitchSize) {
                            const nidx = ny * stitchSize + nx;
                            if (featureMap[nidx] > 0 && visited[nidx] === 0) {
                                visited[nidx] = 1; globalVisited[nidx] = 1; queue.push([nx, ny]);
                            }
                        }
                    }
                }

                const w = (cluster.maxX - cluster.minX) + 1;
                const h = (cluster.maxY - cluster.minY) + 1;
                const areaPx = cluster.points.length;
                const dens   = areaPx / (w * h);
                const ratio  = Math.max(w / h, h / w);
                const minAxis = Math.min(w, h);

                if (areaPx <= tier.minSize) continue;
                if (bboxTouchesUnloadedTile(cluster.minX, cluster.maxX, cluster.minY, cluster.maxY, loadedTiles)) continue;
                if (!sourceType.startsWith('terrain') && sourceType !== 'slope' && sourceType !== 'hydrology') {
                    if (dens <= (config.minSolidity ?? 0.32) && ratio <= (config.minLinearity ?? 4.2)) continue;
                }

                const midX = sumX / areaPx;
                const midY = sumY / areaPx;

                const lon = (tX_start + midX / 256) / n * 360 - 180;
                const yNorm = (tY_start + midY / 256) / n;
                const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * yNorm))) - Math.PI / 2);
                cluster.center  = [lon, lat];
                cluster.polarity = 'Unknown';
                cluster.imagePolarity = sumLap < 0 ? 'lighter' : 'darker';

                const meanRidgeStrength = sumRidge / areaPx;
                const dirConsistency    = dirSamples > 0
                    ? Math.sqrt(sumCos * sumCos + sumSin * sumSin) / dirSamples
                    : 0;

                // PCA bearing (elongated features only)
                let bearing = 0;
                if (ratio > 2.5) {
                    const mX = midX, mY = midY;
                    const covXX = sumX2 / areaPx - mX * mX;
                    const covYY = sumY2 / areaPx - mY * mY;
                    const covXY = sumXY / areaPx - mX * mY;
                    bearing = 0.5 * Math.atan2(2 * covXY, covXX - covYY) * (180 / Math.PI);
                }
                cluster.bearing = bearing;

                // Rendered-image gradients describe pixel morphology only. They
                // must never populate aspect, elevation, relief or slope fields.

                // Bounds check
                if (lon < bounds.west || lon > bounds.east || lat < bounds.south || lat > bounds.north) continue;

                // Convex hull perimeter is more accurate for irregular shapes.
                // Falls back to bounding-box perimeter if hull computation fails.
                const bbPerimeter  = w * 2 + h * 2;
                const hullPerim    = cluster.points.length >= 3 ? convexHullPerimeter(cluster.points) : 0;
                const perimeterPx  = hullPerim > 0 ? hullPerim : bbPerimeter;
                const circularity  = (4 * Math.PI * areaPx) / Math.pow(perimeterPx, 2);

                const centerBox = {
                    minX: Math.floor(cluster.minX + w * 0.25), maxX: Math.floor(cluster.maxX - w * 0.25),
                    minY: Math.floor(cluster.minY + h * 0.25), maxY: Math.floor(cluster.maxY - h * 0.25),
                };
                let centerPixels = 0;
                for (const p of cluster.points) {
                    if (p.x >= centerBox.minX && p.x <= centerBox.maxX && p.y >= centerBox.minY && p.y <= centerBox.maxY) centerPixels++;
                }
                const isHollow = centerPixels / (areaPx * 0.25) < 0.35 && areaPx > 100;

                const nearEdge = cluster.minX < tier.edgeMargin || cluster.maxX > stitchSize - tier.edgeMargin ||
                                 cluster.minY < tier.edgeMargin || cluster.maxY > stitchSize - tier.edgeMargin;
                if (nearEdge && areaPx < tier.edgeSizeThreshold) continue;

                // Classification
                const isMovement = ratio > 6.0 && minAxis >= 6 && dirConsistency > 0.35;
                const isChannelLike = sourceType === 'hydrology' && ratio > 4.0 && minAxis >= 8 && dens > 0.25;

                // Circularity threshold varies by source: ploughing distorts ring features
                // in satellite imagery more than in LiDAR, so satellite uses a looser threshold
                // (0.62) while LiDAR retains the more precise 0.68.
                const circularityThresh = sourceType.startsWith('satellite_') ? 0.62 : 0.68;

                if      (isHollow && circularity > 0.55 && areaPx > 150) cluster.type = 'Ring Feature (Possible Ditch or Enclosure)';
                else if (isHollow && areaPx > 80)                        cluster.type = 'Enclosure Signal (Possible Earthwork)';
                else if (isChannelLike)                                   cluster.type = 'Linear Image Anomaly (Channel-like)';
                else if (sourceType.startsWith('satellite_'))             cluster.type = 'Vegetation Stress Signal';
                else if (isMovement)                                      cluster.type = 'Movement Signal (Possible Trackway)';
                else if (ratio > 3.0)                                     cluster.type = 'Linear Feature (Ditch or Bank Signal)';
                else if (dens > 0.75 && ratio < 1.4 && areaPx > 80)      cluster.type = 'Structural Signal (Possible Building Remains)';
                else if (circularity > circularityThresh && dens > 0.55 && areaPx > 60) cluster.type = 'Circular Feature (Possible Structure or Mound)';
                else if (areaPx > 400)                                    cluster.type = 'Complex Earthwork Signal';
                else                                                      cluster.type = 'Subsurface Anomaly (Unclassified)';

                // ── Internal structure analysis ───────────────────────────────────────
                // Compute core-vs-shell point density BEFORE points are cleared.
                // Core zone = inner 40% of bounding box on each axis (16% of bbox area).
                // interiorDensity ratio: 0 = hollow (ring/enclosure), 1 = solid fill (mound/platform).
                // Only computed for clusters with ≥80 points; 0.5 (unknown) otherwise.
                let interiorDensityVal = 0.5;
                if (areaPx >= 80) {
                    const coreMinX = cluster.minX + w * 0.30;
                    const coreMaxX = cluster.minX + w * 0.70;
                    const coreMinY = cluster.minY + h * 0.30;
                    const coreMaxY = cluster.minY + h * 0.70;
                    const expectedCoreFrac = 0.4 * 0.4; // 16% of bbox
                    let coreCount = 0;
                    for (const p of cluster.points) {
                        if (p.x >= coreMinX && p.x <= coreMaxX && p.y >= coreMinY && p.y <= coreMaxY) coreCount++;
                    }
                    const observedCoreFrac = coreCount / areaPx;
                    interiorDensityVal = Math.min(1, observedCoreFrac / (expectedCoreFrac + 0.001));
                }

                // Refine classification using confirmed internal structure.
                // A solid interior invalidates a ring morphology; a hollow circle upgrades to ring.
                if (interiorDensityVal > 0.70 && cluster.type === 'Ring Feature (Possible Ditch or Enclosure)') {
                    cluster.type = 'Enclosure Signal (Possible Earthwork)';
                } else if (interiorDensityVal < 0.25 && cluster.type === 'Circular Feature (Possible Structure or Mound)' && circularity > 0.60) {
                    cluster.type = 'Ring Feature (Possible Ditch or Enclosure)';
                }

                // Confidence
                let confidenceVal = dens * 0.22 + circularity * 0.22 + Math.min(areaPx / 600, 1) * 0.26 + meanRidgeStrength * 0.30;

                if      (sourceType === 'terrain' || sourceType === 'terrain_global') confidenceVal = Math.min(1, confidenceVal + 0.08);
                else if (sourceType === 'hydrology')                                  confidenceVal = Math.min(1, confidenceVal + 0.04);
                else if (sourceType.startsWith('satellite_'))                         confidenceVal = Math.max(0, confidenceVal - 0.08);
                else if (sourceType === 'slope')                                      confidenceVal = Math.max(0, confidenceVal - 0.05);

                if (ratio > 3.0 && dirConsistency < 0.25) confidenceVal = Math.max(0, confidenceVal - 0.06);
                if (nearEdge)                              confidenceVal = Math.max(0, confidenceVal - tier.edgePenalty);

                // Confirmed hollow ring: genuine ring-ditch morphology is archaeologically credible
                if (interiorDensityVal < 0.25 && cluster.type.includes('Ring')) {
                    confidenceVal = Math.min(1, confidenceVal + 0.05);
                }

                cluster.confidence    = confidenceVal > 0.6 ? 'High' : confidenceVal > 0.35 ? 'Medium' : 'Subtle';
                cluster.findPotential = Math.min(96, Math.round(confidenceVal * 100));

                cluster.metrics = {
                    circularity, density: dens, ratio, area: areaPx,
                    ridgeStrength: meanRidgeStrength, dirConsistency, interiorDensity: interiorDensityVal,
                };
                const minTileX = Math.max(0, Math.floor(cluster.minX / TILE_SIZE));
                const maxTileX = Math.min(2, Math.floor(cluster.maxX / TILE_SIZE));
                const minTileY = Math.max(0, Math.floor(cluster.minY / TILE_SIZE));
                const maxTileY = Math.min(2, Math.floor(cluster.maxY / TILE_SIZE));
                cluster.provenance = tileProvenance.filter(item => item.tile &&
                    item.tile.x >= tX_start + minTileX && item.tile.x <= tX_start + maxTileX &&
                    item.tile.y >= tY_start + minTileY && item.tile.y <= tY_start + maxTileY);
                // points was only needed inside the worker — clear before postMessage to avoid
                // structured-cloning potentially thousands of pixel coords per cluster.
                cluster.points = [];
                allClusters.push(cluster);
            }
        }
    }

    // ── Multi-scale agreement boost ───────────────────────────────────────────
    // Bucket clusters into a spatial grid so each cluster only checks nearby
    // candidates (O(n) build + O(n·k) lookup) instead of O(n²).
    const MULTI_SCALE_DIST = 0.0004;
    const GRID_CELL = 0.001; // >= MULTI_SCALE_DIST, so a 3×3 neighbourhood covers all candidates
    const grid = new Map<string, Cluster[]>();
    for (const c of allClusters) {
        const key = `${Math.floor(c.center[0] / GRID_CELL)},${Math.floor(c.center[1] / GRID_CELL)}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(c); else grid.set(key, [c]);
    }
    for (const c of allClusters) {
        const agreedTiers = new Set<string>([c.scaleTier ?? '']);
        const gx = Math.floor(c.center[0] / GRID_CELL);
        const gy = Math.floor(c.center[1] / GRID_CELL);
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                const neighbours = grid.get(`${gx + ox},${gy + oy}`);
                if (!neighbours) continue;
                for (const other of neighbours) {
                    if (other === c || other.scaleTier === c.scaleTier) continue;
                    const dx = c.center[0] - other.center[0];
                    const dy = c.center[1] - other.center[1];
                    if (Math.sqrt(dx * dx + dy * dy) < MULTI_SCALE_DIST) {
                        agreedTiers.add(other.scaleTier ?? '');
                    }
                }
            }
        }
        if (agreedTiers.size >= 2) {
            c.multiScale      = true;
            c.multiScaleLevel = agreedTiers.size;
            // Route through the logistic so multi-scale agreement cannot push a
            // cluster to 96 from a modest base — multi-scale is a quality signal,
            // not a substitute for physical evidence strength.
            const boost = agreedTiers.size >= 3 ? 8 : 5;
            c.findPotential = boostScoreLocal(c.findPotential, boost);
            if      (c.findPotential > 60) c.confidence = 'High';
            else if (c.findPotential > 35) c.confidence = 'Medium';
        }
    }

    return { clusters: allClusters, tilesLoaded: successCount, provenance: tileProvenance };
}

// ─── Worker message handler ───────────────────────────────────────────────────

// Guard: self is not defined in Node test environments. Named exports (e.g.
// boostScoreLocal) remain importable without triggering the handler assignment.
if (typeof self !== 'undefined') {
    self.onmessage = async (event: MessageEvent<unknown>) => {
        const response = await dispatchWorkerRequest<WorkerParams, WorkerResult>(
            event.data,
            async params => {
                try {
                    return await processSource(params);
                } catch {
                    // Fail-safe: an empty result is recoverable for one source.
                    return { clusters: [], tilesLoaded: 0 };
                }
            },
        );
        self.postMessage(response);
    };
}
