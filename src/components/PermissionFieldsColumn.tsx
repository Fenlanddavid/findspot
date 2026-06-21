import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { area as turfArea } from "@turf/turf";
import { db, GeoJSONPolygon, Field } from "../db";
import { calculateCoverage, CoverageResult } from "../services/coverage";
import {
  BASEMAP_SOURCES, BASEMAP_LAYERS, BASEMAP_MODES, applyBasemap,
  type BasemapMode,
} from "./permission/basemaps";

const landTypes = [
  "arable", "pasture", "woodland", "scrub", "parkland", "beach", "foreshore", "other",
] as const;

function getBoundaryCenter(boundary?: GeoJSONPolygon | null): { lat: number; lon: number } | null {
  const ring = boundary?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length === 0) return null;

  const points = ring.filter((p: unknown): p is [number, number] =>
    Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number"
  );
  if (points.length === 0) return null;

  const lons = points.map(p => p[0]);
  const lats = points.map(p => p[1]);
  return {
    lon: (Math.min(...lons) + Math.max(...lons)) / 2,
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
  };
}

interface FieldsColumnProps {
    // Identity
    permissionId:               string | undefined;
    isEdit:                     boolean;

    // Edit mode
    isEditing:                  boolean;
    saving:                     boolean;

    // Type/role flags
    isRally:                    boolean;
    isClubDayMember:            boolean;
    isSharedPermission:         boolean;
    isPersonalRallyRecord:      boolean;
    isFirstPermission:          boolean | undefined;
    organiserSetupParam:        boolean;
    showOrganiserHub:           boolean;

    // Capabilities
    canUseAgreement:            boolean;
    generateAgreementLabel:     string;
    uploadAgreementLabel:       string;
    permissionNeedsCompletion:  boolean;
    saveButtonLabel:            string;
    showOptionalPermissionDetails: boolean;

    // Coach tips
    permissionCoachActive:      boolean;
    permissionCoachStep:        number;

    // Form field values
    name:                       string;
    type:                       string;
    landownerName:              string;
    landownerPhone:             string;
    landownerEmail:             string;
    landownerAddress:           string;
    collector:                  string;
    landType:                   string;
    permissionGranted:          boolean;
    validFrom:                  string;
    notes:                      string;
    lat:                        number | null;
    lon:                        number | null;

    // Form field setters
    setName:                    (v: string) => void;
    setLandownerName:           (v: string) => void;
    setLandownerPhone:          (v: string) => void;
    setLandownerEmail:          (v: string) => void;
    setLandownerAddress:        (v: string) => void;
    setCollector:               (v: string) => void;
    setLandType:                (v: any) => void;
    setPermissionGranted:       (v: boolean) => void;
    setValidFrom:               (v: string) => void;
    setNotes:                   (v: string) => void;
    setLat:                     (v: number | null) => void;
    setLon:                     (v: number | null) => void;

    // Live data
    boundary:                   any;
    fields:                     any[] | undefined;
    finds:                      any[] | undefined;
    sessions:                   any[] | undefined;
    pendingFinds:               any[] | undefined;
    allTracks:                  any[] | undefined;
    fieldFindCounts:            Map<string, { recorded: number; pending: number }>;
    submittedMembers:           any[] | undefined;
    agreementFile:              any;

    // Display data
    submittedAt:                string | undefined;
    significantFindInstructions: string | undefined;
    organiserContactNumber:     string | undefined;
    clubDayPublicNotes:         string | undefined;
    insuranceProvider:          string;
    ncmdNumber:                 string;
    ncmdExpiry:                 string;

    // Callbacks
    onSave:                     () => void;
    onDoGPS:                    () => void;
    onDeleteField:              (fieldId: string) => void;
    onRecordFind:               (fieldId?: string | null) => void;
    onAddField:                 () => void;
    onEditField:                (fieldId: string) => void;
    onShowFieldNotes:           (fieldId: string) => void;
    onOpenAgreement:            () => void;
    onOpenProof:                () => void;
    onCancelEdit:               () => void;
    onShowAllDetails:           () => void;
    onCompletePermission:       () => void;
    onUploadAgreement:          (file: File | null | undefined) => void;
    onPickBoundary:             () => void;
    onPickLocation:             () => void;
    onShowExportClubDay:        () => void;
}

export function PermissionFieldsColumn(props: FieldsColumnProps) {
    const {
        permissionId, isEdit, isEditing, saving,
        isRally, isClubDayMember, isSharedPermission, isPersonalRallyRecord,
        isFirstPermission, organiserSetupParam, showOrganiserHub,
        canUseAgreement, generateAgreementLabel, uploadAgreementLabel,
        permissionNeedsCompletion, saveButtonLabel, showOptionalPermissionDetails,
        permissionCoachActive, permissionCoachStep,
        name, type, landownerName, landownerPhone, landownerEmail, landownerAddress,
        collector, landType, permissionGranted, validFrom, notes, lat, lon,
        setName, setLandownerName, setLandownerPhone, setLandownerEmail,
        setLandownerAddress, setCollector, setLandType, setPermissionGranted,
        setValidFrom, setNotes, setLat, setLon,
        boundary, fields, finds, sessions, pendingFinds, allTracks,
        fieldFindCounts, submittedMembers, agreementFile,
        submittedAt, significantFindInstructions, organiserContactNumber,
        clubDayPublicNotes, insuranceProvider, ncmdNumber, ncmdExpiry,
        onSave, onDoGPS, onDeleteField, onRecordFind, onAddField, onEditField,
        onShowFieldNotes, onOpenAgreement, onOpenProof, onCancelEdit,
        onShowAllDetails, onCompletePermission, onUploadAgreement,
        onPickBoundary, onPickLocation, onShowExportClubDay,
    } = props;

    const nav = useNavigate();

    // Local state
    const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
    const [permissionSelected, setPermissionSelected] = useState(false);
    const [noPermTooltip, setNoPermTooltip] = useState(false);
    const [shownFieldGapIds, setShownFieldGapIds] = useState<Set<string>>(new Set());
    const [fieldGapResults, setFieldGapResults] = useState<Map<string, CoverageResult>>(new Map());
    const [fieldGapErrors, setFieldGapErrors] = useState<Set<string>>(new Set());
    const [mapStyle, setMapStyle] = useState<BasemapMode>('satellite');
    const showCoverage = false; // always false, kept for effect
    const [coverageResult, setCoverageResult] = useState<CoverageResult | null>(null);
    const [coverageError, setCoverageError] = useState(false); // dead but keep

    // Refs
    const mapDivRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const fieldLabelMarkersRef = useRef<Array<{ id: string; marker: maplibregl.Marker; el: HTMLButtonElement }>>([]);
    const fieldRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const fieldScrollRef = useRef<HTMLDivElement | null>(null);
    const agreementUploadRef = useRef<HTMLInputElement | null>(null);

    // Coverage calculation effect
    useEffect(() => {
        if (!showCoverage || !boundary) {
            setCoverageResult(null);
            setCoverageError(false);
        } else {
            const result = calculateCoverage(boundary, allTracks || []);
            setCoverageResult(result);
            setCoverageError(result === null);
        }

        if (shownFieldGapIds.size === 0) {
            setFieldGapResults(new Map());
            return;
        }

        const fIds = Array.from(shownFieldGapIds);
        Promise.all(fIds.map(async (fId) => {
            const field = await db.fields.get(fId);
            if (!field || !field.boundary) return null;

            // 1. Find all sessions explicitly assigned to this field
            const sessions = await db.sessions.where("fieldId").equals(fId).toArray();
            const fieldSessionIds = new Set(sessions.map(s => s.id));

            // 2. Find sessions for this permission that have NO field assigned (General tracks)
            const unassignedSessions = await db.sessions.where("permissionId").equals(permissionId!).filter(s => !s.fieldId).toArray();
            const unassignedSessionIds = new Set(unassignedSessions.map(s => s.id));

            // Filter allTracks for either explicitly assigned or unassigned sessions
            const fieldTracks = (allTracks ?? []).filter(t =>
                t.sessionId && (fieldSessionIds.has(t.sessionId) || unassignedSessionIds.has(t.sessionId))
            );

            const result = calculateCoverage(field.boundary, fieldTracks);
            return { fId, result };
        })).then(results => {
            const next = new Map<string, CoverageResult>();
            const errors = new Set<string>();
            results.forEach(r => {
                if (r && r.result) next.set(r.fId, r.result);
                else if (r && !r.result) errors.add(r.fId);
            });
            setFieldGapResults(next);
            setFieldGapErrors(errors);
        }).catch(() => {
            setFieldGapErrors(new Set(fIds));
        });
    }, [showCoverage, shownFieldGapIds, boundary, allTracks, permissionId, fields]);

    // Map init effect
    useEffect(() => {
        const hasData = boundary || (fields && fields.length > 0);
        if (!mapDivRef.current || !hasData) return;

        if (!mapRef.current) {
            let map: maplibregl.Map;
            try {
              map = new maplibregl.Map({
                container: mapDivRef.current,
                style: {
                    version: 8,
                    sources: { ...BASEMAP_SOURCES },
                    layers:  [ ...BASEMAP_LAYERS ],
                },
                center: [lon || -2, lat || 54.5],
                zoom: 16,
              });
            } catch (mapErr) {
              console.error("Map init failed:", mapErr);
              return;
            }

            map.on("load", () => {
                applyBasemap(map, mapStyle);

                map.addSource("boundary", {
                    type: "geojson",
                    data: boundary || { type: "FeatureCollection", features: [] }
                });

                map.addLayer({
                    id: "boundary-outline",
                    type: "line",
                    source: "boundary",
                    paint: { "line-color": "#10b981", "line-width": 2, "line-dasharray": [2, 1] }
                });

                // Transparent fill on the permission boundary — hit-target when no sub-fields exist
                map.addLayer({
                    id: "boundary-fill",
                    type: "fill",
                    source: "boundary",
                    paint: { "fill-color": "#10b981", "fill-opacity": 0.01 }
                });

                // Add Sub-Fields Source
                map.addSource("fields-boundary", {
                    type: "geojson",
                    data: { type: "FeatureCollection", features: [] }
                });

                // Transparent fill for reliable tap hit area
                map.addLayer({
                    id: "fields-fill",
                    type: "fill",
                    source: "fields-boundary",
                    paint: { "fill-color": "#0d9488", "fill-opacity": 0.01 }
                });

                map.addLayer({
                    id: "fields-outline",
                    type: "line",
                    source: "fields-boundary",
                    paint: { "line-color": "#0d9488", "line-width": 2 }
                });

                // Single consolidated click handler — avoids double-fire where the layer-specific
                // handler sets selectedFieldId and the general handler immediately clears it.
                map.on("click", (e) => {
                    const fieldHits = map.queryRenderedFeatures(e.point, { layers: ["fields-fill"] });
                    if (fieldHits.length > 0) {
                        const fid = fieldHits[0]?.properties?.id as string | undefined;
                        if (fid) { setPermissionSelected(false); setSelectedFieldId(prev => prev === fid ? null : fid); }
                        return;
                    }
                    // No sub-fields — allow tapping the permission boundary itself
                    const boundaryHits = map.queryRenderedFeatures(e.point, { layers: ["boundary-fill"] });
                    if (boundaryHits.length > 0) {
                        setSelectedFieldId(null);
                        setPermissionSelected(prev => !prev);
                    } else {
                        setSelectedFieldId(null);
                        setPermissionSelected(false);
                    }
                });
                map.on("mouseenter", "fields-fill",    () => { map.getCanvas().style.cursor = "pointer"; });
                map.on("mouseleave", "fields-fill",    () => { map.getCanvas().style.cursor = ""; });
                map.on("mouseenter", "boundary-fill",  () => { map.getCanvas().style.cursor = "pointer"; });
                map.on("mouseleave", "boundary-fill",  () => { map.getCanvas().style.cursor = ""; });

                map.addSource("tracks", {
                    type: "geojson",
                    data: { type: "FeatureCollection", features: [] }
                });

                map.addLayer({
                    id: "tracks-line",
                    type: "line",
                    source: "tracks",
                    layout: { "line-join": "round", "line-cap": "round" },
                    paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.6 }
                });

                map.addSource("coverage", {
                    type: "geojson",
                    data: { type: "FeatureCollection", features: [] }
                });

                map.addLayer({
                    id: "undetected-fill",
                    type: "fill",
                    source: "coverage",
                    paint: { "fill-color": "#ea580c", "fill-opacity": 0.6 }
                });

                map.addLayer({
                    id: "undetected-outline",
                    type: "line",
                    source: "coverage",
                    paint: { "line-color": "#ea580c", "line-width": 2, "line-opacity": 0.8 }
                });

                if (showCoverage && coverageResult) {
                    const src = map.getSource("coverage") as maplibregl.GeoJSONSource;
                    if (src) src.setData(coverageResult.undetectionsGeoJSON);
                }

                updateMapData(map, allTracks || []);
            });
            mapRef.current = map;
        } else {
            const map = mapRef.current;
            if (map.isStyleLoaded()) {
                updateMapData(map, allTracks || []);
            }
        }

        function updateMapData(map: maplibregl.Map, tracksData: any[]) {
            fieldLabelMarkersRef.current.forEach(({ marker }) => marker.remove());
            fieldLabelMarkersRef.current = [];

            const trackSource = map.getSource("tracks") as maplibregl.GeoJSONSource;
            if (trackSource) {
                trackSource.setData({
                    type: "FeatureCollection",
                    features: tracksData
                      .filter(t => t.points && Array.isArray(t.points) && t.points.length >= 2)
                      .map(t => ({
                        type: "Feature",
                        geometry: { type: "LineString", coordinates: t.points.map((p: any) => [p.lon, p.lat]) },
                        properties: { color: t.color }
                      }))
                } as any);
            }

            const boundarySource = map.getSource("boundary") as maplibregl.GeoJSONSource;
            if (boundarySource) boundarySource.setData(boundary || { type: "FeatureCollection", features: [] });

            const fieldsSource = map.getSource("fields-boundary") as maplibregl.GeoJSONSource;
            if (fieldsSource) {
                fieldsSource.setData({
                    type: "FeatureCollection",
                    features: (fields || []).map(f => ({
                        type: "Feature",
                        geometry: f.boundary,
                        properties: { name: f.name, id: f.id }
                    }))
                } as any);
            }

            (fields || []).forEach(field => {
                const center = getBoundaryCenter(field.boundary);
                if (!center) return;

                const el = document.createElement("button");
                el.type = "button";
                el.textContent = field.name;
                el.style.background = "rgba(13, 148, 136, 0.92)";
                el.style.border = "1px solid rgba(255, 255, 255, 0.85)";
                el.style.borderRadius = "999px";
                el.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.25)";
                el.style.color = "#ffffff";
                el.style.cursor = "pointer";
                el.style.font = "700 10px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
                el.style.letterSpacing = "0.04em";
                el.style.maxWidth = "9rem";
                el.style.overflow = "hidden";
                el.style.padding = "0.2rem 0.45rem";
                el.style.textOverflow = "ellipsis";
                el.style.textTransform = "uppercase";
                el.style.whiteSpace = "nowrap";
                el.addEventListener("click", (event) => {
                    event.stopPropagation();
                    setPermissionSelected(false);
                    setSelectedFieldId(prev => prev === field.id ? null : field.id);
                });

                const marker = new maplibregl.Marker({ element: el, anchor: "center" })
                    .setLngLat([center.lon, center.lat])
                    .addTo(map);
                fieldLabelMarkersRef.current.push({ id: field.id, marker, el });
            });

            // Fit bounds to everything
            if (boundary && boundary.coordinates?.[0] && Array.isArray(boundary.coordinates[0])) {
                const bounds = new maplibregl.LngLatBounds();
                boundary.coordinates[0].forEach((p: [number, number]) => {
                    if (Array.isArray(p) && p.length >= 2) bounds.extend(p as [number, number]);
                });

                // Also extend bounds for all sub-fields
                fields?.forEach(f => {
                    if (f.boundary && f.boundary.coordinates?.[0] && Array.isArray(f.boundary.coordinates[0])) {
                        f.boundary.coordinates[0].forEach((p) => {
                            if (Array.isArray(p) && p.length >= 2) bounds.extend(p as [number, number]);
                        });
                    }
                });

                if (!bounds.isEmpty()) {
                    map.fitBounds(bounds, { padding: 40, duration: 0 });
                }
            }

            // Hide outer boundary outline when sub-fields are present — they define the area
            if (map.getLayer("boundary-outline")) {
                map.setLayoutProperty("boundary-outline", "visibility",
                    fields && fields.length > 0 ? "none" : "visible"
                );
            }
        }

        return () => {
            fieldLabelMarkersRef.current.forEach(({ marker }) => marker.remove());
            fieldLabelMarkersRef.current = [];
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, [boundary, fields, permissionId, isEditing]);

    // Basemap toggle effect — switches layers without rebuilding the map
    useEffect(() => {
        const m = mapRef.current;
        if (m && m.isStyleLoaded()) applyBasemap(m, mapStyle);
    }, [mapStyle]);

    // Coverage display effect
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !map.isStyleLoaded()) return;
        const src = map.getSource("coverage") as maplibregl.GeoJSONSource | undefined;
        if (src) {
            const mainFeatures = showCoverage && coverageResult ? coverageResult.undetectionsGeoJSON.features : [];
            const fieldFeatures = Array.from(fieldGapResults.values()).flatMap(r => r.undetectionsGeoJSON.features);
            src.setData({ type: "FeatureCollection", features: [...mainFeatures, ...fieldFeatures] } as any);
        }
        if (map.getLayer("undetected-fill")) {
            const isVisible = showCoverage || fieldGapResults.size > 0;
            map.setLayoutProperty("undetected-fill", "visibility", isVisible ? "visible" : "none");
            if (map.getLayer("undetected-outline")) {
                map.setLayoutProperty("undetected-outline", "visibility", isVisible ? "visible" : "none");
            }
        }
    }, [showCoverage, coverageResult, fieldGapResults]);

    // Field selection highlight effect
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !map.isStyleLoaded()) return;
        if (selectedFieldId) {
            map.setPaintProperty("fields-outline", "line-color", [
                "case", ["==", ["get", "id"], selectedFieldId], "#34d399", "#0d9488"
            ] as any);
            map.setPaintProperty("fields-outline", "line-width", [
                "case", ["==", ["get", "id"], selectedFieldId], 4, 2
            ] as any);
            map.setPaintProperty("fields-outline", "line-opacity", 1);
            const el = fieldRefs.current.get(selectedFieldId);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } else {
            map.setPaintProperty("fields-outline", "line-color", "#0d9488");
            map.setPaintProperty("fields-outline", "line-width", 2);
            map.setPaintProperty("fields-outline", "line-opacity", 1);
        }
        fieldLabelMarkersRef.current.forEach(({ id, el }) => {
            const selected = id === selectedFieldId;
            el.style.background = selected ? "rgba(52, 211, 153, 0.96)" : "rgba(13, 148, 136, 0.92)";
            el.style.boxShadow = selected ? "0 0 0 3px rgba(52, 211, 153, 0.35), 0 2px 8px rgba(0, 0, 0, 0.25)" : "0 2px 8px rgba(0, 0, 0, 0.25)";
        });
    }, [selectedFieldId]);

    return (
        <div className={`lg:col-span-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm grid gap-6 h-fit${isEditing && saving ? ' opacity-60 pointer-events-none' : ''}`}>
            {isEditing ? (
              <>
                <div className="flex items-center gap-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">{isRally ? "Event Details" : "Permission Details"}</div>
                  <div className="flex-1 h-px bg-gray-100 dark:bg-gray-700"></div>
                </div>
                {isFirstPermission && (
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 rounded-xl px-4 py-3 text-sm text-emerald-800 dark:text-emerald-400">
                    Just add a name to get started — fields, boundaries, and landowner details can all be added later.
                  </div>
                )}
                {organiserSetupParam && (
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl px-4 py-3.5">
                    <div className="text-[9px] font-black uppercase tracking-widest text-amber-500 mb-1.5">Setting up a club/rally?</div>
                    <p className="text-sm font-bold text-amber-900 dark:text-amber-200 mb-2">Your landowner details and private notes are never shared.</p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed mb-1">Members will only see:</p>
                    <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5 mb-2 ml-1">
                      <li>· Event name and date</li>
                      <li>· Field boundaries</li>
                      <li>· Organiser contact details</li>
                      <li>· Significant find instructions</li>
                    </ul>
                    <p className="text-xs text-amber-600 dark:text-amber-500">You stay in full control of the permission.</p>
                  </div>
                )}
                <label className="block">
                <div className="mb-2 text-sm font-black text-gray-800 dark:text-gray-200">{type === 'rally' ? 'Rally / Event Name' : 'Permission Name / Location'}</div>
	                <input
	                    value={name}
	                    onChange={(e) => setName(e.target.value)}
	                    placeholder={type === 'rally' ? "e.g., Weekend Rally, Club Dig North" : "e.g., Smith's Farm, North Field"}
	                    className={`w-full bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-600 rounded-xl p-4 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all font-bold text-base ${permissionCoachActive && permissionCoachStep === 0 ? "ring-4 ring-emerald-400/30 border-emerald-400" : ""}`}
	                />
	                </label>

	                {!showOptionalPermissionDetails && (
	                  <div className={`rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 dark:border-emerald-800/60 dark:bg-emerald-950/20 ${permissionCoachActive && permissionCoachStep === 1 ? "ring-4 ring-blue-400/25" : ""}`}>
	                    <div className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Fast setup</div>
	                    <p className="mt-1 text-sm font-medium text-emerald-900 dark:text-emerald-100">
	                      Create the permission now. Landowner details, GPS, field boundaries, agreements and notes can be added from the permission page afterwards.
	                    </p>
	                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
	                      <button
	                        type="button"
	                        onClick={() => onShowAllDetails()}
	                        className="min-h-11 rounded-xl border border-emerald-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-emerald-700 transition-colors hover:border-emerald-500 hover:bg-emerald-600 hover:text-white dark:border-emerald-800 dark:bg-gray-900 dark:text-emerald-300"
	                      >
	                        Add details now
	                      </button>
	                      <button
	                        type="button"
	                        onClick={onDoGPS}
	                        className="min-h-11 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-gray-600 transition-colors hover:border-emerald-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
	                      >
	                        {lat != null ? "GPS set" : "Set GPS only"}
	                      </button>
	                    </div>
	                  </div>
	                )}

	                {showOptionalPermissionDetails && (
	                  <>

	                {isRally ? (
	                  <>
                    <div className="flex flex-col gap-1 pt-2">
                      <div className="flex items-center gap-3">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Organiser & Event</div>
                        <div className="flex-1 h-px bg-gray-100 dark:bg-gray-700"></div>
                      </div>
                      <p className="text-[11px] text-gray-400 dark:text-gray-500">Record the event details so you can log finds against it later.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <label className="block">
                            <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Organiser / Contact Name</div>
                            <input
                                value={landownerName}
                                onChange={(e) => setLandownerName(e.target.value)}
                                placeholder="Club name or organiser"
                                className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
                            />
                        </label>
                        <label className="block">
                            <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Event Date</div>
                            <input
                                type="date"
                                value={validFrom}
                                onChange={(e) => setValidFrom(e.target.value)}
                                className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
                            />
                        </label>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <label className="block">
                            <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Contact Phone</div>
                            <input
                                value={landownerPhone}
                                onChange={(e) => setLandownerPhone(e.target.value)}
                                placeholder="e.g., 07123 456789"
                                className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
                            />
                        </label>
                        <label className="block">
                            <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Contact Email</div>
                            <input
                                type="email"
                                value={landownerEmail}
                                onChange={(e) => setLandownerEmail(e.target.value)}
                                placeholder="organiser@example.com"
                                className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
                            />
                        </label>
                    </div>
	                  </>
	                ) : (
	                  <>
                    <div className="flex flex-col gap-1 pt-2">
                      <div className="flex items-center gap-3">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Landowner Details</div>
                        <div className="flex-1 h-px bg-gray-100 dark:bg-gray-700"></div>
                      </div>
                      <p className="text-[11px] text-gray-400 dark:text-gray-500">Keep a clear record of who granted access to this land.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <label className="block">
                            <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Landowner / Contact Name</div>
                            <input
                                value={landownerName}
                                onChange={(e) => setLandownerName(e.target.value)}
                                placeholder="Full name"
                                className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
                            />
                        </label>
                        <label className="block">
                            <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Phone Number</div>
                            <input
                                value={landownerPhone}
                                onChange={(e) => setLandownerPhone(e.target.value)}
                                placeholder="e.g., 07123 456789"
                                className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
                            />
                        </label>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <label className="block">
                            <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Email Address</div>
                            <input
                                type="email"
                                value={landownerEmail}
                                onChange={(e) => setLandownerEmail(e.target.value)}
                                placeholder="landowner@example.com"
                                className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
                            />
                        </label>
                        <label className="block">
                            <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Postal Address</div>
                            <input
                                value={landownerAddress}
                                onChange={(e) => setLandownerAddress(e.target.value)}
                                placeholder="Farm address, postcode..."
                                className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
                            />
                        </label>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <label className="block">
                            <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Detectorist (Default)</div>
                            <input
                                value={collector}
                                onChange={(e) => setCollector(e.target.value)}
                                placeholder="Name or initials"
                                className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
                            />
                        </label>
                        <label className="block">
                            <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Land Type</div>
                            <select
                                value={landType}
                                onChange={(e) => setLandType(e.target.value as any)}
                                className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all appearance-none font-medium"
                            >
                            {landTypes.map((t) => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                            </select>
                        </label>
                    </div>
	                  </>
	                )}

                <div className="flex items-center gap-3 pt-2">
                  <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">{isRally ? "Event Site & Fields" : "Field Setup & Geometry"}</div>
                  <div className="flex-1 h-px bg-gray-100 dark:bg-gray-700"></div>
                </div>
                <div className="bg-emerald-50/50 dark:bg-emerald-900/20 p-5 rounded-2xl border-2 border-emerald-100/50 dark:border-emerald-800/30 grid gap-4">
                    <div className="flex flex-col sm:flex-row gap-2">
                        <button
                            type="button"
                            onClick={() => onPickBoundary()}
                            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold border-2 shadow-sm transition-all ${boundary ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-emerald-400 hover:text-emerald-600'}`}
                        >
                            <span>{boundary ? (isRally ? "Site Boundary Set ✓" : "Boundary Set ✓") : (isRally ? "Define Site Boundary" : "Define Boundary")}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => onPickLocation()}
                            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-2 border-gray-200 dark:border-gray-700 shadow-sm hover:border-emerald-400 hover:text-emerald-600 transition-all"
                        >
                            <span>Pick Location</span>
                        </button>
                        <button
                            type="button"
                            onClick={onDoGPS}
                            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white border-2 border-emerald-600 shadow-sm transition-all"
                        >
                            <span>{lat != null ? "Refresh GPS" : "Get GPS"}</span>
                        </button>
                    </div>

                    {!boundary && (
                        <div className="text-[11px] text-emerald-700/70 dark:text-emerald-400/60 bg-emerald-50/80 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-800/40 rounded-xl px-4 py-3 font-medium flex items-start gap-2">
                            <span className="shrink-0 mt-0.5">💡</span>
                            <span>{isRally ? "Set the event site boundary, then add the field boundaries members can detect on." : "Set the boundary, then split it into sub-fields — one per field or pasture."}</span>
                        </div>
                    )}
                    {!isEdit && boundary && (
                        <div className={`text-[11px] rounded-xl px-4 py-3 font-medium flex items-start gap-2 border ${isRally ? "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/60" : "text-emerald-700/70 dark:text-emerald-400/60 bg-emerald-50/80 dark:bg-emerald-900/10 border-emerald-100 dark:border-emerald-800/40"}`}>
                            <span className="shrink-0 mt-0.5">📐</span>
                            <span>{isRally ? "Boundary set — save your rally first, then you can add the field boundaries." : "Boundary set — save your permission first, then you can divide it into sub-fields."}</span>
                        </div>
                    )}

                    {/* Fields inside Geometry box */}
                    {isEdit && (
                        <div className="grid gap-3 border-t-2 border-emerald-200/70 dark:border-emerald-700/50 pt-5 mt-1">
                            <div className="flex justify-between items-start gap-3">
                                <div>
                                    <h4 className="text-xs font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">{isRally ? "Rally Fields / Detecting Areas" : "Sub-Fields / Specific Areas"}</h4>
                                    <p className="text-[11px] text-emerald-600/60 dark:text-emerald-400/60 mt-1 font-medium leading-snug">{isRally ? "Add the mapped field boundaries that can be shared in the Club Day QR pack." : "Break larger permissions into manageable working areas."}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onAddField()}
                                    className="text-xs font-black bg-emerald-600 text-white px-3 py-2 rounded-lg hover:bg-emerald-700 transition-colors shrink-0 shadow-sm"
                                >
                                    {isRally ? "+ Add Field" : "+ Add Sub-Field"}
                                </button>
                            </div>
                            {fields && fields.length > 0 ? (
                                <div className="grid grid-cols-1 gap-2">
                                    {fields.map((f) => (
                                        <div key={f.id} className="flex items-center gap-3 bg-white dark:bg-gray-800/80 border border-emerald-100 dark:border-emerald-800/60 px-3 py-2.5 rounded-xl shadow-sm">
                                            <div className="min-w-0 flex-1">
                                                <div className="font-black text-sm text-gray-800 dark:text-gray-100 truncate">{f.name}</div>
                                                <div className="text-[10px] mt-0.5 font-medium text-emerald-600/70 dark:text-emerald-400/70">
                                                    {f.boundary ? "Boundary mapped" : "No boundary yet"}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1.5 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => onShowFieldNotes(f.id)}
                                                    className={`text-[10px] font-bold underline-offset-2 hover:underline transition-colors ${f.notes ? "text-amber-700 dark:text-amber-300" : "text-gray-500 dark:text-gray-400 hover:text-amber-700 dark:hover:text-amber-300"}`}
                                                >
                                                    Notes
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => onEditField(f.id)}
                                                    className="text-[10px] font-bold text-emerald-600 hover:text-white hover:bg-emerald-600 px-2.5 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-700 transition-all"
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => onDeleteField(f.id)}
                                                    className="text-[10px] font-bold text-red-400 hover:text-red-600 px-1.5 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-all"
                                                    title="Delete sub-field"
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="bg-white/60 dark:bg-gray-800/30 border border-dashed border-emerald-200 dark:border-emerald-700/50 rounded-xl p-5 text-center grid gap-2">
                                    <p className="text-xs font-bold text-gray-500 dark:text-gray-400">{isRally ? "No rally fields added yet." : "No sub-fields added yet."}</p>
                                    <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-snug">{isRally ? "Add each field or detecting area so members can pick the right place during the event." : "Use sub-fields to split a large permission into manageable working areas."}</p>
                                    <button
                                        type="button"
                                        onClick={() => onAddField()}
                                        className="mt-1 text-xs font-black text-emerald-600 hover:text-white hover:bg-emerald-600 px-4 py-2 rounded-lg border border-emerald-200 dark:border-emerald-700 transition-all mx-auto"
                                    >
                                        {isRally ? "+ Add Field" : "+ Add Sub-Field"}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4 border-t border-emerald-100 dark:border-emerald-800 pt-4">
                        <label className="block">
                            <div className="mb-1 text-[10px] font-bold uppercase opacity-60">Latitude</div>
                            <input
                                type="number"
                                step="0.000001"
                                className="w-full bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded p-1.5 text-xs font-mono"
                                value={lat ?? ""}
                                onChange={(e) => setLat(e.target.value ? parseFloat(e.target.value) : null)}
                            />
                        </label>
                        <label className="block">
                            <div className="mb-1 text-[10px] font-bold uppercase opacity-60">Longitude</div>
                            <input
                                type="number"
                                step="0.000001"
                                className="w-full bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded p-1.5 text-xs font-mono"
                                value={lon ?? ""}
                                onChange={(e) => setLon(e.target.value ? parseFloat(e.target.value) : null)}
                            />
                        </label>
                    </div>
                </div>

                {!isRally && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <div className="text-sm font-bold text-gray-700 dark:text-gray-300">Permission Status</div>
                        {!isEdit && (
                            <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800 animate-pulse">
                                💡 Save record first to generate agreement
                            </span>
                        )}
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer group w-fit">
                        <input
                            type="checkbox"
                            checked={permissionGranted}
                            onChange={(e) => setPermissionGranted(e.target.checked)}
                            className="w-5 h-5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-emerald-600 transition-colors">Permission Granted?</span>
                    </label>

                    {permissionGranted && (
                        <div className="pt-2 animate-in fade-in slide-in-from-top-2">
                            <label className="block">
                                <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Valid From (Date of Agreement)</div>
                                <input
                                    type="date"
                                    value={validFrom}
                                    onChange={(e) => setValidFrom(e.target.value)}
                                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                />
                            </label>
                        </div>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-3 pt-2">
                  <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Notes</div>
                  <div className="flex-1 h-px bg-gray-100 dark:bg-gray-700"></div>
                </div>
                <label className="block">
                <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">{isRally ? "Event Notes" : "Land/Farm Notes"}</div>
	                <textarea
	                    value={notes}
	                    onChange={(e) => setNotes(e.target.value)}
	                    rows={4}
	                    className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
	                />
	                </label>
	                  </>
	                )}

                <div className="flex gap-4">
                    <button
                        onClick={onSave}
                        disabled={saving || !name.trim()}
                        className={`mt-4 flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-4 rounded-2xl font-black text-xl shadow-xl transition-all disabled:opacity-50 ${permissionCoachActive && permissionCoachStep === 2 ? "ring-4 ring-amber-300/40" : ""}`}
                    >
                        {saveButtonLabel}
                    </button>
                    {isEdit && (
                        <button
                            onClick={() => onCancelEdit()}
                            className="mt-4 bg-gray-100 dark:bg-gray-800 text-gray-500 px-6 py-4 rounded-2xl font-bold transition-all"
                        >
                            Cancel
                        </button>
                    )}
                </div>
              </>
            ) : (
              <div className="grid gap-8">
                <div className="grid gap-3">
                    {/* Row 1 — type badge left, finds count right (always same line) */}
                    <div className="flex items-center justify-between gap-2">
                        {/* Type badge with optional no-permission dot to its left */}
                        <div className="flex items-center gap-2">
                            {!permissionGranted && !isRally && (
                                <div className="relative flex items-center">
                                    <button
                                        onClick={() => setNoPermTooltip(v => !v)}
                                        className="relative flex items-center justify-center w-4 h-4"
                                        aria-label="No permission confirmed"
                                    >
                                        <span className="animate-ping absolute inline-flex h-2.5 w-2.5 rounded-full bg-red-400 opacity-60" />
                                        <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                                    </button>
                                    {noPermTooltip && (
                                        <>
                                            <div className="fixed inset-0 z-40" onClick={() => setNoPermTooltip(false)} />
                                            <div className="absolute left-6 top-1/2 -translate-y-1/2 z-50 bg-gray-900 text-white text-[11px] font-semibold px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg">
                                                No permission confirmed
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                            <span className={`text-[10px] uppercase tracking-widest font-black px-2 py-0.5 rounded ${type === 'rally' ? 'bg-teal-100 text-teal-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                {type === 'rally' ? 'Club/Rally Dig' : 'Individual Permission'}
                            </span>
                        </div>
                        {/* Finds count right */}
                        <span className="flex items-center gap-1 text-[10px] font-bold text-amber-500 dark:text-amber-400 whitespace-nowrap">
                            {finds?.length ?? 0} {(finds?.length ?? 0) === 1 ? 'find' : 'finds'}
                        </span>
                    </div>

                    {/* Row 2 — permission name */}
                    <h3 className="text-2xl sm:text-3xl font-black text-gray-800 dark:text-gray-100 break-words">{name}</h3>

                    {/* Club Day member banners */}
                    {isClubDayMember && (
                      <div className="flex flex-col gap-2">
                        <div className="px-3 py-2.5 bg-teal-50 dark:bg-teal-950/20 border border-teal-200 dark:border-teal-800 rounded-xl">
                          <div className="text-[9px] font-black uppercase tracking-widest text-teal-500 mb-0.5">Club / Rally permission</div>
                          <p className="text-xs text-teal-700 dark:text-teal-300 font-medium leading-relaxed">This is read-only and managed by the organiser. Record find spots and find details during the day, then send your finds export to the organiser.</p>
                          <div className="flex flex-wrap gap-2 mt-3">
                            <button
                              onClick={() => onRecordFind()}
                              className="text-[10px] font-black bg-teal-600 hover:bg-teal-500 text-white px-3 py-2 rounded-lg transition-colors uppercase tracking-widest"
                            >
                              Record Find
                            </button>
                            <button
                              onClick={() => onShowExportClubDay()}
                              className="text-[10px] font-black text-teal-700 dark:text-teal-300 bg-white dark:bg-gray-900 border border-teal-200 dark:border-teal-800 px-3 py-2 rounded-lg hover:bg-teal-50 dark:hover:bg-teal-900/30 transition-colors uppercase tracking-widest"
                            >
                              Send Finds
                            </button>
                          </div>
                        </div>
                        {submittedAt && (
                          <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 font-bold">
                            ✓ Data sent to organiser on {new Date(submittedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}. Your finds are still stored on this device.
                          </div>
                        )}
                        {significantFindInstructions && (
                          <div className="flex items-start gap-2 px-3 py-3 bg-amber-50 dark:bg-amber-950/20 border-2 border-amber-300 dark:border-amber-700 rounded-xl">
                            <span className="text-lg shrink-0">⚠️</span>
                            <div>
                              <div className="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400 mb-0.5">Significant Find?</div>
                              <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">{significantFindInstructions}</p>
                              {organiserContactNumber && (
                                <a href={`tel:${organiserContactNumber}`} className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-black text-amber-700 dark:text-amber-400 underline">
                                  📞 {organiserContactNumber}
                                </a>
                              )}
                            </div>
                          </div>
                        )}
                        {organiserContactNumber && !significantFindInstructions && (
                          <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-600 dark:text-gray-400">
                            📞 Organiser: <a href={`tel:${organiserContactNumber}`} className="font-bold text-teal-600 dark:text-teal-400 underline">{organiserContactNumber}</a>
                          </div>
                        )}
                        {clubDayPublicNotes && (
                          <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-600 dark:text-gray-400">
                            {clubDayPublicNotes}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Organiser: submitted members list */}
                    {!showOrganiserHub && !isClubDayMember && isSharedPermission && submittedMembers && submittedMembers.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Members submitted</div>
                        {submittedMembers.map(m => (
                          <div key={m.id} className="flex items-center justify-between px-3 py-2 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl">
                            <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300">✓ {m.recorderName || "Unnamed detectorist"}</span>
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-500">{new Date(m.importedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Row 3 — action buttons */}
                    <div className="flex flex-wrap gap-2 items-center">
                        {canUseAgreement && (
                          <input
                            ref={agreementUploadRef}
                            type="file"
                            accept="application/pdf,image/*,.doc,.docx,.rtf,.txt"
                            className="hidden"
                            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; onUploadAgreement(file); }}
                          />
                        )}
                        {permissionNeedsCompletion && (
                            <button
                                onClick={onCompletePermission}
                                className="text-[11px] font-black bg-emerald-600 px-3 py-1.5 rounded-lg text-white hover:bg-emerald-700 transition-all flex items-center gap-1.5 shadow-sm uppercase tracking-widest"
                            >
                                Complete Permission
                            </button>
                        )}
                        {lat != null && lon != null && (
                            <button
                                onClick={() => nav(`/fieldguide?lat=${lat}&lng=${lon}`)}
                                className="text-[11px] font-bold bg-white dark:bg-gray-800 border border-sky-200 dark:border-sky-900 px-3 py-1.5 rounded-lg text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20 hover:border-sky-400 transition-all flex items-center gap-1.5 shadow-sm"
                            >
                                FieldGuide
                            </button>
                        )}
                        {canUseAgreement && (
                        <button
                            type="button"
                            onClick={() => onOpenAgreement()}
                            className="text-[11px] font-bold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:border-emerald-400 hover:text-emerald-600 transition-all flex items-center gap-1.5 shadow-sm"
                        >
                            {generateAgreementLabel}
                        </button>
                        )}
                        {canUseAgreement && (
                          <button
                            type="button"
                            onClick={() => agreementUploadRef.current?.click()}
                            className="text-[11px] font-bold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-sky-50 dark:hover:bg-sky-900/20 hover:border-sky-400 hover:text-sky-600 transition-all flex items-center gap-1.5 shadow-sm"
                          >
                            {uploadAgreementLabel}
                          </button>
                        )}
                    </div>
                    {canUseAgreement && agreementFile && (
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold truncate">
                        Agreement file: {agreementFile.filename}
                      </p>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="grid gap-4">
                        <div>
                            <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 text-emerald-600 dark:text-emerald-400">{isRally ? "Organiser / Contact" : "Landowner / Contact"}</h4>
                            <p className="font-bold text-gray-700 dark:text-gray-300">{landownerName || "Not recorded"}</p>
                            {landownerPhone && <p className="text-sm opacity-60">📞 {landownerPhone}</p>}
                            {landownerEmail && <p className="text-sm opacity-60">✉️ {landownerEmail}</p>}
                            {!isRally && landownerAddress && <p className="text-sm opacity-60 mt-1 italic">📍 {landownerAddress}</p>}
                        </div>
                        {!isRally && (
                        <div>
                            <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 text-emerald-600 dark:text-emerald-400">Land Details</h4>
                            <div className="flex justify-between items-center">
                                <div>
                                    <p className="font-bold text-gray-700 dark:text-gray-300 capitalize">{landType}</p>
                                    {(() => {
                                        const fieldsWithBoundary = (fields ?? []).filter(f => f.boundary);
                                        let acres: number | null = null;
                                        if (fieldsWithBoundary.length > 0) {
                                            acres = fieldsWithBoundary.reduce((sum, f) => sum + turfArea(f.boundary) / 4046.86, 0);
                                        } else if (boundary) {
                                            acres = turfArea(boundary) / 4046.86;
                                        }
                                        return acres !== null ? (
                                            <p className="text-[10px] font-bold text-gray-400 dark:text-white/80 mt-0.5">{acres.toFixed(1)} acres</p>
                                        ) : null;
                                    })()}
                                </div>
                                {validFrom && (
                                    <div className="text-right">
                                        <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 text-emerald-600 dark:text-emerald-400">Valid From</h4>
                                        <p className="text-xs font-bold text-gray-700 dark:text-gray-300">{new Date(validFrom).toLocaleDateString()}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                        )}
                        {isRally && validFrom && (
                        <div>
                            <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 text-emerald-600 dark:text-emerald-400">Event Date</h4>
                            <p className="font-bold text-gray-700 dark:text-gray-300">{new Date(validFrom).toLocaleDateString()}</p>
                        </div>
                        )}
                    </div>

                    <div className="grid gap-4">
                        <div>
                            <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 text-emerald-600 dark:text-emerald-400">Base Location</h4>
                            {lat != null && lon != null ? (
                                <div className="flex flex-col gap-1">
                                    <p className="font-mono font-bold text-emerald-600">{lat.toFixed(6)}, {lon.toFixed(6)}</p>
                                    <button
                                        onClick={() => window.open(`https://www.google.com/maps?q=${lat},${lon}`, "_blank")}
                                        className="text-[10px] font-bold text-gray-400 hover:text-emerald-600 transition-colors flex items-center gap-1"
                                    >
                                        View on Google Maps ↗
                                    </button>
                                </div>
                            ) : (
                                <p className="text-sm opacity-40 italic">Coordinates not set</p>
                            )}
                        </div>
                        <div className="relative">
                            <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 text-emerald-600 dark:text-emerald-400">Default Detectorist</h4>
                            <p className="font-bold text-gray-700 dark:text-gray-300">{collector || "Not set"}</p>
                            {(ncmdNumber || ncmdExpiry) && (
                                <div className="mt-1 text-[10px] font-bold text-emerald-600 flex flex-wrap gap-x-3">
                                    {ncmdNumber && <span>{insuranceProvider || 'Insurance'}: {ncmdNumber}</span>}
                                    {ncmdExpiry && <span>Exp: {new Date(ncmdExpiry).toLocaleDateString()}</span>}
                                </div>
                            )}
                            {!isRally && (
                            <button
                                onClick={() => onOpenProof()}
                                className="absolute bottom-0 right-0 text-xs font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1.5 rounded-lg border-2 border-emerald-100 dark:border-emerald-800 hover:bg-emerald-100 transition-all flex items-center gap-1 shadow-sm"
                            >
                                Proof
                            </button>
                            )}
                        </div>
                    </div>
                </div>

                {notes && (
                    <div className="bg-gray-50 dark:bg-gray-900/50 p-6 rounded-2xl border border-gray-100 dark:border-gray-800">
                        <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-2">Notes</h4>
                        <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{notes}</p>
                    </div>
                )}

                {(boundary || (fields && fields.length > 0)) && (
                    <div className="bg-emerald-50/30 dark:bg-emerald-900/10 p-4 rounded-xl border border-emerald-100 dark:border-emerald-800/30">
                        <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
                            <div>
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                                  {isClubDayMember ? "Event Fields" : (isRally ? "Rally Boundary & Fields" : "Permission Boundary & Coverage")}
                                </h4>
                                <p className="text-[10px] opacity-60 italic mt-0.5 font-medium">
                                  {isClubDayMember
                                    ? "Use Locate for bearings, then record finds against the right field"
                                    : `Tracking data from all ${sessions?.length} sessions`}
                                </p>
                            </div>
                            {!isClubDayMember && (
                              <div className="text-[10px] text-emerald-600 font-bold bg-emerald-50 dark:bg-emerald-900/30 px-3 py-1 rounded-lg border border-emerald-100 dark:border-emerald-800 animate-pulse">
                                {isRally ? "💡 Tap 'Show Gaps' on fields below" : "💡 Tap 'Show Gaps' on sub-fields below"}
                              </div>
                            )}
                        </div>

                        {/* Map Preview */}
                        <div className="relative h-72 w-full rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-inner bg-gray-100 dark:bg-gray-900">
                            <div ref={mapDivRef} className="absolute inset-0" />
                            {/* Basemap toggle */}
                            <div className="absolute top-2 left-2 z-10 flex gap-1 bg-white/90 dark:bg-gray-800/90 backdrop-blur p-1 rounded-xl shadow-md border border-gray-200 dark:border-gray-700">
                                {BASEMAP_MODES.map(m => (
                                    <button
                                        key={m.id}
                                        onClick={() => setMapStyle(m.id)}
                                        aria-pressed={mapStyle === m.id}
                                        className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                                            mapStyle === m.id
                                                ? "bg-emerald-600 text-white shadow-sm"
                                                : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                                        }`}
                                    >
                                        {m.emoji} {m.label}
                                    </button>
                                ))}
                            </div>

                            {/* Permission-level stats — shown when boundary tapped and no sub-fields exist */}
                            {permissionSelected && (!fields || fields.length === 0) && (
                                <div className="absolute bottom-3 left-3 right-3 bg-gray-900/90 backdrop-blur-sm rounded-xl border border-emerald-500/40 p-3 shadow-lg">
                                    <div className="flex items-center justify-between mb-2">
                                        <p className="text-[9px] font-black uppercase tracking-widest text-emerald-400">Permission Area</p>
                                        <button onClick={() => setPermissionSelected(false)} aria-label="Close permission area summary" className="text-white/40 hover:text-white/80 text-xs leading-none">×</button>
                                    </div>
                                    <div className="flex gap-4">
                                        <div>
                                            <p className="text-lg font-black text-white leading-none">{finds?.filter(f => !f.isPending).length ?? 0}</p>
                                            <p className="text-[9px] text-white/50 uppercase tracking-widest">Finds</p>
                                        </div>
                                        <div>
                                            <p className="text-lg font-black text-white leading-none">{isClubDayMember ? (fields?.length ?? 0) : (sessions?.length ?? 0)}</p>
                                            <p className="text-[9px] text-white/50 uppercase tracking-widest">{isClubDayMember ? "Fields" : "Sessions"}</p>
                                        </div>
                                        {pendingFinds && pendingFinds.length > 0 && (
                                            <div>
                                                <p className="text-lg font-black text-amber-400 leading-none">{pendingFinds.length}</p>
                                                <p className="text-[9px] text-white/50 uppercase tracking-widest">Pending</p>
                                            </div>
                                        )}
                                    </div>
                                    {(!fields || fields.length === 0) && (
                                        <p className="text-[9px] text-white/30 mt-2 italic">
                                          {isClubDayMember ? "Record finds against the whole event if no fields were shared" : (isRally ? "Add fields to track coverage per area" : "Add sub-fields to track coverage per area")}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Sub-Fields Carousel */}
                        {fields !== undefined && (
                            <div className="mt-6 grid gap-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <h4 className="text-xs font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
                                            {isRally ? "Fields" : "Sub-Fields"}
                                            {fields.length > 0 && <span className="ml-2 font-black bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full text-[10px]">{fields.length}</span>}
                                        </h4>
                                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 font-medium">
                                            {fields.length > 0
                                              ? (isClubDayMember ? "Use Locate for bearings, or Record Find to log a find in that field" : "Tap on a field on the map or scroll to select")
                                              : (isRally ? "Add named field boundaries for the event" : "Divide your permission into named detecting areas")}
                                        </p>
                                    </div>
                                    {!isClubDayMember && (
                                      <button
                                          type="button"
                                          onClick={() => onAddField()}
                                          className="text-xs font-black bg-emerald-600 text-white px-3 py-2 rounded-lg hover:bg-emerald-700 transition-colors shrink-0 shadow-sm"
                                      >
                                          {isRally ? "+ Add Field" : "+ Add Sub-Field"}
                                      </button>
                                    )}
                                </div>
                                {fields.length === 0 && (
                                    <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                                      {isClubDayMember
                                        ? "No fields were shared. Use Record Find to save finds against the event."
                                        : `${isRally ? "No fields added yet" : "No sub-fields added yet"} — tap the button above to get started.`}
                                    </p>
                                )}
                                <div
                                    ref={fieldScrollRef}
                                    className="grid gap-3 overflow-y-auto scroll-smooth"
                                    style={{ maxHeight: "460px", scrollbarWidth: "none" }}
                                >
                                    {fields.map(f => {
                                        const fieldCounts = fieldFindCounts.get(f.id);
                                        const recordedCount = fieldCounts?.recorded ?? 0;
                                        const pendingCount = fieldCounts?.pending ?? 0;
                                        return (
                                        <div
                                            key={f.id}
                                            ref={(el) => { if (el) fieldRefs.current.set(f.id, el); else fieldRefs.current.delete(f.id); }}
                                            className={`bg-white dark:bg-gray-800 border rounded-xl shadow-sm flex flex-col transition-all duration-300 cursor-pointer ${selectedFieldId === f.id ? "border-emerald-400 dark:border-emerald-500 ring-2 ring-emerald-300/50 dark:ring-emerald-700/50" : "border-emerald-100 dark:border-emerald-800/60"}`}
                                            onClick={(e) => {
                                                if ((e.target as HTMLElement).closest("button")) return;
                                                setSelectedFieldId(f.id);
                                                const map = mapRef.current;
                                                if (map && f.boundary?.coordinates?.[0]) {
                                                    const bounds = new maplibregl.LngLatBounds();
                                                    (f.boundary.coordinates[0] as [number, number][]).forEach((p) => {
                                                        if (Array.isArray(p) && p.length >= 2) bounds.extend(p);
                                                    });
                                                    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 50, duration: 600 });
                                                }
                                            }}
                                        >
                                            <div className="p-3 flex-1">
                                                <div className="flex justify-between items-start gap-2 mb-1.5">
                                                    <div className="min-w-0">
                                                        <div className="font-black text-sm text-gray-800 dark:text-gray-100 truncate">{f.name}</div>
                                                        <div className="text-[10px] font-medium text-emerald-600/70 dark:text-emerald-400/70 mt-0.5">
                                                            {f.boundary ? "Boundary mapped" : "No boundary"}
                                                        </div>
                                                    </div>
                                                    <div className="shrink-0 flex flex-col items-end gap-0.5">
                                                        {f.boundary && (
                                                            <div className="text-[10px] font-medium text-gray-400 dark:text-gray-500 whitespace-nowrap">
                                                                {(turfArea(f.boundary) / 4046.86).toFixed(1)} acres
                                                            </div>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => onShowFieldNotes(f.id)}
                                                            className={`text-[9px] font-black uppercase tracking-widest underline-offset-2 hover:underline transition-colors ${f.notes ? "text-amber-800 dark:text-amber-300" : "text-amber-700 dark:text-amber-400"}`}
                                                        >
                                                            Notes
                                                        </button>
                                                    </div>
                                                </div>
                                                {(recordedCount > 0 || pendingCount > 0) && (
                                                    <div className="flex flex-wrap gap-1.5 mb-2">
                                                        {recordedCount > 0 && (
                                                            <span className="text-[9px] font-black uppercase tracking-widest bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-800 rounded-lg px-2 py-1">
                                                                {recordedCount} {recordedCount === 1 ? "find" : "finds"}
                                                            </span>
                                                        )}
                                                        {pendingCount > 0 && (
                                                            <span className="text-[9px] font-black uppercase tracking-widest bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-100 dark:border-amber-800 rounded-lg px-2 py-1">
                                                                {pendingCount} pending
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                                {f.notes && <div className="text-[10px] text-gray-400 dark:text-gray-500 line-clamp-2 italic mb-2">{f.notes}</div>}
                                                <div className="flex flex-wrap gap-1.5 mt-2">
                                                    {f.boundary && (
                                                        <button
                                                            onClick={() => {
                                                                setSelectedFieldId(f.id);
                                                                const map = mapRef.current;
                                                                if (map && f.boundary?.coordinates?.[0]) {
                                                                    const bounds = new maplibregl.LngLatBounds();
                                                                    (f.boundary.coordinates[0] as [number, number][]).forEach((p) => {
                                                                        if (Array.isArray(p) && p.length >= 2) bounds.extend(p);
                                                                    });
                                                                    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 50, duration: 600 });
                                                                }
                                                            }}
                                                            className={`text-[9px] font-black px-2 py-1 rounded-lg border transition-all ${selectedFieldId === f.id ? "bg-emerald-600 border-emerald-600 text-white" : "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 hover:border-emerald-400"}`}
                                                        >
                                                            Locate
                                                        </button>
                                                    )}
                                                    {!isClubDayMember && (
                                                    <button
                                                        onClick={() => {
                                                            const next = new Set(shownFieldGapIds);
                                                            if (next.has(f.id)) next.delete(f.id);
                                                            else next.add(f.id);
                                                            setShownFieldGapIds(next);
                                                        }}
                                                        className={`text-[9px] font-black px-2 py-1 rounded-lg border transition-all ${shownFieldGapIds.has(f.id) ? 'bg-orange-600 border-orange-600 text-white shadow-sm' : 'bg-orange-50 dark:bg-orange-950/20 border-orange-100 dark:border-orange-900 text-orange-700 dark:text-orange-400 hover:border-orange-400'}`}
                                                    >
                                                        {shownFieldGapIds.has(f.id) ? 'Gaps On' : 'Show Gaps'}
                                                        {shownFieldGapIds.has(f.id) && fieldGapResults.get(f.id) && (
                                                            <span className="ml-1 opacity-80">{Math.round(100 - fieldGapResults.get(f.id)!.percentCovered)}% left</span>
                                                        )}
                                                        {shownFieldGapIds.has(f.id) && fieldGapErrors.has(f.id) && (
                                                            <span className="ml-1">Error</span>
                                                        )}
                                                    </button>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 border-t border-gray-100 dark:border-gray-800 px-3 py-2">
                                                <button
                                                    onClick={() => isClubDayMember ? onRecordFind(f.id) : nav(`/session/new?permissionId=${permissionId}&fieldId=${f.id}`)}
                                                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black py-1.5 rounded-lg transition-colors shadow-sm"
                                                >
                                                    {isClubDayMember ? "Record Find" : "Start Session"}
                                                </button>
                                                {!isClubDayMember && (
                                                  <>
                                                    <button
                                                        onClick={() => onEditField(f.id)}
                                                        className="px-2.5 py-1.5 text-[10px] font-bold text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors border border-emerald-100 dark:border-emerald-800"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        onClick={() => onDeleteField(f.id)}
                                                        className="py-1.5 px-2 text-[11px] font-bold text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 rounded-lg transition-colors"
                                                        title="Delete sub-field"
                                                    >
                                                        Delete
                                                    </button>
                                                  </>
                                                )}
                                            </div>
                                        </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}
              </div>
            )}
        </div>
    );
}
