// ─── Terrain / satellite image processing engine ─────────────────────────────
// Moved verbatim from FieldGuide.tsx — logic is intentionally unchanged.

import { Cluster, SCAN_PROFILE } from '../pages/fieldGuideTypes';

type SourceType = 'terrain' | 'satellite' | 'historic' | 'terrain_global' | 'slope' | 'hydrology' | 'satellite_spring' | 'satellite_summer';

function isPointInPolygon(lat: number, lon: number, rings: number[][][]): boolean {
    let inside = false;
    for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
            if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
        }
    }
    return inside;
}

export async function scanDataSource(
    sourceType: SourceType,
    zoom: number,
    tX_start: number,
    tY_start: number,
    bounds: { getWest(): number; getEast(): number; getSouth(): number; getNorth(): number },
    n: number,
    assetsGeoJSON: { features: unknown[] }
): Promise<Cluster[]> {
    const stitchSize = 768;
    const stitchCanvas = document.createElement('canvas');
    stitchCanvas.width = stitchSize; stitchCanvas.height = stitchSize;
    const stitchCtx = stitchCanvas.getContext('2d');
    if (!stitchCtx) return [];

    const isH = sourceType === 'historic';
    const hZoom = 14;
    const effectiveZoom = isH ? hZoom : zoom;
    const zDiff = isH ? (zoom - hZoom) : 0;
    const zScale = Math.pow(2, zDiff);
    void effectiveZoom; void zScale; // used only in tile URL construction conceptually

    const loadTiles = async (): Promise<boolean> => {
        stitchCtx.clearRect(0, 0, stitchSize, stitchSize);
        let successCount = 0;

        const promises = [];
        for (let dy = 0; dy < 3; dy++) {
            for (let dx = 0; dx < 3; dx++) {
                const tx = tX_start + dx;
                const ty = tY_start + dy;

                let url = "";
                if (sourceType === 'terrain') url = `https://services.arcgis.com/JJT1S6cy9mS999Xy/arcgis/rest/services/LIDAR_Composite_1m_DTM_2025_Hillshade/MapServer/tile/${zoom}/${ty}/${tx}`;
                else if (sourceType === 'terrain_global') url = `https://services.arcgis.com/JJT1S6cy9mS999Xy/arcgis/rest/services/LIDAR_Composite_1m_DTM_2022_Multi_Directional_Hillshade/MapServer/tile/${zoom}/${ty}/${tx}`;
                else if (sourceType === 'slope') url = `https://environment.data.gov.uk/image/rest/services/SURVEY/LIDAR_Composite_DTM_1m_2022_Slope/ImageServer/tile/${zoom}/${ty}/${tx}`;
                else if (sourceType === 'hydrology') url = `https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/${zoom}/${ty}/${tx}`;
                else if (sourceType === 'satellite') url = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;
                else if (sourceType === 'satellite_spring') url = `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/43321/${zoom}/${ty}/${tx}`;
                else if (sourceType === 'satellite_summer') url = `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/45236/${zoom}/${ty}/${tx}`;

                promises.push(new Promise<void>((resolve) => {
                    const img = new Image();
                    img.crossOrigin = "anonymous";
                    const timer = setTimeout(() => { img.src = ""; resolve(); }, 4000);
                    img.onload = () => {
                        clearTimeout(timer);
                        successCount++;
                        stitchCtx.drawImage(img, dx * 256, dy * 256);
                        resolve();
                    };
                    img.onerror = () => {
                        const fallbackImg = new Image();
                        fallbackImg.crossOrigin = "anonymous";
                        fallbackImg.onload = () => {
                            successCount++;
                            stitchCtx.drawImage(fallbackImg, dx * 256, dy * 256);
                            resolve();
                        };
                        fallbackImg.onerror = () => { clearTimeout(timer); resolve(); };

                        if (sourceType === 'terrain') {
                            fallbackImg.src = `https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/${zoom}/${ty}/${tx}`;
                        } else if (sourceType === 'terrain_global') {
                            fallbackImg.src = `https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/${zoom}/${ty}/${tx}`;
                        } else if (sourceType === 'slope' || sourceType === 'hydrology') {
                            fallbackImg.src = `https://services.arcgisonline.com/arcgis/rest/services/World_Shaded_Relief/MapServer/tile/${zoom}/${ty}/${tx}`;
                        } else {
                            clearTimeout(timer); resolve();
                        }
                    };
                    img.src = url;
                }));
            }
        }
        await Promise.all(promises);
        return successCount > 0;
    };

    const loaded = await loadTiles();
    if (!loaded) return [];

    const rawData = stitchCtx.getImageData(0, 0, stitchSize, stitchSize).data;
    const preBlur = new Float32Array(stitchSize * stitchSize);

    for (let i = 0; i < rawData.length; i += 4) {
        preBlur[i/4] = (rawData[i] + rawData[i+1] + rawData[i+2])/3;
    }

    const processed = new Float32Array(stitchSize * stitchSize);
    for (let y = 1; y < stitchSize - 1; y++) {
        for (let x = 1; x < stitchSize - 1; x++) {
            let sum = 0;
            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    sum += preBlur[(y+ky)*stitchSize + (x+kx)];
                }
            }
            processed[y*stitchSize + x] = sum / 9;
        }
    }

    if (sourceType.startsWith('terrain')) {
        const macroBlur = new Float32Array(stitchSize * stitchSize);
        const temp = new Float32Array(stitchSize * stitchSize);
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

    if (sourceType.startsWith('terrain') || sourceType === 'slope' || sourceType === 'hydrology') {
        let minG = 255, maxG = 0;
        for (let i = 0; i < processed.length; i++) {
            const v = processed[i];
            if (v < minG) minG = v; if (v > maxG) maxG = v;
        }
        if (maxG - minG < 3) return [];
        for (let i = 0; i < processed.length; i++) processed[i] = (processed[i] - minG) / (maxG - minG || 1);
    } else {
        const exgData = new Float32Array(stitchSize * stitchSize);
        let minE = 255, maxE = -255;
        for (let i = 0; i < rawData.length; i += 4) {
            const exg = (2 * rawData[i+1] - (rawData[i] + rawData[i+2]));
            exgData[i/4] = exg;
            if (exg < minE) minE = exg; if (exg > maxE) maxE = exg;
        }
        for (let y = 2; y < stitchSize - 2; y++) {
            for (let x = 2; x < stitchSize - 2; x++) {
                let sum = 0, sqSum = 0;
                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        const v = exgData[(y+ky)*stitchSize + (x+kx)];
                        sum += v; sqSum += v * v;
                    }
                }
                const mean = sum / 9;
                const variance = (sqSum / 9) - (mean * mean);
                const smoothness = 1.0 / (1.0 + Math.sqrt(Math.max(0, variance)));
                processed[y*stitchSize + x] = ((mean - minE) / (maxE - minE || 1)) * smoothness;
            }
        }
    }

    const config = sourceType.startsWith('terrain') ? SCAN_PROFILE.TERRAIN :
                  (sourceType === 'slope' ? SCAN_PROFILE.SLOPE :
                  (sourceType === 'hydrology' ? SCAN_PROFILE.HYDROLOGY :
                  (sourceType === 'historic' ? SCAN_PROFILE.HISTORIC : SCAN_PROFILE.AERIAL)));

    const TIERS = [
        { label: 'Micro', step: 1, minSize: config.minSize, dilation: config.dilation, threshMult: 1.1 },
        { label: 'Structural', step: 3, minSize: config.minSize * 5, dilation: config.dilation + 1, threshMult: 1.0 },
        { label: 'Enclosure', step: 8, minSize: config.minSize * 15, dilation: config.dilation + 2, threshMult: 0.9 }
    ];

    const allClusters: Cluster[] = [];
    const globalVisited = new Uint8Array(stitchSize * stitchSize);

    for (const tier of TIERS) {
        const tierRidgeMap = new Float32Array(stitchSize * stitchSize);
        const tierLapMap = new Float32Array(stitchSize * stitchSize);
        let tierMaxRidge = 0;
        const s = tier.step;

        for (let y = s * 2; y < stitchSize - s * 2; y++) {
            for (let x = s * 2; x < stitchSize - s * 2; x++) {
                const f = processed[y*stitchSize + x];
                const fxx = processed[y*stitchSize + (x+s)] + processed[y*stitchSize + (x-s)] - 2*f;
                const fyy = processed[(y+s)*stitchSize + x] + processed[(y-s)*stitchSize + x] - 2*f;
                const fxy = (processed[(y+s)*stitchSize + (x+s)] + processed[(y-s)*stitchSize + (x-s)] - processed[(y+s)*stitchSize + (x-s)] - processed[(y-s)*stitchSize + (x+s)]) / 4;
                const lap = fxx + fyy;
                const ridge = Math.max(Math.abs(lap), Math.sqrt(Math.max(0, (fxx-fyy)*(fxx-fyy) + 4*fxy*fxy)));
                tierRidgeMap[y*stitchSize + x] = ridge;
                tierLapMap[y*stitchSize + x] = lap;
                if (ridge > tierMaxRidge) tierMaxRidge = ridge;
            }
        }

        const threshold = tierMaxRidge * config.threshold * tier.threshMult;
        const featureMap = new Uint8Array(stitchSize * stitchSize);
        for (let y = 15; y < stitchSize - 15; y++) {
            for (let x = 15; x < stitchSize - 15; x++) {
                const val = tierRidgeMap[y*stitchSize + x];
                const isSlopeIntensity = sourceType === 'slope' && processed[y*stitchSize + x] < 0.4;
                const isHydrology = sourceType === 'hydrology' && tierLapMap[y*stitchSize + x] > 0.12;

                if (val > threshold || isSlopeIntensity || isHydrology) {
                    for (let dy = -tier.dilation; dy <= tier.dilation; dy++) {
                        for (let dx = -tier.dilation; dx <= tier.dilation; dx++) featureMap[(y+dy)*stitchSize + (x+dx)] = 1;
                    }
                }
            }
        }

        const visited = new Uint8Array(stitchSize * stitchSize);
        for (let y = 0; y < stitchSize; y++) {
            for (let x = 0; x < stitchSize; x++) {
                const idx = y * stitchSize + x;
                if (featureMap[idx] === 1 && visited[idx] === 0 && globalVisited[idx] === 0) {
                    const cluster: Cluster = { id: Math.random().toString(36).substring(7), points: [], minX: x, maxX: x, minY: y, maxY: y, type: "Anomaly", score: 0, number: 0, isProtected: false, confidence: 'Medium', findPotential: 0, center: [0, 0], source: sourceType, sources: [sourceType], polarity: 'Unknown', scaleTier: tier.label as Cluster['scaleTier'] };
                    const queue: [number, number][] = [[x, y]]; visited[idx] = 1; globalVisited[idx] = 1;
                    let sumLap = 0;
                    while (queue.length > 0) {
                        const [cx, cy] = queue.shift()!; cluster.points.push({x: cx, y: cy});
                        sumLap += tierLapMap[cy * stitchSize + cx];
                        cluster.minX = Math.min(cluster.minX, cx); cluster.maxX = Math.max(cluster.maxX, cx);
                        cluster.minY = Math.min(cluster.minY, cy); cluster.maxY = Math.max(cluster.maxY, cy);
                        for (const [nx, ny] of [[cx+1, cy], [cx-1, cy], [cx, cy+1], [cx, cy-1]]) {
                            if (nx >= 0 && nx < stitchSize && ny >= 0 && ny < stitchSize) {
                                const nidx = ny * stitchSize + nx; if (featureMap[nidx] === 1 && visited[nidx] === 0) { visited[nidx] = 1; globalVisited[nidx] = 1; queue.push([nx, ny]); }
                            }
                        }
                    }

                    const w = (cluster.maxX - cluster.minX) + 1, h = (cluster.maxY - cluster.minY) + 1;
                    const areaPx = cluster.points.length, dens = areaPx / (w * h);
                    const ratio = Math.max(w/h, h/w);

                    if (areaPx > tier.minSize && (sourceType.startsWith('terrain') || sourceType === 'slope' || sourceType === 'hydrology' || (dens > (config.minSolidity ?? 0.32)) || (ratio > (config.minLinearity ?? 4.2)))) {
                        let sumX = 0, sumY = 0;
                        for (const p of cluster.points) { sumX += p.x; sumY += p.y; }
                        const midX = sumX / areaPx;
                        const midY = sumY / areaPx;

                        const lon = (tX_start + midX / 256) / n * 360 - 180;
                        const yNorm = (tY_start + midY / 256) / n;
                        const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * yNorm))) - Math.PI / 2);
                        cluster.center = [lon, lat];
                        cluster.polarity = sumLap < 0 ? 'Raised' : 'Sunken';

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
                                    processed[(iy-1)*stitchSize+(ix-1)], processed[(iy-1)*stitchSize+ix], processed[(iy-1)*stitchSize+(ix+1)],
                                    processed[iy*stitchSize+(ix-1)],                                     processed[iy*stitchSize+(ix+1)],
                                    processed[(iy+1)*stitchSize+(ix-1)], processed[(iy+1)*stitchSize+ix], processed[(iy+1)*stitchSize+(ix+1)]
                                ];
                                neighbors.forEach(v => { if (v > cVal + 0.02) higher++; else if (v < cVal - 0.02) lower++; });

                                if (higher >= 6) cluster.relativeElevation = 'Hollow';
                                else if (lower >= 6) cluster.relativeElevation = 'Ridge';
                                else if (higher >= 1 && lower >= 1) cluster.relativeElevation = 'Slope';
                                else cluster.relativeElevation = 'Flat';
                            }
                        }

                        if (lon >= bounds.getWest() && lon <= bounds.getEast() && lat >= bounds.getSouth() && lat <= bounds.getNorth()) {
                            for (const asset of assetsGeoJSON.features as unknown[]) {
                                const a = asset as { geometry?: { type: string; coordinates: unknown }; properties?: { Name?: string } };
                                if (a.geometry?.type === 'Polygon' && isPointInPolygon(lat, lon, a.geometry.coordinates as number[][][])) { cluster.isProtected = true; cluster.monumentName = a.properties?.Name; break; }
                                else if (a.geometry?.type === 'MultiPolygon') {
                                    for (const poly of a.geometry.coordinates as number[][][][]) { if (isPointInPolygon(lat, lon, poly)) { cluster.isProtected = true; cluster.monumentName = a.properties?.Name; break; } }
                                }
                            }
                            const perimeterPx = (w * 2) + (h * 2), circularity = (4 * Math.PI * areaPx) / Math.pow(perimeterPx, 2);

                            let bearing = 0;
                            if (ratio > 2.5) bearing = Math.atan2(cluster.maxY - cluster.minY, cluster.maxX - cluster.minX) * (180 / Math.PI);
                            cluster.bearing = bearing;

                            const centerBox = {
                                minX: Math.floor(cluster.minX + w * 0.25), maxX: Math.floor(cluster.maxX - w * 0.25),
                                minY: Math.floor(cluster.minY + h * 0.25), maxY: Math.floor(cluster.maxY - h * 0.25)
                            };
                            let centerPixels = 0;
                            for (const p of cluster.points) { if (p.x >= centerBox.minX && p.x <= centerBox.maxX && p.y >= centerBox.minY && p.y <= centerBox.maxY) centerPixels++; }
                            const isHollow = centerPixels / (areaPx * 0.25) < 0.35 && areaPx > 100;

                            if (isHollow && circularity > 0.45) cluster.type = "Ring Feature (Possible Ditch or Enclosure)";
                            else if (isHollow) cluster.type = "Enclosure Signal (Possible Earthwork)";
                            else if (sourceType === 'hydrology' && ratio > 3.5 && cluster.polarity === 'Sunken') cluster.type = "Palaeochannel (Ancient Watercourse)";
                            else if (sourceType.startsWith('satellite_')) cluster.type = "Vegetation Stress Signal";
                            else if (ratio > 6.0) cluster.type = "Movement Signal (Possible Trackway)";
                            else if (ratio > 3.0) cluster.type = "Linear Feature (Ditch or Bank Signal)";
                            else if (dens > 0.7 && ratio < 1.4) cluster.type = "Structural Signal (Possible Building Remains)";
                            else if (circularity > 0.65 && dens > 0.5) cluster.type = "Circular Feature (Possible Structure or Mound)";
                            else if (areaPx > 400) cluster.type = "Complex Earthwork Signal";
                            else cluster.type = "Subsurface Anomaly (Unclassified)";

                            const confidenceVal = (dens * 0.3) + (circularity * 0.3) + (Math.min(areaPx/600, 1) * 0.4);
                            cluster.confidence = confidenceVal > 0.6 ? 'High' : (confidenceVal > 0.35 ? 'Medium' : 'Subtle');
                            cluster.findPotential = Math.min(96, Math.round((confidenceVal * 100)));
                            cluster.metrics = { circularity, density: dens, ratio, area: areaPx };
                            allClusters.push(cluster);
                        }
                    }
                }
            }
        }
    }
    return allClusters;
}
