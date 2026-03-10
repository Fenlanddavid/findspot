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
    confidence: 'High' | 'Medium' | 'Subtle';
    findPotential: number;
    center: [number, number];
    source: 'terrain' | 'satellite';
    metrics?: { circularity: number; density: number; ratio: number; area: number };
}

/**
 * FieldGuide Standalone V10.0 - Golden Scan Locked Engine
 * Algorithmic Sweetspot: Locked 12 Lidar | 7 Aerial
 */
const SCAN_PROFILE = {
    TERRAIN: {
        threshold: 0.15,
        minSize: 20,
        dilation: 1,
        minSolidity: 0.15,
        minLinearity: 1.0
    },
    AERIAL: {
        threshold: 0.24,
        minSize: 150,
        dilation: 3,
        minSolidity: 0.32,
        minLinearity: 4.2
    }
};

export default function FieldGuide({ projectId }: { projectId: string }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [detectedFeatures, setDetectedFeatures] = useState<Cluster[]>([]);
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
      center: [-1.8575, 51.4158],
      zoom: 15,
    });

    map.on('load', () => {
        map.addSource('monuments', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'monuments-fill', type: 'fill', source: 'monuments', paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.25 } });
        map.addLayer({ id: 'monuments-outline', type: 'line', source: 'monuments', paint: { 'line-color': '#ef4444', 'line-width': 3 } });
        
        map.addSource('targets', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ 
            id: 'targets-circle', 
            type: 'circle', 
            source: 'targets', 
            paint: { 
                'circle-radius': 18, 
                'circle-color': [
                    'case',
                    ['get', 'isProtected'], '#ef4444',
                    ['==', ['get', 'source'], 'terrain'], '#10b981',
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

  const scanDataSource = async (sourceType: 'terrain' | 'satellite', zoom: number, tX_start: number, tY_start: number, bounds: maplibregl.LngLatBounds, n: number, assetsGeoJSON: any): Promise<Cluster[]> => {
    const stitchSize = 512;
    const stitchCanvas = document.createElement('canvas');
    stitchCanvas.width = stitchSize; stitchCanvas.height = stitchSize;
    const stitchCtx = stitchCanvas.getContext('2d');
    if (!stitchCtx) return [];

    const tilePromises = [];
    for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
            const tx = tX_start + dx;
            const ty = tY_start + dy;
            const url = sourceType === 'terrain'
                ? `https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/${zoom}/${ty}/${tx}`
                : `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;

            tilePromises.push(new Promise<void>((resolve) => {
                const img = new Image(); img.crossOrigin = "anonymous"; img.src = url;
                const timeout = setTimeout(() => resolve(), 4000);
                img.onload = () => { clearTimeout(timeout); stitchCtx.drawImage(img, dx * 256, dy * 256); resolve(); };
                img.onerror = () => { clearTimeout(timeout); resolve(); };
            }));
        }
    }

    await Promise.all(tilePromises);

    const rawData = stitchCtx.getImageData(0, 0, stitchSize, stitchSize).data;
    const processed = new Float32Array(stitchSize * stitchSize);
    
    if (sourceType === 'terrain') {
        let minG = 255, maxG = 0;
        for (let i = 0; i < rawData.length; i += 4) {
            const v = (rawData[i] + rawData[i+1] + rawData[i+2])/3;
            processed[i/4] = v;
            if (v < minG) minG = v; if (v > maxG) maxG = v;
        }
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

    const featureMap = new Uint8Array(stitchSize * stitchSize);
    const ridgeMap = new Float32Array(stitchSize * stitchSize);
    let maxRidge = 0;

    for (let y = 2; y < stitchSize - 2; y++) {
        for (let x = 2; x < stitchSize - 2; x++) {
            const f = processed[y*stitchSize + x];
            const fxx = processed[y*stitchSize + (x+1)] + processed[y*stitchSize + (x-1)] - 2*f;
            const fyy = processed[(y+1)*stitchSize + x] + processed[(y-1)*stitchSize + x] - 2*f;
            const fxy = (processed[(y+1)*stitchSize + (x+1)] + processed[(y-1)*stitchSize + (x-1)] - processed[(y+1)*stitchSize + (x-1)] - processed[(y-1)*stitchSize + (x+1)]) / 4;
            const ridge = Math.max(Math.abs(fxx + fyy), Math.sqrt(Math.max(0, (fxx-fyy)*(fxx-fyy) + 4*fxy*fxy)));
            ridgeMap[y*stitchSize + x] = ridge;
            if (ridge > maxRidge) maxRidge = ridge;
        }
    }

    const config = sourceType === 'terrain' ? SCAN_PROFILE.TERRAIN : SCAN_PROFILE.AERIAL;
    const threshold = maxRidge * config.threshold;
    const dR = config.dilation;

    for (let y = 15; y < stitchSize - 15; y++) {
        for (let x = 15; x < stitchSize - 15; x++) {
            if (ridgeMap[y*stitchSize + x] > threshold) {
                for (let dy = -dR; dy <= dR; dy++) {
                    for (let dx = -dR; dx <= dR; dx++) featureMap[(y+dy)*stitchSize + (x+dx)] = 1;
                }
            }
        }
    }

    const visited = new Uint8Array(stitchSize * stitchSize), clusters: Cluster[] = [];
    for (let y = 0; y < stitchSize; y++) {
        for (let x = 0; x < stitchSize; x++) {
            const idx = y * stitchSize + x;
            if (featureMap[idx] === 1 && visited[idx] === 0) {
                const cluster: Cluster = { id: Math.random().toString(36).substring(7), points: [], minX: x, maxX: x, minY: y, maxY: y, type: "Anomaly", score: 0, number: 0, isProtected: false, confidence: 'Medium', findPotential: 0, center: [0, 0], source: sourceType };
                const queue: [number, number][] = [[x, y]]; visited[idx] = 1;
                while (queue.length > 0) {
                    const [cx, cy] = queue.shift()!; cluster.points.push({x: cx, y: cy});
                    cluster.minX = Math.min(cluster.minX, cx); cluster.maxX = Math.max(cluster.maxX, cx);
                    cluster.minY = Math.min(cluster.minY, cy); cluster.maxY = Math.max(cluster.maxY, cy);
                    for (const [nx, ny] of [[cx+1, cy], [cx-1, cy], [cx, cy+1], [cx, cy-1]]) {
                        if (nx >= 0 && nx < stitchSize && ny >= 0 && ny < stitchSize) {
                            const nidx = ny * stitchSize + nx; if (featureMap[nidx] === 1 && visited[nidx] === 0) { visited[nidx] = 1; queue.push([nx, ny]); }
                        }
                    }
                }
                
                const w = (cluster.maxX - cluster.minX) + 1, h = (cluster.maxY - cluster.minY) + 1;
                const areaPx = cluster.points.length, dens = areaPx / (w * h);
                const ratio = Math.max(w/h, h/w);
                
                const isSolid = dens > (config.minSolidity ?? 0.32); 
                const isLinear = ratio > (config.minLinearity ?? 4.2);
                
                if (areaPx > config.minSize && (sourceType === 'terrain' || isSolid || isLinear)) {
                    const midX = (cluster.minX + cluster.maxX) / 2, midY = (cluster.minY + cluster.maxY) / 2;
                    const lon = (tX_start + midX / 256) / n * 360 - 180;
                    const yNorm = (tY_start + midY / 256) / n;
                    const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * yNorm))) - Math.PI / 2);
                    cluster.center = [lon, lat];
                    if (lon >= bounds.getWest() && lon <= bounds.getEast() && lat >= bounds.getSouth() && lat <= bounds.getNorth()) {
                        for (const asset of assetsGeoJSON.features as any[]) {
                            if (asset.geometry?.type === 'Polygon' && isPointInPolygon(lat, lon, asset.geometry.coordinates)) { cluster.isProtected = true; cluster.monumentName = asset.properties.Name; break; }
                            else if (asset.geometry?.type === 'MultiPolygon') {
                                for (const poly of asset.geometry.coordinates) { if (isPointInPolygon(lat, lon, poly)) { cluster.isProtected = true; cluster.monumentName = asset.properties.Name; break; } }
                            }
                        }
                        const perimeterPx = (w * 2) + (h * 2), circularity = (4 * Math.PI * areaPx) / Math.pow(perimeterPx, 2);
                        
                        if (ratio > 6.0) cluster.type = "Pathway / Sunken Lane";
                        else if (ratio > 3.0) cluster.type = "Linear Ditch / Bank";
                        else if (dens > 0.7 && ratio < 1.4) cluster.type = "Foundation / Building";
                        else if (circularity > 0.65 && dens > 0.5) cluster.type = "Roundhouse / Burial Mound";
                        else if (areaPx > 400) cluster.type = "Complex Earthwork";
                        else cluster.type = "Potential Anomaly";

                        const confidenceVal = (dens * 0.3) + (circularity * 0.3) + (Math.min(areaPx/600, 1) * 0.4);
                        cluster.confidence = confidenceVal > 0.6 ? 'High' : (confidenceVal > 0.35 ? 'Medium' : 'Subtle');
                        cluster.findPotential = Math.min(99, Math.round((confidenceVal * 100)));
                        cluster.metrics = { circularity, density: dens, ratio, area: areaPx };
                        clusters.push(cluster);
                    }
                }
            }
        }
    }
    return clusters;
  };

  const executeScan = async () => {
    if (!mapRef.current) return;
    const currentZoom = mapRef.current.getZoom();
    const zoom = Math.min(Math.floor(currentZoom), 16); 
    const bounds = mapRef.current.getBounds();
    const n = Math.pow(2, zoom);
    const center = mapRef.current.getCenter();
    const cX = (center.lng + 180) / 360 * n;
    const cY = (1 - Math.log(Math.tan(center.lat * Math.PI / 180) + 1 / Math.cos(center.lat * Math.PI / 180)) / Math.PI) / 2 * n;
    const tX_start = Math.floor(cX - 0.5);
    const tY_start = Math.floor(cY - 0.5);

    setAnalyzing(true);
    setDetectedFeatures([]);
    addLog(`Initiating Scan (Data: Z${zoom})...`);

    const herUrl = `https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/6/query?where=1%3D1&geometry=${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&f=geojson&outFields=Name,ListEntry`;
    let assetsGeoJSON = { type: 'FeatureCollection', features: [] };
    try {
        const hRes = await fetch(herUrl);
        assetsGeoJSON = await hRes.json();
        setHeritageCount(assetsGeoJSON.features?.length || 0);
        (mapRef.current.getSource('monuments') as maplibregl.GeoJSONSource).setData(assetsGeoJSON as any);
    } catch (e) { addLog("HER connection error."); }

    try {
        const [terrainHits, satelliteHits] = await Promise.all([
            scanDataSource('terrain', zoom, tX_start, tY_start, bounds, n, assetsGeoJSON),
            scanDataSource('satellite', zoom, tX_start, tY_start, bounds, n, assetsGeoJSON)
        ]);

        const combined = [...terrainHits, ...satelliteHits].map((c, i) => ({ ...c, number: i + 1 }));
        setDetectedFeatures(combined);
        
        if (mapRef.current) {
            const targetGeoJSON = { type: 'FeatureCollection', features: combined.map(f => ({ type: 'Feature', geometry: { type: 'Point', coordinates: f.center }, properties: { id: f.id, number: f.number.toString(), isProtected: f.isProtected, source: f.source } })) };
            (mapRef.current.getSource('targets') as maplibregl.GeoJSONSource).setData(targetGeoJSON as any);
        }
        addLog(`Locked ${terrainHits.length} Lidar | ${satelliteHits.length} Aerial.`);
    } catch (e) { addLog("Engine error."); }
    
    setAnalyzing(false);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] landscape:h-[calc(100vh-100px)] sm:h-[calc(100vh-220px)] bg-slate-950 rounded-3xl overflow-hidden border border-slate-800 shadow-2xl relative">
      <header className="bg-slate-900/80 border-b border-white/5 shrink-0 z-50 backdrop-blur-md">
          {/* Top Row: Title & Search Toggle */}
          <div className="flex justify-between items-center px-4 py-2 border-b border-white/5">
              {!isSearchOpen ? (
                  <p className="m-0 text-[10px] font-black text-emerald-500 tracking-[0.1em] uppercase whitespace-nowrap">Lidar & Satellite Detection</p>
              ) : (
                  <form onSubmit={searchLocation} className="flex gap-2 flex-1 mr-2">
                      <input autoFocus value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search place..." className="bg-black/40 border border-white/10 text-white px-3 py-1 rounded-lg flex-1 text-xs outline-none focus:ring-1 focus:ring-emerald-500" />
                  </form>
              )}
              <button onClick={() => setIsSearchOpen(!isSearchOpen)} className="text-slate-400 hover:text-white p-1 text-xs">
                  {isSearchOpen ? '✕' : '🔍'}
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
            </div>

            {/* Mobile Target Card Popup */}
            {selectedId && (
                <div className="absolute bottom-6 left-4 right-4 z-[100] lg:hidden animate-in slide-in-from-bottom-4 duration-300">
                    {detectedFeatures.filter(f => f.id === selectedId).map(f => (
                        <div key={f.id} className={`p-4 rounded-2xl border shadow-2xl ${
                            f.source === 'terrain' ? 'bg-emerald-500 border-white text-white' : 'bg-sky-500 border-white text-white'
                        }`}>
                            <div className="flex justify-between items-center mb-2">
                                <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 bg-black/20 rounded-lg flex items-center justify-center text-[10px] font-black">{f.number}</div>
                                    <h3 className="text-xs font-black uppercase tracking-tight">{f.type}</h3>
                                </div>
                                <button onClick={(e) => { e.stopPropagation(); setSelectedId(null); }} className="text-white/70 hover:text-white p-1">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                            </div>
                            <div className="flex justify-between items-center text-[10px]">
                                <span className="font-bold uppercase opacity-80">{f.source === 'terrain' ? 'Lidar Signal' : 'Aerial Signal'}</span>
                                <span className="font-black uppercase tracking-widest">Confidence: {f.confidence}</span>
                            </div>
                            {f.isProtected && <div className="mt-2 p-1.5 bg-white/20 rounded-lg text-[8px] font-black uppercase tracking-widest text-center">⚠️ Protected Monument</div>}
                            <div className="mt-3 grid grid-cols-2 gap-2">
                                <button onClick={() => mapRef.current?.flyTo({ center: f.center, zoom: 18 })} className="bg-black/20 hover:bg-black/30 py-2 rounded-lg text-[9px] font-black uppercase">Refine Map</button>
                                <button onClick={() => navigate(`/find?lat=${f.center[1]}&lon=${f.center[0]}`)} className="bg-white text-slate-900 py-2 rounded-lg text-[9px] font-black uppercase">Record Find</button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>

        {/* Sidebar */}
        <div className="w-80 hidden lg:flex flex-col bg-slate-900/80 backdrop-blur-xl border-l border-white/5 shrink-0 relative z-50">
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
                            ? (f.source === 'terrain' ? 'bg-emerald-500 border-white shadow-[0_0_25px_rgba(16,185,129,0.5)]' : 'bg-sky-500 border-white shadow-[0_0_25px_rgba(59,130,246,0.5)]') 
                            : 'bg-white/5 border-white/5 hover:bg-white/10'
                        }`}
                    >
                        <div className="flex justify-between items-center mb-3">
                            <div className="w-8 h-8 bg-black/20 rounded-lg flex items-center justify-center text-xs font-black text-white">{f.number}</div>
                            <div className="px-2 py-1 bg-black/20 rounded text-[8px] font-black text-white uppercase tracking-widest">
                                {f.source === 'terrain' ? 'Lidar Feature' : 'Aerial Feature'}
                            </div>
                        </div>
                        <h3 className={`text-sm font-black uppercase tracking-tight mb-1 ${selectedId === f.id ? 'text-white' : 'text-slate-200'}`}>{f.type}</h3>
                        <div className="flex justify-between items-center">
                            <span className={`text-[10px] font-bold uppercase ${selectedId === f.id ? 'text-white/80' : 'text-slate-500'}`}>Confidence:</span>
                            <span className={`text-[10px] font-black ${selectedId === f.id ? 'text-white' : (f.source === 'terrain' ? 'text-emerald-400' : 'text-sky-400')}`}>{f.confidence}</span>
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
