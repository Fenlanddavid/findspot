import React, { useEffect, useState, useMemo } from "react";
import { db, Permission, Find, Media } from "../db";
import { v4 as uuid } from "uuid";
import { captureGPS } from "../services/gps";
import { getSetting } from "../services/data";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { FindRow } from "../components/FindRow";
import { FindModal } from "../components/FindModal";
import { ScaledImage } from "../components/ScaledImage";
import PermissionReportModal from "../components/PermissionReportModal";
import { AgreementModal } from "../components/AgreementModal";
import { LocationPickerModal } from "../components/LocationPickerModal";
import { BoundaryPickerModal } from "../components/BoundaryPickerModal";
import { FieldModal } from "../components/FieldModal";
import PermissionProofModal from "../components/PermissionProofModal";
import { calculateCoverage, CoverageResult } from "../services/coverage";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const landTypes: Permission["landType"][] = [
  "arable", "pasture", "woodland", "scrub", "parkland", "beach", "foreshore", "other",
];

export default function PermissionPage(props: {
  projectId: string;
  onSaved: (id: string) => void;
}) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const nav = useNavigate();
  const isEdit = !!id;

  const [name, setName] = useState("");
  const typeParam = searchParams.get("type");
  const [type, setType] = useState<Permission["type"]>(typeParam === "rally" ? "rally" : "individual");
  const [collector, setCollector] = useState("");
  const [observedAt, setObservedAt] = useState(new Date().toISOString().slice(0, 16));
  const [lat, setLat] = useState<number | null>(null);
  const [lon, setLon] = useState<number | null>(null);
  const [acc, setAcc] = useState<number | null>(null);

  const [landownerName, setLandownerName] = useState("");
  const [landownerPhone, setLandownerPhone] = useState("");
  const [landownerEmail, setLandownerEmail] = useState("");
  const [landownerAddress, setLandownerAddress] = useState("");

  const [landType, setLandType] = useState<Permission["landType"]>("arable");
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [validFrom, setValidFrom] = useState("");
  const [insuranceProvider, setInsuranceProvider] = useState("");
  const [ncmdNumber, setNcmdNumber] = useState("");
  const [ncmdExpiry, setNcmdExpiry] = useState("");
  const [detectoristName, setDetectoristName] = useState("");
  const [detectoristEmail, setDetectoristEmail] = useState("");

  const [landUse, setLandUse] = useState("");
  const [cropType, setCropType] = useState("");
  const [isStubble, setIsStubble] = useState(false);
  const [notes, setNotes] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [isEditing, setIsEditing] = useState(!isEdit);
  const [isPickingLocation, setIsPickingLocation] = useState(false);
  const [isPickingBoundary, setIsPickingBoundary] = useState(false);
  const [boundary, setBoundary] = useState<any | null>(null);
  const [showCoverage, setShowCoverage] = useState(false);
  const [shownFieldGapIds, setShownFieldGapIds] = useState<Set<string>>(new Set());
  const [fieldGapResults, setFieldGapResults] = useState<Map<string, CoverageResult>>(new Map());
  const [coverageResult, setCoverageResult] = useState<CoverageResult | null>(null);
  const [agreementId, setAgreementId] = useState<string | undefined>();
  const [agreementModalOpen, setAgreementModalOpen] = useState(false);
  const [proofModalOpen, setProofModalOpen] = useState(false);
  
  const [openFindId, setOpenFindId] = useState<string | null>(null);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [isAddingField, setIsAddingField] = useState(false);
  const [reportDropdownOpen, setReportDropdownOpen] = useState(false);
  const [noPermTooltip, setNoPermTooltip] = useState(false);
  // null = closed; undefined = whole permission; string = specific fieldId
  const [reportTarget, setReportTarget] = useState<string | undefined | null>(null);

  const fields = useLiveQuery(async () => {
    if (!id) return [];
    return db.fields.where("permissionId").equals(id).reverse().sortBy("createdAt");
  }, [id]);

  const agreementFile = useLiveQuery(async () => {
    if (!agreementId) return null;
    return db.media.get(agreementId);
  }, [agreementId]);

  // Fetch finds for this trip
  const finds = useLiveQuery(async () => {
    if (!id) return [];
    return db.finds.where("permissionId").equals(id).filter(f => !f.isPending).reverse().sortBy("createdAt");
  }, [id]);

  const pendingFinds = useLiveQuery(async () => {
    if (!id) return [];
    return db.finds.where("permissionId").equals(id).filter(f => !!f.isPending).reverse().sortBy("createdAt");
  }, [id]);

  const standaloneFinds = useLiveQuery(async () => {
    if (!id) return [];
    return db.finds.where("permissionId").equals(id).filter(f => !f.isPending && !f.sessionId).reverse().sortBy("createdAt");
  }, [id]);

  const sessions = useLiveQuery(async () => {
    if (!id) return [];
    const rows = await db.sessions
      .where("permissionId")
      .equals(id)
      .toArray();

    // Sort by date (descending), then by createdAt (descending)
    rows.sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      if (dateB !== dateA) return dateB - dateA;
      const bDate = b?.createdAt || "";
      const aDate = a?.createdAt || "";
      return bDate.localeCompare(aDate);
    });
    
    // Fetch counts and tracks in parallel for all sessions
    return Promise.all(rows.map(async (s) => {
      const field = s.fieldId ? await db.fields.get(s.fieldId) : null;
      const findCount = await db.finds.where("sessionId").equals(s.id).count();
      const sessionTracks = await db.tracks.where("sessionId").equals(s.id).toArray();
      
      let durationMs = 0;
      if (sessionTracks.length > 0) {
        const allPoints = sessionTracks
          .flatMap(t => t.points || [])
          .filter(p => !!p && typeof p.timestamp === 'number')
          .sort((a, b) => a.timestamp - b.timestamp);
          
        if (allPoints.length > 1) {
          durationMs = allPoints[allPoints.length - 1].timestamp - allPoints[0].timestamp;
        }
      }

      return { ...s, fieldName: field?.name, findCount, hasTracking: sessionTracks.length > 0, durationMs };
    }));
  }, [id]);

  function formatDuration(ms: number) {
    if (ms <= 0) return null;
    const mins = Math.floor(ms / 60000);
    const hrs = Math.floor(mins / 600);
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    return `${mins}m`;
  }

  // Fetch all media for the report
  const allMedia = useLiveQuery(async () => {
    if (!id || !finds || finds.length === 0) return [];
    const ids = finds.map(s => s.id).filter(Boolean);
    if (ids.length === 0) return [];
    return db.media.where("findId").anyOf(ids).toArray();
  }, [id, finds]);

  // Fetch thumbnails and scale info for the finds
  const findThumbMedia = useMemo(() => {
    const info = new Map<string, Media>();
    if (!allMedia || !finds) return info;
    
    const sortedMedia = [...allMedia].sort((a, b) => {
        const aDate = a?.createdAt || "";
        const bDate = b?.createdAt || "";
        return aDate.localeCompare(bDate);
    });
    for (const row of sortedMedia) {
      if (row.findId && !info.has(row.findId)) {
        info.set(row.findId, row);
      }
    }
    return info;
  }, [allMedia, finds]);

  const allTracks = useLiveQuery(async () => {
    if (!id) return [];
    const sessions = await db.sessions.where("permissionId").equals(id).toArray();
    const sessionIds = sessions.map(s => s.id).filter(Boolean);
    if (sessionIds.length === 0) return [];
    return db.tracks.where("sessionId").anyOf(sessionIds).toArray();
  }, [id]);

  useEffect(() => {
    if (!showCoverage || !boundary) {
        setCoverageResult(null);
    } else {
        setCoverageResult(calculateCoverage(boundary, allTracks || []));
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
        const unassignedSessions = await db.sessions.where("permissionId").equals(id!).filter(s => !s.fieldId).toArray();
        const unassignedSessionIds = new Set(unassignedSessions.map(s => s.id));

        // Filter allTracks for either explicitly assigned or unassigned sessions
        const fieldTracks = (allTracks ?? []).filter(t => 
            t.sessionId && (fieldSessionIds.has(t.sessionId) || unassignedSessionIds.has(t.sessionId))
        );
        
        const result = calculateCoverage(field.boundary, fieldTracks);
        return { fId, result };
    })).then(results => {
        const next = new Map<string, CoverageResult>();
        results.forEach(r => {
            if (r && r.result) next.set(r.fId, r.result);
        });
        setFieldGapResults(next);
    });
  }, [showCoverage, shownFieldGapIds, boundary, allTracks]);

  const mapDivRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    const hasData = boundary || (fields && fields.length > 0);
    if (!mapDivRef.current || !hasData) return;

    if (!mapRef.current) {
        const map = new maplibregl.Map({
            container: mapDivRef.current,
            style: {
                version: 8,
                sources: {
                    "raster-tiles": {
                        type: "raster",
                        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
                        tileSize: 256,
                        attribution: "© Esri World Imagery"
                    }
                },
                layers: [{ id: "base", type: "raster", source: "raster-tiles", minzoom: 0, maxzoom: 22 }]
            },
            center: [lon || -2, lat || 54.5],
            zoom: 16,
        });

        map.on("load", () => {
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

            // Add Sub-Fields Source
            map.addSource("fields-boundary", {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] }
            });

            map.addLayer({
                id: "fields-outline",
                type: "line",
                source: "fields-boundary",
                paint: { "line-color": "#0d9488", "line-width": 2 }
            });

            map.addLayer({
                id: "field-labels",
                type: "symbol",
                source: "fields-boundary",
                layout: {
                    "text-field": ["get", "name"],
                    "text-size": 10,
                    "text-font": ["Open Sans Bold"],
                    "text-anchor": "center"
                },
                paint: {
                    "text-color": "#ffffff",
                    "text-halo-color": "#0d9488",
                    "text-halo-width": 1
                }
            });

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
                    properties: { name: f.name }
                }))
            } as any);
        }

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
    }

    return () => {
        if (mapRef.current) {
            mapRef.current.remove();
            mapRef.current = null;
        }
    };
  }, [boundary, fields, id, isEditing]);

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

  useEffect(() => {
    getSetting("insuranceProvider", "").then(setInsuranceProvider);
    getSetting("ncmdNumber", "").then(setNcmdNumber);
    getSetting("ncmdExpiry", "").then(setNcmdExpiry);
    getSetting("detectorist", "").then(setDetectoristName);
    getSetting("detectoristEmail", "").then(setDetectoristEmail);

    if (id) {
      db.permissions.get(id).then(l => {
        if (l) {
          setName(l.name);
          setType(l.type || "individual");
          setCollector(l.collector);
          setLat(l.lat);
          setLon(l.lon);
          setAcc(l.gpsAccuracyM);
          setLandownerName(l.landownerName || "");
          setLandownerPhone(l.landownerPhone || "");
          setLandownerEmail(l.landownerEmail || "");
          setLandownerAddress(l.landownerAddress || "");
          setLandType(l.landType);
          setPermissionGranted(l.permissionGranted);
          setValidFrom(l.validFrom || "");
          setBoundary(l.boundary);
          setAgreementId((l as any).agreementId);
          setNotes(l.notes);
        }
        setLoading(false);
      }).catch(err => {
        console.error("Failed to load permission:", err);
        setError("Could not load permission details. The database might be busy or migrating.");
        setLoading(false);
      });
    } else {
      getSetting("detectorist", "").then(setCollector);
    }
  }, [id]);

  async function doGPS() {
    setError(null);
    try {
      const fix = await captureGPS();
      setLat(fix.lat);
      setLon(fix.lon);
      setAcc(fix.accuracyM);
    } catch (e: any) {
      setError(e?.message ?? "GPS failed");
    }
  }

  async function handleDelete() {
    if (!id) return;
    if (!confirm("Are you sure? This will permanently delete this permission, all sessions, and all finds.")) return;
    
    setSaving(true);
    try {
      await db.transaction("rw", db.permissions, db.sessions, db.finds, db.media, async () => {
        const finds = await db.finds.where("permissionId").equals(id).toArray();
        const findIds = finds.map(s => s.id);
        await db.media.where("findId").anyOf(findIds).delete();
        await db.finds.where("permissionId").equals(id).delete();
        await db.sessions.where("permissionId").equals(id).delete();
        await db.permissions.delete(id);
      });
      nav("/");
    } catch (e: any) {
      setError("Delete failed: " + e.message);
      setSaving(false);
    }
  }

  async function handleDeleteField(fieldId: string) {
    if (!confirm("Are you sure? This will permanently delete this field. Sessions previously assigned to this field will remain but will no longer be linked to it.")) return;
    
    try {
      await db.fields.delete(fieldId);
    } catch (e: any) {
      setError("Delete field failed: " + e.message);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      const finalId = id || uuid();

      const permission: Permission = {
        id: finalId,
        projectId: props.projectId,
        name,
        type,
        lat,
        lon,
        gpsAccuracyM: acc,
        collector,
        landownerName,
        landownerPhone,
        landownerEmail,
        landownerAddress,
        landType,
        permissionGranted,
        validFrom,
        boundary,
        agreementId,
        notes,
        createdAt: isEdit ? undefined as any : now, 
        updatedAt: now,
      };

      if (isEdit) {
        await db.permissions.update(id, permission);
        
        // Auto-create "Main Field" if a boundary exists but NO fields exist yet
        if (boundary) {
            const fieldCount = await db.fields.where("permissionId").equals(id).count();
            if (fieldCount === 0) {
                const fieldId = uuid();
                await db.fields.add({
                    id: fieldId,
                    projectId: props.projectId,
                    permissionId: id,
                    name: "Main Field",
                    boundary: boundary,
                    notes: "Automatically created from permission boundary",
                    createdAt: now,
                    updatedAt: now
                });
            }
        }

        setIsEditing(false);
        setSaved(true);
      } else {
        (permission as any).createdAt = now;
        await db.permissions.add(permission);

        // Auto-create "Main Field" if a boundary was defined during creation
        if (boundary) {
            const fieldId = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
            await db.fields.add({
                id: fieldId,
                projectId: props.projectId,
                permissionId: finalId,
                name: "Main Field",
                boundary: boundary,
                notes: "Automatically created from initial permission boundary",
                createdAt: now,
                updatedAt: now
            });
        }

        setIsEditing(false);
        props.onSaved(finalId);
      }
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-10 text-center opacity-50 font-medium">Loading details...</div>;

  const currentPermission: Permission | null = id ? {
    id, projectId: props.projectId, name, type, lat, lon, gpsAccuracyM: acc, collector,
    landownerName, landownerPhone, landownerEmail, landownerAddress,
    landType, permissionGranted, validFrom, notes,
    createdAt: "", updatedAt: ""
  } : null;

  return (
    <div className="max-w-4xl mx-auto pb-20 px-4">
      <div className="no-print grid gap-8 mt-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex flex-wrap gap-3 items-center">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100">{isEdit ? `Land/Permission Details` : "New Permission"}</h2>
                {isEdit && !isEditing && (
                    <button 
                        onClick={() => setIsEditing(true)}
                        className="text-xs font-bold text-emerald-600 hover:text-white hover:bg-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800 transition-all"
                    >
                        ✎ Edit Details
                    </button>
                )}
            </div>
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                {isEdit && (
                    <>
                        {/* Landowner report dropdown */}
                        <div className="relative flex-1 sm:flex-none">
                            <button
                                onClick={() => setReportDropdownOpen(v => !v)}
                                className="w-full text-xs sm:text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-4 py-1.5 rounded-lg shadow-sm transition-all flex items-center justify-center gap-1.5"
                            >
                                📄 Landowner Report
                                <svg className={`w-3 h-3 shrink-0 transition-transform ${reportDropdownOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                            </button>
                            {reportDropdownOpen && (
                                <>
                                <div className="fixed inset-0 z-40" onClick={() => setReportDropdownOpen(false)} />
                                <div
                                    className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden min-w-[220px]"
                                >
                                    <div className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                                        Landowner Report
                                    </div>
                                    <button
                                        onClick={() => { setReportTarget(undefined); setReportDropdownOpen(false); }}
                                        className="w-full text-left px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors flex items-center gap-2"
                                    >
                                        <span className="text-base">🗂️</span>
                                        <div>
                                            <div>All Finds</div>
                                            <div className="text-[11px] font-normal text-gray-400">Entire permission</div>
                                        </div>
                                    </button>
                                    {fields && fields.length > 0 && (
                                        <>
                                            <div className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700">
                                                By Field
                                            </div>
                                            {fields.map(field => (
                                                <button
                                                    key={field.id}
                                                    onClick={() => { setReportTarget(field.id); setReportDropdownOpen(false); }}
                                                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors flex items-center gap-2"
                                                >
                                                    <span className="text-base">🌿</span>
                                                    {field.name}
                                                </button>
                                            ))}
                                        </>
                                    )}
                                </div>
                                </>
                            )}
                        </div>
                        <button
                            onClick={handleDelete}
                            disabled={saving}
                            className="text-xs sm:text-sm font-medium text-red-400 hover:text-red-600 px-3 py-1.5 rounded-lg border border-transparent hover:border-red-200 dark:hover:border-red-800 transition-all disabled:opacity-50 flex-1 sm:flex-none"
                        >
                            Delete
                        </button>
                    </>
                )}
            </div>
        </div>

        {error && (
            <div className="border-2 border-red-200 bg-red-50 text-red-800 p-4 rounded-xl shadow-sm animate-in fade-in slide-in-from-top-2 font-medium flex gap-3 items-center">
                <span className="text-xl">⚠️</span> {error}
            </div>
        )}
        {saved && (
            <div className="border-2 border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 p-4 rounded-xl shadow-sm flex gap-3 items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-emerald-600 rounded-full flex items-center justify-center text-white font-black text-lg shrink-0">✓</div>
                    <div>
                        <div className="font-black text-emerald-700 dark:text-emerald-300">Permission saved</div>
                        <div className="text-xs opacity-70 font-medium mt-0.5">Ready to use with finds, sessions, and coverage</div>
                    </div>
                </div>
                <button onClick={() => setSaved(false)} className="text-xs opacity-60 hover:opacity-100 shrink-0">Dismiss</button>
            </div>
        )}

        <div className="grid lg:grid-cols-3 gap-8">
            {/* Left Column: Permission Info */}
            <div className="lg:col-span-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm grid gap-6 h-fit">
                {isEditing ? (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Permission Details</div>
                      <div className="flex-1 h-px bg-gray-100 dark:bg-gray-700"></div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-1.5 p-1.5 bg-gray-100 dark:bg-gray-900 rounded-xl w-full sm:w-fit border border-gray-200 dark:border-gray-800">
                        <button
                            onClick={() => setType("individual")}
                            className={`flex-1 sm:flex-none px-5 py-2.5 rounded-lg text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-2 ${type === "individual" ? "bg-white dark:bg-gray-800 shadow-md text-emerald-600 ring-1 ring-emerald-200 dark:ring-emerald-800" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"}`}
                        >
                            <span>👤</span> Individual Permission
                        </button>
                        <button
                            onClick={() => setType("rally")}
                            className={`flex-1 sm:flex-none px-5 py-2.5 rounded-lg text-xs sm:text-sm font-black transition-all flex items-center justify-center gap-2 ${type === "rally" ? "bg-white dark:bg-gray-800 shadow-md text-teal-600 ring-1 ring-teal-200 dark:ring-teal-800" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"}`}
                        >
                            <span>🏕️</span> Club/Rally Dig
                        </button>
                    </div>

                    <label className="block">
                    <div className="mb-2 text-sm font-black text-gray-800 dark:text-gray-200">{type === 'rally' ? 'Rally / Event Name' : 'Permission Name / Location'}</div>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={type === 'rally' ? "e.g., Weekend Rally, Club Dig North" : "e.g., Smith's Farm, North Field"}
                        className="w-full bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-600 rounded-xl p-4 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all font-bold text-base"
                    />
                    </label>

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

                    <div className="flex items-center gap-3 pt-2">
                      <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Field Setup & Geometry</div>
                      <div className="flex-1 h-px bg-gray-100 dark:bg-gray-700"></div>
                    </div>
                    <div className="bg-emerald-50/50 dark:bg-emerald-900/20 p-5 rounded-2xl border-2 border-emerald-100/50 dark:border-emerald-800/30 grid gap-4">
                        <div className="flex flex-col sm:flex-row gap-2">
                            <button
                                type="button"
                                onClick={() => setIsPickingBoundary(true)}
                                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold border-2 shadow-sm transition-all ${boundary ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-emerald-400 hover:text-emerald-600'}`}
                            >
                                <span>📐</span>
                                <span>{boundary ? "Boundary Set ✓" : "Define Boundary"}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsPickingLocation(true)}
                                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-2 border-gray-200 dark:border-gray-700 shadow-sm hover:border-emerald-400 hover:text-emerald-600 transition-all"
                            >
                                <span>🗺️</span>
                                <span>Pick Centre</span>
                            </button>
                            <button
                                type="button"
                                onClick={doGPS}
                                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white border-2 border-emerald-600 shadow-sm transition-all"
                            >
                                <span>📍</span>
                                <span>{lat ? "Refresh GPS" : "Get GPS"}</span>
                            </button>
                        </div>

                        {!boundary && (!fields || fields.length === 0) && (
                            <div className="text-[11px] text-emerald-700/70 dark:text-emerald-400/60 bg-emerald-50/80 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-800/40 rounded-xl px-4 py-3 font-medium flex items-start gap-2">
                                <span className="shrink-0 mt-0.5">💡</span>
                                <span>Set the boundary, then split it into sub-fields — one per field or pasture.</span>
                            </div>
                        )}

                        {/* Sub-Fields inside Geometry box */}
                        {isEdit && (
                            <div className="grid gap-3 border-t-2 border-emerald-200/70 dark:border-emerald-700/50 pt-5 mt-1">
                                <div className="flex justify-between items-start gap-3">
                                    <div>
                                        <h4 className="text-xs font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">Sub-Fields / Specific Areas</h4>
                                        <p className="text-[11px] text-emerald-600/60 dark:text-emerald-400/60 mt-1 font-medium leading-snug">Break larger permissions into manageable working areas.</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsAddingField(true)}
                                        className="text-xs font-black bg-emerald-600 text-white px-3 py-2 rounded-lg hover:bg-emerald-700 transition-colors shrink-0 shadow-sm"
                                    >
                                        + Add Sub-Field
                                    </button>
                                </div>
                                {fields && fields.length > 0 ? (
                                    <div className="grid grid-cols-1 gap-2">
                                        {fields.map((f) => (
                                            <div key={f.id} className="flex items-center gap-3 bg-white dark:bg-gray-800/80 border border-emerald-100 dark:border-emerald-800/60 px-3 py-2.5 rounded-xl shadow-sm">
                                                <div className="min-w-0 flex-1">
                                                    <div className="font-black text-sm text-gray-800 dark:text-gray-100 truncate">{f.name}</div>
                                                    <div className="text-[10px] mt-0.5 font-medium text-emerald-600/70 dark:text-emerald-400/70">
                                                        {f.boundary ? "📐 Boundary mapped" : "No boundary yet"}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => setEditingFieldId(f.id)}
                                                        className="text-[10px] font-bold text-emerald-600 hover:text-white hover:bg-emerald-600 px-2.5 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-700 transition-all"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteField(f.id)}
                                                        className="text-[10px] font-bold text-red-400 hover:text-red-600 px-1.5 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-all"
                                                        title="Delete sub-field"
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="bg-white/60 dark:bg-gray-800/30 border border-dashed border-emerald-200 dark:border-emerald-700/50 rounded-xl p-5 text-center grid gap-2">
                                        <p className="text-xs font-bold text-gray-500 dark:text-gray-400">No sub-fields added yet.</p>
                                        <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-snug">Use sub-fields to split a large permission into manageable working areas.</p>
                                        <button
                                            type="button"
                                            onClick={() => setIsAddingField(true)}
                                            className="mt-1 text-xs font-black text-emerald-600 hover:text-white hover:bg-emerald-600 px-4 py-2 rounded-lg border border-emerald-200 dark:border-emerald-700 transition-all mx-auto"
                                        >
                                            + Add Sub-Field
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

                    <div className="flex items-center gap-3 pt-2">
                      <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Additional Notes</div>
                      <div className="flex-1 h-px bg-gray-100 dark:bg-gray-700"></div>
                    </div>
                    <label className="block">
                    <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Land/Farm Notes</div>
                    <textarea 
                        value={notes} 
                        onChange={(e) => setNotes(e.target.value)} 
                        rows={4} 
                        className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
                    />
                    </label>

                    <div className="flex gap-4">
                        <button 
                            onClick={save} 
                            disabled={saving || !name.trim()} 
                            className={`mt-4 flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-4 rounded-2xl font-black text-xl shadow-xl transition-all disabled:opacity-50`}
                        >
                            {saving ? "Saving..." : isEdit ? "Update Details ✓" : "Create Record →"}
                        </button>
                        {isEdit && (
                            <button 
                                onClick={() => setIsEditing(false)}
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
                                {!permissionGranted && (
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
                                <span className="text-[9px]">◈</span>
                                {finds?.length ?? 0} {(finds?.length ?? 0) === 1 ? 'find' : 'finds'}
                            </span>
                        </div>

                        {/* Row 2 — permission name */}
                        <h3 className="text-2xl sm:text-3xl font-black text-gray-800 dark:text-gray-100 break-words">{name}</h3>

                        {/* Row 3 — action buttons */}
                        <div className="flex flex-wrap gap-2 items-center">
                            {lat && lon && (
                                <button
                                    onClick={() => nav(`/fieldguide?lat=${lat}&lng=${lon}`)}
                                    className="text-[11px] font-bold bg-white dark:bg-gray-800 border border-sky-200 dark:border-sky-900 px-3 py-1.5 rounded-lg text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20 hover:border-sky-400 transition-all flex items-center gap-1.5 shadow-sm"
                                >
                                    🗺 Field Guide
                                </button>
                            )}
                            <button
                                onClick={() => setAgreementModalOpen(true)}
                                className="text-[11px] font-bold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:border-emerald-400 hover:text-emerald-600 transition-all flex items-center gap-1.5 shadow-sm"
                            >
                                🤝 {agreementId ? "Update Agreement" : "Generate Agreement"}
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="grid gap-4">
                            <div>
                                <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 text-emerald-600 dark:text-emerald-400">Landowner / Contact</h4>
                                <p className="font-bold text-gray-700 dark:text-gray-300">{landownerName || "Not recorded"}</p>
                                {landownerPhone && <p className="text-sm opacity-60">📞 {landownerPhone}</p>}
                                {landownerEmail && <p className="text-sm opacity-60">✉️ {landownerEmail}</p>}
                                {landownerAddress && <p className="text-sm opacity-60 mt-1 italic">📍 {landownerAddress}</p>}
                            </div>
                            <div>
                                <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 text-emerald-600 dark:text-emerald-400">Land Details</h4>
                                <div className="flex justify-between items-center">
                                    <p className="font-bold text-gray-700 dark:text-gray-300 capitalize">
                                        {landType}
                                    </p>
                                    {validFrom && (
                                        <div className="text-right">
                                            <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 text-emerald-600 dark:text-emerald-400">Valid From</h4>
                                            <p className="text-xs font-bold text-gray-700 dark:text-gray-300">{new Date(validFrom).toLocaleDateString()}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-4">
                            <div>
                                <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 text-emerald-600 dark:text-emerald-400">Base Location</h4>
                                {lat && lon ? (
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
                                <button 
                                    onClick={() => setProofModalOpen(true)}
                                    className="absolute bottom-0 right-0 text-xs font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1.5 rounded-lg border-2 border-emerald-100 dark:border-emerald-800 hover:bg-emerald-100 transition-all flex items-center gap-1 shadow-sm"
                                >
                                    🛡️ PROOF
                                </button>
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
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Permission Boundary & Coverage</h4>
                                    <p className="text-[10px] opacity-60 italic mt-0.5 font-medium">Tracking data from all {sessions?.length} sessions</p>
                                </div>
                                <div className="text-[10px] text-emerald-600 font-bold bg-emerald-50 dark:bg-emerald-900/30 px-3 py-1 rounded-lg border border-emerald-100 dark:border-emerald-800 animate-pulse">
                                    💡 Tap 'Show Gaps' on sub-fields below
                                </div>
                            </div>
                            
                            {/* Map Preview */}
                            <div className="relative h-72 w-full rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-inner bg-gray-100 dark:bg-gray-900">
                                <div ref={mapDivRef} className="absolute inset-0" />
                            </div>

                            {/* Sub-Fields List in View Mode */}
                            {fields && fields.length > 0 && (
                                <div className="mt-6 grid gap-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <h4 className="text-xs font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">Sub-Fields / Specific Areas</h4>
                                            <p className="text-[11px] text-emerald-600/60 dark:text-emerald-400/60 mt-0.5 font-medium">Defined working areas within this permission</p>
                                        </div>
                                        <span className="text-[10px] font-black bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-2.5 py-0.5 rounded-full shrink-0">{fields.length}</span>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {fields.map(f => (
                                            <div key={f.id} className="bg-white dark:bg-gray-800 border border-emerald-100 dark:border-emerald-800/60 rounded-xl shadow-sm flex flex-col">
                                                <div className="p-4 flex-1">
                                                    <div className="flex justify-between items-start gap-2 mb-1.5">
                                                        <div className="min-w-0">
                                                            <div className="font-black text-sm text-gray-800 dark:text-gray-100 truncate">{f.name}</div>
                                                            <div className="text-[10px] font-medium text-emerald-600/70 dark:text-emerald-400/70 mt-0.5">
                                                                {f.boundary ? "📐 Boundary mapped" : "No boundary"}
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={() => {
                                                                const next = new Set(shownFieldGapIds);
                                                                if (next.has(f.id)) next.delete(f.id);
                                                                else next.add(f.id);
                                                                setShownFieldGapIds(next);
                                                            }}
                                                            className={`text-[9px] font-black px-2.5 py-1.5 rounded-lg border transition-all shrink-0 ${shownFieldGapIds.has(f.id) ? 'bg-orange-600 border-orange-600 text-white shadow-sm' : 'bg-orange-50 dark:bg-orange-950/20 border-orange-100 dark:border-orange-900 text-orange-700 dark:text-orange-400 hover:border-orange-400'}`}
                                                        >
                                                            🧭 {shownFieldGapIds.has(f.id) ? 'Gaps On' : 'Show Gaps'}
                                                            {shownFieldGapIds.has(f.id) && fieldGapResults.get(f.id) && (
                                                                <span className="ml-1 opacity-80">{Math.round(100 - fieldGapResults.get(f.id)!.percentCovered)}% left</span>
                                                            )}
                                                        </button>
                                                    </div>
                                                    {f.notes && <div className="text-[10px] text-gray-400 dark:text-gray-500 line-clamp-2 italic">{f.notes}</div>}
                                                </div>
                                                <div className="flex items-center gap-2 border-t border-gray-100 dark:border-gray-800 px-4 py-2.5">
                                                    <button
                                                        onClick={() => nav(`/session/new?permissionId=${id}&fieldId=${f.id}`)}
                                                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black py-2 rounded-lg transition-colors shadow-sm"
                                                    >
                                                        Start Session
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingFieldId(f.id)}
                                                        className="px-3 py-2 text-[10px] font-bold text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors border border-emerald-100 dark:border-emerald-800"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteField(f.id)}
                                                        className="py-2 px-2 text-[11px] font-bold text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 rounded-lg transition-colors"
                                                        title="Delete sub-field"
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                  </div>
                )}
            </div>

            {/* Right Column: Sessions & Pending List */}
            <div className="lg:col-span-1 grid gap-6 h-fit">
                {/* Pending Finds Section */}
                {isEdit && pendingFinds && pendingFinds.length > 0 && (
                    <div className="bg-amber-50 dark:bg-amber-900/10 border-2 border-amber-200 dark:border-amber-800/50 rounded-2xl p-6 shadow-sm">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-black text-amber-800 dark:text-amber-400 m-0 uppercase tracking-tight">Pending Finds</h3>
                            <div className="text-[10px] font-black bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100 px-2 py-0.5 rounded-full">{pendingFinds.length}</div>
                        </div>
                        <div className="grid gap-3">
                            {pendingFinds.map(f => (
                                <button 
                                    key={f.id}
                                    onClick={() => nav(`/find?quickId=${f.id}`)}
                                    className="w-full text-left bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-800/50 p-3 rounded-xl shadow-sm hover:border-amber-500 transition-all flex items-center gap-3 group"
                                >
                                    <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/50 rounded-lg flex items-center justify-center text-xl">📸</div>
                                    <div className="min-w-0 flex-1">
                                        <div className="font-black text-[10px] text-amber-700 dark:text-amber-500 uppercase tracking-widest leading-none mb-1">Quick Recorded</div>
                                        <div className="text-xs font-bold text-gray-800 dark:text-gray-100 truncate">
                                            {f.notes || "No notes..."}
                                        </div>
                                        <div className="text-[9px] opacity-60 font-mono mt-0.5">
                                            {new Date(f.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {f.findCode}
                                        </div>
                                    </div>
                                    <div className="text-amber-400 group-hover:text-amber-600 transition-colors">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                                    </div>
                                </button>
                            ))}
                            <p className="text-[9px] text-amber-700/60 dark:text-amber-400/60 text-center italic mt-1 font-medium">
                                Tap to add details & assign to a session
                            </p>
                        </div>
                    </div>
                )}

                {/* Quick Finds Section (Recorded but no session) */}
                {isEdit && standaloneFinds && standaloneFinds.length > 0 && (
                    <div className="bg-sky-50 dark:bg-sky-900/10 border-2 border-sky-200 dark:border-sky-800/50 rounded-2xl p-6 shadow-sm">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-black text-sky-800 dark:text-sky-400 m-0 uppercase tracking-tight">Quick Finds</h3>
                            <div className="text-[10px] font-black bg-sky-200 dark:bg-sky-800 text-sky-900 dark:text-sky-100 px-2 py-0.5 rounded-full">{standaloneFinds.length}</div>
                        </div>
                        <div className="grid gap-3">
                            {standaloneFinds.map(f => {
                                const thumb = allMedia?.find(m => m.findId === f.id);
                                return (
                                    <div key={f.id} className="bg-white dark:bg-gray-800 border border-sky-200 dark:border-sky-800/50 rounded-xl shadow-sm flex flex-col group relative">
                                        <button 
                                            onClick={() => setOpenFindId(f.id)}
                                            className="w-full text-left p-3 flex items-center gap-3 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-all border-b border-gray-50 dark:border-gray-700/50 rounded-t-xl"
                                        >
                                            <div className="w-10 h-10 bg-sky-100 dark:bg-sky-900/50 rounded-lg flex items-center justify-center overflow-hidden shrink-0">
                                                {thumb ? (
                                                    <ScaledImage media={thumb} className="w-full h-full" imgClassName="object-cover" />
                                                ) : (
                                                    <span className="text-xl">💎</span>
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="font-black text-[10px] text-sky-700 dark:text-sky-500 uppercase tracking-widest leading-none mb-1">Recorded Find</div>
                                                <div className="text-xs font-bold text-gray-800 dark:text-gray-100 truncate">
                                                    {f.objectType}
                                                </div>
                                                <div className="text-[9px] opacity-60 font-mono mt-0.5">
                                                    {new Date(f.createdAt).toLocaleDateString()} • {f.findCode}
                                                </div>
                                            </div>
                                            <div className="text-sky-400 group-hover:text-sky-600 transition-colors">
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                                            </div>
                                        </button>

                                        {/* Quick Actions Bar */}
                                        <div className="p-2 bg-gray-50/50 dark:bg-gray-900/30 flex gap-2 rounded-b-xl">
                                            {sessions && sessions.length > 0 ? (
                                                <div className="relative flex-1 group/link">
                                                    <button className="w-full bg-sky-600 text-white text-[9px] font-black py-2 rounded-lg shadow-sm hover:bg-sky-700 transition-all uppercase tracking-widest text-center flex items-center justify-center gap-1">
                                                        <span>🔗 Link to Visit</span>
                                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                                    </button>
                                                    
                                                    {/* Session Selection Menu - Positioned to pop out without being clipped */}
                                                    <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border-2 border-sky-400 dark:border-sky-600 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.3)] p-1 hidden group-hover/link:block z-50 animate-in fade-in slide-in-from-top-2">
                                                        <div className="text-[8px] font-black text-sky-600 uppercase p-2 border-b border-gray-50 dark:border-gray-700 mb-1 flex justify-between items-center">
                                                            <span>Select a Visit</span>
                                                            <span className="opacity-50">Recent 5</span>
                                                        </div>
                                                        <div className="max-h-40 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600 pr-1">
                                                            {sessions.slice(0, 5).map((s: any) => (
                                                                <button 
                                                                    key={s.id}
                                                                    onClick={async () => {
                                                                        if (confirm(`Link this find to the session on ${new Date(s.date).toLocaleDateString()}?`)) {
                                                                            await db.finds.update(f.id, { 
                                                                                sessionId: s.id, 
                                                                                fieldId: s.fieldId || f.fieldId,
                                                                                isPending: false 
                                                                            });
                                                                        }
                                                                    }}
                                                                    className="w-full text-left p-2.5 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors border-b border-gray-50 dark:border-gray-700 last:border-0 group/item"
                                                                >
                                                                    <div className="text-[10px] font-black text-gray-800 dark:text-gray-100 group-hover/item:text-emerald-600 transition-colors leading-tight">
                                                                        🗓️ {new Date(s.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                                                                    </div>
                                                                    <div className="text-[8px] opacity-60 truncate font-bold mt-0.5">
                                                                        {s.fieldName || "General Location"}
                                                                    </div>
                                                                </button>
                                                            ))}
                                                        </div>
                                                        <button 
                                                            onClick={() => nav(`/session/new?permissionId=${id}`)}
                                                            className="w-full text-center p-2 mt-1 text-[8px] font-black text-emerald-600 uppercase hover:bg-gray-50 dark:hover:bg-gray-900 rounded-lg transition-colors border-t border-gray-100 dark:border-gray-700"
                                                        >
                                                            + Start New Visit
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <button 
                                                    onClick={() => nav(`/session/new?permissionId=${id}`)}
                                                    className="w-full bg-emerald-600 text-white text-[9px] font-black py-2 rounded-lg shadow-sm hover:bg-emerald-700 transition-all uppercase tracking-widest text-center"
                                                >
                                                    + Create Visit
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            <p className="text-[9px] text-sky-700/60 dark:text-sky-400/60 text-center italic mt-1 font-medium px-2 leading-tight">
                                Tap find to view, or link to a visit below.
                            </p>
                        </div>
                    </div>
                )}

                {/* Sessions Section */}
                <div className="bg-gray-50 dark:bg-gray-900/30 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-inner">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100 m-0">Sessions / Visits</h3>
                        <div className="text-xs font-mono bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded font-bold">{sessions?.length ?? 0} total</div>
                    </div>

                {!isEdit && (
                    <div className="text-center py-10 opacity-50 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl italic text-sm px-4">
                        Create the record first to start adding sessions!
                    </div>
                )}

                {isEdit && (
                    <div className="grid gap-3">
                        <button 
                            onClick={() => nav(`/session/new?permissionId=${id}`)}
                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-bold shadow-md transition-all flex items-center justify-center gap-2 mb-4"
                        >
                            + Start New Session (Visit)
                        </button>

                        {sessions && sessions.length > 0 ? (
                            <div className={sessions.length > 4 ? 'max-h-[195px] overflow-y-auto' : ''}>
                                <div className="grid gap-3">
                                    {sessions.map((s: any) => (
                                        <button
                                            key={s.id}
                                            onClick={() => nav(`/session/${s.id}`)}
                                            className="w-full text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4 rounded-xl shadow-sm hover:border-emerald-500 transition-all group overflow-hidden relative"
                                        >
                                            {s.hasTracking && (
                                                <div className="absolute top-0 right-0 bg-sky-500 text-white text-[7px] font-black px-1.5 py-0.5 rounded-bl uppercase tracking-widest">
                                                    GPS TRAIL
                                                </div>
                                            )}

                                            <div className="flex justify-between items-start mb-1">
                                                <div className="flex flex-col gap-0.5 min-w-0">
                                                    <div className="font-black text-xs text-gray-900 dark:text-gray-100 group-hover:text-emerald-600 transition-colors">
                                                        {new Date(s.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <span className={`text-[10px] font-bold truncate ${s.fieldName ? 'text-emerald-600' : 'text-gray-400 italic'}`}>
                                                            📍 {s.fieldName || "No specific field"}
                                                        </span>
                                                    </div>
                                                </div>

                                                {s.findCount > 0 && (
                                                    <div className="bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800 px-2 py-1 rounded-lg text-center min-w-[40px]">
                                                        <div className="text-[10px] font-black text-emerald-700 dark:text-emerald-400 leading-none">{s.findCount}</div>
                                                        <div className="text-[7px] font-bold text-emerald-600 dark:text-emerald-500 uppercase leading-none mt-0.5">Finds</div>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="text-[10px] opacity-60 flex items-center justify-between border-t border-gray-50 dark:border-gray-700/50 pt-2 mt-2">
                                                <span className="truncate pr-2">{s.cropType || s.landUse || "General detecting"}</span>
                                                {s.durationMs > 0 && <span className="font-mono font-bold opacity-80 whitespace-nowrap">⏱️ {formatDuration(s.durationMs)}</span>}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-10 opacity-50 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl italic text-sm">
                                No sessions recorded yet.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
      </div>
    </div>

      {isEdit && id && reportTarget !== null && (
        <PermissionReportModal
          permissionId={id}
          fieldId={reportTarget}
          onClose={() => setReportTarget(null)}
        />
      )}

      {openFindId && <FindModal findId={openFindId} onClose={() => setOpenFindId(null)} />}
      
      {agreementModalOpen && currentPermission && (
        <AgreementModal 
          permission={currentPermission} 
          onClose={() => setAgreementModalOpen(false)} 
          onSaved={(mediaId) => {
            setAgreementId(mediaId);
            setAgreementModalOpen(false);
          }}
        />
      )}

      {isPickingLocation && (
          <LocationPickerModal 
              initialLat={lat}
              initialLon={lon}
              onClose={() => setIsPickingLocation(false)}
              onSelect={(pickedLat, pickedLon) => {
                  setLat(pickedLat);
                  setLon(pickedLon);
                  setAcc(null);
                  setIsPickingLocation(false);
              }}
          />
      )}

      {isPickingBoundary && (
          <BoundaryPickerModal 
              initialBoundary={boundary}
              initialLat={lat}
              initialLon={lon}
              onClose={() => setIsPickingBoundary(false)}
              onSelect={(pickedBoundary) => {
                  setBoundary(pickedBoundary);
                  setIsPickingBoundary(false);
              }}
          />
      )}

      {(isAddingField || editingFieldId) && (
         <FieldModal 
             projectId={props.projectId}
             permissionId={id!}
             permissionBoundary={boundary}
             permissionLat={lat}
             permissionLon={lon}
             field={fields?.find(f => f.id === editingFieldId)}
             onClose={() => {
               setIsAddingField(false);
               setEditingFieldId(null);
             }}
             onSaved={() => {
               setIsAddingField(false);
               setEditingFieldId(null);
             }}
         />
      )}

      {proofModalOpen && currentPermission && (
        <PermissionProofModal
          permission={{...currentPermission, id: id!}}
          agreementFile={agreementFile || null}
          insuranceProvider={insuranceProvider}
          ncmdNumber={ncmdNumber}
          ncmdExpiry={ncmdExpiry}
          onClose={() => setProofModalOpen(false)}
        />
      )}

    </div>
  );
}
