import React, { useState, useMemo, useEffect, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, Media } from "../db";
import { useSearchParams } from "react-router-dom";
import { ScaledImage } from "../components/ScaledImage";
import { FindModal } from "../components/FindModal";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const DEFAULT_CENTER: [number, number] = [-2.0, 54.5];
const DEFAULT_ZOOM = 5;

export default function AllFinds(props: { projectId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<"list" | "map">(searchParams.get("view") === "map" ? "map" : "list");
  const filterPeriod = searchParams.get("period");
  const filterType = searchParams.get("type");
  const filterMaterial = searchParams.get("material");
  const filterPending = searchParams.get("filter") === "pending";

  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") ?? "");
  const [openFindId, setOpenFindId] = useState<string | null>(null);

  // --- DATA FETCHING ---
  const finds = useLiveQuery(
    async () => {
      let results = await db.finds.where("projectId").equals(props.projectId).reverse().sortBy("createdAt");
      return results.filter(s => {
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            const matchesSearch = (s.objectType || "").toLowerCase().includes(q) ||
                                 (s.findCode || "").toLowerCase().includes(q) ||
                                 (s.notes || "").toLowerCase().includes(q) ||
                                 (s.period || "").toLowerCase().includes(q) ||
                                 (s.material || "").toLowerCase().includes(q) ||
                                 (s.coinType || "").toLowerCase().includes(q);
            if (!matchesSearch) return false;
        }
        if (filterPeriod && s.period !== filterPeriod) return false;
        if (filterType && !(s.objectType || "").toLowerCase().includes(filterType.toLowerCase()) && !(s.coinType || "").toLowerCase().includes(filterType.toLowerCase())) return false;
        if (filterMaterial && s.material !== filterMaterial) return false;
        if (filterPending && !s.isPending) return false;
        return true;
      });
    },
    [props.projectId, searchQuery, filterPeriod, filterType, filterMaterial, filterPending]
  );

  // --- MAP LOGIC ---
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const lastPos = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const [mapStyleMode, setMapStyleMode] = useState<"streets" | "satellite">("streets");
  const [showLidar, setShowLidar] = useState(false);

  useEffect(() => {
    db.settings.get("searchMapStyle").then(s => s && setMapStyleMode(s.value as "streets" | "satellite"));
    db.settings.get("searchShowLidar").then(s => s && setShowLidar(!!s.value));
  }, []);

  // Create/destroy the map only when entering/leaving map view.
  // Style and LIDAR are toggled in a separate effect to preserve pan/zoom state.
  useEffect(() => {
    if (viewMode !== 'map' || !mapDivRef.current) return;

    const center = lastPos.current?.center || DEFAULT_CENTER;
    const zoom = lastPos.current?.zoom || DEFAULT_ZOOM;

    const map = new maplibregl.Map({
      container: mapDivRef.current,
      style: {
        version: 8,
        sources: {
          osm: { type: "raster", tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256 },
          satellite: { type: "raster", tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], tileSize: 256 },
          lidar: { type: "raster", tiles: ["https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}"], tileSize: 256 },
        },
        layers: [
          { id: "osm-layer", type: "raster", source: "osm", layout: { visibility: "visible" } },
          { id: "satellite-layer", type: "raster", source: "satellite", layout: { visibility: "none" } },
          { id: "lidar-layer", type: "raster", source: "lidar", layout: { visibility: "none" }, paint: { "raster-contrast": 0.2, "raster-opacity": 0.6 } },
        ],
      } as any,
      center,
      zoom,
    });

    map.on('moveend', () => {
        lastPos.current = { center: [map.getCenter().lng, map.getCenter().lat], zoom: map.getZoom() };
    });

    map.on('load', () => {
        map.addSource('finds', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
        map.addLayer({
            id: 'finds-points',
            type: 'circle',
            source: 'finds',
            paint: { 'circle-radius': 7, 'circle-color': '#10b981', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' }
        });
        map.on('click', 'finds-points', (e) => {
            if (e.features?.[0]) setOpenFindId(e.features[0].properties?.id);
        });
    });

    mapRef.current = map;
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [viewMode]);

  // Update base layer style without recreating the map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const isStreets = mapStyleMode === "streets";
    map.setLayoutProperty("osm-layer", "visibility", isStreets && !showLidar ? "visible" : "none");
    map.setLayoutProperty("satellite-layer", "visibility", !isStreets && !showLidar ? "visible" : "none");
    map.setLayoutProperty("lidar-layer", "visibility", showLidar ? "visible" : "none");
    // Show the base map underneath LiDAR at reduced opacity
    if (showLidar) {
      map.setLayoutProperty(isStreets ? "osm-layer" : "satellite-layer", "visibility", "visible");
      map.setPaintProperty(isStreets ? "osm-layer" : "satellite-layer", "raster-opacity", 0.4);
    } else {
      map.setPaintProperty("osm-layer", "raster-opacity", 1.0);
      map.setPaintProperty("satellite-layer", "raster-opacity", 1.0);
    }
  }, [mapStyleMode, showLidar]);

  useEffect(() => {
    if (mapRef.current && mapRef.current.getSource('finds') && finds) {
        const source = mapRef.current.getSource('finds') as maplibregl.GeoJSONSource;
        source.setData({
            type: 'FeatureCollection',
            features: finds.filter(f => f.lat && f.lon).map(f => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [f.lon!, f.lat!] },
                properties: { id: f.id }
            }))
        });
    }
  }, [finds]);

  // --- RENDER HELPERS ---
  const findIds = useMemo(() => finds?.map(s => s.id) ?? [], [finds]);
  const stats = useMemo(() => {
    if (!finds) return null;
    return {
      total: finds.length,
      coins: finds.filter(f => f.objectType.toLowerCase().includes("coin")).length,
      roman: finds.filter(f => f.period === "Roman").length,
    };
  }, [finds]);

  const firstMediaMap = useLiveQuery(async () => {
    if (findIds.length === 0) return new Map<string, Media>();
    const media = await db.media.where("findId").anyOf(findIds).toArray();
    const m = new Map<string, Media>();
    media.sort((a, b) => {
        const aDate = a?.createdAt || "";
        const bDate = b?.createdAt || "";
        return aDate.localeCompare(bDate);
    });
    for (const row of media) if (row.findId && !m.has(row.findId)) m.set(row.findId, row);
    return m;
  }, [findIds]);

  return (
    <div className="max-w-6xl mx-auto pb-10 px-4">
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6 mt-4">
        <div className="flex items-center gap-6">
          <div>
            <h2 className="text-2xl font-black text-gray-800 dark:text-gray-100 tracking-tighter uppercase leading-none">Search Finds</h2>
            <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">Discovery Exploration</p>
          </div>
          <div className="flex bg-gray-200 dark:bg-gray-800 p-1 rounded-2xl shadow-inner shrink-0">
              <button onClick={() => setViewMode("list")} className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${viewMode === 'list' ? 'bg-white dark:bg-emerald-600 shadow-md text-emerald-600 dark:text-white' : 'text-gray-500 hover:text-gray-700'}`}>List</button>
              <button onClick={() => setViewMode("map")} className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${viewMode === 'map' ? 'bg-white dark:bg-emerald-600 shadow-md text-emerald-600 dark:text-white' : 'text-gray-500 hover:text-gray-700'}`}>Map</button>
          </div>
        </div>
        <div className="relative flex-1 max-w-md">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40 text-xs">🔍</span>
            <input type="text" placeholder="Search objects, notes, periods..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl py-2.5 pl-10 pr-4 shadow-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all text-sm" />
        </div>
      </header>

      {stats && stats.total > 0 && (
        <div className="flex gap-3 mb-4 flex-wrap">
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2 text-center shadow-sm">
            <div className="text-lg font-black text-gray-800 dark:text-gray-100">{stats.total}</div>
            <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">Finds</div>
          </div>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2 text-center shadow-sm">
            <div className="text-lg font-black text-emerald-600 dark:text-emerald-400">{stats.coins}</div>
            <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">Coins</div>
          </div>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2 text-center shadow-sm">
            <div className="text-lg font-black text-amber-600 dark:text-amber-400">{stats.roman}</div>
            <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">Roman</div>
          </div>
        </div>
      )}

      {viewMode === 'list' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {finds?.map((s) => {
                const media = firstMediaMap?.get(s.id);
                return (
                    <div key={s.id} onClick={() => setOpenFindId(s.id)} className="group border border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden bg-white dark:bg-gray-800 shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col h-full">
                        <div className="aspect-video bg-gray-100 dark:bg-gray-900 relative border-b border-gray-100 dark:border-gray-700">
                            {media ? <ScaledImage media={media} className="w-full h-full" imgClassName="object-cover" /> : <div className="w-full h-full flex items-center justify-center opacity-30 italic text-xs uppercase font-black">No photo</div>}
                            <div className="absolute top-3 left-3"><span className="font-mono text-[9px] font-bold bg-black/60 backdrop-blur-md text-white px-2 py-1 rounded shadow-sm">{s.findCode}</span></div>
                        </div>
                        <div className="p-5 flex-1 flex flex-col justify-between">
                            <h3 className="text-lg font-black text-gray-800 dark:text-gray-100 group-hover:text-emerald-600 transition-colors line-clamp-1 uppercase tracking-tight">{s.objectType || "Unidentified"}</h3>
                            <div className="flex flex-wrap gap-2 pt-3 mt-auto">
                                <span className="text-[9px] font-black px-2 py-0.5 rounded uppercase border bg-emerald-50 border-emerald-100 text-emerald-700">{s.period}</span>
                                <span className="ml-auto text-[9px] opacity-40 font-black uppercase tracking-widest">{new Date(s.createdAt).toLocaleDateString()}</span>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
      ) : (
        <div className="h-[600px] sm:h-[calc(100vh-250px)] relative border border-gray-200 dark:border-gray-700 rounded-3xl overflow-hidden bg-black shadow-2xl">
            <div ref={mapDivRef} className="absolute inset-0" />
            <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
                <button onClick={() => { const m = mapStyleMode === 'streets' ? 'satellite' : 'streets'; setMapStyleMode(m); db.settings.put({ key: "searchMapStyle", value: m }); }} className="bg-white dark:bg-gray-800 px-4 py-2 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 text-[10px] font-black uppercase tracking-widest">
                    {mapStyleMode === 'streets' ? 'Satellite' : 'Streets'}
                </button>
                <button onClick={() => { const l = !showLidar; setShowLidar(l); db.settings.put({ key: "searchShowLidar", value: l }); }} className={`px-4 py-2 rounded-xl shadow-lg border text-[10px] font-black uppercase tracking-widest transition-colors ${showLidar ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
                    LIDAR {showLidar ? 'ON' : 'OFF'}
                </button>
            </div>
            <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-4 py-2 rounded-xl text-[9px] font-black text-white uppercase tracking-widest border border-white/10">
                {finds?.length ?? 0} Discoveries Located
            </div>
        </div>
      )}

      {openFindId && <FindModal findId={openFindId} onClose={() => setOpenFindId(null)} />}
    </div>
  );
}

