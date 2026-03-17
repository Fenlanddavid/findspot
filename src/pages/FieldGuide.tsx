import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useNavigate } from 'react-router-dom';
import { toOSGridRef } from '../services/gps';

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
interface PASFind {
    id: string;
    internalId: string;
    objectType: string;
    broadperiod: string;
    county: string;
    workflow: "PAS";
    lat: number;
    lon: number;
    isApprox?: boolean; // True if it's a 1km grid centroid or parish centroid
}

interface PlaceSignal {
    name: string;
    meaning: string;
    distance: number;
    period: string;
    confidence: number;
    type: string;
}

const ETYMOLOGY_SIGNALS = [
  // --- ROMAN (90%+) ---
  { pattern: "chester", meaning: "Roman fort", period: "Roman", confidence: 0.95 },
  { pattern: "caster", meaning: "Roman fort", period: "Roman", confidence: 0.95 },
  { pattern: "cester", meaning: "Roman fort", period: "Roman", confidence: 0.95 },
  { pattern: "street", meaning: "Roman road", period: "Roman", confidence: 0.9 },
  { pattern: "strat", meaning: "Roman road", period: "Roman", confidence: 0.9 },
  { pattern: "foss", meaning: "Roman ditch/road", period: "Roman", confidence: 0.85 },

  // --- SAXON / EARLY MEDIEVAL ---
  { pattern: "bury", meaning: "Fortified place", period: "Saxon", confidence: 0.85 },
  { pattern: "borough", meaning: "Fortified settlement", period: "Saxon", confidence: 0.85 },
  { pattern: "burgh", meaning: "Fortified settlement", period: "Saxon", confidence: 0.85 },
  { pattern: "ham", meaning: "Settlement", period: "Saxon", confidence: 0.75 },
  { pattern: "ton", meaning: "Farmstead or enclosure", period: "Saxon", confidence: 0.75 },
  { pattern: "stow", meaning: "Meeting / holy place", period: "Saxon", confidence: 0.85 },
  { pattern: "ley", meaning: "Clearing in woodland", period: "Saxon", confidence: 0.7 },
  { pattern: "leigh", meaning: "Clearing", period: "Saxon", confidence: 0.7 },
  { pattern: "ing", meaning: "People of...", period: "Early Saxon", confidence: 0.8 },

  // --- VIKING / NORSE ---
  { pattern: "by", meaning: "Viking settlement", period: "Viking", confidence: 0.95 },
  { pattern: "thorpe", meaning: "Secondary Viking settlement", period: "Viking", confidence: 0.9 },
  { pattern: "kirk", meaning: "Church site", period: "Viking/Saxon", confidence: 0.85 },

  // --- MEDIEVAL & TRADE ---
  { pattern: "wick", meaning: "Trading settlement", period: "Early Medieval", confidence: 0.8 },
  { pattern: "wich", meaning: "Specialised settlement (salt/trade)", period: "Early Medieval", confidence: 0.8 },
  { pattern: "port", meaning: "Market town", period: "Medieval", confidence: 0.75 },
  { pattern: "bridge", meaning: "Crossing point", period: "Medieval+", confidence: 0.85 },
  { pattern: "field", meaning: "Open land", period: "Medieval+", confidence: 0.6 },

  // --- TOPOGRAPHICAL / WATER ---
  { pattern: "ford", meaning: "River crossing", period: "Multi-period", confidence: 0.85 },
  { pattern: "mere", meaning: "Lake or wetland", period: "Prehistoric+", confidence: 0.8 },
  { pattern: "marsh", meaning: "Wetland", period: "Multi-period", confidence: 0.7 },
  { pattern: "low", meaning: "Burial mound / barrow", period: "Prehistoric/Saxon", confidence: 0.85 },
  { pattern: "howe", meaning: "Burial mound / barrow", period: "Viking/Saxon", confidence: 0.85 }
];


/**
 * FieldGuide Standalone V12.8 - Expert Verification Engine
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
  const [isIntelOpen, setIsIntelOpen] = useState(false);
  
  // PAS & Potential Score State
  const [pasFinds, setPasFinds] = useState<PASFind[]>([]);
  const [selectedPASFind, setSelectedPASFind] = useState<PASFind | null>(null);
  const [loadingPAS, setLoadingPAS] = useState(false);
  const [placeSignals, setPlaceSignals] = useState<PlaceSignal[]>([]);
  const [potentialScore, setPotentialScore] = useState<{score: number, reasons: string[]} | null>(null);
  const [monumentPoints, setMonumentPoints] = useState<[number, number][]>([]);

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
    setPasFinds([]);
    setPlaceSignals([]);
    setPotentialScore(null);
    setSystemLog(["SYSTEM CLEARED. Ready for new scan."]);
  };

  const loadPASFinds = async () => {
    if (!mapRef.current) {
        addLog("ERROR: Map engine not initialized.");
        return;
    }
    
    const center = mapRef.current.getCenter();
    setLoadingPAS(true);
    addLog(`INITIALIZING SCAN @ ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`);

    // 1. REVERSE GEOCODE to get Parish/County (The "Another Way")
    let parish = "";
    let county = "";
    try {
        addLog("IDENTIFYING PARISH...");
        const geoResp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${center.lat}&lon=${center.lng}`, {
            headers: { 'User-Agent': 'FindSpot-FieldGuide/1.0' }
        });
        const geoData = await geoResp.json();
        if (geoData && geoData.address) {
            parish = geoData.address.village || geoData.address.town || geoData.address.suburb || "";
            county = geoData.address.county || "";
            addLog(`LOCATION: ${parish}, ${county}`);
        }

        // SCAN NEARBY PLACE NAMES FOR SIGNALS via Overpass (More comprehensive: millions of entries)
        addLog("ENGAGING OVERPASS ETYMOLOGY ENGINE...");
        const latOffsetPlace = 10 / 111.32; // ~10km box
        const lonOffsetPlace = 10 / (111.32 * Math.cos(center.lat * Math.PI / 180));
        const pWest = (center.lng - lonOffsetPlace).toFixed(4);
        const pSouth = (center.lat - latOffsetPlace).toFixed(4);
        const pEast = (center.lng + lonOffsetPlace).toFixed(4);
        const pNorth = (center.lat + latOffsetPlace).toFixed(4);

        // Fetch villages, farms, hills, and historic sites with names
        const overpassQuery = `[out:json][timeout:15];(node["name"]["place"~"city|town|village|hamlet|isolated_dwelling"](${pSouth},${pWest},${pNorth},${pEast});way["name"]["place"~"city|town|village|hamlet|isolated_dwelling"](${pSouth},${pWest},${pNorth},${pEast});node["name"]["natural"~"hill|peak|ridge"](${pSouth},${pWest},${pNorth},${pEast});node["name"]["historic"](${pSouth},${pWest},${pNorth},${pEast});node["name"]["landuse"="farmyard"](${pSouth},${pWest},${pNorth},${pEast}););out center;`;
        
        const placeResp = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`);
        const placeData = await placeResp.json();
        
        if (placeData && placeData.elements) {
            const detectedSignals: PlaceSignal[] = [];
            
            // Map technical OSM tags to user-friendly categories
            const getTypeLabel = (tags: any) => {
                if (tags.place) return "Populated Place";
                if (tags.natural) return "Topographic Feature";
                if (tags.historic) return "Historic Site";
                if (tags.landuse === "farmyard") return "Agricultural Site";
                return "Feature";
            };

            placeData.elements.forEach((el: any) => {
                const name = el.tags.name;
                const typeLabel = getTypeLabel(el.tags);
                const lat = el.lat || el.center?.lat;
                const lon = el.lon || el.center?.lon;
                
                const match = ETYMOLOGY_SIGNALS.find(s => name.toLowerCase().includes(s.pattern));
                if (match && lat && lon) {
                    const dist = getDistancePAS(center.lat, center.lng, lat, lon);
                    if (!detectedSignals.find(ds => ds.name === name)) {
                        detectedSignals.push({ 
                            name, 
                            meaning: match.meaning, 
                            distance: dist,
                            period: match.period,
                            confidence: match.confidence,
                            type: typeLabel
                        });
                    }
                }
            });
            
            if (detectedSignals.length > 0) {
                setPlaceSignals(detectedSignals.sort((a, b) => a.distance - b.distance));
                addLog(`SIGNALS: ${detectedSignals.length} historic signals detected.`);
            } else {
                addLog("SIGNALS: No etymological matches in area.");
            }
        }
    } catch (e) {
        addLog("SIGNAL SCAN FAILED (Overpass Timeout/Proxy)");
    }

    // 2. CALCULATE 4-FIGURE GRID REF (1km Square)
    const gridRefFull = toOSGridRef(center.lat, center.lng);
    let grid4 = "";
    if (gridRefFull && gridRefFull.length > 10) {
        // e.g. "TL 12345 67890" -> "TL1267" approx (using first 2 digits of each 5-digit block)
        const parts = gridRefFull.split(" ");
        if (parts.length === 3) {
            grid4 = `${parts[0]}${parts[1].substring(0, 2)}${parts[2].substring(0, 2)}`;
            addLog(`GRID SQUARE: ${grid4}`);
        }
    }

    // 3. PREPARE MULTIPLE SEARCH STRATEGIES
    const latOffset = 8 / 111.32; // ~8km box
    const lonOffset = 8 / (111.32 * Math.cos(center.lat * Math.PI / 180));
    const west = (center.lng - lonOffset).toFixed(4);
    const south = (center.lat - latOffset).toFixed(4);
    const east = (center.lng + lonOffset).toFixed(4);
    const north = (center.lat + latOffset).toFixed(4);

    const searchUrls: { url: string, label: string }[] = [];
    // Strategy A: Bounding Box (Precise points)
    searchUrls.push({ 
        url: `https://finds.org.uk/database/search/results/bbox/${west},${south},${east},${north}/show/100/format/json`,
        label: "BBOX Scan"
    });
    
    // Strategy B: Parish Search (General area mapping - very robust)
    if (parish && county) {
        searchUrls.push({ 
            url: `https://finds.org.uk/database/search/results/parish/${encodeURIComponent(parish)}/county/${encodeURIComponent(county)}/show/100/format/json`,
            label: "Parish Scan"
        });
    }

    // Strategy C: Grid Reference Search (Keyword-based)
    if (grid4) {
        searchUrls.push({ 
            url: `https://finds.org.uk/database/search/results/q/${grid4}/show/100/format/json`,
            label: "Grid Scan"
        });
    }

    const allProxies = [
        { type: 'raw', name: 'Direct' },
        { type: 'wrapped', name: 'AllOrigins' },
        { type: 'raw', name: 'CORSProxy.io' },
        { type: 'raw', name: 'CodeTabs' },
        { type: 'raw', name: 'CORS.sh' }
    ];

    const fetchWithFallback = async (pasUrl: string, label: string): Promise<PASFind[]> => {
        addLog(`RACING PROXIES FOR: ${label}...`);
        
        const raceProxy = async (proxy: {name: string, type: string}): Promise<PASFind[]> => {
            let finalUrl = pasUrl;
            if (proxy.name === 'AllOrigins') finalUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(pasUrl)}`;
            if (proxy.name === 'CORSProxy.io') finalUrl = `https://corsproxy.io/?${encodeURIComponent(pasUrl)}`;
            if (proxy.name === 'CodeTabs') finalUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(pasUrl)}`;
            if (proxy.name === 'CORS.sh') finalUrl = `https://proxy.cors.sh/${pasUrl}`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000); // OPTION 3: AGGRESSIVE 4S TIMEOUT

            try {
                const response = await fetch(finalUrl, {
                    headers: { 'Accept': 'application/json' },
                    mode: 'cors',
                    signal: controller.signal
                });

                clearTimeout(timeoutId);
                if (!response.ok) throw new Error("Network fail");

                const text = await response.text();
                if (!text || text.includes('<!DOCTYPE') || text.length < 100) throw new Error("Invalid data");

                let data = JSON.parse(text);
                if (proxy.type === 'wrapped' && data.contents) data = JSON.parse(data.contents);

                const results = data.results || data.features || [];
                if (!results.length) throw new Error("No records");

                return results.map((p: any) => {
                    const item = p.properties || p;
                    const iLat = Number(item.declat || item.fourFigureLat || item.latitude || item.lat || NaN);
                    const iLon = Number(item.declon || item.fourFigureLon || item.longitude || item.lon || NaN);
                    
                    if (isNaN(iLat) || isNaN(iLon)) return null;

                    return {
                        id: String(item.findIdentifier || item.id || item.secuid),
                        internalId: String(item.id || item.secuid || ""),
                        objectType: String(item.objecttype || "Object"),
                        broadperiod: String(item.broadperiod || "Unknown"),
                        county: String(item.county || "Unknown"),
                        workflow: "PAS",
                        lat: iLat,
                        lon: iLon,
                        isApprox: !!item.fourFigureLat
                    } as PASFind;
                }).filter((f: any): f is PASFind => f !== null);
            } catch (e) {
                clearTimeout(timeoutId);
                throw e; // Re-throw so Promise.any knows this proxy failed
            }
        };

        try {
            // OPTION 1: PROXY RACING (Fire all at once, take first successful)
            const result = await Promise.any(allProxies.map(p => raceProxy(p)));
            return result;
        } catch (e) {
            // If all proxies in the race fail
            return [];
        }
    };

    // Execute all strategies in parallel for speed
    addLog("EXECUTING MULTISPECTRAL PAS SCAN...");
    const strategyPromises = searchUrls.map(s => fetchWithFallback(s.url, s.label));
    const resultsArray = await Promise.all(strategyPromises);
    
    let combinedFinds: PASFind[] = [];
    resultsArray.forEach((results, idx) => {
        if (results.length > 0) {
            combinedFinds = [...combinedFinds, ...results];
            addLog(`READY: ${results.length} records from ${searchUrls[idx].label}`);
        }
    });

    // Deduplicate and filter by distance
    const uniqueMap = new Map();
    combinedFinds.forEach(f => {
        if (!uniqueMap.has(f.id)) uniqueMap.set(f.id, f);
    });

    const finalFinds = Array.from(uniqueMap.values()).filter(f => {
        const d = getDistancePAS(center.lat, center.lng, f.lat, f.lon);
        return d < 15;
    });

    if (finalFinds.length > 0) {
        setPasFinds(finalFinds);
        addLog(`SUCCESS: ${finalFinds.length} total finds mapped.`);
        calculatePotentialScore(finalFinds, monumentPoints);
    } else {
        addLog("SCAN FINISHED: 0 records found in this area.");
    }
    setLoadingPAS(false);
  };


  const calculatePotentialScore = (pas: PASFind[], monuments: [number, number][]) => {
    if (!mapRef.current) return;
    const center = mapRef.current.getCenter();
    let score = 30; // Base score for any field
    const reasons: string[] = [];

    // 1. Proximity to PAS Finds (High Weight)
    const nearbyPAS = pas.filter(f => {
        const dist = getDistancePAS(center.lat, center.lng, f.lat, f.lon);
        return dist < 1.0; // 1km radius
    });

    if (nearbyPAS.length > 5) {
        score += 35;
        reasons.push(`${nearbyPAS.length} historic finds within 1km`);
    } else if (nearbyPAS.length > 0) {
        score += 20;
        reasons.push(`Known historic finds in immediate vicinity`);
    }

    // 2. Proximity to Scheduled Monuments/HE AIM (High Weight)
    const nearbyMonuments = monuments.filter(m => {
        const dist = getDistancePAS(center.lat, center.lng, m[1], m[0]);
        return dist < 0.5; // 500m radius
    });

    if (nearbyMonuments.length > 0) {
        score += 25;
        reasons.push("Adjacent to recorded archaeological monument");
    }

    // 3. Geographic Features (Water/Slope)
    // For now, we simulate this based on the existing hydrology scan if any linear features were found
    const hasWater = detectedFeatures.some(f => f.source === 'hydrology' && f.metrics && f.metrics.ratio > 5);
    if (hasWater) {
        score += 15;
        reasons.push("Near palaeochannel or historic watercourse");
    }

    // Cap score at 98% (Archaeology is never 100% certain!)
    const finalScore = Math.min(score, 98);
    setPotentialScore({ score: finalScore, reasons });
  };

  // Simple Haversine distance in km
  const getDistancePAS = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
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
      clickTolerance: 40,
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

        map.addSource('pas-finds', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
            id: 'pas-circles',
            type: 'circle',
            source: 'pas-finds',
            paint: {
                'circle-radius': 10,
                'circle-color': '#3b82f6',
                'circle-stroke-width': 2,
                'circle-stroke-color': '#fff'
            }
        });

        map.on('click', 'pas-circles', (e) => {
            if (e.features?.[0]) {
                const props = e.features[0].properties as any;
                addLog(`PAS FIND: ${props.objectType} (${props.broadperiod}) - ${props.id}`);
                setSelectedPASFind({
                    id: props.id,
                    internalId: String(props.internalId || ""),
                    objectType: props.objectType,
                    broadperiod: props.broadperiod,
                    county: props.county,
                    workflow: "PAS",
                    lat: Number(props.lat),
                    lon: Number(props.lon),
                    isApprox: !!props.isApprox
                });
            }
        });

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

  useEffect(() => {
    if (isIntelOpen && pasFinds.length === 0 && !loadingPAS) {
        loadPASFinds();
    }
  }, [isIntelOpen]);

  useEffect(() => {
    if (mapRef.current) {
        // Group finds by coordinate to detect overlaps
        const coordGroups: { [key: string]: number } = {};
        
        // USER REQUEST: Don't map PAS points because they aren't accurate enough
        const pasGeoJSON = {
            type: 'FeatureCollection',
            features: [] // Empty features to hide points from map
        };
        
        const updateSource = () => {
            const source = mapRef.current?.getSource('pas-finds') as maplibregl.GeoJSONSource;
            if (source) {
                source.setData(pasGeoJSON as any);
            } else if (mapRef.current?.loaded()) {
                // If loaded but source missing, it might not have been added yet
            } else {
                // Map not loaded yet, retry shortly
                setTimeout(updateSource, 500);
            }
        };
        updateSource();
    }
  }, [pasFinds]);

  // Sync monument points for score calculation
  useEffect(() => {
    if (mapRef.current) {
        const mSrc = mapRef.current.getSource('monuments') as maplibregl.GeoJSONSource;
        if (mSrc) {
            // This is a bit of a hack since we can't easily get data back from a source
            // But heritageCount is updated when the monuments source is set
            // In the scan logic, we should also setMonumentPoints
        }
    }
  }, [heritageCount]);

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
        
        // Extract center points for scoring
        const mPoints: [number, number][] = assetsGeoJSON.features.map((f: any) => {
            if (f.geometry.type === 'Point') return f.geometry.coordinates;
            // For polygons, use the first coordinate as a rough center
            if (f.geometry.type === 'Polygon') return f.geometry.coordinates[0][0];
            if (f.geometry.type === 'MultiPolygon') return f.geometry.coordinates[0][0][0];
            return [0, 0];
        });
        setMonumentPoints(mPoints);

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
          
          {/* Bottom Row: Dual Actions */}
          <div className="flex justify-between items-center px-4 py-2 bg-black/20 relative">
              {/* Left Side: Historic/Site Intel */}
              <div className="flex gap-2 items-center relative">
                  {/* Option 3: Ephemeral Instruction */}
                  {!isIntelOpen && pasFinds.length === 0 && !loadingPAS && !potentialScore && (
                      <div className="absolute bottom-full left-1 mb-1 pointer-events-none animate-pulse">
                          <span className="text-[7px] font-black text-blue-400/80 uppercase tracking-[0.2em] whitespace-nowrap bg-slate-900/80 px-1.5 py-0.5 rounded border border-blue-500/20">Historic Scan</span>
                      </div>
                  )}
                  <button 
                    onClick={() => {
                        if (pasFinds.length === 0) loadPASFinds();
                        setIsIntelOpen(!isIntelOpen);
                    }}
                    className={`px-4 py-1.5 rounded-lg text-[9px] font-black tracking-widest uppercase border transition-all shadow-lg ${
                        isIntelOpen ? 'bg-slate-700 text-white border-white/20' : 
                        (pasFinds.length > 0 ? 'bg-red-600 text-white border-red-400 shadow-[0_0_15px_rgba(220,38,38,0.5)]' : 
                         'bg-blue-600 text-white border-blue-400/50 shadow-[0_0_15px_rgba(37,99,235,0.3)]')
                    } ${loadingPAS ? 'animate-pulse opacity-80' : ''}`}
                  >
                    {loadingPAS ? 'Scanning...' : 'Historic'}
                  </button>
                  <button onClick={clearScan} className="text-[9px] font-black text-slate-400 hover:text-white transition-colors tracking-widest uppercase px-2 py-1.5">Clear</button>
              </div>

              {/* Right Side: Terrain Scan */}
              <div className="flex gap-2 items-center relative">
                  {/* Option 3: Ephemeral Instruction */}
                  {!analyzing && detectedFeatures.length === 0 && (
                      <div className="absolute bottom-full right-1 mb-1 pointer-events-none animate-pulse text-right">
                          <span className="text-[7px] font-black text-emerald-500/80 uppercase tracking-[0.2em] whitespace-nowrap bg-slate-900/80 px-1.5 py-0.5 rounded border border-emerald-500/20">Terrain Scan</span>
                      </div>
                  )}
                  <button onClick={findMe} className="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-[9px] font-black tracking-widest uppercase hover:bg-slate-700 transition-colors">GPS</button>
                  <button 
                    onClick={executeScan} 
                    disabled={analyzing} 
                    className="bg-emerald-500 text-white px-4 py-1.5 rounded-lg text-[9px] font-black tracking-widest uppercase hover:bg-emerald-400 transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:opacity-50 disabled:animate-pulse"
                  >
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
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
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

            {/* Mobile Site Intel HUD Overlay */}
            {isIntelOpen && (
                <div className="absolute inset-0 z-[105] lg:hidden bg-slate-950/80 backdrop-blur-2xl animate-in fade-in duration-500 flex flex-col">
                    {/* HUD Header */}
                    <div className="p-4 pt-6 border-b border-white/5 flex justify-between items-center">
                        <div>
                            <h2 className="text-xl font-black text-white uppercase tracking-tighter italic leading-none">Site Intelligence</h2>
                            <p className="text-[10px] text-emerald-500 font-black uppercase tracking-[0.2em]">Regional Scan Profile</p>
                        </div>
                        <button 
                            onClick={() => setIsIntelOpen(false)} 
                            className="w-12 h-12 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-2xl border border-white/10 text-white transition-all active:scale-90"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M18 6L6 18M6 6l12 12"/>
                            </svg>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-8 pb-24">
                        {/* Big HUD Score Gauge */}
                        <div className="relative flex flex-col items-center justify-center py-6">
                            <div className="relative w-48 h-48 flex items-center justify-center">
                                {/* Background Ring */}
                                <svg className="absolute inset-0 w-full h-full -rotate-90">
                                    <circle cx="96" cy="96" r="80" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/5" />
                                    {/* Segmented Ring Effect */}
                                    <circle 
                                        cx="96" cy="96" r="80" 
                                        fill="none" 
                                        stroke="currentColor" 
                                        strokeWidth="8" 
                                        className={`${pasFinds.length > 0 ? 'text-red-500' : 'text-emerald-500'} shadow-[0_0_20px_rgba(239,68,68,0.5)] transition-all duration-1000`}
                                        strokeDasharray="502"
                                        strokeDashoffset={502 - (502 * (potentialScore?.score || 0)) / 100}
                                        strokeLinecap="round"
                                    />
                                </svg>
                                <div className="text-center">
                                    <span className="block text-6xl font-black text-white tracking-tighter leading-none">{potentialScore?.score || '0'}</span>
                                    <span className={`text-xs font-black uppercase tracking-widest mt-1 ${pasFinds.length > 0 ? 'text-red-400' : 'text-emerald-500'}`}>Potential Index</span>
                                </div>
                            </div>
                        </div>

                        {/* PAS Period Summary Grid */}
                        {pasFinds.length > 0 && (
                            <div className="space-y-4">
                                <h3 className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em] flex items-center gap-2">
                                    <div className="w-1 h-3 bg-blue-500" /> Historic Period Profile
                                </h3>
                                <div className="grid grid-cols-2 gap-2">
                                    {Object.entries(
                                        pasFinds.reduce((acc, f) => {
                                            const p = f.broadperiod || "Unknown";
                                            acc[p] = (acc[p] || 0) + 1;
                                            return acc;
                                        }, {} as Record<string, number>)
                                    ).sort((a, b) => b[1] - a[1]).map(([period, count]) => (
                                        <div key={period} className="bg-blue-500/5 border border-blue-500/10 p-3 rounded-2xl flex justify-between items-center">
                                            <span className="text-[9px] font-black text-slate-300 uppercase truncate pr-2">{period}</span>
                                            <span className="text-sm font-black text-blue-400">{count}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Analysis Grid */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-white/5 p-4 rounded-3xl border border-white/10">
                                <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Evidence</span>
                                <span className="text-lg font-black text-blue-400">{pasFinds.length} <span className="text-[10px] text-blue-400/50 italic">Records</span></span>
                            </div>
                            <div className="bg-white/5 p-4 rounded-3xl border border-white/10">
                                <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Place Names</span>
                                <span className="text-lg font-black text-emerald-500">{placeSignals.length} <span className="text-[10px] text-emerald-500/50 italic">Signals</span></span>
                            </div>
                        </div>

                        {/* PAS Findings Hud List - MOVED UP */}
                        {pasFinds.length > 0 && (
                            <div className="space-y-4">
                                <h3 className="text-[10px] font-black text-white uppercase tracking-[0.2em] flex items-center gap-2">
                                    <div className="w-1 h-3 bg-blue-500" /> Historic Findings
                                </h3>
                                <div className="space-y-2">
                                    {pasFinds.map(f => (
                                        <div 
                                          key={f.id} 
                                          onClick={() => { setSelectedPASFind(f); setIsIntelOpen(false); mapRef.current?.flyTo({ center: [f.lon, f.lat], zoom: 17 }); }}
                                          className="bg-blue-500/5 p-4 rounded-2xl border border-blue-500/10 flex justify-between items-center active:bg-blue-500/20 transition-all"
                                        >
                                            <div className="flex-1 min-w-0 pr-4">
                                                <p className="text-xs font-black text-white uppercase truncate">{f.objectType}</p>
                                                <p className="text-[9px] font-bold text-blue-400 uppercase">{f.broadperiod}</p>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-[9px] font-black text-slate-500 font-mono tracking-tighter mb-0.5">{f.id}</p>
                                                <p className="text-[8px] font-bold text-slate-400 uppercase italic leading-none">{f.county}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Place Name Signals */}
                        {placeSignals.length > 0 && (
                            <div className="space-y-4">
                                <h3 className="text-[10px] font-black text-emerald-500 uppercase tracking-[0.2em] flex items-center gap-2">
                                    <div className="w-1 h-3 bg-emerald-500" /> Etymological Signals
                                </h3>
                                <div className="space-y-2">
                                    {placeSignals.map((s, i) => (
                                        <div key={i} className="bg-emerald-500/5 border border-emerald-500/10 p-4 rounded-2xl relative overflow-hidden group">
                                            {/* Signal Type Badge */}
                                            <div className="absolute top-0 right-0 px-2 py-0.5 bg-emerald-500/10 border-b border-l border-emerald-500/20 text-[7px] font-black text-emerald-400 uppercase tracking-tighter">Signal Detected</div>
                                            
                                            <div className="flex justify-between items-start mb-1">
                                                <span className="text-sm font-black text-white uppercase italic tracking-tight">"{s.name}"</span>
                                                <span className="text-[9px] font-bold text-emerald-500/60 uppercase">{s.distance.toFixed(1)} km</span>
                                            </div>
                                            <p className="text-[8px] font-black text-emerald-500/40 uppercase mb-2 tracking-widest">{s.type}</p>
                                            <p className="text-[10px] font-bold text-slate-300 leading-tight">
                                                <span className="text-emerald-500/80 uppercase text-[9px]">Meaning:</span> {s.meaning}
                                            </p>

                                            <div className="mt-2.5 flex items-center justify-between border-t border-white/5 pt-2">
                                                <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest bg-white/5 px-1.5 py-0.5 rounded">{s.period}</span>
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-10 h-1 bg-black/40 rounded-full overflow-hidden">
                                                        <div 
                                                            className="h-full bg-emerald-500" 
                                                            style={{ width: `${s.confidence * 100}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-[7px] font-black text-emerald-500/60">{(s.confidence * 100).toFixed(0)}%</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    
                    {/* Bottom Status Bar */}
                    <div className="p-4 pb-8 bg-black/40 border-t border-white/5">
                        <p className="text-center text-[8px] font-black text-slate-500 uppercase tracking-[0.3em] italic animate-pulse">Scanning Spectral Data... [Consensus v12.8]</p>
                    </div>
                </div>
            )}
        </div>

        {/* Sidebar */}
        <div className="w-80 hidden lg:flex flex-col bg-slate-900/80 backdrop-blur-xl border-l border-white/5 shrink-0 relative z-50 overflow-y-auto scrollbar-hide">
            
            {/* Archaeological Potential Section */}
            <div className="p-6 border-b border-white/10 bg-emerald-500/5">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-[10px] font-black text-emerald-500 uppercase tracking-[0.2em]">Archaeological Potential</h2>
                    {potentialScore && (
                        <span className="text-[10px] font-black text-white bg-emerald-500 px-2 py-0.5 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.4)]">
                            {potentialScore.score}%
                        </span>
                    )}
                </div>
                
                {potentialScore ? (
                    <div className="space-y-3">
                        <div className="relative h-2 bg-black/40 rounded-full overflow-hidden">
                            <div 
                                className="absolute inset-y-0 left-0 bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.6)] transition-all duration-1000"
                                style={{ width: `${potentialScore.score}%` }}
                            />
                        </div>
                        <div className="space-y-1.5">
                            {potentialScore.reasons.map((reason, i) => (
                                <div key={i} className="flex items-start gap-2">
                                    <span className="text-emerald-500 mt-0.5 font-bold text-[10px]">✓</span>
                                    <p className="text-[10px] font-bold text-slate-300 leading-tight">{reason}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <p className="text-[10px] text-slate-500 font-bold uppercase italic leading-tight">Perform a scan to calculate site potential.</p>
                )}
            </div>

            {/* PAS Intelligence Section - Desktop Only */}
            <div className="hidden lg:block p-6 border-b border-white/10 bg-blue-500/5">
                <div className="flex justify-between items-baseline mb-4">
                    <h2 className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em]">PAS Intelligence</h2>
                    <button 
                        onClick={loadPASFinds}
                        disabled={loadingPAS}
                        className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded border transition-all ${
                            loadingPAS ? 'bg-slate-800 text-slate-500 border-white/5' : 'bg-blue-500/10 text-blue-400 border-blue-500/30 hover:bg-blue-500 hover:text-white'
                        }`}
                    >
                        {loadingPAS ? 'SYNCING...' : 'SCAN AREA'}
                    </button>
                </div>

                {pasFinds.length > 0 ? (
                    <div className="space-y-3">
                        <p className="text-[9px] font-black text-blue-400/60 uppercase tracking-widest mb-2">{pasFinds.length} Recorded Finds Nearby</p>
                        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 scrollbar-hide">
                            {pasFinds.map(f => (
                                <div key={f.id} onClick={() => { setSelectedPASFind(f); mapRef.current?.flyTo({ center: [f.lon, f.lat], zoom: 17 }); }} className="bg-black/30 p-2.5 rounded-xl border border-blue-500/10 hover:border-blue-500/30 transition-all cursor-crosshair">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="text-[10px] font-black text-white truncate pr-2 uppercase">{f.objectType}</span>
                                        <span className="text-[8px] font-bold text-blue-400 shrink-0">{f.broadperiod}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-[8px] font-black text-slate-500 tracking-tighter font-mono">{f.id}</span>
                                        <span className="text-[8px] font-bold text-slate-400">{f.county}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <p className="text-[10px] text-slate-500 font-bold uppercase italic leading-tight">No PAS records loaded. Click scan to fetch data.</p>
                )}
            </div>

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

      {/* PAS Specimen Card Modal */}
      {selectedPASFind && (
          <div className="absolute inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
              <div className="bg-slate-900 border border-blue-500/30 w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
                  <div className="relative h-32 bg-blue-600/20 flex items-center justify-center border-b border-white/5">
                      <div className="absolute top-4 right-4">
                        <button onClick={() => setSelectedPASFind(null)} className="p-2 bg-black/40 hover:bg-black/60 rounded-full text-white transition-all border border-white/10">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" x2="18" y1="18"></line>
                            </svg>
                        </button>
                      </div>
                      <div className="flex flex-col items-center">
                        <div className="w-12 h-12 bg-blue-500 rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(59,130,246,0.5)] mb-2">
                           <span className="text-xl font-black text-white italic">H</span>
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-400">Historic Specimen</span>
                      </div>
                  </div>

                  <div className="p-6 space-y-6">
                      <div className="space-y-1">
                          <h3 className="text-xl font-black text-white uppercase tracking-tight">{selectedPASFind.objectType}</h3>
                          <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 rounded text-[9px] font-black text-blue-400 uppercase tracking-widest">{selectedPASFind.broadperiod}</span>
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">{selectedPASFind.id}</span>
                          </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                          <div className="bg-black/40 p-3 rounded-2xl border border-white/5">
                              <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Source</span>
                              <span className="text-[10px] font-black text-white uppercase italic">Portable Antiquities</span>
                          </div>
                          <div className="bg-black/40 p-3 rounded-2xl border border-white/5">
                              <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Region</span>
                              <span className="text-[10px] font-black text-white uppercase italic">{selectedPASFind.county}</span>
                          </div>
                      </div>

                      <div className="bg-blue-500/5 p-4 rounded-2xl border border-blue-500/10 space-y-2">
                          <div className="flex items-center gap-2">
                              <div className={`w-1.5 h-1.5 rounded-full ${selectedPASFind.isApprox ? "bg-amber-400" : "bg-blue-400"}`} />
                              <p className="text-[11px] font-bold text-slate-300 leading-tight">
                                {selectedPASFind.isApprox 
                                  ? "Approximate location: 1km Parish/Grid centroid." 
                                  : "Coordinates obfuscated to 100m for heritage protection."}
                              </p>
                          </div>
                      </div>

                      <a 
                        href={`https://finds.org.uk/database/artefacts/record/id/${selectedPASFind.internalId || String(selectedPASFind.id || "").replace(/\D/g, '')}`} 
                        target="_blank" 
                        rel="noreferrer"
                        className="flex items-center justify-center gap-2 w-full py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-blue-600/20 active:scale-[0.98]"
                      >
                          View Official PAS Record
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                              <polyline points="15 3 21 3 21 9"></polyline>
                              <line x1="10" y1="14" x2="21" y2="3"></line>
                          </svg>
                      </a>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}
