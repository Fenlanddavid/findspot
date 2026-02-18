import React, { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useLiveQuery } from "dexie-react-hooks";
import { db, Find, Media, Track } from "../db";
import { v4 as uuid } from "uuid";
import { MapFilterBar } from "../components/MapFilterBar";
import { PermissionPanel } from "../components/PermissionPanel";
import { FindModal } from "../components/FindModal";
import { PermissionQuickAddModal } from "../components/PermissionQuickAddModal";
import { useNavigate } from "react-router-dom";
import { startTracking, stopTracking, isTrackingActive, getCurrentTrackId } from "../services/tracking";

const DEFAULT_CENTER: [number, number] = [-2.0, 54.5];
const DEFAULT_ZOOM = 5;

type SelectedPermission = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  landType: string;
  permissionGranted: boolean;
  findCount: number;
};

type DateFilterMode = "all" | "7d" | "30d" | "custom";

export default function MapPage({ projectId }: { projectId: string }) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const nav = useNavigate();

  // Filters
  const [filterPermissionOnly, setFilterPermissionOnly] = useState(false);
  const [filterLandType, setFilterLandType] = useState<string>("");
  const [filterObjectType, setFilterObjectType] = useState("");
  const [minFinds, setMinFinds] = useState(1);

  // Date range
  const [dateMode, setDateMode] = useState<DateFilterMode>("all");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  
  // Map Style
  const [mapStyleMode, setMapStyleMode] = useState<"streets" | "satellite">("streets");

  // Selection / modals
  const [selected, setSelected] = useState<SelectedPermission | null>(null);
  const [openFindId, setOpenFindId] = useState<string | null>(null);
  const [addingPermissionAt, setAddingPermissionAt] = useState<{ lat: number; lon: number } | null>(null);
  const [highlightedPermissionId, setHighlightedPermissionId] = useState<string | null>(null);

  // Tracking state
  const [isTracking, setIsTracking] = useState(isTrackingActive());

  // Data
  const permissions = useLiveQuery(async () => {
    const rows = await db.permissions.where("projectId").equals(projectId).toArray();
    return rows.filter((r) => typeof r.lat === "number" && typeof r.lon === "number") as Array<
      typeof rows[number] & { lat: number; lon: number }
    >;
  }, [projectId]);

  const finds = useLiveQuery(async () => db.finds.where("projectId").equals(projectId).toArray(), [projectId]);
  
  const tracks = useLiveQuery(async () => db.tracks.where("projectId").equals(projectId).toArray(), [projectId]);

  // Derived state
  const landTypeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of permissions ?? []) {
      const f = (l.landType || "").trim();
      if (f) set.add(f);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [permissions]);

  const maxFindsAtAnyPermission = useMemo(() => {
    let max = 0;
    const counts = new Map<string, number>();
    for (const s of finds ?? []) {
      const c = (counts.get(s.permissionId) ?? 0) + 1;
      counts.set(s.permissionId, c);
      if (c > max) max = c;
    }
    return max;
  }, [finds]);

  const findPassesDateFilter = useMemo(() => {
    const now = new Date();
    const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
    const now0 = startOfDay(now);
    let from: Date | null = null;
    let to: Date | null = null;

    if (dateMode === "7d") {
      from = new Date(now0); from.setDate(from.getDate() - 7); to = now0;
    } else if (dateMode === "30d") {
      from = new Date(now0); from.setDate(from.getDate() - 30); to = now0;
    } else if (dateMode === "custom") {
      if (customFrom) from = startOfDay(new Date(customFrom));
      if (customTo) { to = startOfDay(new Date(customTo)); to.setHours(23, 59, 59, 999); }
    }

    return (s: { createdAt: string }) => {
      if (dateMode === "all") return true;
      const d = new Date(s.createdAt);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    };
  }, [dateMode, customFrom, customTo]);

  const findCountByPermission = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of finds ?? []) {
      if (!findPassesDateFilter(s)) continue;
      map.set(s.permissionId, (map.get(s.permissionId) ?? 0) + 1);
    }
    return map;
  }, [finds, findPassesDateFilter]);

  const filteredPermissions = useMemo(() => {
    let out = permissions ?? [];
    if (filterLandType.trim()) out = out.filter((l) => (l.landType || "").trim() === filterLandType.trim());
    if (filterPermissionOnly) out = out.filter((l) => !!l.permissionGranted);
    if (minFinds > 0) out = out.filter((l) => (findCountByPermission.get(l.id) ?? 0) >= minFinds);

    const fObjectType = filterObjectType.trim().toLowerCase();
    if (fObjectType) {
      const matchingPermissionIds = new Set<string>();
      for (const s of finds ?? []) {
        if (!findPassesDateFilter(s)) continue;
        if ((s.objectType || "").toLowerCase().includes(fObjectType)) matchingPermissionIds.add(s.permissionId);
      }
      out = out.filter((l) => matchingPermissionIds.has(l.id));
    }
    return out;
  }, [permissions, finds, filterLandType, filterPermissionOnly, filterObjectType, minFinds, findCountByPermission]);

  const featureCollection = useMemo(() => {
    return {
      type: "FeatureCollection" as const,
      features: filteredPermissions.map((l) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [l.lon, l.lat] as [number, number] },
        properties: {
          id: l.id,
          name: l.name || "(Unnamed permission)",
          permissionGranted: l.permissionGranted ? 1 : 0,
          landType: l.landType || "",
          findCount: findCountByPermission.get(l.id) ?? 0,
        },
      })),
    };
  }, [filteredPermissions, findCountByPermission]);
  
  const trackGeoJSON = useMemo(() => {
    return {
        type: "FeatureCollection" as const,
        features: (tracks ?? []).map((t) => ({
            type: "Feature" as const,
            geometry: {
                type: "LineString" as const,
                coordinates: t.points.map(p => [p.lon, p.lat])
            },
            properties: {
                id: t.id,
                name: t.name,
                color: t.color || "#059669",
                isActive: t.isActive
            }
        }))
    };
  }, [tracks]);

  const selectedFinds = useLiveQuery(async () => {
    if (!selected) return [];
    const all = await db.finds.where("permissionId").equals(selected.id).reverse().sortBy("createdAt");
    return all.filter(findPassesDateFilter);
  }, [selected?.id, dateMode, customFrom, customTo]);

  const firstPhotoByFindId = useLiveQuery(async () => {
    if (!selectedFinds || selectedFinds.length === 0) return new Map<string, Media>();
    const ids = selectedFinds.map((s) => s.id);
    const mediaRows = await db.media.where("findId").anyOf(ids).toArray();
    mediaRows.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    const m = new Map<string, Media>();
    for (const row of mediaRows) {
      if (!m.has(row.findId)) {
        m.set(row.findId, row);
      }
    }
    return m;
  }, [selectedFinds?.map((s) => s.id).join("|")]);

  // Map Initialization
  useEffect(() => {
    if (!mapDivRef.current) return;
    
    if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
    }

    let tiles: string[] = [];
    let attribution = "";
    let tileSize = 256;
    
    switch (mapStyleMode) {
        case "streets":
            tiles = ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"];
            attribution = "© OpenStreetMap";
            break;
        case "satellite":
            tiles = ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"];
            attribution = "© Esri World Imagery";
            break;
    }

    const style: any = {
        version: 8,
        sources: {
            "raster-tiles": {
                type: "raster",
                tiles: tiles,
                tileSize: tileSize,
                attribution: attribution
            }
        },
        layers: [
            { id: "simple-tiles", type: "raster", source: "raster-tiles", minzoom: 0, maxzoom: 22 }
        ]
    };

    const map = new maplibregl.Map({
      container: mapDivRef.current,
      style: style,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "top-right");

    map.on("load", () => {
      // Tracks Source
      map.addSource("tracks", {
        type: "geojson",
        data: trackGeoJSON as any
      });

      // Track Layer (background/faint)
      map.addLayer({
        id: "tracks-line",
        type: "line",
        source: "tracks",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 4,
          "line-opacity": ["case", ["==", ["get", "isActive"], true], 0.8, 0.4]
        }
      });

      map.addSource("localities", {
        type: "geojson",
        data: featureCollection as any,
        cluster: true,
        clusterRadius: 50,
        clusterMaxZoom: 12,
      });

      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "localities",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#059669",
          "circle-radius": ["step", ["get", "point_count"], 16, 25, 20, 100, 28],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "localities",
        filter: ["has", "point_count"],
        layout: { "text-field": "{point_count_abbreviated}", "text-size": 12 },
        paint: { "text-color": "#ffffff" },
      });

      map.addLayer({
        id: "unclustered",
        type: "circle",
        source: "localities",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": ["step", ["get", "findCount"], 8, 1, 10, 5, 12, 20, 14],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
          "circle-color": ["case", ["==", ["get", "permissionGranted"], 1], "#059669", "#d97706"],
        },
      });

      map.addLayer({
        id: "unclustered-highlight",
        type: "circle",
        source: "localities",
        filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "id"], "___NONE___"]] as any,
        paint: {
          "circle-radius": 18,
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
          "circle-color": "rgba(0,0,0,0)",
        },
      });
      
      map.addLayer({
          id: "unclustered-highlight-ring",
          type: "circle",
          source: "localities",
          filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "id"], "___NONE___"]] as any,
          paint: {
            "circle-radius": 22,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#000000",
            "circle-color": "rgba(0,0,0,0)",
            "circle-opacity": 0.5
          }
      });

      map.addLayer({
        id: "unclustered-count",
        type: "symbol",
        source: "localities",
        filter: ["!", ["has", "point_count"]],
        layout: {
          "text-field": ["case", [">", ["get", "findCount"], 0], ["to-string", ["get", "findCount"]], ""],
          "text-offset": [0, 0],
          "text-size": 10,
        },
        paint: { "text-color": "#ffffff" },
      });

      map.on("click", "clusters", (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
        const clusterId = features[0]?.properties?.cluster_id;
        const source = map.getSource("localities") as any;
        if (!clusterId || !source.getClusterExpansionZoom) return;
        source.getClusterExpansionZoom(clusterId, (err: any, zoom: number) => {
          if (err) return;
          const coords = (features[0].geometry as any).coordinates as [number, number];
          map.easeTo({ center: coords, zoom });
        });
      });

      map.on("click", "unclustered", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const coords = (f.geometry as any).coordinates as [number, number];
        const props = f.properties as any;
        const id = String(props.id);
        
        setHighlightedPermissionId(id);
        setSelected({
          id,
          name: props.name,
          lon: coords[0],
          lat: coords[1],
          permissionGranted: props.permissionGranted === 1 || props.permissionGranted === "1",
          landType: props.landType || "",
          findCount: Number(props.findCount ?? 0),
        });

        const currentZoom = map.getZoom();
        const targetZoom = Math.max(currentZoom, 13);
        map.easeTo({ center: coords, zoom: targetZoom, duration: 450 });
        
        const filter = ["all", ["!", ["has", "point_count"]], ["==", ["get", "id"], id]] as any;
        if (map.getLayer("unclustered-highlight")) map.setFilter("unclustered-highlight", filter);
        if (map.getLayer("unclustered-highlight-ring")) map.setFilter("unclustered-highlight-ring", filter);
      });

      map.on("mouseenter", "clusters", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "clusters", () => (map.getCanvas().style.cursor = ""));
      map.on("mouseenter", "unclustered", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "unclustered", () => (map.getCanvas().style.cursor = ""));
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [mapStyleMode]); // ONLY style changes trigger re-init

  // Data Updates
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource("localities") as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(featureCollection as any);
  }, [featureCollection]); // Update pins when data changes

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource("tracks") as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(trackGeoJSON as any);
  }, [trackGeoJSON]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    if (selected) {
      const stillThere = featureCollection.features.some((f) => String((f.properties as any).id) === String(selected.id));
      if (!stillThere) {
        setSelected(null);
        setHighlightedPermissionId(null);
        const filter = ["all", ["!", ["has", "point_count"]], ["==", ["get", "id"], "___NONE___"]] as any;
        if (map.getLayer("unclustered-highlight")) map.setFilter("unclustered-highlight", filter);
        if (map.getLayer("unclustered-highlight-ring")) map.setFilter("unclustered-highlight-ring", filter);
      } else if (highlightedPermissionId) {
         const filter = ["all", ["!", ["has", "point_count"]], ["==", ["get", "id"], highlightedPermissionId]] as any;
         if (map.getLayer("unclustered-highlight")) map.setFilter("unclustered-highlight", filter);
         if (map.getLayer("unclustered-highlight-ring")) map.setFilter("unclustered-highlight-ring", filter);
      }
    }
  }, [selected, highlightedPermissionId, featureCollection]);

  function zoomToMyLocation() {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => mapRef.current?.easeTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 13 }),
      () => {},
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  function addPermissionHere() {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setAddingPermissionAt({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  async function createPermissionAt(name: string) {
    if (!addingPermissionAt) return;
    const { lat, lon } = addingPermissionAt;
    const now = new Date().toISOString();
    await db.permissions.add({
      id: uuid(),
      projectId,
      name: name.trim() || "New permission",
      type: "individual",
      lat,
      lon,
      gpsAccuracyM: null,
      collector: "",
      landType: "other",
      permissionGranted: false,
      notes: "",
      createdAt: now,
      updatedAt: now,
    });
    setAddingPermissionAt(null);
  }

  function clearFilters() {
    setFilterPermissionOnly(false);
    setFilterLandType("");
    setFilterObjectType("");
    setMinFinds(1);
    setDateMode("all");
  }
  
  async function toggleTracking() {
    if (isTracking) {
        await stopTracking();
        setIsTracking(false);
    } else {
        await startTracking(projectId);
        setIsTracking(true);
    }
  }

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-80px)]">
      <MapFilterBar 
        count={filteredPermissions.length}
        zoomToMyLocation={zoomToMyLocation}
        addPermissionHere={addPermissionHere}
        filterSSSIOnly={filterPermissionOnly}
        setFilterSSSIOnly={setFilterPermissionOnly}
        filterFormation={filterLandType}
        setFilterFormation={setFilterLandType}
        formationOptions={landTypeOptions}
        filterTaxon={filterObjectType}
        setFilterTaxon={setFilterObjectType}
        minFinds={minFinds}
        setMinFinds={setMinFinds}
        maxFindsAtAnyPermission={maxFindsAtAnyPermission}
        dateMode={dateMode}
        setDateMode={setDateMode}
        customFrom={customFrom}
        setCustomFrom={setCustomFrom}
        customTo={customTo}
        setCustomTo={setCustomTo}
        onClear={clearFilters}
        needsKey={false}
        mapStyleMode={mapStyleMode}
        setMapStyleMode={setMapStyleMode}
      />

      <div className="flex-1 relative border-2 border-gray-100 dark:border-gray-800 rounded-3xl overflow-hidden shadow-inner bg-gray-50 dark:bg-black">
        <div ref={mapDivRef} className="absolute inset-0" />
        
        {/* Selection overlay */}
        {selected && (
          <div className="absolute bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 z-10">
            <PermissionPanel 
              selected={selected}
              selectedFinds={selectedFinds as Find[]}
              firstPhotoByFindId={firstPhotoByFindId}
              onOpenFind={(sid) => setOpenFindId(sid)}
              onEdit={() => nav(`/permission/${selected.id}`)}
              onClose={() => {
                setSelected(null);
                setHighlightedPermissionId(null);
                const filter = ["all", ["!", ["has", "point_count"]], ["==", ["get", "id"], "___NONE___"]] as any;
                if (mapRef.current?.getLayer("unclustered-highlight")) mapRef.current.setFilter("unclustered-highlight", filter);
                if (mapRef.current?.getLayer("unclustered-highlight-ring")) mapRef.current.setFilter("unclustered-highlight-ring", filter);
              }}
            />
          </div>
        )}
      </div>

      {openFindId && (
        <FindModal findId={openFindId} onClose={() => setOpenFindId(null)} />
      )}

      {addingPermissionAt && (
        <PermissionQuickAddModal 
          lat={addingPermissionAt.lat}
          lon={addingPermissionAt.lon}
          onCancel={() => setAddingPermissionAt(null)}
          onCreate={createPermissionAt}
        />
      )}
    </div>
  );
}