// ─── Terrain scan worker ──────────────────────────────────────────────────────
// Runs inside a Web Worker. Receives tile parameters, fetches tiles via
// fetch() + createImageBitmap(), composites them onto OffscreenCanvas, runs the
// full pixel-processing pipeline, and posts back a Cluster[].
//
// No DOM access (document/window) — OffscreenCanvas only.

import { Cluster, SCAN_PROFILE } from '../pages/fieldGuideTypes';
import { waybackTileUrl } from '../utils/waybackService';

type SourceType = 'terrain' | 'terrain_global' | 'slope' | 'hydrology' | 'satellite_spring' | 'satellite_summer';

export interface WorkerParams {
    sourceType: SourceType;
    zoom: number;
    tX_start: number;
    tY_start: number;
    /** Plain bounds object — no MapLibre LngLatBounds methods in the worker */
    bounds: { west: number; east: number; south: number; north: number };
    n: number;
    /** Resolved by the main thread before the worker starts — avoids duplicate catalog fetches */
    waybackIds: { spring: number; summer: number } | null;
}

// ─── Tile fetch helper ────────────────────────────────────────────────────────

async function fetchBitmapTimed(url: string): Promise<ImageBitmap | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) return null;
        return await createImageBitmap(await res.blob());
    } catch {
        clearTimeout(timer);
        return null;
    }
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

function boostScoreLocal(base: number, boost: number): number {
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

// ─── Main processing function ─────────────────────────────────────────────────

async function processSource(params: WorkerParams): Promise<Cluster[]> {
    const { sourceType, zoom, tX_start, tY_start, bounds, n, waybackIds } = params;
    const stitchSize = 768;

    const canvas = new OffscreenCanvas(stitchSize, stitchSize);
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];

    // ── Tile loading ──────────────────────────────────────────────────────────

    const promises: Promise<void>[] = [];
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
            } else if (sourceType === 'satellite_spring') {
                primaryUrl  = waybackIds ? waybackTileUrl(waybackIds.spring, zoom, ty, tx) : '';
                fallbackUrl = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;
            } else if (sourceType === 'satellite_summer') {
                primaryUrl  = waybackIds ? waybackTileUrl(waybackIds.summer, zoom, ty, tx) : '';
                fallbackUrl = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;
            }

            const dxCopy = dx, dyCopy = dy;
            promises.push((async () => {
                let bitmap: ImageBitmap | null = null;
                if (primaryUrl) bitmap = await fetchBitmapTimed(primaryUrl);
                if (!bitmap && fallbackUrl) bitmap = await fetchBitmapTimed(fallbackUrl);
                if (bitmap) {
                    ctx.drawImage(bitmap, dxCopy * 256, dyCopy * 256);
                    bitmap.close();
                    successCount++;
                }
            })());
        }
    }

    await Promise.all(promises);
    if (successCount === 0) return [];

    // ── Pixel extraction ──────────────────────────────────────────────────────

    const rawData = ctx.getImageData(0, 0, stitchSize, stitchSize).data;
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
        if (maxG - minG < 3) return [];
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
                if (!sourceType.startsWith('terrain') && sourceType !== 'slope' && sourceType !== 'hydrology') {
                    if (dens <= (config.minSolidity ?? 0.32) && ratio <= (config.minLinearity ?? 4.2)) continue;
                }

                const midX = sumX / areaPx;
                const midY = sumY / areaPx;

                const lon = (tX_start + midX / 256) / n * 360 - 180;
                const yNorm = (tY_start + midY / 256) / n;
                const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * yNorm))) - Math.PI / 2);
                cluster.center  = [lon, lat];
                cluster.polarity = sumLap < 0 ? 'Raised' : 'Sunken';

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

                if (sourceType.startsWith('terrain')) {
                    const ix = Math.floor(midX), iy = Math.floor(midY);
                    if (ix > 0 && ix < stitchSize - 1 && iy > 0 && iy < stitchSize - 1) {
                        const dz_dx = (processed[iy * stitchSize + (ix + 1)] - processed[iy * stitchSize + (ix - 1)]) / 2.0;
                        const dz_dy = (processed[(iy + 1) * stitchSize + ix] - processed[(iy - 1) * stitchSize + ix]) / 2.0;
                        let aspect = Math.atan2(dz_dy, -dz_dx) * (180 / Math.PI);
                        if (aspect < 0) aspect += 360;
                        cluster.aspect = aspect;

                        const cVal = processed[iy * stitchSize + ix];
                        let higher = 0, lower = 0;
                        const neighbors = [
                            processed[(iy - 1) * stitchSize + (ix - 1)], processed[(iy - 1) * stitchSize + ix], processed[(iy - 1) * stitchSize + (ix + 1)],
                            processed[iy * stitchSize + (ix - 1)],                                               processed[iy * stitchSize + (ix + 1)],
                            processed[(iy + 1) * stitchSize + (ix - 1)], processed[(iy + 1) * stitchSize + ix], processed[(iy + 1) * stitchSize + (ix + 1)],
                        ];
                        neighbors.forEach(v => { if (v > cVal + 0.02) higher++; else if (v < cVal - 0.02) lower++; });

                        if (higher >= 6)            cluster.relativeElevation = 'Hollow';
                        else if (lower >= 6)         cluster.relativeElevation = 'Ridge';
                        else if (higher >= 1 && lower >= 1) cluster.relativeElevation = 'Slope';
                        else                         cluster.relativeElevation = 'Flat';
                    }
                }

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
                const isPalaeo   = sourceType === 'hydrology' && ratio > 4.0 && cluster.polarity === 'Sunken' && minAxis >= 8 && dens > 0.25;

                // Circularity threshold varies by source: ploughing distorts ring features
                // in satellite imagery more than in LiDAR, so satellite uses a looser threshold
                // (0.62) while LiDAR retains the more precise 0.68.
                const circularityThresh = sourceType.startsWith('satellite_') ? 0.62 : 0.68;

                if      (isHollow && circularity > 0.55 && areaPx > 150) cluster.type = 'Ring Feature (Possible Ditch or Enclosure)';
                else if (isHollow && areaPx > 80)                        cluster.type = 'Enclosure Signal (Possible Earthwork)';
                else if (isPalaeo)                                        cluster.type = 'Palaeochannel (Ancient Watercourse)';
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

                // ── Terrain-derived hydrology heuristics ──────────────────────
                // Only meaningful for terrain sources (local-relief normalised data).
                let dryMarginVal      = 0;
                let flowConvergenceVal = 0;
                if (sourceType.startsWith('terrain')) {
                    const hx = Math.floor(midX), hy = Math.floor(midY);
                    if (hx > 4 && hx < stitchSize - 5 && hy > 4 && hy < stitchSize - 5) {
                        dryMarginVal      = computeDryMarginScore(hx, hy, processed, stitchSize);
                        flowConvergenceVal = computeFlowConvergence(hx, hy, processed, stitchSize);
                    }
                }
                const hydrologicalContextVal = dryMarginVal > 0 || flowConvergenceVal > 0
                    ? Math.min(1.0, dryMarginVal * 0.55 + flowConvergenceVal * 0.45)
                    : 0;

                cluster.metrics = {
                    circularity, density: dens, ratio, area: areaPx,
                    ridgeStrength: meanRidgeStrength, dirConsistency, interiorDensity: interiorDensityVal,
                    ...(dryMarginVal > 0 || flowConvergenceVal > 0 ? {
                        dryMarginScore:            dryMarginVal,
                        flowConvergence:           flowConvergenceVal,
                        hydrologicalContext:       hydrologicalContextVal,
                        hydrologyHeuristicVersion: 'terrain-hydro-v1',
                        hydrologyUsed:             true,
                    } : {}),
                };
                // points was only needed inside the worker — clear before postMessage to avoid
                // structured-cloning potentially thousands of pixel coords per cluster.
                cluster.points = [];
                allClusters.push(cluster);
            }
        }
    }

    // ── Multi-scale agreement boost ───────────────────────────────────────────
    const MULTI_SCALE_DIST = 0.0004;
    for (const c of allClusters) {
        const agreedTiers = new Set<string>([c.scaleTier ?? '']);
        for (const other of allClusters) {
            if (other === c || other.scaleTier === c.scaleTier) continue;
            const dx = c.center[0] - other.center[0];
            const dy = c.center[1] - other.center[1];
            if (Math.sqrt(dx * dx + dy * dy) < MULTI_SCALE_DIST) {
                agreedTiers.add(other.scaleTier ?? '');
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

    return allClusters;
}

// ─── Worker message handler ───────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent<WorkerParams>) => {
    const clusters = await processSource(e.data);
    self.postMessage(clusters);
};
