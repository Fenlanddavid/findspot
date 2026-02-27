import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Modal } from "./Modal";

export function LocationPickerModal(props: {
  initialLat?: number | null;
  initialLon?: number | null;
  onClose: () => void;
  onSelect: (lat: number, lon: number) => void;
}) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  const [lat, setLat] = useState(props.initialLat || 54.5);
  const [lon, setLon] = useState(props.initialLon || -2.0);
  const [zoom] = useState(props.initialLat ? 16 : 6);
  const [mapStyle, setMapStyle] = useState<"streets" | "satellite">("streets");

  useEffect(() => {
    if (!mapDivRef.current) return;

    let tiles: string[] = [];
    let attribution = "";
    
    switch (mapStyle) {
        case "streets":
            tiles = ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"];
            attribution = "© OpenStreetMap";
            break;
        case "satellite":
            tiles = ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"];
            attribution = "© Esri World Imagery";
            break;
    }

    const map = new maplibregl.Map({
      container: mapDivRef.current,
      style: {
        version: 8,
        sources: {
          "raster-tiles": {
            type: "raster",
            tiles: tiles,
            tileSize: 256,
            attribution: attribution
          }
        },
        layers: [{ id: "simple-tiles", type: "raster", source: "raster-tiles", minzoom: 0, maxzoom: 22 }]
      },
      center: [lon, lat],
      zoom: zoom,
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

    return () => map.remove();
  }, [mapStyle]);

  return (
    <Modal title="Pick Findspot Location" onClose={props.onClose}>
      <div className="grid gap-4 no-print">
        <div className="h-[60vh] rounded-2xl overflow-hidden border-2 border-gray-100 dark:border-gray-800 relative shadow-inner bg-gray-50 dark:bg-black">
          <div ref={mapDivRef} className="absolute inset-0" />
          
          <div className="absolute top-2 left-2 z-10 flex gap-1 bg-white/90 dark:bg-gray-900/90 p-1 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
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
