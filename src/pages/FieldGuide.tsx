import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as turf from '@turf/turf';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toOSGridRef } from '../services/gps';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';

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
    aspect?: number; // 0-360 degrees
    relativeElevation?: 'Ridge' | 'Hollow' | 'Slope' | 'Flat';
    metrics?: { circularity: number; density: number; ratio: number; area: number };
    explanationLines?: string[];
    isHighConfidenceCrossing?: boolean;
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
    osmType?: string; // e.g. node, way, relation
}

interface PlaceSignal {
    name: string;
    meaning: string;
    distance: number;
    period: string;
    confidence: number;
    type: string;
}

interface HistoricRoute {
    id: string;
    type: "roman_road" | "historic_trackway" | "holloway" | "green_lane" | "droveway" | "suspected_route";
    source: "osm" | "historic_map_digitised" | "lidar_interpreted" | "manual";
    confidenceClass: "A" | "B" | "C" | "D";
    certaintyScore: number;
    geometry: [number, number][]; // [lat, lon] coordinates
    bbox: [[number, number], [number, number]]; // [[minLon, minLat], [maxLon, maxLat]]
    period?: "roman" | "medieval" | "post-medieval" | "unknown";
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

interface Hotspot {
    id: string;
    number: number;
    score: number; // 0-100 (cap at 98)
    confidence: 'Low Confidence' | 'Developing Signal' | 'Strong Signal' | 'High Probability';
    type: 'Likely Settlement Edge' | 'Water Interaction Zone' | 'Movement Corridor (Likely)' | 'Raised Dry Area (Likely)' | 'General Activity Zone';
    explanation: string[]; // Reasons why it stands out
    center: [number, number];
    bounds: [[number, number], [number, number]]; // [SW, NE]
    memberIds: string[];
    isHighConfidenceCrossing?: boolean;
    metrics: {
        anomaly: number;
        context: number;
        convergence: number;
        behaviour: number;
        penalty: number;
    };
}

export default function FieldGuide({ projectId }: { projectId: string }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [isSatellite, setIsSatellite] = useState(false);
  const [detectedFeatures, setDetectedFeatures] = useState<Cluster[]>([]);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const [historicRoutes, setHistoricRoutes] = useState<HistoricRoute[]>([]);
  const [heritageCount, setHeritageCount] = useState(0);
  const [zoomWarning, setZoomWarning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [systemLog, setSystemLog] = useState<string[]>(["SYSTEM READY. Execute Scan."]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isIntelOpen, setIsIntelOpen] = useState(false);
  const [targetPeriod, setTargetPeriod] = useState<'All' | 'Bronze Age' | 'Roman' | 'Medieval'>('All');
  const [isLocating, setIsLocating] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [showSuggestion, setShowSuggestion] = useState(false);
  const [scanStatus, setScanStatus] = useState<string>("");
  
  const permissions = useLiveQuery(() => db.permissions.where("projectId").equals(projectId).toArray()) || [];
  const fields = useLiveQuery(() => db.fields.where("projectId").equals(projectId).toArray()) || [];

  // PAS & Potential Score State
  const [pasFinds, setPasFinds] = useState<PASFind[]>([]);
  const [selectedPASFind, setSelectedPASFind] = useState<PASFind | null>(null);
  const [loadingPAS, setLoadingPAS] = useState(false);
  const [placeSignals, setPlaceSignals] = useState<PlaceSignal[]>([]);
  const [potentialScore, setPotentialScore] = useState<{
    score: number, 
    reasons: string[],
    breakdown?: {
        terrain: number, // 0-100
        hydro: number,   // 0-100
        historic: number,// 0-100
        signals: number  // 0-100
    }
  } | null>(null);
  const [scanConfidence, setScanConfidence] = useState<'High Probability' | 'Developing Signal' | 'Low Confidence' | null>(null);
  const [monumentPoints, setMonumentPoints] = useState<[number, number][]>([]);
  const [historicMode, setHistoricMode] = useState(false);
  const [historicStripExpanded, setHistoricStripExpanded] = useState(false);
  const [historicLayerToggles, setHistoricLayerToggles] = useState({ lidar: false, os1930: false, os1880: false });
  const [historicLayerVisibility, setHistoricLayerVisibility] = useState({ routes: true, corridors: true, crossings: true, monuments: true, aim: true });
  const [mapClickLabel, setMapClickLabel] = useState<string | null>(null);
  const clickLabelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initLat = parseFloat(searchParams.get('lat') ?? '');
  const initLng = parseFloat(searchParams.get('lng') ?? '');

  const mapContainerRef = useRef<HTMLDivElement>(null);

  const mapRef = useRef<maplibregl.Map | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const addLog = (msg: string) => setSystemLog(prev => [...prev, `> ${msg}`]);

  const clearScan = () => {
    setDetectedFeatures([]);
    setHotspots([]); // Clear all strategic hotspots
    setSelectedHotspotId(null); // Clear active hotspot border
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
    setHistoricRoutes([]);
    setHistoricMode(false);
    setHistoricStripExpanded(false);
    setHistoricLayerToggles({ lidar: false, os1930: false, os1880: false });
    setHistoricLayerVisibility({ routes: true, corridors: true, crossings: true, monuments: true, aim: true });
    setMapClickLabel(null);
    if (mapRef.current) {
        const rSrc = mapRef.current.getSource('historic-routes') as maplibregl.GeoJSONSource;
        if (rSrc) rSrc.setData({ type: 'FeatureCollection', features: [] });
        const aimSrc = mapRef.current.getSource('aim-monuments') as maplibregl.GeoJSONSource;
        if (aimSrc) aimSrc.setData({ type: 'FeatureCollection', features: [] });
        const cSrc = mapRef.current.getSource('corridors') as maplibregl.GeoJSONSource;
        if (cSrc) cSrc.setData({ type: 'FeatureCollection', features: [] });
        const xSrc = mapRef.current.getSource('crossings') as maplibregl.GeoJSONSource;
        if (xSrc) xSrc.setData({ type: 'FeatureCollection', features: [] });
    }
    setSystemLog(["SYSTEM CLEARED. Ready for new scan."]);
  };

  const loadPASFinds = async () => {
    if (!mapRef.current) {
        addLog("ERROR: Map engine not initialized.");
        return;
    }

    const map = mapRef.current;
    const center = map.getCenter();
    const zoom = map.getZoom();

    if (zoom < 10) {
        addLog("ZOOM IN: Historic scan works best at zoom 10+. Pan to your target area.");
        return;
    }

    const bounds = map.getBounds();
    setLoadingPAS(true);
    addLog(`INITIALIZING HERITAGE SCAN @ ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`);

    // Bounding box: use viewport but cap to ~5km radius to keep queries fast
    const maxDelta = 0.045; // ~5km
    const latBuffer = 0.009;
    const lonBuffer = 0.015;
    const west  = Number(Math.max(center.lng - maxDelta, Math.min(bounds.getWest(),  center.lng - lonBuffer)).toFixed(6));
    const south = Number(Math.max(center.lat - maxDelta, Math.min(bounds.getSouth(), center.lat - latBuffer)).toFixed(6));
    const east  = Number(Math.min(center.lng + maxDelta, Math.max(bounds.getEast(),  center.lng + lonBuffer)).toFixed(6));
    const north = Number(Math.min(center.lat + maxDelta, Math.max(bounds.getNorth(), center.lat + latBuffer)).toFixed(6));

    try {
        addLog("STAGE: Running parallel data fetch...");

        // Build all query strings up front
        const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${center.lat}&lon=${center.lng}`;
        const etymologyQuery = `[out:json][timeout:20];(node["place"](${south},${west},${north},${east});way["place"](${south},${west},${north},${east});rel["place"](${south},${west},${north},${east});node["natural"](${south},${west},${north},${east});way["natural"](${south},${west},${north},${east});node["historic"](${south},${west},${north},${east});way["historic"](${south},${west},${north},${east});node["landuse"="farmyard"](${south},${west},${north},${east});way["landuse"="farmyard"](${south},${west},${north},${east});node["standing_remains"](${south},${west},${north},${east});way["standing_remains"](${south},${west},${north},${east}););out center;`;
        const heritageQuery = `[out:json][timeout:20];(node["historic"](around:2000,${center.lat},${center.lng});way["historic"](around:2000,${center.lat},${center.lng});node["heritage"](around:2000,${center.lat},${center.lng});way["heritage"](around:2000,${center.lat},${center.lng});node["archaeological_site"](around:2000,${center.lat},${center.lng});way["archaeological_site"](around:2000,${center.lat},${center.lng});node["standing_remains"](around:2000,${center.lat},${center.lng});way["standing_remains"](around:2000,${center.lat},${center.lng}););out center;`;
        const routeQuery = `[out:json][timeout:20];(way["historic"="roman_road"](around:2000,${center.lat},${center.lng});way["roman_road"="yes"](around:2000,${center.lat},${center.lng});way["historic"="trackway"](around:2000,${center.lat},${center.lng});way["holloway"="yes"](around:2000,${center.lat},${center.lng}););out geom;`;
        const nhleUrl = `https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/6/query?where=1%3D1&geometry=${west},${south},${east},${north}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&f=geojson&outFields=Name,ListEntry`;
        const aimUrl = `https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/HE_AIM_data/FeatureServer/1/query?where=1%3D1&geometry=${west},${south},${east},${north}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&f=geojson&outFields=MONUMENT_TYPE,PERIOD,EVIDENCE_1`;
        const overpassBase = `https://overpass-api.de/api/interpreter?data=`;

        // Fire everything in parallel
        const [geoData, etymData, osmData, nhleData, aimData, routeData] = await Promise.all([
            fetch(nominatimUrl).then(r => r.json()).catch(() => null),
            fetch(overpassBase + encodeURIComponent(etymologyQuery)).then(r => r.json()).catch(() => null),
            fetch(overpassBase + encodeURIComponent(heritageQuery)).then(r => r.json()).catch(() => null),
            fetch(nhleUrl).then(r => r.json()).catch(() => ({ features: [] })),
            fetch(aimUrl).then(r => r.json()).catch(() => ({ features: [] })),
            historicRoutes.length === 0
                ? fetch(overpassBase + encodeURIComponent(routeQuery)).then(r => r.json()).catch(() => null)
                : Promise.resolve(null),
        ]);

        // 1. Location
        if (geoData?.address) {
            const parish = geoData.address.parish || geoData.address.village || geoData.address.town || "Unknown Parish";
            const county = geoData.address.county || geoData.address.state_district || "Unknown County";
            const fullGrid = toOSGridRef(center.lat, center.lng);
            const parts = fullGrid.split(' ');
            const fourFigure = parts.length === 3 ? `${parts[0]} ${parts[1].substring(0, 2)}${parts[2].substring(0, 2)}` : fullGrid;
            addLog(`LOCATION: ${parish}, ${county} [${fourFigure}]`);
        }

        // 2. Etymology signals
        let discoveredSignals: PlaceSignal[] = [];
        if (etymData?.elements) {
            const signals: PlaceSignal[] = [];
            etymData.elements.forEach((el: any) => {
                const name = el.tags?.name || "";
                if (!name) return;
                const lat = el.lat || el.center?.lat;
                const lon = el.lon || el.center?.lon;
                if (!lat || !lon) return;
                ETYMOLOGY_SIGNALS.forEach(sig => {
                    if (name.toLowerCase().includes(sig.pattern.toLowerCase())) {
                        const typeValue = el.tags?.historic || el.tags?.heritage || el.tags?.place || el.tags?.natural || el.tags?.landuse || el.tags?.standing_remains || "Location";
                        signals.push({ name, meaning: sig.meaning, distance: getDistancePAS(center.lat, center.lng, lat, lon), period: sig.period, confidence: sig.confidence, type: String(typeValue) });
                    }
                });
            });
            discoveredSignals = signals.sort((a, b) => b.confidence - a.confidence);
            setPlaceSignals(discoveredSignals);
            if (discoveredSignals.length > 0) addLog(`ETYMOLOGY: ${discoveredSignals.length} place-name signal${discoveredSignals.length !== 1 ? 's' : ''} detected.`);
        }

        // 3. OSM Heritage features
        let mappedFinds: PASFind[] = [];
        if (osmData?.elements) {
            mappedFinds = osmData.elements.map((el: any) => {
                const lat = el.lat || el.center?.lat;
                const lon = el.lon || el.center?.lon;
                if (!lat || !lon) return null;
                const type = el.tags?.historic || el.tags?.archaeological_site || el.tags?.heritage || el.tags?.standing_remains || el.tags?.site_type || "Heritage Site";
                const name = el.tags?.name;
                const dist = getDistancePAS(center.lat, center.lng, lat, lon);
                const inViewport = lat >= south && lat <= north && lon >= west && lon <= east;
                if (!inViewport && dist > 2) return null;
                const descriptiveType = name ? `${name} (${type})` : type;
                return { id: `OSM-${el.id}`, internalId: String(el.id), objectType: String(descriptiveType).charAt(0).toUpperCase() + String(descriptiveType).slice(1), broadperiod: el.tags?.period || "Unknown", county: "Local Area", workflow: "PAS" as const, lat, lon, isApprox: false, osmType: el.type };
            }).filter((f: any) => f !== null);
            setPasFinds(mappedFinds);
            addLog(`HERITAGE: ${mappedFinds.length} OSM feature${mappedFinds.length !== 1 ? 's' : ''} found within 2km.`);
        }
        calculatePotentialScore(mappedFinds, monumentPoints, discoveredSignals);

        // 4. NHLE scheduled monuments
        if (nhleData?.features?.length > 0) {
            const mPoints: [number, number][] = nhleData.features.map((f: any) => {
                if (f.geometry?.type === 'Point') return f.geometry.coordinates;
                if (f.geometry?.type === 'Polygon') return f.geometry.coordinates[0][0];
                if (f.geometry?.type === 'MultiPolygon') return f.geometry.coordinates[0][0][0];
                return [0, 0];
            });
            setMonumentPoints(mPoints);
            setHeritageCount(nhleData.features.length);
            const mSrc = map.getSource('monuments') as maplibregl.GeoJSONSource | undefined;
            if (mSrc) mSrc.setData(nhleData);
            addLog(`NHLE: ${nhleData.features.length} scheduled monument${nhleData.features.length !== 1 ? 's' : ''} found.`);
        } else {
            addLog("NHLE: No scheduled monuments in this area.");
        }

        // 5. AIM aerial archaeology
        if (aimData?.features?.length > 0) {
            const aimSrc = map.getSource('aim-monuments') as maplibregl.GeoJSONSource | undefined;
            if (aimSrc) aimSrc.setData(aimData);
            addLog(`AIM: ${aimData.features.length} aerial monument${aimData.features.length !== 1 ? 's' : ''} mapped.`);
        }

        // 6. Historic routes (only if not already loaded)
        if (routeData?.elements?.length > 0) {
            const fetchedRoutes: HistoricRoute[] = routeData.elements
                .filter((el: any) => el.geometry?.length >= 2)
                .map((el: any) => {
                    const geom: [number, number][] = el.geometry.map((g: any) => [g.lon, g.lat]);
                    const lons = geom.map((g: [number,number]) => g[0]);
                    const lats = geom.map((g: [number,number]) => g[1]);
                    return {
                        id: `route-${el.id}`,
                        type: (el.tags.historic === 'roman_road' || el.tags.roman_road === 'yes') ? 'roman_road' as const : 'historic_trackway' as const,
                        source: 'osm' as const,
                        confidenceClass: 'B' as const,
                        certaintyScore: 70,
                        geometry: geom,
                        bbox: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]] as [[number,number],[number,number]],
                        period: el.tags.historic === 'roman_road' ? 'roman' as const : 'unknown' as const
                    };
                });
            setHistoricRoutes(fetchedRoutes);
            if (fetchedRoutes.length > 0) addLog(`ROUTES: ${fetchedRoutes.length} historic route segment${fetchedRoutes.length !== 1 ? 's' : ''} found.`);
        } else if (historicRoutes.length === 0) {
            addLog("ROUTES: No historic routes found nearby.");
        }

    } catch (e) {
        addLog("HERITAGE SCAN FAILED.");
        console.error(e);
    } finally {
        setLoadingPAS(false);
    }
  };


  const calculatePotentialScore = (pas: PASFind[], monuments: [number, number][], signals: PlaceSignal[]) => {
    if (!mapRef.current) return;
    const center = mapRef.current.getCenter();
    const reasons: string[] = [];

    // 1. Terrain/Anomaly Potential (Derived from general surroundings)
    let terrainPoints = 20; // Base terrain potential

    // 2. Hydrology Strength
    const nearbyHydroSignals = signals.filter(s => (s.type.includes('stream') || s.type.includes('river') || s.type.includes('water')) && s.distance < 1.0);
    const hydroScore = Math.min(100, nearbyHydroSignals.length * 30 + 10);
    if (nearbyHydroSignals.length > 0) reasons.push("Strategic water proximity");

    // 3. Historic Proximity (OSM + NHLE)
    const nearbyHeritage = pas.filter(f => getDistancePAS(center.lat, center.lng, f.lat, f.lon) < 1.5);
    const nearbyMonuments = monuments.filter(m => getDistancePAS(center.lat, center.lng, m[1], m[0]) < 0.6);
    
    let historicPoints = 0;
    if (nearbyHeritage.length >= 3) historicPoints += 45;
    else if (nearbyHeritage.length > 0) historicPoints += 25;
    if (nearbyMonuments.length > 0) historicPoints += 35;

    if (nearbyHeritage.length > 0) reasons.push(`${nearbyHeritage.length} historic features nearby`);
    if (nearbyMonuments.length > 0) reasons.push("Adjacent to Scheduled Monument");

    // 4. Etymological Signals (with RARITY WEIGHTING & DISTANCE DECAY)
    let signalPoints = 0;
    const nearbySignals = signals.filter(s => s.distance < 2.0);
    
    nearbySignals.forEach(s => {
        // Rarity Weighting Logic
        let weight = 1.0;
        if (s.name.toLowerCase().includes('chester') || s.name.toLowerCase().includes('caster')) weight = 2.0; // Roman Fort (Rare)
        else if (s.name.toLowerCase().includes('bury') || s.name.toLowerCase().includes('burgh')) weight = 1.5; // Fortified (Strong)
        else if (s.name.toLowerCase().includes('field') || s.name.toLowerCase().includes('acre')) weight = 0.8; // Common land (Common)
        
        // 5. ETYMOLOGY ENGINE → ADD DISTANCE DECAY
        let distFactor = 1.0;
        if (s.distance < 0.5) distFactor = 1.0;
        else if (s.distance < 1.5) distFactor = 0.5;
        else distFactor = 0.2;

        signalPoints += Math.round(s.confidence * 20 * weight * distFactor);
    });
    signalPoints = Math.min(100, signalPoints);

    if (nearbySignals.length > 0) {
        const bestSignal = [...nearbySignals].sort((a, b) => b.confidence - a.confidence)[0];
        reasons.push(`Local signal: ${bestSignal.name} (${bestSignal.meaning})`);
    }

    // CALCULATE FINAL WEIGHTED SCORE
    const finalScore = Math.min(98, Math.max(15, (terrainPoints * 0.2) + (hydroScore * 0.2) + (historicPoints * 0.4) + (signalPoints * 0.2)));

    setPotentialScore({ 
        score: Math.round(finalScore), 
        reasons,
        breakdown: {
            terrain: terrainPoints,
            hydro: hydroScore,
            historic: Math.min(100, historicPoints),
            signals: signalPoints
        }
    });

    // 4. DATA DESERT LOGIC → UPDATE
    // Low confidence if no historical support AND only terrain anomalies
    let confidence: 'High Probability' | 'Developing Signal' | 'Low Confidence' = 'Developing Signal';
    const hasHistoricSupport = historicPoints > 0 || signalPoints > 15;
    
    if (hasHistoricSupport && (pas.length + signals.length) > 5) confidence = 'High Probability';
    else if (!hasHistoricSupport) confidence = 'Low Confidence'; // Data Desert (Terrain only)
    
    setScanConfidence(confidence);
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
        sources: {
            'osm': { type: 'raster', tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '&copy; OSM' },
            'satellite': { type: 'raster', tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'Esri' },
            'overlay-lidar': { type: 'raster', tiles: ['https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m-2022/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=true&LAYERS=Lidar_Composite_Hillshade_DTM_1m&CRS=EPSG%3A3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}'], tileSize: 256, attribution: 'Environment Agency (OGL)' },
            'overlay-os1930': { type: 'raster', tiles: ['https://mapseries-tilesets.s3.amazonaws.com/os/6inchsecond/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 6, maxzoom: 16, attribution: '&copy; National Library of Scotland' },
            'overlay-os1880': { type: 'raster', tiles: ['https://mapseries-tilesets.s3.amazonaws.com/1inch_2nd_ed/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 6, maxzoom: 15, attribution: '&copy; National Library of Scotland' }
        },
        layers: [
            { id: 'osm', type: 'raster', source: 'osm', minzoom: 0, maxzoom: 19, layout: { visibility: isSatellite ? 'none' : 'visible' } },
            { id: 'satellite', type: 'raster', source: 'satellite', minzoom: 0, maxzoom: 19, layout: { visibility: isSatellite ? 'visible' : 'none' } },
            { id: 'overlay-lidar', type: 'raster', source: 'overlay-lidar', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.8, 'raster-contrast': 0.3, 'raster-brightness-max': 0.9, 'raster-fade-duration': 0 } },
            { id: 'overlay-os1880', type: 'raster', source: 'overlay-os1880', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 } },
            { id: 'overlay-os1930', type: 'raster', source: 'overlay-os1930', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 } }
        ]
      },
      center: [-2.0, 54.5],
      zoom: 5.5,
      clickTolerance: 40,
    });

    map.on('load', () => {
        map.addSource('monuments', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'monuments-fill', type: 'fill', source: 'monuments', paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.25 } });
        map.addLayer({ id: 'monuments-outline', type: 'line', source: 'monuments', paint: { 'line-color': '#ef4444', 'line-width': 3 } });

        // AIM aerial archaeology polygons (orange — distinct from NHLE red)
        map.addSource('aim-monuments', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'aim-fill', type: 'fill', source: 'aim-monuments', layout: { visibility: 'none' }, paint: { 'fill-color': '#f97316', 'fill-opacity': 0.2 } });
        map.addLayer({ id: 'aim-outline', type: 'line', source: 'aim-monuments', layout: { visibility: 'none' }, paint: { 'line-color': '#f97316', 'line-width': 2, 'line-opacity': 0.8 } });
        
        map.addSource('hotspots-overlay', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ 
            id: 'hotspots-outline', 
            type: 'line', 
            source: 'hotspots-overlay', 
            paint: { 
                'line-color': [
                    'case',
                    ['>=', ['get', 'score'], 80], '#f59e0b', // Priority
                    ['>=', ['get', 'score'], 45], '#10b981', // Moderate/High
                    '#3b82f6' // Low/Possible
                ],
                'line-width': 4, 
                'line-opacity': 1.0
            } 
        });
        map.addLayer({ 
            id: 'hotspots-fill', 
            type: 'fill', 
            source: 'hotspots-overlay', 
            paint: { 
                'fill-color': [
                    'case',
                    ['>=', ['get', 'score'], 80], '#f59e0b',
                    ['>=', ['get', 'score'], 45], '#10b981',
                    '#3b82f6'
                ],
                'fill-opacity': 0.15
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
            layout: { visibility: 'none' },
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
                addLog(`HERITAGE: ${props.objectType} - ${props.id}`);
                setSelectedPASFind({
                    id: props.id,
                    internalId: String(props.internalId || ""),
                    objectType: props.objectType,
                    broadperiod: props.broadperiod,
                    county: props.county,
                    workflow: "PAS",
                    lat: Number(props.lat),
                    lon: Number(props.lon),
                    isApprox: !!props.isApprox,
                    osmType: props.osmType
                });
            }
        });

        map.addSource('historic-routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        // Roman road casing (white contrast border)
        map.addLayer({
            id: 'historic-routes-roman-casing',
            type: 'line',
            source: 'historic-routes',
            filter: ['==', ['get', 'type'], 'roman_road'],
            layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#ffffff', 'line-width': 10, 'line-opacity': 0.35 }
        });
        // Roman roads — solid blue, thick
        map.addLayer({
            id: 'historic-routes-roman',
            type: 'line',
            source: 'historic-routes',
            filter: ['==', ['get', 'type'], 'roman_road'],
            layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#3b82f6', 'line-width': 5, 'line-opacity': 0.97 }
        });
        // Trackway casing
        map.addLayer({
            id: 'historic-routes-trackway-casing',
            type: 'line',
            source: 'historic-routes',
            filter: ['!=', ['get', 'type'], 'roman_road'],
            layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.2 }
        });
        // Historic trackways — dashed lighter blue
        map.addLayer({
            id: 'historic-routes-trackway',
            type: 'line',
            source: 'historic-routes',
            filter: ['!=', ['get', 'type'], 'roman_road'],
            layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#93c5fd', 'line-width': 3, 'line-opacity': 0.95, 'line-dasharray': [5, 4] }
        });

        // Movement corridors — buffer zones around historic routes
        map.addSource('corridors', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
            id: 'corridors-fill',
            type: 'fill',
            source: 'corridors',
            layout: { visibility: 'none' },
            paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 }
        });
        map.addLayer({
            id: 'corridors-outline',
            type: 'line',
            source: 'corridors',
            layout: { visibility: 'none', 'line-join': 'round' },
            paint: { 'line-color': ['get', 'color'], 'line-width': 1, 'line-opacity': 0.3, 'line-dasharray': [3, 3] }
        });

        // Route crossings — high-value intersection points
        map.addSource('crossings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
            id: 'crossings-halo',
            type: 'circle',
            source: 'crossings',
            layout: { visibility: 'none' },
            paint: { 'circle-radius': 14, 'circle-color': '#f59e0b', 'circle-opacity': 0.25, 'circle-stroke-width': 0 }
        });
        map.addLayer({
            id: 'crossings-circle',
            type: 'circle',
            source: 'crossings',
            layout: { visibility: 'none' },
            paint: { 'circle-radius': 6, 'circle-color': '#f59e0b', 'circle-opacity': 0.95, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' }
        });

        map.on('click', 'hotspots-fill', (e) => {
            if (e.features?.[0]) {
                setShowSuggestion(false);
                setSelectedHotspotId(e.features[0].properties?.id);
            }
        });

        map.on('click', (e) => {
            // Only clear if no relevant layers were hit
            const features = map.queryRenderedFeatures(e.point, { layers: ['targets-circle', 'pas-circles', 'hotspots-fill'] });
            if (features.length > 0) return;

            setShowSuggestion(false);
            setSelectedHotspotId(null);
            setSelectedId(null);
        });
        
        map.on('dragstart', () => setShowSuggestion(false));
        
        map.on('move', () => {
            const z = map.getZoom();
            setZoomWarning(z > 16.5);
        });

        // Historic layer click labels
        const showLabel = (label: string) => {
            if (clickLabelTimer.current) clearTimeout(clickLabelTimer.current);
            setMapClickLabel(label);
            clickLabelTimer.current = setTimeout(() => setMapClickLabel(null), 3000);
        };
        map.on('click', 'historic-routes-roman', () => showLabel('Roman Road'));
        map.on('click', 'historic-routes-trackway', () => showLabel('Historic Trackway'));
        map.on('click', 'corridors-fill', (e) => {
            const type = e.features?.[0]?.properties?.type;
            showLabel(type === 'roman_road' ? 'Roman Road Corridor' : 'Historic Trackway Corridor');
        });
        map.on('click', 'crossings-circle', (e) => {
            const p = e.features?.[0]?.properties as any;
            const a = p?.typeA === 'roman_road' ? 'Roman Road' : 'Trackway';
            const b = p?.typeB === 'roman_road' ? 'Roman Road' : 'Trackway';
            showLabel(`Route Crossing: ${a} × ${b}`);
        });
        map.on('click', 'monuments-fill', (e) => {
            const name = e.features?.[0]?.properties?.Name;
            showLabel(name ? `Scheduled Monument: ${name}` : 'Scheduled Monument');
        });
        map.on('click', 'aim-fill', (e) => {
            const p = e.features?.[0]?.properties as any;
            const type = p?.MONUMENT_TYPE || 'Aerial Monument';
            const period = p?.PERIOD ? ` · ${p.PERIOD}` : '';
            showLabel(`${type}${period}`);
        });

        if (!isNaN(initLat) && !isNaN(initLng)) {
            map.flyTo({ center: [initLng, initLat], zoom: 14 });
        }

        setTimeout(() => map.resize(), 300);
    });

    mapRef.current = map;
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    if (map.getLayer('osm')) map.setLayoutProperty('osm', 'visibility', isSatellite ? 'none' : 'visible');
    if (map.getLayer('satellite')) map.setLayoutProperty('satellite', 'visibility', isSatellite ? 'visible' : 'none');
  }, [isSatellite]);

  useEffect(() => {
    if (mapRef.current) {
        const hotspotGeoJSON = {
            type: 'FeatureCollection',
            features: hotspots
                .filter(h => h.id === selectedHotspotId) // Only include the selected hotspot
                .map(h => ({
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [[
                        [h.bounds[0][0], h.bounds[0][1]],
                        [h.bounds[1][0], h.bounds[0][1]],
                        [h.bounds[1][0], h.bounds[1][1]],
                        [h.bounds[0][0], h.bounds[1][1]],
                        [h.bounds[0][0], h.bounds[0][1]]
                    ]]
                },
                properties: { id: h.id, type: h.type, score: h.score }
            }))
        };
        const source = mapRef.current.getSource('hotspots-overlay') as maplibregl.GeoJSONSource;
        if (source) source.setData(hotspotGeoJSON as any);
    }
  }, [hotspots, selectedHotspotId]);

  useEffect(() => {
    if (mapRef.current && mapRef.current.getLayer('hotspots-outline')) {
        if (selectedHotspotId) {
            mapRef.current.setFilter('hotspots-outline', ['==', ['get', 'id'], selectedHotspotId]);
        } else {
            mapRef.current.setFilter('hotspots-outline', ['==', ['get', 'id'], '']);
        }
    }
  }, [selectedHotspotId]);

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
    if (historicMode && pasFinds.length === 0 && !loadingPAS) {
        loadPASFinds();
    }
  }, [historicMode]);

  useEffect(() => {
    if (mapRef.current) {
        // Map PAS points with a slight offset for identical coordinates to prevent stacking
        const coordGroups: { [key: string]: number } = {};
        
        const pasGeoJSON = {
            type: 'FeatureCollection',
            features: pasFinds.map(f => {
                const key = `${f.lat.toFixed(4)},${f.lon.toFixed(4)}`;
                const count = coordGroups[key] || 0;
                coordGroups[key] = count + 1;
                
                // Jitter slightly if they are exactly the same
                const jitterLat = f.lat + (count * 0.0001);
                const jitterLon = f.lon + (count * 0.0001);

                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [jitterLon, jitterLat] },
                    properties: { ...f }
                };
            })
        };
        
        let canceled = false;
        const updateSource = () => {
            if (canceled) return;
            const source = mapRef.current?.getSource('pas-finds') as maplibregl.GeoJSONSource;
            if (source) {
                source.setData(pasGeoJSON as any);
            } else if (!mapRef.current?.loaded()) {
                // Map not loaded yet, retry shortly
                setTimeout(updateSource, 500);
            }
        };
        updateSource();
        return () => { canceled = true; };
    }
  }, [pasFinds]);

  // Sync historicRoutes state → route lines, movement corridors, crossing points
  useEffect(() => {
    if (!mapRef.current) return;
    const doUpdate = () => {
        const map = mapRef.current!;

        // 1. Route lines
        const routeSrc = map.getSource('historic-routes') as maplibregl.GeoJSONSource;
        if (routeSrc) {
            routeSrc.setData({
                type: 'FeatureCollection',
                features: historicRoutes.map(r => ({
                    type: 'Feature' as const,
                    geometry: { type: 'LineString' as const, coordinates: r.geometry },
                    properties: { type: r.type, id: r.id }
                }))
            });
        }

        if (historicRoutes.length === 0) {
            const cSrc = map.getSource('corridors') as maplibregl.GeoJSONSource;
            if (cSrc) cSrc.setData({ type: 'FeatureCollection', features: [] });
            const xSrc = map.getSource('crossings') as maplibregl.GeoJSONSource;
            if (xSrc) xSrc.setData({ type: 'FeatureCollection', features: [] });
            return;
        }

        // 2. Movement corridors — buffer each route
        const corridorFeatures: GeoJSON.Feature[] = [];
        for (const r of historicRoutes) {
            try {
                const line = turf.lineString(r.geometry);
                const bufferKm = r.type === 'roman_road' ? 0.3 : 0.15;
                const color = r.type === 'roman_road' ? '#3b82f6' : '#93c5fd';
                const buffered = turf.buffer(line, bufferKm, { units: 'kilometers' });
                if (buffered) {
                    buffered.properties = { routeId: r.id, type: r.type, color };
                    corridorFeatures.push(buffered as GeoJSON.Feature);
                }
            } catch { /* skip malformed geometry */ }
        }
        const corridorSrc = map.getSource('corridors') as maplibregl.GeoJSONSource;
        if (corridorSrc) corridorSrc.setData({ type: 'FeatureCollection', features: corridorFeatures });

        // 3. Crossing detection — find intersections between all route pairs
        const crossingFeatures: GeoJSON.Feature[] = [];
        const seen = new Set<string>();
        for (let i = 0; i < historicRoutes.length; i++) {
            for (let j = i + 1; j < historicRoutes.length; j++) {
                try {
                    const a = turf.lineString(historicRoutes[i].geometry);
                    const b = turf.lineString(historicRoutes[j].geometry);
                    const intersects = turf.lineIntersect(a, b);
                    for (const pt of intersects.features) {
                        const key = pt.geometry.coordinates.map(c => c.toFixed(5)).join(',');
                        if (seen.has(key)) continue;
                        seen.add(key);
                        crossingFeatures.push({
                            ...pt,
                            properties: {
                                typeA: historicRoutes[i].type,
                                typeB: historicRoutes[j].type,
                                label: `${historicRoutes[i].type === 'roman_road' ? 'Roman road' : 'Trackway'} × ${historicRoutes[j].type === 'roman_road' ? 'Roman road' : 'Trackway'}`
                            }
                        });
                    }
                } catch { /* skip */ }
            }
        }
        const crossingSrc = map.getSource('crossings') as maplibregl.GeoJSONSource;
        if (crossingSrc) crossingSrc.setData({ type: 'FeatureCollection', features: crossingFeatures });

        if (crossingFeatures.length > 0) {
            addLog(`CROSSINGS: ${crossingFeatures.length} route intersection${crossingFeatures.length !== 1 ? 's' : ''} detected — high-value targets.`);
        }
    };
    if (mapRef.current.loaded()) doUpdate();
    else mapRef.current.once('load', doUpdate);
  }, [historicRoutes]);

  // historicMode + historicLayerVisibility → toggle which map layers are visible
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const setViz = (id: string, show: boolean) => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none');
    };
    const h = historicMode;
    const v = historicLayerVisibility;
    setViz('pas-circles', h && v.monuments);
    setViz('historic-routes-roman-casing', h && v.routes);
    setViz('historic-routes-roman', h && v.routes);
    setViz('historic-routes-trackway-casing', h && v.routes);
    setViz('historic-routes-trackway', h && v.routes);
    setViz('aim-fill', h && v.aim);
    setViz('aim-outline', h && v.aim);
    setViz('corridors-fill', h && v.corridors);
    setViz('corridors-outline', h && v.corridors);
    setViz('crossings-halo', h && v.crossings);
    setViz('crossings-circle', h && v.crossings);
    setViz('targets-circle', !h);
    setViz('hotspots-outline', !h);
    setViz('hotspots-fill', !h);
  }, [historicMode, historicLayerVisibility]);

  // overlay layer toggles (only active when historicMode is on)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.getLayer('overlay-lidar')) map.setLayoutProperty('overlay-lidar', 'visibility', (historicMode && historicLayerToggles.lidar) ? 'visible' : 'none');
    if (map.getLayer('overlay-os1930')) map.setLayoutProperty('overlay-os1930', 'visibility', (historicMode && historicLayerToggles.os1930) ? 'visible' : 'none');
    if (map.getLayer('overlay-os1880')) map.setLayoutProperty('overlay-os1880', 'visibility', (historicMode && historicLayerToggles.os1880) ? 'visible' : 'none');
  }, [historicLayerToggles, historicMode]);

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
    if (isLocating) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        mapRef.current?.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 16 });
      },
      (err) => {
        setIsLocating(false);
        console.error("GPS Error:", err);
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
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

                        // --- TOPOGRAPHICAL ANALYSIS (PHASE 2) ---
                        if (sourceType.startsWith('terrain')) {
                            const ix = Math.floor(midX), iy = Math.floor(midY);
                            if (ix > 0 && ix < stitchSize - 1 && iy > 0 && iy < stitchSize - 1) {
                                // 1. ASPECT CALCULATION (Slope Direction)
                                const dz_dx = (processed[iy * stitchSize + (ix + 1)] - processed[iy * stitchSize + (ix - 1)]) / 2.0;
                                const dz_dy = (processed[(iy + 1) * stitchSize + ix] - processed[(iy - 1) * stitchSize + ix]) / 2.0;
                                let aspect = Math.atan2(dz_dy, -dz_dx) * (180 / Math.PI);
                                if (aspect < 0) aspect += 360;
                                cluster.aspect = aspect;

                                // 2. RELATIVE ELEVATION (Shelter vs Exposure)
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

  // FAST Flat-surface approximation for segment loops
  const getFlatDistanceSq = (p1: [number, number], p2: [number, number]) => {
      const dx = (p1[0] - p2[0]) * Math.cos(p1[1] * Math.PI / 180);
      const dy = p1[1] - p2[1];
      return (dx * dx + dy * dy) * 12346344456; // Magic constant for squared meters approx in UK
  };

  const getDistanceToLine = (pt: [number, number], line: [number, number][], bbox: [[number, number], [number, number]]) => {
      // 1. QUICK BBOX CHECK (Roughly 100m padding)
      const lat = pt[1], lon = pt[0];
      if (lon < bbox[0][0] - 0.002 || lon > bbox[1][0] + 0.002 || lat < bbox[0][1] - 0.002 || lat > bbox[1][1] + 0.002) {
          return Infinity;
      }

      let minDistSq = Infinity;
      for (let i = 0; i < line.length - 1; i++) {
          const dSq = getDistanceSqToSegment(pt, line[i], line[i+1]);
          if (dSq < minDistSq) minDistSq = dSq;
      }
      return Math.sqrt(minDistSq);
  };

  const getDistanceSqToSegment = (pt: [number, number], p1: [number, number], p2: [number, number]) => {
      const x = pt[0], y = pt[1];
      const x1 = p1[0], y1 = p1[1];
      const x2 = p2[0], y2 = p2[1];
      
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len_sq = dx * dx + dy * dy;
      let param = -1;
      if (len_sq !== 0) {
          param = ((x - x1) * dx + (y - y1) * dy) / len_sq;
      }

      let xx, yy;
      if (param < 0) {
          xx = x1; yy = y1;
      } else if (param > 1) {
          xx = x2; yy = y2;
      } else {
          xx = x1 + param * dx;
          yy = y1 + param * dy;
      }

      const dxFinal = (x - xx) * Math.cos(y * Math.PI / 180);
      const dyFinal = y - yy;
      return (dxFinal * dxFinal + dyFinal * dyFinal) * 12346344456;
  };

  const findConsensus = (rawClusters: Cluster[]): Cluster[] => {
      const merged: Cluster[] = [];
      const thresholdM = 40; 

      for (const c of rawClusters) {
          let found = false;
          for (const m of merged) {
              const dist = getDistance(c.center, m.center);
              
              // 3. VECTOR STITCHING → ADD CONFIDENCE DECAY
              const angleDiff = Math.abs((c.bearing || 0) - (m.bearing || 0));
              const isAligned = angleDiff < 15 || angleDiff > 165; // Similarly oriented
              
              // Confidence Decay for long-distance linking
              const gapLimit = 60;
              const canStitch = isAligned && dist < gapLimit && c.metrics!.ratio > 3.0 && m.metrics!.ratio > 3.0;

              if (dist < thresholdM || canStitch) {
                  // MULTISPECTRAL AGGREGATION
                  c.sources.forEach(src => {
                      if (!m.sources.includes(src)) m.sources.push(src);
                  });
                  if (!m.sources.includes(c.source)) m.sources.push(c.source);
                  
                  // Vector Stitching Upgrade
                  if (canStitch && dist > thresholdM) {
                      m.type = "Linear Pattern Anomaly";
                      // Confidence decay if distance is large
                      m.confidence = dist > 45 ? 'Medium' : 'High';
                  }

                  // 1. CONSENSUS ENGINE → ADD WEIGHTING (CRITICAL)
                  // Reliability Matrix: LiDAR (High), Hydrology (High), Sat (Med-High)
                  const getWeight = (s: string) => {
                      if (s.startsWith('terrain')) return 1.0;
                      if (s === 'hydrology') return 0.9;
                      if (s.startsWith('satellite_summer')) return 0.8;
                      if (s.startsWith('satellite_spring')) return 0.7;
                      return 0.5;
                  };

                  if (c.source === 'terrain') m.center = [c.center[0], c.center[1]];
                  else m.center = [(m.center[0] + c.center[0]) / 2, (m.center[1] + c.center[1]) / 2];
                  
                  // Weighted Potential Update
                  m.findPotential = Math.min(96, m.findPotential + (c.findPotential * 0.4 * getWeight(c.source)));
                  
                  if (c.source === 'hydrology') {
                      m.type = "Ancient Watercourse Signal";
                  }

                  if (m.sources.includes('satellite_summer') && !m.sources.includes('satellite_spring')) {
                      m.type = "Cropmark Signal (Drought Response)";
                      m.findPotential = Math.min(96, m.findPotential + 15);
                  }

                  if (m.sources.length >= 3) m.confidence = 'High';
                  else if (m.sources.length >= 2 && m.confidence === 'Subtle') m.confidence = 'Medium';
                  
                  // CALCULATE PERSISTENCE SCORE
                  let score = (m.sources.length * 15);
                  if (m.sources.includes('terrain') && m.sources.includes('terrain_global')) score += 10;
                  if (m.sources.includes('slope')) score += 5;
                  if (c.scaleTier !== m.scaleTier) score += 20;
                  m.persistenceScore = Math.min(100, (m.persistenceScore || 0) + score);

                  found = true;
                  break;
              }
          }
          if (!found) {
              const initialType = c.source === 'satellite_summer' ? "Cropmark Signal (Drought Response)" : c.type;
              merged.push({ ...c, type: initialType, sources: [c.source], persistenceScore: 25, rescanCount: 1 });
          }
      }
      return merged;
  };

  const analyzeContext = (clusters: Cluster[], routes: HistoricRoute[] = []): Cluster[] => {
      const results = [...clusters];
      const proximityM = 60; // Max distance for "Settlement" grouping

      for (let i = 0; i < results.length; i++) {
          const c = results[i];
          if (!c.explanationLines) c.explanationLines = [];

          const neighbors = results.filter(n => n.id !== c.id && getDistance(c.center, n.center) < proximityM);
          
          if (neighbors.length >= 2) {
              const houses = neighbors.filter(n => n.type.includes('Roundhouse') || n.type.includes('Foundation'));
              const enclosures = neighbors.filter(n => n.type.includes('Enclosure') || n.type.includes('Ring'));
              const ditches = neighbors.filter(n => n.type.includes('Linear') || n.type.includes('Corridor'));

              if (enclosures.length > 0 && houses.length > 0) {
                  c.contextLabel = "Enclosed Settlement / Farmstead";
                  c.findPotential = Math.min(96, c.findPotential + 10);
              } else if (houses.length >= 2) {
                  c.contextLabel = "Habitation Cluster / Settlement Nucleus";
                  c.findPotential = Math.min(96, c.findPotential + 5);
              } else if (ditches.length >= 2) {
                  c.contextLabel = "Organized Field System / Celtic Fields";
              }
          }

          // --- NEW MOVEMENT LOGIC FOR TARGETS ---
          let hasRouteProximity = false;
          for (const route of routes) {
              const dist = getDistanceToLine(c.center, route.geometry, route.bbox);
              if (route.type === 'roman_road' && dist < 150) {
                  c.findPotential = Math.min(96, c.findPotential + 12);
                  c.explanationLines.push("Roman road proximity");
                  if (c.sources.includes('terrain') || c.sources.includes('terrain_global')) {
                      c.explanationLines.push("LiDAR relief agrees with movement corridor");
                  }
                  hasRouteProximity = true;
              } else if (dist < 100) {
                  c.findPotential = Math.min(96, c.findPotential + 7);
                  c.explanationLines.push("Historic route proximity");
                  hasRouteProximity = true;
              }
          }

          if (c.sources.includes('hydrology') && hasRouteProximity) {
              c.explanationLines.push("Near likely crossing point");
              c.isHighConfidenceCrossing = true;
          }

          if (c.polarity === 'Raised' && hasRouteProximity) {
              c.explanationLines.push("Strong route-to-terrain relationship");
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

  const generateHotspots = (clusters: Cluster[], pas: PASFind[], monuments: [number, number][], period: string = 'All', perms: any[] = [], flds: any[] = [], routes: HistoricRoute[] = []): Hotspot[] => {
       const results: Hotspot[] = [];
       const usedIds = new Set<string>();

       for (const c of clusters) {
           if (usedIds.has(c.id)) continue;

           // 2. CLUSTERING RADIUS → MAKE DYNAMIC
           let radiusM = 40; // Default
           if (c.type.includes('Roundhouse') || c.type.includes('Barrow')) radiusM = 20; // Micro features
           else if (c.metrics && c.metrics.ratio > 4) radiusM = 80; // Landscape features (routes/ditches)

           // 1. CLUSTER OVERLAPPING HITS
           const members = clusters.filter(n => !usedIds.has(n.id) && getDistance(c.center, n.center) < radiusM);
           if (members.length === 0) continue;
           members.forEach(m => usedIds.add(m.id));

           // 2. INITIALIZE METRICS
           let anomaly = 0;
           let context = 0;
           let convergence = 0;
           let behaviour = 0;
           let penalty = 0;
           const explanation: string[] = [];

           // A. ANOMALY SCORE (0-40) - WEIGHTED
           const sources = new Set(members.flatMap(m => m.sources));
           const hasLidar = sources.has('terrain') || sources.has('terrain_global');
           const hasSatellite = (sources.has('satellite_spring') || sources.has('satellite_summer')) && !sources.has('terrain');
           const hasHydrology = sources.has('hydrology');

           if (hasLidar) {
               const bestLidar = members.find(m => m.sources.includes('terrain') || m.sources.includes('terrain_global'));
               let lidarScore = bestLidar?.confidence === 'High' ? 18 : (bestLidar?.confidence === 'Medium' ? 10 : 5);
               
               // 1. RELIABILITY MATRIX → ADD INTERACTION WEIGHTING
               if (hasHydrology) { lidarScore += 5; explanation.push("LiDAR + Hydrology correlation"); }
               if (sources.has('satellite_summer')) { lidarScore += 4; explanation.push("LiDAR + Spectral agreement"); }
               
               anomaly += lidarScore;
               explanation.push("Reliable LiDAR relief signature");
           }

           if (hasSatellite) {
               const hasSummer = sources.has('satellite_summer');
               const hasSpring = sources.has('satellite_spring');
               // Weaker combinations: minimal boost for sat+sat alone
               let satScore = (hasSummer && hasSpring) ? 10 : (hasSummer ? 6 : 3);
               anomaly += satScore;
               explanation.push("Spectral vegetation anomaly");
           }

           // B. CONTEXT SCORE (0-20)
           const center = c.center;
           const isRaised = members.some(m => m.polarity === 'Raised');
           if (isRaised) { 
               context += 8; 
               explanation.push("Raised dry footing"); 
               // Interaction Bonus
               if (hasHydrology) { context += 4; explanation.push("Strategic dry point near water"); }
           }

           // C. HYDROLOGY → EXTEND INTO BEHAVIOUR LAYER
           // 2. HYDROLOGY BONUSES → REBALANCE (Base reduced slightly)
           if (hasHydrology) {
               anomaly += 5;
               // Behavioural Hydrology
               if (isRaised) { 
                   // Extra bonus if convergence exists
                   const convergenceBonus = hasLidar ? 4 : 0;
                   behaviour += (6 + convergenceBonus); 
                   explanation.push("Island effect: Dry ground in wet zone"); 
               }
               if (members.some(m => m.type.includes('Corridor'))) {
                   const corridorBonus = hasLidar ? 3 : 0;
                   behaviour += (5 + corridorBonus);
                   explanation.push("Historic river crossing / Ford potential");
               }
           }

           // --- NEW MOVEMENT LOGIC (ROMAN ROADS & TRACKWAYS) ---
           let routeScore = 0;
           let routeReasons: string[] = [];
           let hasRomanProximity = false;
           let hasHistProximity = false;
           let routeCount = 0;

           for (const route of routes) {
               const dist = getDistanceToLine(center, route.geometry, route.bbox);
               if (route.type === 'roman_road') {
                   if (dist < 100) { routeScore += 8; hasRomanProximity = true; routeCount++; }
                   else if (dist < 250) { routeScore += 6; hasRomanProximity = true; routeCount++; }
                   else if (dist < 500) { routeScore += 3; hasRomanProximity = true; routeCount++; }
               } else {
                   if (dist < 75) { routeScore += 5; hasHistProximity = true; routeCount++; }
                   else if (dist < 200) { routeScore += 3; hasHistProximity = true; routeCount++; }
                   else if (dist < 400) { routeScore += 1; hasHistProximity = true; routeCount++; }
               }
           }

           // Junction Bonus
           if (routeCount >= 2) {
               const nearbyRoutes = routes.filter(r => getDistanceToLine(center, r.geometry, r.bbox) < 500);
               const romanCount = nearbyRoutes.filter(r => r.type === 'roman_road').length;
               const histCount = nearbyRoutes.length - romanCount;
               if (romanCount >= 2) { routeScore += 7; routeReasons.push("Near Roman route junction"); }
               else if (romanCount >= 1 && histCount >= 1) { routeScore += 6; routeReasons.push("Near historic route convergence"); }
               else if (histCount >= 2) { routeScore += 4; routeReasons.push("Route junction nearby"); }
           }

           // Water Crossing Bonus
           let isHighConfidenceCrossing = false;
           if (hasHydrology) {
               if (hasRomanProximity) { routeScore += 7; routeReasons.push("Likely Roman water crossing"); isHighConfidenceCrossing = true; }
               else if (hasHistProximity) { routeScore += 5; routeReasons.push("Historic crossing point"); isHighConfidenceCrossing = true; }
           }

           // Dry Island / Raised Ground Bonus
           if (isRaised) {
               if (hasRomanProximity) { routeScore += 6; routeReasons.push("Raised access point beside Roman route"); }
               else if (hasHistProximity) { routeScore += 4; routeReasons.push("Raised ground beside movement corridor"); }
           }

           // Boundary / Slope Break Bonus
           // (Assuming independent signals logic from FieldGuide-testing)
           const independentSignals = [hasLidar, sources.has('satellite_summer'), hasHydrology, isRaised].filter(Boolean).length;
           
           if (routeScore > 0) {
               if (independentSignals === 0) {
                   routeScore = Math.round(routeScore * 0.7); // Downgrade by 30%
               } else if (independentSignals >= 2) {
                   routeScore = Math.round(routeScore * 1.3); // Upgrade by 30%
                   if (hasRomanProximity) routeReasons.push("Confidence boosted by Roman road corridor");
                   else routeReasons.push("Confidence boosted by historic route proximity");
               }
           }

           // Add specific interpretive reasons to explanation
           if (hasRomanProximity && routeScore > 5) explanation.push("Near probable Roman road corridor");
           else if (hasHistProximity && routeScore > 3) explanation.push("Historic movement corridor nearby");
           
           routeReasons.forEach(r => { if (!explanation.includes(r)) explanation.push(r); });
           behaviour += routeScore;

           // D. FALSE POSITIVE PENALTY & NEGATIVE EXPLANATIONS
           members.forEach(m => {
               if (m.disturbanceRisk === 'High') {
                   penalty -= 20;
                   explanation.push("IGNORE: High risk of modern disturbance");
               }
               if (m.metrics && m.metrics.density < 0.05) {
                   penalty -= 10;
                   explanation.push("IGNORE: Uniform/Featureless terrain");
               }
           });

           // FINAL CALCULATION
           const score = Math.min(98, Math.max(0, anomaly + context + convergence + behaviour + penalty));

           // 3. CONFIDENCE BASED ON SIGNAL AGREEMENT (Multi-Source Trust)
           const signalCount = sources.size;
           const hasStrongAgreement = signalCount >= 3;
           const hasModerateAgreement = signalCount >= 2;

           let confidence: Hotspot['confidence'] = 'Low Confidence';
           if (score > 80 && hasStrongAgreement) confidence = 'High Probability';
           else if (score > 60 && hasModerateAgreement) confidence = 'Strong Signal';
           else if (score > 35) confidence = 'Developing Signal';
           
           // Professional Tone: Downgrade if no specific behavioural/context logic support
           if (confidence === 'Strong Signal' && behaviour < 5 && context < 5) confidence = 'Developing Signal';
           if (confidence === 'High Probability' && behaviour < 8) confidence = 'Strong Signal';

           let type: Hotspot['type'] = 'General Activity Zone';
           if (hasHydrology && isRaised) type = 'Raised Dry Area (Likely)';
           else if (members.some(m => m.type.includes('Corridor'))) type = 'Movement Corridor (Likely)';

          // Bounding Box calculation
          let minLon = members[0].center[0], maxLon = members[0].center[0];
          let minLat = members[0].center[1], maxLat = members[0].center[1];
          members.forEach(m => {
              minLon = Math.min(minLon, m.center[0]); maxLon = Math.max(maxLon, m.center[0]);
              minLat = Math.min(minLat, m.center[1]); maxLat = Math.max(maxLat, m.center[1]);
          });

          results.push({
              id: Math.random().toString(36).substring(7),
              number: 0,
              score,
              confidence,
              type,
              explanation: Array.from(new Set(explanation)).slice(0, 4),
              center: [ (minLon + maxLon) / 2, (minLat + maxLat) / 2 ],
              bounds: [[minLon - 0.0004, minLat - 0.0004], [maxLon + 0.0004, maxLat + 0.0004]],
              memberIds: members.map(m => m.id),
              isHighConfidenceCrossing,
              metrics: { anomaly, context, convergence, behaviour, penalty }
          });
      }

      return results
          .filter(h => h.score >= 15)
          .sort((a, b) => b.score - a.score)
          .map((h, i) => ({ ...h, number: i + 1 }));
      };
  const executeScan = async () => {
    if (!mapRef.current || analyzing) return;
    
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

    clearScan();
    setAnalyzing(true);
    setScanStatus("Engine Initiating...");
    addLog(`Engine Initiating (Fixed Z${scanZoom})...`);

    // Use visible bounds for HER to keep it fast
    const qWest = bounds.getWest();
    const qSouth = bounds.getSouth();
    const qEast = bounds.getEast();
    const qNorth = bounds.getNorth();

    const herUrl = `https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/6/query?where=1%3D1&geometry=${qWest},${qSouth},${qEast},${qNorth}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&f=geojson&outFields=Name,ListEntry`;
    
    // START ALL ASYNC FETCHES IN PARALLEL
    const routeQuery = `[out:json][timeout:30];(way["historic"="roman_road"](around:1000, ${center.lat}, ${center.lng});way["roman_road"="yes"](around:1000, ${center.lat}, ${center.lng});way["name"~"Roman Road",i](around:1000, ${center.lat}, ${center.lng});way["historic"="trackway"](around:1000, ${center.lat}, ${center.lng});way["holloway"="yes"](around:1000, ${center.lat}, ${center.lng});way["highway"="track"]["historic"="yes"](around:1000, ${center.lat}, ${center.lng}););out geom;`;
    
    const herPromise = fetch(herUrl).then(r => r.json()).catch(() => ({ features: [] }));
    const routePromise = fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(routeQuery)}`).then(r => r.json()).catch(() => null);
    
    setScanStatus("Scanning Terrain...");
    const terrainTask = scanDataSource('terrain', scanZoom, tX_start, tY_start, bounds, n, { features: [] });
    const terrainGlobalTask = scanDataSource('terrain_global', scanZoom, tX_start, tY_start, bounds, n, { features: [] });
    const slopeTask = scanDataSource('slope', scanZoom, tX_start, tY_start, bounds, n, { features: [] });
    
    setScanStatus("Scanning Hydrology...");
    const hydroTask = scanDataSource('hydrology', scanZoom, tX_start, tY_start, bounds, n, { features: [] });
    
    setScanStatus("Spectral Sampling...");
    const springTask = scanDataSource('satellite_spring', scanZoom, tX_start, tY_start, bounds, n, { features: [] });
    const summerTask = scanDataSource('satellite_summer', scanZoom, tX_start, tY_start, bounds, n, { features: [] });

    try {
        // Wait for all spectral bands and heritage data
        const [
            assetsGeoJSON,
            terrainHits,
            terrainGlobalHits,
            slopeHits,
            hydroHits,
            springHits,
            summerHits
        ] = await Promise.all([
            herPromise,
            terrainTask,
            terrainGlobalTask,
            slopeTask,
            hydroTask,
            springTask,
            summerTask
        ]);

        setScanStatus("Locking Coordinates...");
        setHeritageCount(assetsGeoJSON.features?.length || 0);
        const mPoints: [number, number][] = (assetsGeoJSON.features || []).map((f: any) => {
            if (f.geometry.type === 'Point') return f.geometry.coordinates;
            if (f.geometry.type === 'Polygon') return f.geometry.coordinates[0][0];
            if (f.geometry.type === 'MultiPolygon') return f.geometry.coordinates[0][0][0];
            return [0, 0];
        });
        setMonumentPoints(mPoints);
        if (mapRef.current.getSource('monuments')) {
            (mapRef.current.getSource('monuments') as maplibregl.GeoJSONSource).setData(assetsGeoJSON as any);
        }

        setScanStatus("Syncing Routes...");
        let routes: HistoricRoute[] = [];
        try {
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));
            const rData = await Promise.race([routePromise, timeoutPromise]) as any;
            
            if (rData && rData.elements) {
                routes = rData.elements.map((el: any) => {
                    const geom = el.geometry.map((g: any) => [g.lon, g.lat]);
                    const lons = geom.map((g: any) => g[0]);
                    const lats = geom.map((g: any) => g[1]);
                    return {
                        id: `route-${el.id}`,
                        type: (el.tags.historic === 'roman_road' || el.tags.roman_road === 'yes' || (el.tags.name && el.tags.name.toLowerCase().includes('roman road'))) ? 'roman_road' : 
                              el.tags.holloway === 'yes' ? 'holloway' : 'historic_trackway',
                        source: 'osm',
                        confidenceClass: 'B',
                        certaintyScore: 70,
                        geometry: geom,
                        bbox: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
                        period: (el.tags.historic === 'roman_road' || el.tags.roman_road === 'yes' || (el.tags.name && el.tags.name.toLowerCase().includes('roman road'))) ? 'roman' : 'unknown'
                    };
                });
                setHistoricRoutes(routes);
            } else { routes = historicRoutes; }
        } catch (e) { routes = historicRoutes; }

        setScanStatus("Deep Signal Audit...");
        const aimUrl = `https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/HE_AIM_data/FeatureServer/1/query?where=1%3D1&geometry=${qWest},${qSouth},${qEast},${qNorth}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&inSR=4326&outSR=4326&f=geojson&outFields=MONUMENT_TYPE,PERIOD,EVIDENCE_1`;
        let aimGeoJSON = { type: 'FeatureCollection', features: [] };
        try {
            const aRes = await fetch(aimUrl);
            aimGeoJSON = await aRes.json();
            const aimSrc = mapRef.current?.getSource('aim-monuments') as maplibregl.GeoJSONSource | undefined;
            if (aimSrc && aimGeoJSON.features?.length > 0) {
                aimSrc.setData(aimGeoJSON as any);
                addLog(`AIM: ${aimGeoJSON.features.length} aerial monument${aimGeoJSON.features.length !== 1 ? 's' : ''} mapped in this area.`);
            }
        } catch (e) {}

        const rawCombined = [...terrainHits, ...terrainGlobalHits, ...slopeHits, ...hydroHits, ...springHits, ...summerHits];
        const merged = findConsensus(rawCombined);
        
        const newScanResults = merged.map(c => {
            for (const aim of (aimGeoJSON.features || [])) {
                const aimProps = (aim as any).properties;
                const coords = (aim as any).geometry?.coordinates;
                if (!coords) continue;
                let isMatch = false;
                if ((aim as any).geometry.type === 'Polygon' || (aim as any).geometry.type === 'MultiPolygon') {
                    const rings = (aim as any).geometry.type === 'Polygon' ? [coords] : coords;
                    for (const ring of rings) { if (isPointInPolygon(c.center[1], c.center[0], ring)) { isMatch = true; break; } }
                } else if ((aim as any).geometry.type === 'Point' && getDistance(c.center, coords) < 50) isMatch = true;

                if (isMatch) {
                    if (!c.sources.includes('historic')) c.sources.push('historic');
                    c.aimInfo = { type: aimProps.MONUMENT_TYPE, period: aimProps.PERIOD, evidence: aimProps.EVIDENCE_1 };
                    c.confidence = 'High';
                    c.findPotential = 96;
                    break;
                }
            }
            return c;
        });

        const updatedFeatures: Cluster[] = [];
        newScanResults.forEach(newHit => {
            let anchored = false;
            for (let i = 0; i < updatedFeatures.length; i++) {
                if (getDistance(newHit.center, updatedFeatures[i].center) < 15) {
                    newHit.sources.forEach(s => { if (!updatedFeatures[i].sources.includes(s)) updatedFeatures[i].sources.push(s); });
                    updatedFeatures[i].confidence = newHit.confidence === 'High' ? 'High' : updatedFeatures[i].confidence;
                    anchored = true;
                    break;
                }
            }
            if (!anchored) updatedFeatures.push(newHit);
        });

        const suppressed = suppressDisturbance(updatedFeatures);
        const contextualized = analyzeContext(suppressed, routes)
            .sort((a, b) => b.findPotential - a.findPotential)
            .map((c, i) => ({ ...c, number: i + 1 }));

        const tacticalHotspots = generateHotspots(contextualized, pasFinds, monumentPoints, targetPeriod, permissions, fields, routes);
        setDetectedFeatures(contextualized);
        setHotspots(tacticalHotspots);

        if (!hasScanned && tacticalHotspots.length > 0) {
            setHasScanned(true);
            setShowSuggestion(true);
            setSelectedHotspotId(tacticalHotspots[0].id);
            mapRef.current?.fitBounds(tacticalHotspots[0].bounds as any, { padding: 40 });
        }
        addLog(`Scan Complete. ${tacticalHotspots.length} Hotspots identified.`);
    } catch (e) { addLog("Engine Error."); console.error(e); }
    
    setAnalyzing(false);
    setScanStatus("");
  };

  const HOTSPOT_INTERPRETATION: Record<string, string> = {
    'Likely Settlement Edge': 'Signals suggest activity along a settlement boundary',
    'Water Interaction Zone': 'Signals suggest activity linked to nearby water',
    'Movement Corridor (Likely)': 'Signals suggest past movement through this area',
    'Raised Dry Area (Likely)': 'Slight elevation may indicate favourable settlement or use',
    'General Activity Zone': 'Multiple weak signals suggest dispersed activity',
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] landscape:h-[calc(100vh-100px)] sm:h-[calc(100vh-220px)] bg-slate-950 rounded-3xl overflow-hidden border border-slate-800 shadow-2xl relative">
      <header className="bg-slate-900/80 border-b border-white/5 shrink-0 z-50 backdrop-blur-md">
          {/* Top Row: Overlay Toggles & Search Toggle */}
          <div className="flex justify-between items-center px-4 py-2 pb-3 border-b border-white/5">
              {!isSearchOpen ? (
                  <div className="flex items-center gap-2">
                      <button
                          onClick={() => { if (!historicMode) setHistoricMode(true); setHistoricLayerToggles(p => ({ ...p, lidar: !p.lidar })); }}
                          className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[8px] font-black uppercase tracking-wider transition-all active:scale-95 ${historicLayerToggles.lidar ? 'bg-emerald-500 border-emerald-300 text-white shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 'bg-white/5 border-white/10 text-slate-400'}`}
                      >
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 17l9-14 9 14H3z"/></svg>
                          LiDAR
                      </button>
                      <button
                          onClick={() => { if (!historicMode) setHistoricMode(true); setHistoricLayerToggles(p => ({ ...p, os1880: !p.os1880 })); }}
                          className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[8px] font-black uppercase tracking-wider transition-all active:scale-95 ${historicLayerToggles.os1880 ? 'bg-amber-500 border-amber-300 text-black shadow-[0_0_8px_rgba(245,158,11,0.4)]' : 'bg-white/5 border-white/10 text-slate-400'}`}
                      >
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                          1880 OS
                      </button>
                      <button
                          onClick={() => { if (!historicMode) setHistoricMode(true); setHistoricLayerToggles(p => ({ ...p, os1930: !p.os1930 })); }}
                          className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[8px] font-black uppercase tracking-wider transition-all active:scale-95 ${historicLayerToggles.os1930 ? 'bg-orange-500 border-orange-300 text-black shadow-[0_0_8px_rgba(249,115,22,0.4)]' : 'bg-white/5 border-white/10 text-slate-400'}`}
                      >
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                          1888 OS
                      </button>
                  </div>
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
                  {!historicMode && pasFinds.length === 0 && !loadingPAS && !potentialScore && (
                      <div className="absolute bottom-full left-1 mb-1 pointer-events-none animate-pulse">
                          <span className="text-[7px] font-black text-blue-400/80 uppercase tracking-[0.2em] whitespace-nowrap bg-slate-900/80 px-1.5 py-0.5 rounded border border-blue-500/20">Historic</span>
                      </div>
                  )}
                  <button
                    onClick={() => {
                        if (!historicMode) {
                            clearScan();
                            setHistoricMode(true);
                        } else {
                            setHistoricMode(false);
                            setHistoricStripExpanded(false);
                            setHistoricLayerToggles({ lidar: false, os1930: false, os1880: false });
                        }
                    }}
                    className={`px-4 py-1.5 rounded-lg text-[9px] font-black tracking-widest uppercase border transition-all shadow-lg ${
                        historicMode
                            ? 'bg-blue-500 text-white border-blue-300 shadow-[0_0_18px_rgba(59,130,246,0.6)] ring-2 ring-blue-400/40'
                            : 'bg-blue-600 text-white border-blue-400/50 shadow-[0_0_15px_rgba(37,99,235,0.3)]'
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
                  <button 
                    onClick={findMe} 
                    disabled={isLocating}
                    className="bg-slate-800 text-white px-4 py-1.5 rounded-lg text-[9px] font-black tracking-widest uppercase hover:bg-slate-700 transition-colors disabled:opacity-50"
                  >
                    {isLocating ? '...' : 'GPS'}
                  </button>
                  <button 
                    onClick={executeScan} 
                    disabled={analyzing} 
                    title="Scan area locked to Z16 for precision"
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
            
            {/* Map Layer Toggle */}
            <div className="absolute top-4 right-4 z-[60] flex flex-col gap-2">
                <button
                    onClick={() => setIsSatellite(!isSatellite)}
                    className={`w-10 h-10 flex items-center justify-center rounded-xl border shadow-xl backdrop-blur-md transition-all active:scale-95 ${
                        isSatellite
                        ? 'bg-emerald-500 border-white text-white'
                        : 'bg-slate-900/90 border-white/10 text-slate-300'
                    }`}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="12 2 2 7 12 12 22 7 12 2" />
                        <polyline points="2 17 12 22 22 17" />
                        <polyline points="2 12 12 17 22 12" />
                    </svg>
                </button>
            </div>
            
            {/* Center Reticle */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20">
                <div className="w-10 h-10 border-2 border-emerald-500/50 rounded-full flex items-center justify-center">
                    <div className="w-1 h-1 bg-emerald-500 rounded-full" />
                </div>
            </div>

            {/* Floating Alerts */}
            <div className="absolute top-12 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none w-[90%] max-w-sm">
                {mapClickLabel && (
                    <div className="bg-slate-900/95 text-white px-4 py-1.5 rounded-full text-[9px] font-black tracking-widest uppercase shadow-2xl border border-blue-500/40">
                        {mapClickLabel}
                    </div>
                )}
                {heritageCount > 0 && !historicMode && (
                    <div className="bg-red-600 text-white px-4 py-1.5 rounded-full text-[8px] sm:text-[10px] font-black tracking-widest uppercase shadow-2xl border border-white/20 animate-bounce">
                        ⛔ Scheduled Monument
                    </div>
                )}
                {zoomWarning && !historicLayerToggles.lidar && (
                    <div className="bg-amber-500 text-black px-4 py-1.5 rounded-full text-[8px] sm:text-[10px] font-black tracking-widest uppercase shadow-2xl border border-white/20">
                        ⚠️ MAX SCAN ZOOM
                    </div>
                )}
                {analyzing && (
                    <div className="bg-slate-900/90 text-emerald-400 px-6 py-3 rounded-2xl text-[10px] font-black tracking-[0.2em] uppercase shadow-2xl border border-emerald-500/50 animate-pulse flex items-center gap-3 backdrop-blur-xl">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
                        {scanStatus || 'Scanning Terrain...'}
                    </div>
                )}
            </div>

            {/* Mobile Tactical Tray (Hotspot Selection) */}
            {hotspots.length > 0 && (
                <div className="absolute top-4 left-4 z-[100] lg:hidden pointer-events-none flex flex-col gap-2">
                    <div className="bg-slate-900/90 text-emerald-400 px-3 py-1.5 rounded-xl text-[10px] font-black tracking-widest uppercase shadow-2xl border border-emerald-500/30 backdrop-blur-md w-fit pointer-events-auto flex items-center gap-2">
                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                        Hotspot detected
                    </div>
                    <div className="flex flex-col gap-2 pointer-events-auto max-h-[40vh] overflow-y-auto scrollbar-hide pb-4">
                        {hotspots.slice(0, 3).map(h => (
                            <button
                                key={h.id}
                                onClick={() => {
                                    setShowSuggestion(false);
                                    setSelectedHotspotId(h.id === selectedHotspotId ? null : h.id);
                                    if (h.id !== selectedHotspotId) mapRef.current?.fitBounds(h.bounds as any, { padding: 40 });
                                }}
                                className={`w-14 h-10 flex items-center justify-center rounded-xl border shadow-xl backdrop-blur-md transition-all active:scale-95 flex-shrink-0 ${
                                    selectedHotspotId === h.id
                                    ? 'bg-emerald-500 border-white text-white shadow-[0_0_20px_rgba(16,185,129,0.5)]'
                                    : 'bg-slate-900/90 border-white/10 text-slate-300'
                                }`}
                            >
                                <span className="text-[12px] font-black tracking-tight">{h.score}%</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
            {/* Mobile Hotspot Card Popup */}
            {selectedHotspotId && (
                <div className="absolute bottom-6 left-4 right-4 z-[100] lg:hidden animate-in slide-in-from-bottom-4 duration-300">
                    {hotspots.filter(h => h.id === selectedHotspotId).map(h => (
                        <div key={h.id} className={`p-5 rounded-3xl border-2 shadow-2xl backdrop-blur-xl transition-all ${
                            h.score >= 80 ? 'bg-slate-900/95 border-amber-500/50 shadow-[0_0_40px_rgba(245,158,11,0.2)]' :
                            h.score >= 45 ? 'bg-slate-900/95 border-emerald-500/50' :
                            'bg-slate-900/95 border-white/20'
                        }`}>
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 className="text-lg font-black uppercase tracking-tight leading-none mb-1">Hotspot</h3>
                                    <p className="text-[10px] font-black text-emerald-400 uppercase tracking-wide mb-1">{h.type}</p>
                                    <p className="text-[9px] text-slate-400 italic mb-2 leading-tight">{HOTSPOT_INTERPRETATION[h.type]}</p>
                                    <div className="flex items-center gap-2">
                                        <div className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${
                                            h.score >= 80 ? 'bg-amber-600 text-white shadow-[0_0_10px_rgba(217,119,6,0.3)]' : 
                                            h.score >= 65 ? 'bg-orange-600 text-white' :
                                            h.score >= 45 ? 'bg-emerald-600 text-white' :
                                            'bg-slate-700 text-slate-300'
                                        }`}>
                                            {h.score >= 80 ? 'High Probability' : h.score >= 65 ? 'Strong Signal' : h.score >= 45 ? 'Developing Signal' : 'Possible Anomaly'}
                                        </div>
                                        <div className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${
                                            h.confidence === 'High Probability' ? 'bg-white text-black' : 'bg-black/20 text-white/80'
                                        }`}>
                                            {h.confidence}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4">
                                    {showSuggestion && (
                                        <span className="text-emerald-400 text-[10px] font-black animate-pulse tracking-widest">DETECT HERE</span>
                                    )}
                                    <span className="text-xl font-black text-white/90">{h.score}%</span>
                                    <button onClick={() => setSelectedHotspotId(null)} className="bg-black/20 hover:bg-black/40 text-white rounded-full p-2 transition-colors border border-white/10">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                       <line x1="18" y1="6" x2="6" y2="18"></line>
                                       <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                    </button>
                                </div>
                            </div>

                                    {h.isHighConfidenceCrossing && (
                                    <div className="bg-blue-600/40 p-2 rounded-2xl border border-blue-400 mb-4 animate-pulse">
                                    <p className="m-0 text-xs font-black uppercase text-white text-center tracking-[0.2em]">🌊 Likely historic crossing point</p>
                                    </div>
                                    )}
                            <div className="bg-black/20 rounded-2xl p-4 mb-4">
                                <p className="text-[10px] font-black uppercase tracking-widest text-white/60 mb-3">Why this area stands out:</p>
                                <div className="space-y-2">
                                    {h.explanation.map((reason, idx) => (
                                        <div key={idx} className="flex items-start gap-3">
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                                            <p className="text-xs font-bold text-white leading-tight flex-1">{reason}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                                <div className="bg-white/10 p-2 rounded-xl text-center">
                                    <span className="block text-[7px] uppercase font-bold opacity-60 mb-0.5">Anomaly</span>
                                    <span className="text-[10px] font-black">{h.metrics.anomaly}</span>
                                </div>
                                <div className="bg-white/10 p-2 rounded-xl text-center">
                                    <span className="block text-[7px] uppercase font-bold opacity-60 mb-0.5">Context</span>
                                    <span className="text-[10px] font-black">{h.metrics.context}</span>
                                </div>
                                <div className="bg-white/10 p-2 rounded-xl text-center">
                                    <span className="block text-[7px] uppercase font-bold opacity-60 mb-0.5">Bonus</span>
                                    <span className="text-[10px] font-black text-emerald-400">+{h.metrics.convergence + h.metrics.behaviour}</span>
                                </div>
                            </div>
                            <p className="text-center text-[7px] text-white italic mt-3">Highlights historic activity — not guaranteed finds.</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Mobile Target Card Popup */}
            {selectedId && !selectedHotspotId && (
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
                                    <span className="block text-[8px] uppercase font-bold opacity-70 mb-2">Signal Sources</span>
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
                                        <span className="text-[10px] font-black uppercase tracking-widest">Confidence: {f.confidence}</span>
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

                                {f.isHighConfidenceCrossing && (
                                    <div className="bg-blue-600/40 p-2 rounded-xl border border-blue-400 mb-2 animate-pulse">
                                        <p className="m-0 text-[10px] font-black uppercase text-white text-center tracking-widest">🌊 Likely historic crossing point</p>
                                    </div>
                                )}

                                {f.explanationLines && f.explanationLines.length > 0 && (
                                    <div className="mt-2 mb-3 space-y-1 bg-black/20 p-2 rounded-xl border border-white/5">
                                        {f.explanationLines.map((line, idx) => (
                                            <div key={idx} className="flex items-center gap-1.5">
                                                <div className="w-1 h-1 rounded-full bg-emerald-400 shrink-0" />
                                                <p className="text-[9px] font-bold text-emerald-100/80 leading-tight uppercase italic">{line}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <p className="m-0 text-[10px] font-bold uppercase opacity-80 tracking-wide">
                                    Signal Profile: <span className="font-black">{f.polarity || 'Unknown'}</span>
                                </p>
                                <div className="flex items-center gap-3">
                                    <p className="m-0 text-[10px] font-bold uppercase opacity-80 tracking-wide whitespace-nowrap">
                                        Potential Index:
                                    </p>
                                    <div className="flex-1 h-1.5 bg-black/40 rounded-full overflow-hidden flex items-center">
                                        <div
                                            className="h-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.5)] transition-all duration-1000"
                                            style={{ width: `${f.findPotential}%` }}
                                        />
                                    </div>
                                    <span className="text-[10px] font-black text-white">{Math.round(f.findPotential)}</span>
                                </div>
                                <p className="text-[7px] text-white/40 italic text-right">relative score</p>

                            </div>

                            {f.isProtected && <div className="mt-4 p-1.5 bg-red-600/40 rounded-lg text-[8px] font-black uppercase tracking-widest text-center border border-red-400">⚠️ Protected Monument</div>}
                            <p className="text-center text-[7px] text-white italic mt-3">Highlights historic activity — not guaranteed finds.</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Historic Field Intelligence Banner — top of map, mobile */}
            {historicMode && !isIntelOpen && (
                <div className="absolute top-3 left-3 right-3 z-[90] lg:hidden pointer-events-auto">
                    {historicStripExpanded ? (
                        /* ── Expanded card ── */
                        <div className="bg-black rounded-2xl border border-blue-500/30 shadow-2xl overflow-hidden">
                            {/* Card header */}
                            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                                    <span className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em]">Field Intelligence</span>
                                </div>
                                <button
                                    onClick={() => setHistoricStripExpanded(false)}
                                    className="w-7 h-7 flex items-center justify-center bg-white/5 rounded-lg border border-white/10 text-white active:scale-90"
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                                </button>
                            </div>

                            <div className="p-4 space-y-4 max-h-[55vh] overflow-y-auto">

                                {/* Historic layer visibility toggles */}
                                <div>
                                    <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-2">Historic Layers</p>
                                    <div className="flex flex-wrap gap-2">
                                        {[
                                            { key: 'routes', label: 'Routes' },
                                            { key: 'corridors', label: 'Corridors' },
                                            { key: 'crossings', label: 'Crossings' },
                                            { key: 'monuments', label: 'Monuments' },
                                            { key: 'aim', label: 'AIM' },
                                        ].map(({ key, label }) => (
                                            <button
                                                key={key}
                                                onClick={() => setHistoricLayerVisibility(p => ({ ...p, [key]: !p[key as keyof typeof p] }))}
                                                className={`px-3 py-1.5 rounded-xl border text-[9px] font-black uppercase tracking-wider transition-all active:scale-95 ${
                                                    historicLayerVisibility[key as keyof typeof historicLayerVisibility]
                                                        ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                                                        : 'bg-white/5 border-white/10 text-slate-500'
                                                }`}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Routes found */}
                                {(historicRoutes.length > 0) && (
                                    <div>
                                        <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-2">Routes Detected</p>
                                        {historicRoutes.filter(r => r.type === 'roman_road').length > 0 && (
                                            <div className="flex items-center gap-3 py-2 border-b border-white/5">
                                                <div className="w-8 h-[3px] bg-blue-500 rounded-full shrink-0" />
                                                <span className="text-[10px] font-black text-white uppercase flex-1">Roman road</span>
                                                <span className="text-[9px] text-blue-400 font-black">{historicRoutes.filter(r => r.type === 'roman_road').length} seg.</span>
                                            </div>
                                        )}
                                        {historicRoutes.filter(r => r.type !== 'roman_road').length > 0 && (
                                            <div className="flex items-center gap-3 py-2">
                                                <div className="w-8 border-t-2 border-dashed border-blue-300 shrink-0" />
                                                <span className="text-[10px] font-black text-white uppercase flex-1">Historic trackway</span>
                                                <span className="text-[9px] text-blue-300 font-black">{historicRoutes.filter(r => r.type !== 'roman_road').length} seg.</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Heritage sites */}
                                {pasFinds.length > 0 && (
                                    <div>
                                        <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-2">Heritage Sites ({pasFinds.length})</p>
                                        <div className="space-y-0">
                                            {pasFinds.slice(0, 5).map(f => (
                                                <div
                                                    key={f.id}
                                                    className="flex items-center gap-3 py-2 border-b border-white/5 active:bg-white/5"
                                                    onClick={() => { mapRef.current?.flyTo({ center: [f.lon, f.lat], zoom: 17 }); setHistoricStripExpanded(false); }}
                                                >
                                                    <div className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                                                    <span className="text-[10px] font-bold text-slate-200 truncate flex-1">{f.objectType}</span>
                                                    <span className="text-[8px] text-slate-500 shrink-0">{f.broadperiod}</span>
                                                </div>
                                            ))}
                                            {pasFinds.length > 5 && (
                                                <p className="text-[8px] text-slate-500 text-center font-bold uppercase tracking-widest py-1.5">+{pasFinds.length - 5} more</p>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Place signals */}
                                {placeSignals.length > 0 && (
                                    <div>
                                        <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest mb-2">Place Signals</p>
                                        {placeSignals.slice(0, 2).map((s, i) => (
                                            <div key={i} className="flex items-center gap-2 py-1.5 border-b border-white/5">
                                                <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                                                <span className="text-[9px] font-bold text-slate-300 flex-1">"{s.name}"</span>
                                                <span className="text-[8px] text-slate-500">{s.meaning}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <button
                                    onClick={() => { setIsIntelOpen(true); setHistoricStripExpanded(false); }}
                                    className="w-full py-2.5 bg-blue-500/10 border border-blue-500/30 text-blue-400 text-[9px] font-black uppercase tracking-widest rounded-xl active:bg-blue-500/20"
                                >
                                    Full Intel View
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* ── Collapsed bar ── */
                        <div
                            className="w-full flex items-center gap-2 px-3 py-2.5 bg-slate-950/90 backdrop-blur-xl rounded-2xl border border-blue-500/25 shadow-xl active:scale-[0.98] cursor-pointer"
                            onClick={() => setHistoricStripExpanded(true)}
                        >
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
                            <span className="text-[9px] font-black text-blue-400 uppercase tracking-[0.15em] shrink-0">Historic</span>
                            <span className="text-[9px] text-slate-400 truncate text-left flex-1 min-w-0">
                                {loadingPAS ? 'Scanning...' : (
                                    [
                                        historicRoutes.filter(r => r.type === 'roman_road').length > 0 ? 'Roman road' : null,
                                        historicRoutes.filter(r => r.type !== 'roman_road').length > 0 ? 'Trackway' : null,
                                        pasFinds.length > 0 ? `${pasFinds.length} site${pasFinds.length !== 1 ? 's' : ''}` : null,
                                        placeSignals.length > 0 ? `"${placeSignals[0]?.name}"` : null,
                                    ].filter(Boolean).join(' · ') || 'No features found nearby'
                                )}
                            </span>
                            <button
                                onClick={e => {
                                    e.stopPropagation();
                                    const allOn = Object.values(historicLayerVisibility).every(v => v);
                                    const next = !allOn;
                                    setHistoricLayerVisibility({ routes: next, corridors: next, crossings: next, monuments: next, aim: next });
                                }}
                                className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[8px] font-black uppercase tracking-wider transition-all active:scale-95 shrink-0 ${Object.values(historicLayerVisibility).every(v => v) ? 'bg-blue-500 border-blue-300 text-white shadow-[0_0_8px_rgba(59,130,246,0.4)]' : 'bg-white/5 border-white/10 text-slate-400'}`}
                            >
                                Overlays
                            </button>
                            <svg className="shrink-0 text-slate-500" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                        </div>
                    )}
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

                        {/* Historic Period Summary Grid */}
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
                            <div className="bg-white/5 p-4 rounded-3xl border border-white/10 relative">
                                {scanConfidence && (
                                    <span className={`absolute top-2 right-2 text-[6px] font-black px-1 rounded border ${
                                        scanConfidence === 'High Probability' ? 'text-emerald-400 border-emerald-400/30' :
                                        scanConfidence === 'Developing Signal' ? 'text-amber-400 border-amber-400/30' :
                                        'text-red-400 border-red-400/30'
                                    }`}>
                                        {scanConfidence}
                                    </span>
                                )}
                                <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Terrain Relief</span>
                                <div className="h-1 bg-slate-800 rounded-full overflow-hidden my-1.5">
                                    <div className="h-full bg-emerald-500" style={{ width: `${potentialScore?.breakdown?.terrain || 0}%` }} />
                                </div>
                                <span className="text-lg font-black text-emerald-500">{potentialScore?.breakdown?.terrain || '0'}<span className="text-[10px] text-emerald-500/50 italic">%</span></span>
                            </div>
                            
                            <div className="bg-white/5 p-4 rounded-3xl border border-white/10">
                                <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Hydro Context</span>
                                <div className="h-1 bg-slate-800 rounded-full overflow-hidden my-1.5">
                                    <div className="h-full bg-blue-500" style={{ width: `${potentialScore?.breakdown?.hydro || 0}%` }} />
                                </div>
                                <span className="text-lg font-black text-blue-500">{potentialScore?.breakdown?.hydro || '0'}<span className="text-[10px] text-blue-500/50 italic">%</span></span>
                            </div>

                            <div className="bg-white/5 p-4 rounded-3xl border border-white/10">
                                <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Historic Density</span>
                                <div className="h-1 bg-slate-800 rounded-full overflow-hidden my-1.5">
                                    <div className="h-full bg-amber-500" style={{ width: `${potentialScore?.breakdown?.historic || 0}%` }} />
                                </div>
                                <span className="text-lg font-black text-amber-500">{potentialScore?.breakdown?.historic || '0'}<span className="text-[10px] text-amber-500/50 italic">%</span></span>
                            </div>

                            <div className="bg-white/5 p-4 rounded-3xl border border-white/10">
                                <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Spectral Signals</span>
                                <div className="h-1 bg-slate-800 rounded-full overflow-hidden my-1.5">
                                    <div className="h-full bg-purple-500" style={{ width: `${potentialScore?.breakdown?.signals || 0}%` }} />
                                </div>
                                <span className="text-lg font-black text-purple-500">{potentialScore?.breakdown?.signals || '0'}<span className="text-[10px] text-purple-500/50 italic">%</span></span>
                            </div>
                        </div>

                        {/* Historic Findings Hud List - MOVED UP */}
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

            {/* Historic Site Intelligence Section - Desktop Only */}
            <div className="hidden lg:block p-6 border-b border-white/10 bg-blue-500/5">
                <div className="flex justify-between items-baseline mb-4">
                    <h2 className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em]">Historic Site Intelligence</h2>
                    <button
                        onClick={() => { clearScan(); setHistoricMode(true); }}
                        disabled={loadingPAS}
                        className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded border transition-all ${
                            loadingPAS ? 'bg-slate-800 text-slate-500 border-white/5' :
                            historicMode ? 'bg-amber-500 text-black border-amber-300' :
                            'bg-blue-500/10 text-blue-400 border-blue-500/30 hover:bg-blue-500 hover:text-white'
                        }`}
                    >
                        {loadingPAS ? 'SYNCING...' : historicMode ? 'ACTIVE' : 'SCAN AREA'}
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
                    <p className="text-[10px] text-slate-500 font-bold uppercase italic leading-tight">No historic records loaded. Click scan to fetch data.</p>
                )}
            </div>

            <div className="p-6 border-b border-white/5 shrink-0 overflow-y-auto max-h-[40%] scrollbar-hide">
                <div className="flex justify-between items-baseline mb-4">
                    <h2 className="text-sm font-black text-white uppercase tracking-tighter">Strategic Hotspots</h2>
                    {selectedHotspotId && <button onClick={() => setSelectedHotspotId(null)} className="text-[9px] font-black text-emerald-500 hover:underline tracking-widest uppercase">Clear View</button>}
                </div>
                <div className="flex flex-col gap-4">
                    {hotspots.length > 0 ? hotspots.map(h => (
                        <div 
                            key={h.id} 
                            onClick={() => {
                                setShowSuggestion(false);
                                setSelectedHotspotId(h.id);
                                mapRef.current?.fitBounds(h.bounds as any, { padding: 40 });
                            }}
                            className={`p-4 rounded-2xl border-2 cursor-pointer transition-all active:scale-[0.98] ${
                                selectedHotspotId === h.id ? 'bg-white/10 border-white ring-4 ring-white/10' :
                                h.score >= 80 ? 'bg-slate-900/40 border-amber-500/30 hover:border-amber-500/60 shadow-[0_0_15px_rgba(245,158,11,0.05)]' :
                                h.score >= 45 ? 'bg-slate-900/40 border-emerald-500/30 hover:border-emerald-500/60' :
                                'bg-slate-900/40 border-white/10 hover:border-white/20'
                            }`}
                        >
                            <div className="flex justify-between items-start mb-3">
                                <div>
                                    <h3 className={`text-xs font-black uppercase tracking-tight ${selectedHotspotId === h.id ? 'text-white' : 'text-slate-200'}`}>Hotspot</h3>
                                    <p className="text-[9px] font-black text-emerald-400 uppercase tracking-wide mt-0.5">{h.type}</p>
                                    <p className="text-[8px] text-slate-500 italic leading-tight mt-0.5">{HOTSPOT_INTERPRETATION[h.type]}</p>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <div className="flex items-center gap-2">
                                        {showSuggestion && h.number === 1 && (
                                            <span className="text-[7px] font-black text-emerald-400 animate-pulse tracking-widest">DETECT HERE</span>
                                        )}
                                        <span className="text-[10px] font-black text-emerald-500 tracking-tight">{h.score}%</span>
                                    </div>
                                    <div className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${
                                        h.confidence === 'High Probability' ? 'bg-amber-500 text-black shadow-[0_0_10px_rgba(245,158,11,0.5)]' : 
                                        h.confidence === 'Strong Signal' ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300'
                                    }`}>{h.confidence}</div>
                                </div>
                            </div>

                                {h.isHighConfidenceCrossing && (
                                <div className="bg-blue-600/40 p-1.5 rounded-xl border border-blue-400 mb-3 animate-pulse">
                                   <p className="m-0 text-[9px] font-black uppercase text-white text-center tracking-widest">🌊 Likely historic crossing point</p>
                                </div>
                                )}
                            <div className="space-y-1.5 mt-3">
                                {h.explanation.map((reason, idx) => (
                                    <div key={idx} className="flex items-center gap-2">
                                        <div className="w-1 h-1 rounded-full bg-emerald-500 shrink-0" />
                                        <p className="text-[10px] font-bold text-slate-300 leading-tight">{reason}</p>
                                    </div>
                                ))}
                            </div>
                            <p className="text-center text-[7px] text-white italic mt-3">Highlights historic activity — not guaranteed finds.</p>
                        </div>
                    )) : (
                        <p className="text-[10px] text-slate-500 font-bold uppercase italic text-center py-4">No tactical hotspots defined.</p>
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

                        {f.isHighConfidenceCrossing && (
                            <div className="bg-blue-600/40 p-2 rounded-xl border border-blue-400 mb-2 animate-pulse">
                                <p className="m-0 text-[9px] font-black uppercase text-white text-center tracking-widest">🌊 Likely historic crossing point</p>
                            </div>
                        )}

                        {f.explanationLines && f.explanationLines.length > 0 && (
                            <div className="mt-2 mb-3 space-y-1 bg-black/20 p-2 rounded-xl border border-white/5">
                                {f.explanationLines.map((line, idx) => (
                                    <div key={idx} className="flex items-center gap-1.5">
                                        <div className="w-1 h-1 rounded-full bg-emerald-400 shrink-0" />
                                        <p className="text-[9px] font-bold text-emerald-100/80 leading-tight uppercase italic">{line}</p>
                                    </div>
                                ))}
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
                            <span className={`text-[10px] font-black ${selectedId === f.id ? 'text-white' : (f.sources.length >= 3 ? 'text-amber-400' : f.source === 'terrain' ? 'text-emerald-400' : 'text-sky-400')}`}>Confidence: {f.confidence}</span>
                        </div>

                        {f.isProtected && <div className="mt-3 p-2 bg-white/20 rounded-lg text-[8px] font-black text-white uppercase tracking-widest text-center">⚠️ Protected Monument</div>}
                        <p className="text-center text-[7px] text-white italic mt-3">Highlights historic activity — not guaranteed finds.</p>
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

      {/* Heritage Feature Card Modal */}
      {selectedPASFind && (
          <div className="absolute inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
              <div className="bg-slate-900 border border-emerald-500/30 w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
                  <div className="relative h-32 bg-emerald-600/20 flex items-center justify-center border-b border-white/5">
                      <div className="absolute top-4 right-4">
                        <button onClick={() => setSelectedPASFind(null)} className="p-2 bg-black/40 hover:bg-black/60 rounded-full text-white transition-all border border-white/10">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="18" x2="18" y2="6"></line>
                            </svg>
                        </button>
                      </div>
                      <div className="flex flex-col items-center">
                        <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.5)] mb-2">
                           <span className="text-xl font-black text-white italic">H</span>
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">Heritage Feature</span>
                      </div>
                  </div>

                  <div className="p-6 space-y-6">
                      <div className="space-y-1">
                          <h3 className="text-xl font-black text-white uppercase tracking-tight">{selectedPASFind.objectType}</h3>
                          <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded text-[9px] font-black text-emerald-400 uppercase tracking-widest">{selectedPASFind.broadperiod}</span>
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">{selectedPASFind.id}</span>
                          </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                          <div className="bg-black/40 p-3 rounded-2xl border border-white/5">
                              <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Source</span>
                              <span className="text-[10px] font-black text-white uppercase italic">OSM Heritage</span>
                          </div>
                          <div className="bg-black/40 p-3 rounded-2xl border border-white/5">
                              <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Status</span>
                              <span className="text-[10px] font-black text-white uppercase italic">Standing Remains</span>
                          </div>
                      </div>

                      <div className="bg-emerald-500/5 p-4 rounded-2xl border border-emerald-500/10 space-y-2">
                          <div className="flex items-center gap-2">
                              <div className={`w-1.5 h-1.5 rounded-full bg-emerald-400`} />
                              <p className="text-[11px] font-bold text-slate-300 leading-tight">
                                High-precision coordinates from the OpenStreetMap community heritage dataset.
                              </p>
                          </div>
                      </div>

                      <a 
                        href={`https://www.openstreetmap.org/${selectedPASFind.osmType || 'node'}/${selectedPASFind.internalId}`} 
                        target="_blank" 
                        rel="noreferrer"
                        className="flex items-center justify-center gap-2 w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-600/20 active:scale-[0.98]"
                      >
                          View on OpenStreetMap
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
