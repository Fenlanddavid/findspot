import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useNavigate } from 'react-router-dom';

interface Cluster {
    id: string; points: {x: number, y: number}[];
    minX: number; maxX: number; minY: number; maxY: number;
    type: string; score: number; number: number;
    isProtected: boolean;
    monumentName?: string;
    aimInfo?: { type: string; period: string; evidence: string };
    confidence: 'High' | 'Medium' | 'Subtle';
    findPotential: number;
    center: [number, number];
    source: 'terrain' | 'satellite' | 'historic' | 'terrain_global' | 'slope' | 'hydrology' | 'satellite_spring' | 'satellite_summer';
    sources: ('terrain' | 'satellite' | 'historic' | 'terrain_global' | 'slope' | 'hydrology' | 'satellite_spring' | 'satellite_summer')[];
    polarity?: 'Raised' | 'Sunken' | 'Unknown';
    bearing?: number; // Added for corridor modelling
    contextLabel?: string; // Added for settlement analysis
    scaleTier?: 'Micro' | 'Structural' | 'Enclosure' | 'Landscape';
    persistenceScore?: number; // 0-100% Stability score
    rescanCount?: number; // Number of times anchored
    disturbanceRisk?: 'Low' | 'Medium' | 'High';
    disturbanceReason?: string;
    metrics?: { circularity: number; density: number; ratio: number; area: number };
}

/**
 * FieldGuide Standalone V12.7 - Expert Verification Engine
 * Consensus: Lidar Topography | Slope Gradient | Hydrology & Palaeochannels | HE AIM Mapping
 */
const SCAN_PROFILE = {
    TERRAIN: {
        threshold: 0.15, // Increased from 0.10
        minSize: 20,     // Increased from 15
        dilation: 1,
        minSolidity: 0.12,
        minLinearity: 1.0
    },
    SLOPE: {
        threshold: 0.20, // Increased from 0.15
        minSize: 25,     // Increased from 20
        dilation: 1,
        minSolidity: 0.15,
        minLinearity: 1.2
    },
    HYDROLOGY: {
        threshold: 0.22, // Further increased from 0.15
        minSize: 500,    // Doubled from 250 to filter out noise
        dilation: 2,
        minSolidity: 0.10,
        minLinearity: 5.5 // Much stricter linearity for waterways
    },
    AERIAL: {
        threshold: 0.22,
        minSize: 120,
        dilation: 3,
        minSolidity: 0.30,
        minLinearity: 4.0
    },
    HISTORIC: {
        threshold: 0.10,
        minSize: 20,
        dilation: 2,
        minSolidity: 0.15,
        minLinearity: 1.5
    }
};

interface Zone {
    id: string;
    number: number;
    type: 'Settlement' | 'Activity' | 'Route' | 'Disturbed' | 'Unknown';
    priority: 'High' | 'Medium' | 'Low';
    persistence: 'High' | 'Medium' | 'Low';
    disturbance: 'High' | 'Medium' | 'Low';
    center: [number, number];
    bounds: [[number, number], [number, number]]; // [SW, NE]
    memberIds: string[];
    description: string;
    insights: string[];
}

export default function FieldGuide({ projectId }: { projectId: string }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [detectedFeatures, setDetectedFeatures] = useState<Cluster[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [heritageCount, setHeritageCount] = useState(0);
  const [zoomWarning, setZoomWarning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [systemLog, setSystemLog] = useState<string[]>(["SYSTEM READY. Execute Scan."]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const navigate = useNavigate();

  const mapContainerRef = useRef<HTMLDivElement>(null);

  const mapRef = useRef<maplibregl.Map | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const addLog = (msg: string) => setSystemLog(prev => [...prev, `> ${msg}`]);

  const clearScan = () => {
    setDetectedFeatures([]);
    setZones([]); // Clear all strategic zones
    setSelectedZoneId(null); // Clear active zone border
    setHeritageCount(0);
    setSelectedId(null);
    if (mapRef.current) {
        const mSrc = mapRef.current.getSource('monuments') as maplibregl.GeoJSONSource;
        if (mSrc) mSrc.setData({ type: 'FeatureCollection', features: [] });
        const tSrc = mapRef.current.getSource('targets') as maplibregl.GeoJSONSource;
        if (tSrc) tSrc.setData({ type: 'FeatureCollection', features: [] });
    }
    setSystemLog(["SYSTEM CLEARED. Ready for new scan."]);
  };

  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: { 'osm': { type: 'raster', tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '&copy; OSM' } },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
      },
      center: [-2.0, 54.5],
      zoom: 5.5,
    });

    map.on('load', () => {
        map.addSource('monuments', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'monuments-fill', type: 'fill', source: 'monuments', paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.25 } });
        map.addLayer({ id: 'monuments-outline', type: 'line', source: 'monuments', paint: { 'line-color': '#ef4444', 'line-width': 3 } });
        
        map.addSource('zones-overlay', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ 
            id: 'zones-outline', 
            type: 'line', 
            source: 'zones-overlay', 
            paint: { 
                'line-color': [
                    'match', ['get', 'type'],
                    'Settlement', '#f59e0b',
                    'Activity', '#10b981',
                    'Route', '#0ea5e9',
                    'Disturbed', '#64748b',
                    '#fff'
                ],
                'line-width': 3, 
                'line-opacity': [
                    'case',
                    ['==', ['get', 'id'], ''], 0, // Placeholder for selected ID logic
                    1.0
                ] 
            } 
        });

        map.addSource('targets', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ 
            id: 'targets-circle', 
            type: 'circle', 
            source: 'targets', 
            paint: { 
                'circle-radius': [
                    'interpolate', ['linear'], ['get', 'consensus'],
                    1, 18,
                    2, 22,
                    3, 26
                ], 
                'circle-color': [
                    'case',
                    ['get', 'isProtected'], '#ef4444',
                    ['>=', ['get', 'consensus'], 2], '#f59e0b',
                    ['==', ['get', 'source'], 'terrain'], '#10b981',
                    ['==', ['get', 'source'], 'historic'], '#f59e0b',
                    '#3b82f6'
                ],
                'circle-stroke-width': 2, 
                'circle-stroke-color': '#fff' 
            } 
        });
        map.on('click', 'targets-circle', (e) => { if (e.features?.[0]) setSelectedId(e.features[0].properties?.id); });
        
        map.on('move', () => {
            const z = map.getZoom();
            setZoomWarning(z > 16.8);
        });

        setTimeout(() => map.resize(), 300);
    });

    mapRef.current = map;
  }, []);

  useEffect(() => {
    if (mapRef.current) {
        const zoneGeoJSON = {
            type: 'FeatureCollection',
            features: zones
                .filter(z => z.id === selectedZoneId) // Only include the selected zone
                .map(z => ({
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [[
                        [z.bounds[0][0], z.bounds[0][1]],
                        [z.bounds[1][0], z.bounds[0][1]],
                        [z.bounds[1][0], z.bounds[1][1]],
                        [z.bounds[0][0], z.bounds[1][1]],
                        [z.bounds[0][0], z.bounds[0][1]]
                    ]]
                },
                properties: { id: z.id, type: z.type, priority: z.priority }
            }))
        };
        const source = mapRef.current.getSource('zones-overlay') as maplibregl.GeoJSONSource;
        if (source) source.setData(zoneGeoJSON as any);
    }
  }, [zones, selectedZoneId]);

  useEffect(() => {
    if (mapRef.current && mapRef.current.getLayer('zones-outline')) {
        if (selectedZoneId) {
            mapRef.current.setFilter('zones-outline', ['==', ['get', 'id'], selectedZoneId]);
        } else {
            mapRef.current.setFilter('zones-outline', ['==', ['get', 'id'], '']);
        }
    }
  }, [selectedZoneId]);

  useEffect(() => {
    if (mapRef.current) {
        const targetGeoJSON = { 
            type: 'FeatureCollection', 
            features: detectedFeatures.map(f => ({ 
                type: 'Feature', 
                geometry: { type: 'Point', coordinates: f.center }, 
                properties: { 
                    id: f.id, 
                    number: f.number.toString(), 
                    isProtected: f.isProtected, 
                    source: f.sources[0],
                    consensus: f.sources.length
                } 
            })) 
        };
        const source = mapRef.current.getSource('targets') as maplibregl.GeoJSONSource;
        if (source) source.setData(targetGeoJSON as any);
    }
  }, [detectedFeatures]);

  useEffect(() => {
    if (selectedId) {
        const el = document.getElementById(`card-${selectedId}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    }
  }, [selectedId]);

  useLayoutEffect(() => {
    if (logContainerRef.current) logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
  }, [systemLog]);

  const findMe = () => {
    navigator.geolocation.getCurrentPosition((pos) => {
        mapRef.current?.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 16 });
    });
  };

  const searchLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery) return;
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        if (data[0]) {
            mapRef.current?.flyTo({ center: [parseFloat(data[0].lon), parseFloat(data[0].lat)], zoom: 16 });
            setIsSearchOpen(false);
        }
    } catch (e) { addLog("Search failed."); }
  };

  const isPointInPolygon = (lat: number, lon: number, rings: any[][]) => {
    let inside = false;
    for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
            if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
        }
    }
    return inside;
  };

  const scanDataSource = async (sourceType: 'terrain' | 'satellite' | 'historic' | 'terrain_global' | 'slope' | 'hydrology' | 'satellite_spring' | 'satellite_summer', zoom: number, tX_start: number, tY_start: number, bounds: maplibregl.LngLatBounds, n: number, assetsGeoJSON: any): Promise<Cluster[]> => {
    const stitchSize = 768; // Increased from 512 for 3x3 coverage
    const stitchCanvas = document.createElement('canvas');
    stitchCanvas.width = stitchSize; stitchCanvas.height = stitchSize;
    const stitchCtx = stitchCanvas.getContext('2d');
    if (!stitchCtx) return [];

    const isH = sourceType === 'historic';
    const hZoom = 14;
    const effectiveZoom = isH ? hZoom : zoom;
    const zDiff = isH ? (zoom - hZoom) : 0;
    const zScale = Math.pow(2, zDiff);

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
                else if (sourceType === 'hydrology') url = `https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/${zoom}/${ty}/${tx}`; // Base for palaeochannels
                else if (sourceType === 'satellite') url = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;
                else if (sourceType === 'satellite_spring') url = `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/43321/${zoom}/${ty}/${tx}`; // May 2022 (Spring)
                else if (sourceType === 'satellite_summer') url = `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/45236/${zoom}/${ty}/${tx}`; // Aug 2022 (Summer Drought)

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
                        // Fallback logic for UK services that might be out of bounds or down
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
    
    // NOISE FILTERING: 3x3 Median-style smoothing pass to remove "speckle" noise
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

    // LOCAL RELIEF MODEL (LRM): Subtract macro-terrain to isolate archaeology
    if (sourceType.startsWith('terrain')) {
        const macroBlur = new Float32Array(stitchSize * stitchSize);
        const temp = new Float32Array(stitchSize * stitchSize);
        const radius = 12; // Radius for terrain extraction

        // Two-pass box blur (horizontal)
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
        // Two-pass box blur (vertical)
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

        // Subtract macro-terrain from processed to get Local Relief
        for (let i = 0; i < processed.length; i++) {
            processed[i] = (processed[i] - macroBlur[i]) + 0.5; // Offset 0.5 to keep range stable
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
        // ... Aerial processing remains same
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
    
    // MULTI-SCALE FEATURE DETECTION: 5m (Micro), 20m (Structural), 80m (Enclosure)
    const TIERS = [
        { label: 'Micro', step: 1, minSize: config.minSize, dilation: config.dilation, threshMult: 1.1 }, // Increased from 1.0
        { label: 'Structural', step: 3, minSize: config.minSize * 5, dilation: config.dilation + 1, threshMult: 1.0 }, // Increased from 0.8
        { label: 'Enclosure', step: 8, minSize: config.minSize * 15, dilation: config.dilation + 2, threshMult: 0.9 } // Increased from 0.6
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
                    const cluster: Cluster = { id: Math.random().toString(36).substring(7), points: [], minX: x, maxX: x, minY: y, maxY: y, type: "Anomaly", score: 0, number: 0, isProtected: false, confidence: 'Medium', findPotential: 0, center: [0, 0], source: sourceType, sources: [sourceType], polarity: 'Unknown', scaleTier: tier.label as any };
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

                        if (lon >= bounds.getWest() && lon <= bounds.getEast() && lat >= bounds.getSouth() && lat <= bounds.getNorth()) {
                            for (const asset of assetsGeoJSON.features as any[]) {
                                if (asset.geometry?.type === 'Polygon' && isPointInPolygon(lat, lon, asset.geometry.coordinates)) { cluster.isProtected = true; cluster.monumentName = asset.properties.Name; break; }
                                else if (asset.geometry?.type === 'MultiPolygon') {
                                    for (const poly of asset.geometry.coordinates) { if (isPointInPolygon(lat, lon, poly)) { cluster.isProtected = true; cluster.monumentName = asset.properties.Name; break; } }
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

                            if (isHollow && circularity > 0.45) cluster.type = "Ring Ditch / Henge";
                            else if (isHollow) cluster.type = "Enclosure / Earthwork Foundation";
                            else if (sourceType === 'hydrology' && ratio > 3.5 && cluster.polarity === 'Sunken') cluster.type = "Palaeochannel / Stream Bed";
                            else if (sourceType.startsWith('satellite_')) cluster.type = "Vegetation Stress Anomaly";
                            else if (ratio > 6.0) cluster.type = "Movement Corridor / Trackway";
                            else if (ratio > 3.0) cluster.type = "Linear Ditch / Bank";
                            else if (dens > 0.7 && ratio < 1.4) cluster.type = "Foundation / Building";
                            else if (circularity > 0.65 && dens > 0.5) cluster.type = "Roundhouse / Burial Mound";
                            else if (areaPx > 400) cluster.type = "Complex Earthwork System";
                            else cluster.type = "Potential Anomaly";

                            const confidenceVal = (dens * 0.3) + (circularity * 0.3) + (Math.min(areaPx/600, 1) * 0.4);
                            cluster.confidence = confidenceVal > 0.6 ? 'High' : (confidenceVal > 0.35 ? 'Medium' : 'Subtle');
                            cluster.findPotential = Math.min(99, Math.round((confidenceVal * 100)));
                            cluster.metrics = { circularity, density: dens, ratio, area: areaPx };
                            allClusters.push(cluster);
                        }
                    }
                }
            }
        }
    }
    return allClusters;
  };

  const getDistance = (c1: [number, number], c2: [number, number]) => {
      const R = 6371e3; 
      const φ1 = c1[1] * Math.PI/180;
      const φ2 = c2[1] * Math.PI/180;
      const Δφ = (c2[1]-c1[1]) * Math.PI/180;
      const Δλ = (c2[0]-c1[0]) * Math.PI/180;
      const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  };

  const findConsensus = (rawClusters: Cluster[]): Cluster[] => {
      const merged: Cluster[] = [];
      const thresholdM = 40; 

      for (const c of rawClusters) {
          let found = false;
          for (const m of merged) {
              const dist = getDistance(c.center, m.center);
              const angleDiff = Math.abs((c.bearing || 0) - (m.bearing || 0));
              const isAligned = angleDiff < 15 || angleDiff > 165; // Similarly oriented

              if (dist < thresholdM || (dist < 80 && isAligned && c.metrics!.ratio > 3.0 && m.metrics!.ratio > 3.0)) {
                  // MULTISPECTRAL AGGREGATION: Keep all raw sources for detailed UI display
                  c.sources.forEach(src => {
                      if (!m.sources.includes(src)) m.sources.push(src);
                  });
                  if (!m.sources.includes(c.source)) m.sources.push(c.source);
                  
                  // Vector Stitching: if they are aligned linear features, upgrade to "Systemic Corridor"
                  if (isAligned && dist > thresholdM) {
                      m.type = "Systemic Movement Corridor (Road/Track)";
                      m.confidence = 'High';
                  }

                  if (c.source === 'terrain') m.center = [c.center[0], c.center[1]];
                  else m.center = [(m.center[0] + c.center[0]) / 2, (m.center[1] + c.center[1]) / 2];
                  m.findPotential = Math.min(100, m.findPotential + (c.findPotential * 0.4));
                  
                  // Prioritize Palaeochannel type if hydrology is present in consensus
                  if (c.source === 'hydrology') {
                      m.type = "Palaeochannel / Ancient Waterway";
                  }

                  // Temporal Difference: Summer Stress vs Spring Baseline
                  if (m.sources.includes('satellite_summer') && !m.sources.includes('satellite_spring')) {
                      m.type = "Temporal Cropmark (Drought Stress)";
                      m.findPotential = Math.min(100, m.findPotential + 20);
                  }

                  if (m.sources.length >= 3) m.confidence = 'High';
                  else if (m.sources.length >= 2 && m.confidence === 'Subtle') m.confidence = 'Medium';
                  
                  // CALCULATE PERSISTENCE SCORE: Cross-method and Cross-scale agreement
                  let score = (m.sources.length * 15); // Base consensus
                  if (m.sources.includes('terrain') && m.sources.includes('terrain_global')) score += 10; // DTM + MDH match
                  if (m.sources.includes('slope')) score += 5; // LRM/Slope match
                  if (c.scaleTier !== m.scaleTier) score += 20; // Scale stability (Micro + Structural)
                  m.persistenceScore = Math.min(100, (m.persistenceScore || 0) + score);

                  found = true;
                  break;
              }
          }
          if (!found) {
              // If it's summer satellite but not spring, it might be a new cropmark
              const initialType = c.source === 'satellite_summer' ? "Temporal Cropmark (Potential)" : c.type;
              merged.push({ ...c, type: initialType, sources: [c.source], persistenceScore: 25, rescanCount: 1 });
          }
      }
      return merged;
  };

  const analyzeContext = (clusters: Cluster[]): Cluster[] => {
      const results = [...clusters];
      const proximityM = 60; // Max distance for "Settlement" grouping

      for (let i = 0; i < results.length; i++) {
          const c = results[i];
          const neighbors = results.filter(n => n.id !== c.id && getDistance(c.center, n.center) < proximityM);
          
          if (neighbors.length >= 2) {
              const houses = neighbors.filter(n => n.type.includes('Roundhouse') || n.type.includes('Foundation'));
              const enclosures = neighbors.filter(n => n.type.includes('Enclosure') || n.type.includes('Ring'));
              const ditches = neighbors.filter(n => n.type.includes('Linear') || n.type.includes('Corridor'));

              if (enclosures.length > 0 && houses.length > 0) {
                  c.contextLabel = "Enclosed Settlement / Farmstead";
                  c.findPotential = Math.min(100, c.findPotential + 10);
              } else if (houses.length >= 2) {
                  c.contextLabel = "Habitation Cluster / Settlement Nucleus";
                  c.findPotential = Math.min(100, c.findPotential + 5);
              } else if (ditches.length >= 2) {
                  c.contextLabel = "Organized Field System / Celtic Fields";
              }
          }
      }
      return results;
  };

  const suppressDisturbance = (clusters: Cluster[]): Cluster[] => {
      const results = [...clusters];
      
      for (let i = 0; i < results.length; i++) {
          const c = results[i];
          let risk: Cluster['disturbanceRisk'] = 'Low';
          let reason = "";

          // 1. SYSTEMATIC PARALLELISM (Modern Drainage / Ploughing)
          const parallelNeighbors = results.filter(n => 
              n.id !== c.id && 
              getDistance(c.center, n.center) < 100 && 
              Math.abs((c.bearing || 0) - (n.bearing || 0)) < 1.5 && // Extremely precise angle
              c.metrics!.ratio > 4.0 && n.metrics!.ratio > 4.0
          );

          if (parallelNeighbors.length >= 2) {
              risk = 'High';
              reason = "Systematic Parallelism (Drainage/Plough)";
          }

          // 2. EDGE SHARPNESS (Recent Trenches / Quarries)
          // Modern cuts have much higher density/solidity for their size
          if (c.metrics!.density > 0.85 && c.metrics!.area < 300 && !c.type.includes('Roundhouse')) {
              risk = 'Medium';
              reason = "High Gradient Sharpness (Recent Cut)";
          }

          // 3. BOUNDARY PROXIMITY (Machinery Marks)
          // Simplified: if it's long, thin, and very near another linear feature
          if (c.metrics!.ratio > 8.0 && parallelNeighbors.length >= 1) {
              risk = 'High';
              reason = "Machinery / Track Scar";
          }

          if (risk !== 'Low') {
              c.disturbanceRisk = risk;
              c.disturbanceReason = reason;
              // Downgrade potential for high risk modern features
              c.findPotential = Math.max(5, c.findPotential - (risk === 'High' ? 60 : 30));
          } else {
              c.disturbanceRisk = 'Low';
          }
      }
      return results;
  };

  const generateZones = (clusters: Cluster[]): Zone[] => {
      const results: Zone[] = [];
      const usedIds = new Set<string>();
      const radiusM = 120; // Radius for Zone Discovery

      for (const c of clusters) {
          if (usedIds.has(c.id)) continue;

          // Discover all members in this spatial neighborhood
          const members = clusters.filter(n => !usedIds.has(n.id) && getDistance(c.center, n.center) < radiusM);
          if (members.length < 2) continue; // Zones require multiple hits

          members.forEach(m => usedIds.add(m.id));

          // Calculate Zone Geometry (Bounding Box)
          let minLon = members[0].center[0], maxLon = members[0].center[0];
          let minLat = members[0].center[1], maxLat = members[0].center[1];
          let sumLon = 0, sumLat = 0;

          members.forEach(m => {
              minLon = Math.min(minLon, m.center[0]); maxLon = Math.max(maxLon, m.center[0]);
              minLat = Math.min(minLat, m.center[1]); maxLat = Math.max(maxLat, m.center[1]);
              sumLon += m.center[0]; sumLat += m.center[1];
          });

          // Classification & Insight Logic
          const habCount = members.filter(m => m.type.includes('Roundhouse') || m.type.includes('Foundation')).length;
          const enclosureCount = members.filter(m => m.type.includes('Enclosure') || m.type.includes('Ring')).length;
          const trackCount = members.filter(m => m.type.includes('Movement') || m.type.includes('Corridor')).length;
          const hydroCount = members.filter(m => m.sources.includes('hydrology')).length;
          const highPersistenceCount = members.filter(m => (m.persistenceScore || 0) > 70).length;
          const structuralCount = members.filter(m => m.scaleTier === 'Structural').length;

          let type: Zone['type'] = 'Unknown';
          let priority: Zone['priority'] = 'Low';
          let desc = "General Cluster of Interest";
          const insights: string[] = [`${members.length} linked anomalies`];

          if (enclosureCount > 0 && habCount > 0) {
              type = 'Settlement'; priority = 'High'; desc = "Settlement Cluster Zone";
              insights.push("Core habitation structures detected");
          } else if (habCount >= 2) {
              type = 'Settlement'; priority = 'High'; desc = "Habitation Nucleus Zone";
              insights.push("Multiple domestic foundations");
          } else if (highPersistenceCount >= 3) {
              type = 'Activity'; priority = 'High'; desc = "High-Intensity Activity Zone";
          } else if (trackCount > 0) {
              type = 'Route'; priority = 'Medium'; desc = "Route-Edge Target Zone";
              insights.push("Aligned with movement corridor");
          } else if (members.every(m => m.confidence === 'Subtle')) {
              type = 'Disturbed'; priority = 'Low'; desc = "Disturbed / Low-Confidence Zone";
          }

          if (hydroCount > 0) insights.push("Near palaeochannel edge");
          if (structuralCount > 0) insights.push("Structural-scale signatures present");
          if (highPersistenceCount > 0) insights.push("Highly stable multispectral signals");

          const avgPersistence = members.reduce((acc, m) => acc + (m.persistenceScore || 0), 0) / members.length;
          const persistence: Zone['persistence'] = avgPersistence > 70 ? 'High' : avgPersistence > 40 ? 'Medium' : 'Low';
          
          // Estimate disturbance (High if many subtle satellite-only hits, Low if solid Lidar consensus)
          const disturbance: Zone['disturbance'] = members.every(m => m.sources.includes('terrain')) ? 'Low' : 'Medium';

          results.push({
              id: Math.random().toString(36).substring(7),
              number: 0, // Placeholder
              type, priority, persistence, disturbance,
              center: [sumLon / members.length, sumLat / members.length],
              bounds: [[minLon - 0.0005, minLat - 0.0005], [maxLon + 0.0005, maxLat + 0.0005]],
              memberIds: members.map(m => m.id),
              description: desc,
              insights: insights.slice(0, 3) // Max 3 bullets
          });
      }

      // Sort by priority and assign consecutive numbers
      return results
          .sort((a, b) => {
              const priorities = { 'High': 3, 'Medium': 2, 'Low': 1 };
              return (priorities[b.priority] || 0) - (priorities[a.priority] || 0);
          })
          .map((z, i) => ({ ...z, number: i + 1 }));
  };

  const executeScan = async () => {
    if (!mapRef.current) return;
    
    // PRECISION LOCK: Always scan at exactly Z16 for mathematical consistency
    const scanZoom = 16; 
    const bounds = mapRef.current.getBounds();
    const n = Math.pow(2, scanZoom);
    const center = mapRef.current.getCenter();
    
    // Ensure we align to a stable tile grid regardless of slight view shifts
    const cX = (center.lng + 180) / 360 * n;
    const cY = (1 - Math.log(Math.tan(center.lat * Math.PI / 180) + 1 / Math.cos(center.lat * Math.PI / 180)) / Math.PI) / 2 * n;
    const tX_start = Math.floor(cX) - 1; // 3x3 grid centered on view
    const tY_start = Math.floor(cY) - 1;

    setAnalyzing(true);
    setDetectedFeatures([]); // CLEAR PREVIOUS TARGETS
    setZones([]); // Reset zones for the new scan area
    setSelectedZoneId(null); // Clear any active zone border
    setSelectedId(null); // Clear active target selection
    addLog(`Engine Initiating (Fixed Z${scanZoom})...`);

    const herUrl = `https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/6/query?where=1%3D1&geometry=${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&f=geojson&outFields=Name,ListEntry`;
    let assetsGeoJSON = { type: 'FeatureCollection', features: [] };
    try {
        const hRes = await fetch(herUrl);
        assetsGeoJSON = await hRes.json();
        setHeritageCount(assetsGeoJSON.features?.length || 0);
        (mapRef.current.getSource('monuments') as maplibregl.GeoJSONSource).setData(assetsGeoJSON as any);
    } catch (e) { addLog("HER connection error."); }

    try {
        addLog("Stage 1/5: Lidar DTM...");
        const terrainHits = await scanDataSource('terrain', scanZoom, tX_start, tY_start, bounds, n, assetsGeoJSON);
        
        addLog("Stage 2/5: Lidar MDH...");
        const terrainGlobalHits = await scanDataSource('terrain_global', scanZoom, tX_start, tY_start, bounds, n, assetsGeoJSON);

        addLog("Stage 3/5: Slope Gradient...");
        const slopeHits = await scanDataSource('slope', scanZoom, tX_start, tY_start, bounds, n, assetsGeoJSON);
        
        addLog("Stage 4/5: Hydrology (Palaeo)...");
        const hydroHits = await scanDataSource('hydrology', scanZoom, tX_start, tY_start, bounds, n, assetsGeoJSON);
        
        addLog("Stage 5/6: Spring Baseline (ExG)...");
        const springHits = await scanDataSource('satellite_spring', scanZoom, tX_start, tY_start, bounds, n, assetsGeoJSON);
        
        addLog("Stage 6/6: Summer Stress (ExG)...");
        const summerHits = await scanDataSource('satellite_summer', scanZoom, tX_start, tY_start, bounds, n, assetsGeoJSON);
        
        const aimUrl = `https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/HE_AIM_data/FeatureServer/1/query?where=1%3D1&geometry=${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&f=geojson&outFields=MONUMENT_TYPE,PERIOD,EVIDENCE_1`;
        let aimGeoJSON = { type: 'FeatureCollection', features: [] };
        try {
            const aRes = await fetch(aimUrl);
            aimGeoJSON = await aRes.json();
            if (aimGeoJSON.features?.length > 0) addLog(`Lock: ${aimGeoJSON.features.length} AIM Features.`);
        } catch (e) { addLog("AIM connection error."); }

        const rawCombined = [...terrainHits, ...terrainGlobalHits, ...slopeHits, ...hydroHits, ...springHits, ...summerHits];
        const merged = findConsensus(rawCombined);
        
        // Cross-reference with AIM data and perform Target Reconciliation
        const newScanResults = merged.map(c => {
            for (const aim of (aimGeoJSON.features || [])) {
                const aimProps = (aim as any).properties;
                const coords = (aim as any).geometry?.coordinates;
                if (!coords) continue;
                
                let isMatch = false;
                if ((aim as any).geometry.type === 'Polygon' || (aim as any).geometry.type === 'MultiPolygon') {
                    const rings = (aim as any).geometry.type === 'Polygon' ? [coords] : coords;
                    for (const ring of rings) { if (isPointInPolygon(c.center[1], c.center[0], ring)) { isMatch = true; break; } }
                } else if ((aim as any).geometry.type === 'Point') {
                    if (getDistance(c.center, coords) < 50) isMatch = true;
                }

                if (isMatch) {
                    if (!c.sources.includes('historic')) c.sources.push('historic');
                    c.aimInfo = { type: aimProps.MONUMENT_TYPE, period: aimProps.PERIOD, evidence: aimProps.EVIDENCE_1 };
                    c.confidence = 'High';
                    c.findPotential = 99;
                    break;
                }
            }
            return c;
        });

        // FRESH SCAN: Start with empty list for each execution to prevent over-accumulation
        const updatedFeatures: Cluster[] = [];
        
        newScanResults.forEach(newHit => {
            let anchored = false;
            for (let i = 0; i < updatedFeatures.length; i++) {
                if (getDistance(newHit.center, updatedFeatures[i].center) < 15) {
                    newHit.sources.forEach(s => { if (!updatedFeatures[i].sources.includes(s)) updatedFeatures[i].sources.push(s); });
                    updatedFeatures[i].rescanCount = (updatedFeatures[i].rescanCount || 1) + 1;
                    updatedFeatures[i].persistenceScore = Math.min(100, (updatedFeatures[i].persistenceScore || 0) + 10);
                    updatedFeatures[i].confidence = newHit.confidence === 'High' ? 'High' : updatedFeatures[i].confidence;
                    if (newHit.aimInfo) updatedFeatures[i].aimInfo = newHit.aimInfo;
                    anchored = true;
                    break;
                }
            }
            if (!anchored) updatedFeatures.push(newHit);
        });

        // RUN MODERN DISTURBANCE SUPPRESSION (Suppress drainage, ploughing, etc.)
        const suppressed = suppressDisturbance(updatedFeatures);

        const contextualized = analyzeContext(suppressed)
            .sort((a, b) => b.findPotential - a.findPotential)
            .map((c, i) => ({ ...c, number: i + 1 }));

        const tacticalZones = generateZones(contextualized);

        // SYNC STATE
        setDetectedFeatures(contextualized);
        setZones(tacticalZones);

        addLog(`Scan Complete. Consensus Verified.`);
    } catch (e) { addLog("Engine Error."); console.error(e); }
    
    setAnalyzing(false);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] landscape:h-[calc(100vh-100px)] sm:h-[calc(100vh-220px)] bg-slate-950 rounded-3xl overflow-hidden border border-slate-800 shadow-2xl relative">
      <header className="bg-slate-900/80 border-b border-white/5 shrink-0 z-50 backdrop-blur-md">
          {/* Top Row: Title & Search Toggle */}
          <div className="flex justify-between items-center px-4 py-2 border-b border-white/5">
              {!isSearchOpen ? (
                  <p className="m-0 text-[10px] font-black text-emerald-500 tracking-[0.1em] uppercase whitespace-nowrap">MULTISPECTRAL TERRAIN SCAN</p>
              ) : (
                  <form onSubmit={searchLocation} className="flex gap-2 flex-1 mr-2">
                      <input autoFocus value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search place..." className="bg-black/40 border border-white/10 text-white px-3 py-1 rounded-lg flex-1 text-xs outline-none focus:ring-1 focus:ring-emerald-500" />
                  </form>
              )}
              <button onClick={() => setIsSearchOpen(!isSearchOpen)} className="text-slate-400 hover:text-white p-1">
                  {isSearchOpen ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  ) : '🔍'}
              </button>
          </div>
          
          {/* Bottom Row: Actions */}
          <div className="flex justify-between items-center px-4 py-2 bg-black/20">
              <div className="flex gap-1.5 items-center">
                  <button onClick={() => navigate('/finds?view=map')} className="text-[9px] font-black text-slate-400 hover:text-white transition-colors tracking-widest uppercase px-2 py-1.5 border border-white/5 rounded-lg whitespace-nowrap">Manual Map</button>
                  <button onClick={clearScan} className="text-[9px] font-black text-slate-400 hover:text-white transition-colors tracking-widest uppercase px-2 py-1.5">Clear</button>
              </div>
              <div className="flex gap-2 items-center">
                  <button onClick={findMe} className="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-[9px] font-black tracking-widest uppercase hover:bg-slate-700 transition-colors">GPS</button>
                  <button onClick={executeScan} disabled={analyzing} className="bg-emerald-500 text-white px-4 py-1.5 rounded-lg text-[9px] font-black tracking-widest uppercase hover:bg-emerald-400 transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:opacity-50 disabled:animate-pulse">
                    {analyzing ? '...' : 'Scan'}
                  </button>
              </div>
          </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        <div className="flex-1 relative bg-slate-900">
            <div ref={mapContainerRef} className="absolute inset-0" />
            
            {/* Center Reticle */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20">
                <div className="w-10 h-10 border-2 border-emerald-500/50 rounded-full flex items-center justify-center">
                    <div className="w-1 h-1 bg-emerald-500 rounded-full" />
                </div>
            </div>

            {/* Floating Alerts */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none w-[90%] max-w-sm">
                {heritageCount > 0 && (
                    <div className="bg-red-600 text-white px-4 py-1.5 rounded-full text-[8px] sm:text-[10px] font-black tracking-widest uppercase shadow-2xl border border-white/20 animate-bounce">
                        ⛔ Scheduled Monument
                    </div>
                )}
                {zoomWarning && (
                    <div className="bg-amber-500 text-black px-4 py-1.5 rounded-full text-[8px] sm:text-[10px] font-black tracking-widest uppercase shadow-2xl border border-white/20">
                        ⚠️ Use Zoom 16.0
                    </div>
                )}
                {analyzing && (
                    <div className="bg-slate-900/90 text-emerald-400 px-6 py-3 rounded-2xl text-[10px] font-black tracking-[0.2em] uppercase shadow-2xl border border-emerald-500/50 animate-pulse flex items-center gap-3 backdrop-blur-xl">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
                        Scanning Terrain...
                    </div>
                )}
            </div>

            {/* Mobile Tactical Tray (Zone Selection) */}
            {zones.length > 0 && (
                <div className="absolute top-4 left-0 w-full z-[100] lg:hidden pointer-events-none">
                    <div className="flex gap-2 overflow-x-auto pl-4 pr-10 py-2 scrollbar-hide pointer-events-auto">
                        {zones.map(z => (
                            <div 
                                key={z.id} 
                                onClick={() => {
                                    setSelectedZoneId(z.id === selectedZoneId ? null : z.id);
                                    if (z.id !== selectedZoneId) mapRef.current?.fitBounds(z.bounds as any, { padding: 40 });
                                }}
                                className={`px-4 py-2 rounded-full border shadow-lg backdrop-blur-md transition-all active:scale-95 whitespace-nowrap ${
                                    selectedZoneId === z.id 
                                    ? 'bg-emerald-500 border-white text-white' 
                                    : 'bg-slate-900/90 border-white/10 text-slate-300'
                                }`}
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-[11px] font-black uppercase tracking-wider">Zone {z.number}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Mobile Target Card Popup */}
            {selectedId && !selectedZoneId && (
                <div className="absolute bottom-6 left-4 right-4 z-[100] lg:hidden animate-in slide-in-from-bottom-4 duration-300">
                    {detectedFeatures.filter(f => f.id === selectedId).map(f => (
                        <div key={f.id} className={`p-4 rounded-2xl border shadow-2xl transition-all ${
                            f.sources.length >= 3 ? 'bg-amber-600 border-yellow-300 text-white shadow-[0_0_30px_rgba(217,119,6,0.5)]' :
                            f.sources.includes('hydrology') ? 'bg-blue-600 border-white text-white' :
                            f.source === 'terrain' ? 'bg-emerald-500 border-white text-white' : 
                            f.source === 'historic' ? 'bg-slate-700 border-white text-white' :
                            'bg-sky-500 border-white text-white'
                        }`}>
                            <div className="flex justify-between items-center mb-2">
                                <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 bg-black/20 rounded-lg flex items-center justify-center text-[10px] font-black">{f.number}</div>
                                    <h3 className="text-xs font-black uppercase tracking-tight">{f.type}</h3>
                                </div>
                                <button onClick={(e) => { e.stopPropagation(); setSelectedId(null); }} className="bg-black/20 hover:bg-black/40 text-white rounded-full p-1.5 transition-colors border border-white/10 shadow-lg">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-3 mb-4">
                                <div className="bg-black/20 p-2 rounded-xl flex flex-col items-center justify-center">
                                    <span className="block text-[8px] uppercase font-bold opacity-70 mb-2">Detection Spectrum</span>
                                    <div className="flex flex-col gap-1 w-full px-1">
                                        {[
                                            { ids: ['terrain', 'terrain_global'], label: 'Lidar' },
                                            { ids: ['slope'], label: 'Slope / LRM' },
                                            { ids: ['hydrology'], label: 'Hydrology' },
                                            { ids: ['satellite', 'satellite_spring', 'satellite_summer'], label: 'Aerial' },
                                            { ids: ['historic'], label: 'Historic' }
                                        ].map(s => (
                                            <div key={s.label} className="flex items-center justify-between w-full">
                                                <span className="text-[8px] font-black uppercase tracking-tighter">{s.label}</span>
                                                <div className={`w-2 h-2 rounded-full border border-white/10 ${
                                                    s.ids.some(id => f.sources.includes(id as any)) 
                                                    ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' 
                                                    : 'bg-black/40'
                                                }`} />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex flex-col gap-2">
                                    <div className="bg-black/20 p-2 rounded-xl">
                                        <span className="block text-[8px] uppercase font-bold opacity-70">Confidence</span>
                                        <span className="text-[10px] font-black uppercase tracking-widest">{f.confidence}</span>
                                    </div>
                                    <div className={`p-2 rounded-xl border ${
                                        (f.persistenceScore || 0) > 70 ? 'bg-emerald-500/20 border-emerald-400' :
                                        (f.persistenceScore || 0) > 40 ? 'bg-amber-500/20 border-amber-400' :
                                        'bg-slate-500/20 border-slate-400'
                                    }`}>
                                        <span className="block text-[8px] uppercase font-bold opacity-70">Persistence</span>
                                        <span className={`text-[10px] font-black uppercase tracking-widest ${
                                            (f.persistenceScore || 0) > 70 ? 'text-emerald-400' :
                                            (f.persistenceScore || 0) > 40 ? 'text-amber-400' :
                                            'text-slate-400'
                                        }`}>
                                            {(f.persistenceScore || 0) > 70 ? 'High' : (f.persistenceScore || 0) > 40 ? 'Medium' : 'Low'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2 px-1">
                                {f.disturbanceRisk && f.disturbanceRisk !== 'Low' && (
                                    <div className={`p-2 rounded-xl border mb-2 ${
                                        f.disturbanceRisk === 'High' ? 'bg-red-500/20 border-red-400' : 'bg-amber-500/20 border-amber-400'
                                    }`}>
                                        <p className="m-0 text-[9px] font-black uppercase text-red-300 leading-tight">Modern Disturbance Risk: {f.disturbanceRisk}</p>
                                        <p className="m-0 text-[10px] font-bold text-white tracking-tight">{f.disturbanceReason}</p>
                                    </div>
                                )}
                                {f.contextLabel && (
                                    <div className="bg-emerald-400/20 p-2 rounded-xl border border-emerald-400/30 mb-2">
                                        <p className="m-0 text-[9px] font-black uppercase text-emerald-300 leading-tight">Settlement Context:</p>
                                        <p className="m-0 text-[10px] font-bold text-white tracking-tight">{f.contextLabel}</p>
                                    </div>
                                )}
                                {f.aimInfo && (
                                    <div className="bg-amber-400/20 p-2 rounded-xl border border-amber-400/30 mb-2">
                                        <p className="m-0 text-[9px] font-black uppercase text-amber-200 leading-tight">Historic Verification:</p>
                                        <p className="m-0 text-[10px] font-bold text-white tracking-tight">{f.aimInfo.type} ({f.aimInfo.period})</p>
                                    </div>
                                )}
                                <p className="m-0 text-[10px] font-bold uppercase opacity-80 tracking-wide">
                                    Signal Profile: <span className="font-black">{f.polarity || 'Unknown'}</span>
                                </p>
                                <div className="flex items-center gap-3">
                                    <p className="m-0 text-[10px] font-bold uppercase opacity-80 tracking-wide whitespace-nowrap">
                                        Find Probability:
                                    </p>
                                    <div className="flex-1 h-1.5 bg-black/40 rounded-full overflow-hidden flex items-center">
                                        <div 
                                            className="h-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.5)] transition-all duration-1000" 
                                            style={{ width: `${f.findPotential}%` }} 
                                        />
                                    </div>
                                    <span className="text-[10px] font-black text-white">{Math.round(f.findPotential)}%</span>
                                </div>
                            </div>

                            {f.isProtected && <div className="mt-4 p-1.5 bg-red-600/40 rounded-lg text-[8px] font-black uppercase tracking-widest text-center border border-red-400">⚠️ Protected Monument</div>}
                        </div>
                    ))}
                </div>
            )}

            {/* Mobile Zone Detail Card Popup */}
            {selectedZoneId && (
                <div className="absolute bottom-6 left-4 right-4 z-[100] lg:hidden animate-in slide-in-from-bottom-4 duration-300">
                    {zones.filter(z => z.id === selectedZoneId).map(z => (
                        <div key={z.id} className="bg-slate-900 border border-white/20 p-5 rounded-2xl shadow-2xl backdrop-blur-xl">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 className="text-sm font-black uppercase tracking-tight text-white">Zone {z.number}</h3>
                                </div>
                                <button onClick={() => setSelectedZoneId(null)} className="bg-black/20 hover:bg-black/40 text-white rounded-full p-1.5 transition-colors border border-white/10 shadow-lg">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" x2="18" y1="18" y2="18"></line>
                                    </svg>
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-3 mb-5">
                                <div className="bg-black/40 p-2.5 rounded-xl border border-white/5">
                                    <span className="block text-[8px] uppercase font-bold text-slate-500 mb-1">Persistence</span>
                                    <span className={`text-[10px] font-black uppercase tracking-widest ${
                                        z.persistence === 'High' ? 'text-emerald-400' : 'text-amber-400'
                                    }`}>{z.persistence}</span>
                                </div>
                                <div className="bg-black/40 p-2.5 rounded-xl border border-white/5">
                                    <span className="block text-[8px] uppercase font-bold text-slate-500 mb-1">Disturbance</span>
                                    <span className={`text-[10px] font-black uppercase tracking-widest ${
                                        z.disturbance === 'Low' ? 'text-emerald-400' : 'text-red-400'
                                    }`}>{z.disturbance}</span>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <p className="text-[9px] font-black uppercase text-emerald-500 tracking-[0.15em] mb-2">Why it matters</p>
                                {z.insights.map((insight, idx) => (
                                    <div key={idx} className="flex items-center gap-2.5">
                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]" />
                                        <p className="text-[11px] font-bold text-slate-200 leading-tight">{insight}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>

        {/* Sidebar */}
        <div className="w-80 hidden lg:flex flex-col bg-slate-900/80 backdrop-blur-xl border-l border-white/5 shrink-0 relative z-50">
            <div className="p-6 border-b border-white/5 shrink-0 overflow-y-auto max-h-[40%] scrollbar-hide">
                <div className="flex justify-between items-baseline mb-4">
                    <h2 className="text-sm font-black text-white uppercase tracking-tighter">Strategic Zones</h2>
                    {selectedZoneId && <button onClick={() => setSelectedZoneId(null)} className="text-[9px] font-black text-emerald-500 hover:underline tracking-widest uppercase">Clear View</button>}
                </div>
                <div className="flex flex-col gap-4">
                    {zones.length > 0 ? zones.map(z => (
                        <div 
                            key={z.id} 
                            onClick={() => {
                                setSelectedZoneId(z.id);
                                mapRef.current?.fitBounds(z.bounds as any, { padding: 40 });
                            }}
                            className={`p-4 rounded-2xl border cursor-pointer transition-all active:scale-[0.98] ${
                                selectedZoneId === z.id ? 'bg-white/10 border-white ring-4 ring-white/10' :
                                z.type === 'Settlement' ? 'bg-amber-500/5 border-amber-500/20 hover:border-amber-500/40' :
                                z.type === 'Activity' ? 'bg-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40' :
                                'bg-white/5 border-white/10 hover:border-white/20'
                            }`}
                        >
                            <div className="flex justify-between items-start mb-3">
                                <div>
                                    <h3 className={`text-xs font-black uppercase tracking-tight ${selectedZoneId === z.id ? 'text-white' : 'text-slate-200'}`}>Zone {z.number}</h3>
                                </div>
                                <div className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${
                                    z.priority === 'High' ? 'bg-red-500 text-white' : 'bg-slate-700 text-slate-300'
                                }`}>{z.priority} Priority</div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 mb-4">
                                <div className="bg-black/20 p-2 rounded-xl">
                                    <span className="block text-[7px] uppercase font-bold text-slate-500">Persistence</span>
                                    <span className={`text-[9px] font-black uppercase tracking-widest ${
                                        z.persistence === 'High' ? 'text-emerald-400' : 'text-amber-400'
                                    }`}>{z.persistence}</span>
                                </div>
                                <div className="bg-black/20 p-2 rounded-xl">
                                    <span className="block text-[7px] uppercase font-bold text-slate-500">Disturbance</span>
                                    <span className={`text-[9px] font-black uppercase tracking-widest ${
                                        z.disturbance === 'Low' ? 'text-emerald-400' : 'text-red-400'
                                    }`}>{z.disturbance}</span>
                                </div>
                            </div>

                            <div className="space-y-1">
                                <p className="text-[8px] font-black uppercase text-emerald-500/70 tracking-widest mb-1.5">Why it matters</p>
                                {z.insights.map((insight, idx) => (
                                    <div key={idx} className="flex items-center gap-2">
                                        <div className="w-1 h-1 rounded-full bg-emerald-500" />
                                        <p className="text-[10px] font-bold text-slate-300 leading-tight">{insight}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )) : (
                        <p className="text-[10px] text-slate-500 font-bold uppercase italic text-center py-4">No tactical zones defined.</p>
                    )}
                </div>
            </div>

            <div className="p-6 border-b border-white/5 flex justify-between items-center shrink-0">
                <div>
                    <h2 className="text-sm font-black text-white uppercase tracking-tighter">Site Report</h2>
                    <p className="text-[10px] text-slate-500 font-bold uppercase">{detectedFeatures.length} Signals Locked</p>
                </div>
                {selectedId && <button onClick={() => setSelectedId(null)} className="text-[10px] font-black text-emerald-500 hover:underline tracking-widest uppercase">Reset</button>}
            </div>
            
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 scrollbar-hide space-y-4">
                {detectedFeatures.map((f) => (
                    <div 
                        key={f.id} 
                        id={`card-${f.id}`} 
                        onClick={() => { setSelectedId(f.id); mapRef.current?.flyTo({ center: f.center, zoom: 17 }); }} 
                        className={`p-5 rounded-2xl cursor-pointer transition-all border ${
                            selectedId === f.id 
                            ? (f.sources.length >= 3 ? 'bg-amber-600 border-white shadow-[0_0_25px_rgba(217,119,6,0.6)]' :
                               f.sources.includes('hydrology') ? 'bg-blue-600 border-white shadow-[0_0_25px_rgba(37,99,235,0.5)]' :
                               f.source === 'terrain' ? 'bg-emerald-500 border-white shadow-[0_0_25px_rgba(16,185,129,0.5)]' : 
                               f.source === 'historic' ? 'bg-slate-700 border-white shadow-[0_0_25px_rgba(255,255,255,0.2)]' :
                               'bg-sky-500 border-white shadow-[0_0_25px_rgba(59,130,246,0.5)]') 
                            : 'bg-white/5 border-white/5 hover:bg-white/10'
                        }`}
                    >
                        <div className="flex justify-between items-center mb-3">
                            <div className="w-8 h-8 bg-black/20 rounded-lg flex items-center justify-center text-xs font-black text-white">{f.number}</div>
                            <div className="flex flex-col gap-0.5 items-end">
                                {[
                                    { ids: ['terrain', 'terrain_global'], label: 'Lidar' },
                                    { ids: ['slope'], label: 'Slope / LRM' },
                                    { ids: ['hydrology'], label: 'Hydrology' },
                                    { ids: ['satellite', 'satellite_spring', 'satellite_summer'], label: 'Aerial' },
                                    { ids: ['historic'], label: 'Historic' }
                                ].map(s => (
                                    <div key={s.label} className="flex items-center gap-1.5">
                                        <span className={`text-[7px] font-black uppercase tracking-tighter ${s.ids.some(id => f.sources.includes(id as any)) ? 'text-white' : 'text-white/20'}`}>{s.label}</span>
                                        <div className={`w-1.5 h-1.5 rounded-full ${
                                            s.ids.some(id => f.sources.includes(id as any)) 
                                            ? 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.5)]' 
                                            : 'bg-black/40'
                                        }`} />
                                    </div>
                                ))}
                            </div>
                        </div>
                        <h3 className={`text-sm font-black uppercase tracking-tight mb-1 ${selectedId === f.id ? 'text-white' : 'text-slate-200'}`}>{f.type}</h3>
                        
                        {f.contextLabel && (
                            <div className="mt-1 mb-2 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                                <p className="m-0 text-[8px] font-black uppercase text-emerald-400">Context: {f.contextLabel}</p>
                            </div>
                        )}

                        {f.disturbanceRisk && f.disturbanceRisk !== 'Low' && (
                            <div className={`mt-1 mb-2 px-2 py-1 rounded-lg border ${
                                f.disturbanceRisk === 'High' ? 'bg-red-500/10 border-red-500/20' : 'bg-amber-500/10 border-amber-500/20'
                            }`}>
                                <p className={`m-0 text-[8px] font-black uppercase ${f.disturbanceRisk === 'High' ? 'text-red-400' : 'text-amber-400'}`}>
                                    Risk: {f.disturbanceRisk} ({f.disturbanceReason})
                                </p>
                            </div>
                        )}

                        {f.aimInfo && (
                            <div className="mt-1 mb-2 px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                                <p className="m-0 text-[8px] font-black uppercase text-amber-400">Verified: {f.aimInfo.type}</p>
                                <p className="m-0 text-[8px] font-bold text-amber-200/70">{f.aimInfo.period}</p>
                            </div>
                        )}

                        <div className="flex justify-between items-center mt-2">
                            <span className={`text-[10px] font-bold uppercase ${selectedId === f.id ? 'text-white/80' : 'text-slate-500'}`}>Persistence:</span>
                            <div className="flex items-center gap-1.5">
                                {f.rescanCount && f.rescanCount > 1 && (
                                    <span className="text-[7px] font-black bg-emerald-500/20 text-emerald-400 px-1 rounded border border-emerald-500/30">LOCKED x{f.rescanCount}</span>
                                )}
                                <span className={`text-[10px] font-black ${
                                    (f.persistenceScore || 0) > 70 ? 'text-emerald-400' :
                                    (f.persistenceScore || 0) > 40 ? 'text-amber-400' :
                                    'text-slate-400'
                                }`}>
                                    {(f.persistenceScore || 0) > 70 ? 'High' : (f.persistenceScore || 0) > 40 ? 'Medium' : 'Low'}
                                </span>
                            </div>
                        </div>

                        <div className="flex justify-between items-center mt-0.5">
                            <span className={`text-[10px] font-bold uppercase ${selectedId === f.id ? 'text-white/80' : 'text-slate-500'}`}>Confidence:</span>
                            <span className={`text-[10px] font-black ${selectedId === f.id ? 'text-white' : (f.sources.length >= 3 ? 'text-amber-400' : f.source === 'terrain' ? 'text-emerald-400' : 'text-sky-400')}`}>{f.confidence}</span>
                        </div>
                        
                        {f.isProtected && <div className="mt-3 p-2 bg-white/20 rounded-lg text-[8px] font-black text-white uppercase tracking-widest text-center">⚠️ Protected Monument</div>}
                    </div>
                ))}
            </div>
            
            <div className="h-24 bg-black/40 border-t border-white/5 p-4 overflow-y-auto shrink-0" ref={logContainerRef}>
                <div className="font-mono text-[9px] text-emerald-500/70 leading-relaxed uppercase tracking-tighter">
                    {systemLog.map((l, i) => <div key={i} className="mb-1">{l}</div>)}
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}
