import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Modal } from "./Modal";
import { db } from "../db";

export function LocationPickerModal(props: {
  initialLat?: number | null;
  initialLon?: number | null;
  onClose: () => void;
  onSelect: (lat: number, lon: number) => void;
}) {
    const mapDivRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const markerRef = useRef<maplibregl.Marker | null>(null);
    
    // Persistence for style switching
    const lastPosition = useRef<{ center: [number, number]; zoom: number } | null>(null);
  
    const [lat, setLat] = useState(props.initialLat || 54.5);
    const [lon, setLon] = useState(props.initialLon || -2.0);
    const [zoom] = useState(props.initialLat ? 16 : 6);
    const [mapStyle, setMapStyle] = useState<"streets" | "satellite">("streets");
    const [showLidar, setShowLidar] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [isSearching, setIsSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);

    async function handleSearch(e: React.FormEvent) {
        e.preventDefault();
        if (!searchQuery.trim()) return;
        setIsSearching(true);
        setSearchError(null);
        try {
            const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1`);
            const data = await resp.json();
            if (data && data.length > 0) {
                const { lat, lon } = data[0];
                const newLat = parseFloat(lat);
                const newLon = parseFloat(lon);
                setLat(newLat);
                setLon(newLon);
                if (mapRef.current) {
                    mapRef.current.flyTo({ center: [newLon, newLat], zoom: 16 });
                }
                if (markerRef.current) {
                    markerRef.current.setLngLat([newLon, newLat]);
                }
            } else {
                setSearchError("Location not found.");
            }
        } catch (err) {
            console.error("Search failed:", err);
        } finally {
            setIsSearching(false);
        }
    }
    
    // Load persistent style
    useEffect(() => {
        db.settings.get("mapStyle").then(s => {
            if (s && ["streets", "satellite"].includes(String(s.value))) {
                setMapStyle(s.value as "streets" | "satellite");
            }
        });
        db.settings.get("showLidar").then(s => setShowLidar(!!s?.value));
    }, []);

    // Save persistent style
    useEffect(() => {
        db.settings.put({ key: "mapStyle", value: mapStyle });
        db.settings.put({ key: "showLidar", value: showLidar });
    }, [mapStyle, showLidar]);
  
    useEffect(() => {
      if (!mapDivRef.current) return;
  
      const style: any = {
          version: 8,
          sources: {},
          layers: [
              {
                  id: "background",
                  type: "background",
                  paint: { "background-color": "#f3f4f6" }
              }
          ]
      };

      // 1. THE BONE BASE (Solid Terrain) - 100% Opaque
      if (showLidar) {
          // Global Fallback
          style.sources["esri-lidar-base"] = {
              type: "raster",
              tiles: ["https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}"],
              tileSize: 256,
              attribution: "© Esri Hillshade",
              maxzoom: 19
          };
          style.layers.push({
              id: "lidar-fallback-layer",
              type: "raster",
              source: "esri-lidar-base",
              paint: { 
                  "raster-contrast": 0.2,
                  "raster-brightness-max": 0.9,
                  "raster-fade-duration": 0
              }
          });

          // High-Detail EA LiDAR
          style.sources["ea-lidar-detail"] = {
              type: "raster",
              tiles: ["https://services.arcgis.com/JJT1S6cy9mS999Xy/arcgis/rest/services/LIDAR_Composite_1m_DTM_2025_Hillshade/MapServer/tile/{z}/{y}/{x}"],
              tileSize: 256,
              attribution: "© Environment Agency",
              maxzoom: 20
          };
          style.layers.push({
              id: "lidar-detail-layer",
              type: "raster",
              source: "ea-lidar-detail",
              paint: { 
                  "raster-opacity": 1.0,
                  "raster-contrast": 0.4,      
                  "raster-brightness-max": 0.9,
                  "raster-fade-duration": 0
              }
          });
          
          // SLOPE OVERDRIVE
          style.layers.push({
            id: "lidar-slope-punch",
            type: "raster",
            source: "ea-lidar-detail",
            paint: { 
                "raster-opacity": 0.5,
                "raster-contrast": 0.8,
                "raster-brightness-max": 0.5,
                "raster-fade-duration": 0
            }
          });
      }

      // 2. THE SKIN (Basemap) - Transparent when LiDAR is ON
      let baseTiles: string[] = [];
      let baseAttribution = "";
      if (mapStyle === "streets") {
          baseTiles = ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"];
          baseAttribution = "© OpenStreetMap";
      } else {
          baseTiles = ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"];
          baseAttribution = "© Esri World Imagery";
      }

      style.sources["base-raster"] = {
          type: "raster",
          tiles: baseTiles,
          tileSize: 256,
          attribution: baseAttribution,
          maxzoom: 22
      };

      style.layers.push({
          id: "base-layer",
          type: "raster",
          source: "base-raster",
          paint: { 
              "raster-fade-duration": 0,
              "raster-opacity": showLidar ? 0.3 : 1.0 
          }
      });

      // 3. Subtle Elevation Tint
      if (showLidar) {
          style.layers.push({
            id: "ea-elevation-tint",
            type: "raster",
            source: "ea-lidar-detail",
            paint: { 
                "raster-opacity": 0.15,
                "raster-hue-rotate": 140,
                "raster-contrast": 0.1
            }
          });
      }
  
      const startCenter: [number, number] = lastPosition.current?.center || [lon, lat];
      const startZoom: number = lastPosition.current?.zoom || zoom;
  
      const map = new maplibregl.Map({
        container: mapDivRef.current,
        style: style,
        center: startCenter,
        zoom: startZoom,
      });
  
      map.on("load", () => {
          map.resize();
      });

      map.on("moveend", () => {
          lastPosition.current = {
              center: [map.getCenter().lng, map.getCenter().lat],
              zoom: map.getZoom()
          };
      });
  

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "top-right");

    const marker = new maplibregl.Marker({ draggable: true })
      .setLngLat([lon, lat])
      .addTo(map);

    marker.on("dragend", () => {
      const lngLat = marker.getLngLat();
      setLat(lngLat.lat);
      setLon(lngLat.lng);
    });

    map.on("click", (e) => {
      marker.setLngLat(e.lngLat);
      setLat(e.lngLat.lat);
      setLon(e.lngLat.lng);
    });

    mapRef.current = map;
    markerRef.current = marker;

    return () => {
        if (mapRef.current) {
            mapRef.current.remove();
            mapRef.current = null;
        }
    };
  }, [mapStyle, showLidar]);

  return (
    <Modal title="Pick Findspot Location" onClose={props.onClose}>
      <div className="grid gap-4 no-print">
        <div className="h-[60vh] rounded-2xl overflow-hidden border-2 border-gray-100 dark:border-gray-800 relative shadow-inner bg-gray-50 dark:bg-black">
          <div ref={mapDivRef} className="absolute inset-0" />
          
          <div className="absolute top-2 left-2 z-10 flex flex-col gap-2 max-w-[calc(100%-80px)]">
            <form onSubmit={handleSearch} className="flex gap-1 bg-white/90 dark:bg-gray-900/90 backdrop-blur p-1 rounded-xl shadow-md border border-gray-200 dark:border-gray-700">
                <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search address..."
                    className="bg-transparent text-xs font-bold px-2 py-1 outline-none w-full sm:w-48 text-gray-800 dark:text-gray-100"
                />
                <button
                    type="submit"
                    disabled={isSearching}
                    className="bg-emerald-600 text-white p-1 rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
                >
                    {isSearching ? "..." : "🔍"}
                </button>
            </form>
            {searchError && (
              <p className="text-xs font-medium text-red-600 bg-white/90 dark:bg-gray-900/90 px-2 py-1 rounded-lg shadow-sm">{searchError}</p>
            )}

            <div className="flex gap-1 bg-white/90 dark:bg-gray-900/90 p-1 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 w-fit">
                <button 
                    onClick={() => setMapStyle("streets")}
                    className={`px-2 py-1 text-[10px] font-bold rounded ${mapStyle === "streets" ? "bg-emerald-600 text-white" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"}`}
                >
                    Streets
                </button>
                <button 
                    onClick={() => setMapStyle("satellite")}
                    className={`px-2 py-1 text-[10px] font-bold rounded ${mapStyle === "satellite" ? "bg-emerald-600 text-white" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"}`}
                >
                    Satellite
                </button>
            </div>

            <div className="flex items-center gap-1 bg-emerald-50/90 dark:bg-emerald-900/90 p-1 rounded-lg shadow-sm border border-emerald-200 dark:border-emerald-800">
                <button 
                    onClick={() => setShowLidar(!showLidar)}
                    className={`px-2 py-1 text-[10px] font-bold rounded whitespace-nowrap ${showLidar ? "bg-emerald-600 text-white" : "text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-800"}`}
                >
                    {showLidar ? "LiDAR ON" : "LiDAR OFF"}
                </button>
                {showLidar && mapStyle === "satellite" && (
                    <span className="text-[8px] text-emerald-800 dark:text-emerald-200 opacity-60 italic px-2 border-l border-emerald-200 dark:border-emerald-800">
                        Tip: Best in Streets
                    </span>
                )}
            </div>
          </div>

          <div className="absolute bottom-2 left-2 right-2 bg-white/90 dark:bg-gray-900/90 p-2 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 text-center pointer-events-none">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600 m-0">Tap map or drag marker to set spot</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-emerald-50/50 dark:bg-emerald-900/10 p-4 rounded-2xl border border-emerald-100 dark:border-emerald-900/30">
          <div className="flex flex-col">
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-1">Selected Coordinates</span>
            <div className="font-mono font-bold text-sm text-gray-800 dark:text-gray-100 flex gap-3">
                <span>{lat.toFixed(6)}</span>
                <span className="opacity-20">|</span>
                <span>{lon.toFixed(6)}</span>
            </div>
          </div>
          <div className="flex gap-3 w-full sm:w-auto">
            <button onClick={props.onClose} className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-bold hover:bg-gray-200 transition-colors text-sm">Cancel</button>
            <button onClick={() => props.onSelect(lat, lon)} className="flex-1 sm:flex-none px-6 py-2 rounded-xl bg-emerald-600 text-white font-bold shadow-md hover:bg-emerald-700 transition-all text-sm">Confirm Location</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
