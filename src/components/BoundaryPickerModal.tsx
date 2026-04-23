import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Modal } from "./Modal";

interface BoundaryPickerModalProps {
  initialBoundary?: any; // GeoJSON Polygon
  permissionBoundary?: any; // GeoJSON Polygon for zooming in
  initialLat?: number | null;
  initialLon?: number | null;
  onClose: () => void;
  onSelect: (boundary: any) => void;
}

function buildSourceData(pts: [number, number][]) {
  const features: any[] = [];
  if (pts.length > 0) {
    pts.forEach((p, i) => {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: p },
        properties: { index: i }
      });
    });
    if (pts.length >= 2) {
      const coords = [...pts];
      if (pts.length >= 3) {
        coords.push(pts[0]);
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
  return { type: "FeatureCollection" as const, features };
}

export function BoundaryPickerModal({ initialBoundary, permissionBoundary, initialLat, initialLon, onClose, onSelect }: BoundaryPickerModalProps) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [points, setPoints] = useState<[number, number][]>([]);
  const [mapStyle, setMapStyle] = useState<"streets" | "satellite">("satellite");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  // Refs for drag state — accessible inside map event handlers without stale closures
  const pointsRef = useRef<[number, number][]>([]);
  const draggingIndexRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didDragRef = useRef(false);

  // Keep pointsRef in sync with React state
  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

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
        if (mapRef.current) {
          mapRef.current.flyTo({ center: [parseFloat(lon), parseFloat(lat)], zoom: 16 });
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

    // Fit bounds if we have a boundary
    const boundaryToFit = initialBoundary || permissionBoundary;
    if (boundaryToFit && boundaryToFit.coordinates?.[0] && Array.isArray(boundaryToFit.coordinates[0])) {
      const bounds = new maplibregl.LngLatBounds();
      boundaryToFit.coordinates[0].forEach((p: [number, number]) => {
        if (Array.isArray(p) && p.length >= 2) bounds.extend(p as [number, number]);
      });
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 40, duration: 0 });
      }
    }

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "top-right");

    map.on("load", () => {
      map.addSource("boundary", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
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
        filter: ["==", "$type", "Point"],
        paint: {
          "circle-radius": 9,
          "circle-color": "#ffffff",
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#10b981"
        }
      });

      // Invisible larger hit area layer for easier touch targeting
      map.addLayer({
        id: "boundary-points-hit",
        type: "circle",
        source: "boundary",
        filter: ["==", "$type", "Point"],
        paint: {
          "circle-radius": 20,
          "circle-color": "transparent",
          "circle-opacity": 0
        }
      });

      function updateSource(pts: [number, number][]) {
        const source = map.getSource("boundary") as maplibregl.GeoJSONSource;
        if (source) source.setData(buildSourceData(pts));
      }

      function endDrag() {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        if (draggingIndexRef.current !== null) {
          didDragRef.current = true; // Block the click that fires after mouseup/touchend
          setPoints([...pointsRef.current]);
          draggingIndexRef.current = null;
          map.dragPan.enable();
          map.getCanvas().style.cursor = "";
        }
      }

      // Long press detection on vertex dots — use the hit layer for easier touch targeting
      function startLongPress(idx: number) {
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null;
          draggingIndexRef.current = idx;
          map.dragPan.disable();
          map.getCanvas().style.cursor = "grabbing";
        }, 300);
      }

      map.on("mousedown", "boundary-points-hit", (e) => {
        const idx = e.features?.[0]?.properties?.index;
        if (idx == null) return;
        startLongPress(idx as number);
      });

      map.on("touchstart", "boundary-points-hit", (e) => {
        const idx = e.features?.[0]?.properties?.index;
        if (idx == null) return;
        startLongPress(idx as number);
      });

      // Cancel long press if finger/mouse moves before threshold fires
      function cancelLongPressIfPending() {
        if (longPressTimerRef.current && draggingIndexRef.current === null) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
      }

      map.on("mousemove", (e) => {
        cancelLongPressIfPending();
        if (draggingIndexRef.current === null) return;
        const newPoints = [...pointsRef.current];
        newPoints[draggingIndexRef.current] = [e.lngLat.lng, e.lngLat.lat];
        pointsRef.current = newPoints;
        updateSource(newPoints);
      });

      map.on("touchmove", (e) => {
        cancelLongPressIfPending();
        if (draggingIndexRef.current === null) return;
        const newPoints = [...pointsRef.current];
        newPoints[draggingIndexRef.current] = [e.lngLat.lng, e.lngLat.lat];
        pointsRef.current = newPoints;
        updateSource(newPoints);
      });

      map.on("mouseup", endDrag);
      map.on("touchend", endDrag);
      map.on("touchcancel", endDrag);

      map.on("click", (e) => {
        // Block click if we just finished a drag
        if (didDragRef.current) {
          didDragRef.current = false;
          return;
        }
        // Don't add a new point if the tap was on an existing dot
        const hits = map.queryRenderedFeatures(e.point, { layers: ["boundary-points-hit"] });
        if (hits.length > 0) return;

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

    source.setData(buildSourceData(points));
  }, [points]);

  function handleSave() {
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
    setPoints([]);
    setConfirmingClear(false);
  }

  return (
    <Modal title="Define Field Boundary" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-xl text-xs font-medium text-emerald-800 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800">
          Tap the corners of the field to place points. Hold and drag a dot to reposition it.
        </div>

        <div className="relative h-[400px] sm:h-[500px] bg-gray-100 dark:bg-black rounded-2xl overflow-hidden border-2 border-gray-100 dark:border-gray-800 shadow-inner">
          <div ref={mapDivRef} className="absolute inset-0" />

          <div className="absolute top-4 left-4 flex flex-col gap-2 z-10 max-w-[calc(100%-100px)]">
            <form onSubmit={handleSearch} className="flex gap-1 bg-white/90 dark:bg-gray-800/90 backdrop-blur p-1 rounded-xl shadow-md border border-gray-200 dark:border-gray-700">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search area..."
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
              <p className="text-xs font-medium text-red-600 bg-white/90 dark:bg-gray-800/90 px-2 py-1 rounded-lg shadow-sm">{searchError}</p>
            )}
            <button
              onClick={() => setMapStyle(prev => prev === "streets" ? "satellite" : "streets")}
              className="w-fit bg-white/90 dark:bg-gray-800/90 backdrop-blur px-3 py-2 rounded-lg shadow-md text-[10px] font-bold border border-gray-200 dark:border-gray-700 hover:bg-white transition-all uppercase"
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
            {!confirmingClear ? (
              <button
                onClick={() => setConfirmingClear(true)}
                disabled={points.length === 0}
                className="bg-white/90 dark:bg-gray-800/90 backdrop-blur px-4 py-2 rounded-xl shadow-lg text-xs font-bold border border-red-100 dark:border-red-900 text-red-600 hover:bg-red-50 transition-all disabled:opacity-50"
              >
                🗑️ Clear
              </button>
            ) : (
              <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur flex items-center gap-1 px-2 py-1 rounded-xl shadow-lg border border-red-200 dark:border-red-800">
                <span className="text-[10px] font-bold text-red-600">Clear all?</span>
                <button onClick={clear} className="bg-red-600 text-white px-2 py-0.5 rounded text-[10px] font-bold">Yes</button>
                <button onClick={() => setConfirmingClear(false)} className="text-gray-500 px-2 py-0.5 rounded text-[10px] font-bold">No</button>
              </div>
            )}
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
