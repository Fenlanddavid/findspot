import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Modal } from "./Modal";

interface BoundaryPickerModalProps {
  initialBoundary?: any; // GeoJSON Polygon
  initialLat?: number | null;
  initialLon?: number | null;
  onClose: () => void;
  onSelect: (boundary: any) => void;
}

export function BoundaryPickerModal({ initialBoundary, initialLat, initialLon, onClose, onSelect }: BoundaryPickerModalProps) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [points, setPoints] = useState<[number, number][]>([]);
  const [mapStyle, setMapStyle] = useState<"streets" | "satellite">("satellite");

  useEffect(() => {
    // Extract points from initial boundary if it exists
    if (initialBoundary && initialBoundary.type === "Polygon" && initialBoundary.coordinates?.[0]) {
      // GeoJSON Polygons have first and last point identical, we'll strip the last one for editing
      const coords = [...initialBoundary.coordinates[0]];
      if (coords.length > 0) coords.pop();
      setPoints(coords);
    }
  }, [initialBoundary]);

  useEffect(() => {
    if (!mapDivRef.current) return;

    const style = mapStyle === "streets" 
      ? "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"
      : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

    const map = new maplibregl.Map({
      container: mapDivRef.current,
      style: {
        version: 8,
        sources: {
          "base": {
            type: "raster",
            tiles: [style],
            tileSize: 256,
            attribution: mapStyle === "streets" ? "© OpenStreetMap" : "© Esri World Imagery"
          }
        },
        layers: [
          { id: "base", type: "raster", source: "base" }
        ]
      },
      center: initialLon && initialLat ? [initialLon, initialLat] : [-2, 54.5],
      zoom: initialLon && initialLat ? 16 : 5,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "top-right");

    map.on("load", () => {
      map.addSource("boundary", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: []
        }
      });

      map.addLayer({
        id: "boundary-fill",
        type: "fill",
        source: "boundary",
        paint: {
          "fill-color": "#10b981",
          "fill-opacity": 0.2
        }
      });

      map.addLayer({
        id: "boundary-outline",
        type: "line",
        source: "boundary",
        paint: {
          "line-color": "#10b981",
          "line-width": 3,
          "line-dasharray": [2, 1]
        }
      });

      map.addLayer({
        id: "boundary-points",
        type: "circle",
        source: "boundary",
        paint: {
          "circle-radius": 6,
          "circle-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#10b981"
        }
      });

      map.on("click", (e) => {
        const newPoint: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        setPoints(prev => [...prev, newPoint]);
      });
    });

    mapRef.current = map;

    return () => map.remove();
  }, [mapStyle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const source = map.getSource("boundary") as maplibregl.GeoJSONSource;
    if (!source) return;

    const features: any[] = [];
    
    if (points.length > 0) {
      // Point features for all corners
      points.forEach((p, i) => {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: p },
          properties: { index: i }
        });
      });

      // Line/Polygon feature
      if (points.length >= 2) {
        const coords = [...points];
        if (points.length >= 3) {
          coords.push(points[0]); // Close it
          features.push({
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [coords] },
            properties: {}
          });
        } else {
          features.push({
            type: "Feature",
            geometry: { type: "LineString", coordinates: coords },
            properties: {}
          });
        }
      }
    }

    source.setData({
      type: "FeatureCollection",
      features
    });
  }, [points]);

  function handleSave() {
    if (points.length < 3) {
      alert("Please plot at least 3 points to define a field boundary.");
      return;
    }
    
    const geojson = {
      type: "Polygon",
      coordinates: [[...points, points[0]]]
    };
    onSelect(geojson);
  }

  function undo() {
    setPoints(prev => prev.slice(0, -1));
  }

  function clear() {
    if (confirm("Clear all points?")) setPoints([]);
  }

  return (
    <Modal title="Define Field Boundary" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-xl text-xs font-medium text-emerald-800 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800">
          Tip: Tap the corners of the field to draw its boundary. Plot at least 3 points to form a polygon.
        </div>

        <div className="relative h-[400px] sm:h-[500px] bg-gray-100 dark:bg-black rounded-2xl overflow-hidden border-2 border-gray-100 dark:border-gray-800 shadow-inner">
          <div ref={mapDivRef} className="absolute inset-0" />
          
          <div className="absolute top-4 left-4 flex flex-col gap-2">
            <button 
              onClick={() => setMapStyle(prev => prev === "streets" ? "satellite" : "streets")}
              className="bg-white/90 dark:bg-gray-800/90 backdrop-blur px-3 py-2 rounded-lg shadow-md text-xs font-bold border border-gray-200 dark:border-gray-700 hover:bg-white transition-all"
            >
              {mapStyle === "streets" ? "🛰️ Satellite" : "🗺️ Streets"}
            </button>
          </div>

          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2">
            <button 
              onClick={undo}
              disabled={points.length === 0}
              className="bg-white/90 dark:bg-gray-800/90 backdrop-blur px-4 py-2 rounded-xl shadow-lg text-xs font-bold border border-gray-200 dark:border-gray-700 hover:bg-white transition-all disabled:opacity-50"
            >
              ↩ Undo Point
            </button>
            <button 
              onClick={clear}
              disabled={points.length === 0}
              className="bg-white/90 dark:bg-gray-800/90 backdrop-blur px-4 py-2 rounded-xl shadow-lg text-xs font-bold border border-red-100 dark:border-red-900 text-red-600 hover:bg-red-50 transition-all disabled:opacity-50"
            >
              🗑️ Clear
            </button>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button 
            onClick={handleSave}
            disabled={points.length < 3}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-4 rounded-2xl font-black text-lg shadow-xl transition-all disabled:opacity-50"
          >
            Save Boundary ✓
          </button>
          <button 
            onClick={onClose}
            className="px-8 bg-gray-100 dark:bg-gray-800 text-gray-500 rounded-2xl font-bold hover:bg-gray-200 transition-all"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
