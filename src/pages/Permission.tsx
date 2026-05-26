import React, { useEffect, useState, useMemo, useRef } from "react";
import { db, Permission, Find, Media, GeoJSONPolygon } from "../db";
import { v4 as uuid } from "uuid";
import { captureGPS } from "../services/gps";
import { getSetting } from "../services/data";
import { loadRallyDayReview } from "../services/rallyDayReview";
import { CreateClubDayPackModal, ExportClubDayModal, ImportClubDayDataModal } from "../components/ClubDayModals";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { FindRow } from "../components/FindRow";
import { FindModal } from "../components/FindModal";
import { ScaledImage } from "../components/ScaledImage";
import { StaticMapPreview } from "../components/StaticMapPreview";
import { RallyDayReviewPanel } from "../components/RallyDayReviewPanel";
import PermissionReportModal from "../components/PermissionReportModal";
import { AgreementModal } from "../components/AgreementModal";
import { LocationPickerModal } from "../components/LocationPickerModal";
import { BoundaryPickerModal } from "../components/BoundaryPickerModal";
import { FieldModal } from "../components/FieldModal";
import { FieldNotesModal } from "../components/FieldNotesModal";
import PermissionProofModal from "../components/PermissionProofModal";
import { useConfirmDialog } from "../components/ConfirmModal";
import { CoachTip, CoachTips } from "../components/CoachTips";
import { calculateCoverage, CoverageResult } from "../services/coverage";
import { area as turfArea } from "@turf/turf";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const landTypes: Permission["landType"][] = [
  "arable", "pasture", "woodland", "scrub", "parkland", "beach", "foreshore", "other",
];
const PERMISSION_HELPERS_SEEN_KEY = "fs_permission_helpers_seen";

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

function formatDeleteCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function PermissionPage(props: {
  projectId: string;
  onSaved: (id: string) => void;
}) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const nav = useNavigate();
  const { confirm: confirmAction, dialog: confirmDialog } = useConfirmDialog();
  const isEdit = !!id;

  const [name, setName] = useState("");
  const typeParam = searchParams.get("type");
  const organiserSetupParam = searchParams.get("organiserSetup") === "true";
  const openClubDayParam = searchParams.get("openClubDay") === "true";
  const [type, setType] = useState<Permission["type"]>(typeParam === "rally" ? "rally" : "individual");
  const [collector, setCollector] = useState("");
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
  const [showNewPermissionDetails, setShowNewPermissionDetails] = useState(false);
  const [isPickingLocation, setIsPickingLocation] = useState(false);
  const [isPickingBoundary, setIsPickingBoundary] = useState(false);
  const [boundary, setBoundary] = useState<any | null>(null);
  const [showCoverage, setShowCoverage] = useState(false);
  const [coverageError, setCoverageError] = useState(false);
  const [shownFieldGapIds, setShownFieldGapIds] = useState<Set<string>>(new Set());
  const [fieldGapResults, setFieldGapResults] = useState<Map<string, CoverageResult>>(new Map());
  const [fieldGapErrors, setFieldGapErrors] = useState<Set<string>>(new Set());
  const [coverageResult, setCoverageResult] = useState<CoverageResult | null>(null);
  const [milestoneMsg, setMilestoneMsg] = useState<string | null>(null);
  const [agreementId, setAgreementId] = useState<string | undefined>();
  const [agreementModalOpen, setAgreementModalOpen] = useState(false);
  const [proofModalOpen, setProofModalOpen] = useState(false);
  const agreementUploadRef = useRef<HTMLInputElement | null>(null);
  
  const [openFindId, setOpenFindId] = useState<string | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [permissionSelected, setPermissionSelected] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [notesFieldId, setNotesFieldId] = useState<string | null>(null);
  const [isAddingField, setIsAddingField] = useState(false);
  const [showAttendeeFields, setShowAttendeeFields] = useState(false);
  const [reportDropdownOpen, setReportDropdownOpen] = useState(false);
  const [noPermTooltip, setNoPermTooltip] = useState(false);
  // null = closed; undefined = whole permission; string = specific fieldId
  const [reportTarget, setReportTarget] = useState<string | undefined | null>(null);

  // Club Day state
  const [isClubDayMember, setIsClubDayMember] = useState(false);
  const [isPersonalRallyRecord, setIsPersonalRallyRecord] = useState(false);
  const [isSharedPermission, setIsSharedPermission] = useState(false);
  const [sharedPermissionId, setSharedPermissionId] = useState<string | undefined>();
  const [organiserContactNumber, setOrganiserContactNumber] = useState<string | undefined>();
  const [organiserEmail, setOrganiserEmail] = useState<string | undefined>();
  const [submittedAt, setSubmittedAt] = useState<string | undefined>();
  const [significantFindInstructions, setSignificantFindInstructions] = useState<string | undefined>();
  const [clubDayPublicNotes, setClubDayPublicNotes] = useState<string | undefined>();
  const [showCreatePack, setShowCreatePack] = useState(false);
  const [showExportClubDay, setShowExportClubDay] = useState(false);
  const [showImportClubDayData, setShowImportClubDayData] = useState(false);
  const [permissionCoachActive, setPermissionCoachActive] = useState(false);
  const [permissionCoachStep, setPermissionCoachStep] = useState(0);

  const fields = useLiveQuery(async () => {
    if (!id) return [];
    return db.fields.where("permissionId").equals(id).reverse().sortBy("createdAt");
  }, [id]);

  const isFirstPermission = useLiveQuery(async () => {
    if (isEdit) return false;
    return (await db.permissions.where("projectId").equals(props.projectId).filter(p => !p.isDefault).count()) === 0;
  }, [isEdit, props.projectId]);

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
    
    // Batch fetch all related data in 3 queries instead of 3×N
    const sessionIds = rows.map(s => s.id);
    const fieldIds = [...new Set(rows.map(s => s.fieldId).filter(Boolean) as string[])];

    const [allFindsForSessions, allTracksForSessions, allFields] = await Promise.all([
      db.finds.where("sessionId").anyOf(sessionIds).toArray(),
      db.tracks.where("sessionId").anyOf(sessionIds).toArray(),
      fieldIds.length > 0 ? db.fields.bulkGet(fieldIds) : Promise.resolve([]),
    ]);

    const findCountBySession = new Map<string, number>();
    for (const f of allFindsForSessions) {
      if (f.sessionId) findCountBySession.set(f.sessionId, (findCountBySession.get(f.sessionId) ?? 0) + 1);
    }

    const tracksBySession = new Map<string, typeof allTracksForSessions>();
    for (const t of allTracksForSessions) {
      if (!t.sessionId) continue;
      if (!tracksBySession.has(t.sessionId)) tracksBySession.set(t.sessionId, []);
      tracksBySession.get(t.sessionId)!.push(t);
    }

    const fieldById = new Map(allFields.filter(Boolean).map(f => [f!.id, f!]));

    return rows.map(s => {
      const field = s.fieldId ? fieldById.get(s.fieldId) ?? null : null;
      const findCount = findCountBySession.get(s.id) ?? 0;
      const sessionTracks = tracksBySession.get(s.id) ?? [];

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
    });
  }, [id]);

  function formatDuration(ms: number) {
    if (ms <= 0) return null;
    const mins = Math.floor(ms / 60000);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    return `${mins}m`;
  }

  // Submitted members (organiser side of club day)
  const submittedMembers = useLiveQuery(async () => {
    if (!id) return [];
    const perm = await db.permissions.get(id);
    if (!perm?.isSharedPermission || !perm.sharedPermissionId) return [];
    return db.importedPackages.where("sharedPermissionId").equals(perm.sharedPermissionId).sortBy("importedAt");
  }, [id]);

  const rallyDayReview = useLiveQuery(async () => {
    if (!id) return null;
    const perm = await db.permissions.get(id);
    if (!perm?.isSharedPermission || perm.isClubDayMember) return null;
    return loadRallyDayReview(id);
  }, [id]);

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

  const fieldFindCounts = useMemo(() => {
    const counts = new Map<string, { recorded: number; pending: number }>();
    const ensure = (fieldId: string) => {
      const existing = counts.get(fieldId);
      if (existing) return existing;
      const next = { recorded: 0, pending: 0 };
      counts.set(fieldId, next);
      return next;
    };

    for (const find of finds ?? []) {
      if (find.fieldId) ensure(find.fieldId).recorded += 1;
    }
    for (const find of pendingFinds ?? []) {
      if (find.fieldId) ensure(find.fieldId).pending += 1;
    }
    return counts;
  }, [finds, pendingFinds]);

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
  }, [showCoverage, shownFieldGapIds, boundary, allTracks, id, fields]);

  const mapDivRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const fieldLabelMarkersRef = React.useRef<Array<{ id: string; marker: maplibregl.Marker; el: HTMLButtonElement }>>([]);
  const fieldRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());
  const fieldScrollRef = React.useRef<HTMLDivElement | null>(null);

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
        } catch (mapErr) {
          console.error("Map init failed:", mapErr);
          return;
        }

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

  useEffect(() => {
    if (isEdit) {
      const msg = sessionStorage.getItem('fs_pending_toast');
      if (msg) {
        sessionStorage.removeItem('fs_pending_toast');
        setMilestoneMsg(msg);
        setTimeout(() => setMilestoneMsg(null), 4000);
      }
    }
  }, [isEdit]);

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
          setAgreementId(l.agreementId);
          setNotes(l.notes);
          setIsClubDayMember(!!l.isClubDayMember);
          setIsPersonalRallyRecord(!!l.isPersonalRallyRecord);
          setIsSharedPermission(!!l.isSharedPermission);
          setSharedPermissionId(l.sharedPermissionId);
          setOrganiserContactNumber(l.organiserContactNumber);
          setOrganiserEmail(l.organiserEmail);
          setSubmittedAt(l.submittedAt);
          setSignificantFindInstructions(l.significantFindInstructions);
          setClubDayPublicNotes(l.clubDayPublicNotes);
        }
        setLoading(false);
      }).catch(err => {
        console.error("Failed to load permission:", err);
        setError("Could not load permission details. The database might be busy or migrating.");
        setLoading(false);
      });
    } else {
      getSetting("detectorist", "").then(setCollector);
      // Pre-fill from Discover → "Add to FindSpot" navigation
      const prefillName = searchParams.get("name");
      const prefillValidFrom = searchParams.get("validFrom");
      const prefillLandownerName = searchParams.get("landownerName");
      const prefillLat = searchParams.get("lat");
      const prefillLon = searchParams.get("lon");
      const prefillNotes = searchParams.get("notes");
      if (prefillName) setName(prefillName);
      if (prefillValidFrom) setValidFrom(prefillValidFrom);
      if (prefillLandownerName) setLandownerName(prefillLandownerName);
      if (prefillLat) setLat(parseFloat(prefillLat));
      if (prefillLon) setLon(parseFloat(prefillLon));
      if (prefillNotes) setNotes(prefillNotes);
    }
  }, [id]);

  // Auto-open club day pack modal when navigating from global organiser flow
  useEffect(() => {
    if (!loading && isEdit && openClubDayParam) {
      setShowCreatePack(true);
    }
  }, [loading, isEdit, openClubDayParam]);

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
    const sessions = await db.sessions.where("permissionId").equals(id).toArray();
    const sessionIds = sessions.map(s => s.id);
    const finds = await db.finds.where("permissionId").equals(id).toArray();
    const findIds = finds.map(f => f.id);
    const significantFinds = await db.significantFinds.where("permissionId").equals(id).toArray();
    const significantFindIds = significantFinds.map(f => f.id);
    const fieldsToDelete = await db.fields.where("permissionId").equals(id).toArray();
    const findMediaCount = findIds.length ? await db.media.where("findId").anyOf(findIds).count() : 0;
    const significantFindMediaCount = significantFindIds.length ? await db.media.where("findId").anyOf(significantFindIds).count() : 0;
    const permissionMediaCount = await db.media.where("permissionId").equals(id).count();
    const mediaCount = findMediaCount + significantFindMediaCount + permissionMediaCount;
    const trackCount = sessionIds.length ? await db.tracks.where("sessionId").anyOf(sessionIds).count() : 0;

    if (!(await confirmAction({
      title: "Delete Permission?",
      message: `Delete ${name.trim() || "this permission"}?\n\nThis will permanently delete:\n` +
      `- ${formatDeleteCount(sessions.length, "session")}\n` +
      `- ${formatDeleteCount(finds.length, "find")}\n` +
      `- ${formatDeleteCount(significantFinds.length, "significant find")}\n` +
      `- ${formatDeleteCount(fieldsToDelete.length, "field")}\n` +
      `- ${formatDeleteCount(mediaCount, "photo/document", "photos/documents")}\n` +
      `- ${formatDeleteCount(trackCount, "GPS track")}`,
      confirmLabel: "Delete",
      danger: true,
    }))) return;

    setSaving(true);
    try {
      await db.transaction("rw", [db.permissions, db.sessions, db.finds, db.significantFinds, db.media, db.fields, db.tracks], async () => {
        if (findIds.length) await db.media.where("findId").anyOf(findIds).delete();
        if (significantFindIds.length) await db.media.where("findId").anyOf(significantFindIds).delete();
        await db.media.where("permissionId").equals(id).delete();
        await db.finds.where("permissionId").equals(id).delete();
        await db.significantFinds.where("permissionId").equals(id).delete();
        if (sessionIds.length) await db.tracks.where("sessionId").anyOf(sessionIds).delete();
        await db.sessions.where("permissionId").equals(id).delete();
        await db.fields.where("permissionId").equals(id).delete();
        await db.permissions.delete(id);
      });
      nav("/");
    } catch (e: any) {
      setError("Delete failed: " + e.message);
      setSaving(false);
    }
  }

  async function handleDeleteClubDayPermission() {
    if (!id) return;
    const perm = await db.permissions.get(id);
    const sessions = await db.sessions.where("permissionId").equals(id).toArray();
    const sessionIds = sessions.map(s => s.id);
    const finds = await db.finds.where("permissionId").equals(id).toArray();
    const findIds = finds.map(f => f.id);
    const significantFinds = await db.significantFinds.where("permissionId").equals(id).toArray();
    const significantFindIds = significantFinds.map(f => f.id);
    const fieldsToDelete = await db.fields.where("permissionId").equals(id).toArray();
    const findMediaCount = findIds.length ? await db.media.where("findId").anyOf(findIds).count() : 0;
    const significantFindMediaCount = significantFindIds.length ? await db.media.where("findId").anyOf(significantFindIds).count() : 0;
    const permissionMediaCount = await db.media.where("permissionId").equals(id).count();
    const mediaCount = findMediaCount + significantFindMediaCount + permissionMediaCount;
    const trackCount = sessionIds.length ? await db.tracks.where("sessionId").anyOf(sessionIds).count() : 0;

    if (!(await confirmAction({
      title: "Remove Rally Permission?",
      message: `Remove ${name.trim() || "this club / rally permission"}?\n\nThis will permanently delete from this device:\n` +
      `- ${formatDeleteCount(sessions.length, "session")}\n` +
      `- ${formatDeleteCount(finds.length, "find")}\n` +
      `- ${formatDeleteCount(significantFinds.length, "significant find")}\n` +
      `- ${formatDeleteCount(fieldsToDelete.length, "field card")}\n` +
      `- ${formatDeleteCount(mediaCount, "photo/document", "photos/documents")}\n` +
      `- ${formatDeleteCount(trackCount, "GPS track")}\n\n` +
      "Use Keep Rally Record first if you want to keep them.",
      confirmLabel: "Remove",
      danger: true,
    }))) return;

    setSaving(true);
    try {
      await db.transaction("rw", [db.permissions, db.sessions, db.finds, db.significantFinds, db.media, db.fields, db.tracks, db.importedPackages], async () => {
        if (findIds.length) await db.media.where("findId").anyOf(findIds).delete();
        if (significantFindIds.length) await db.media.where("findId").anyOf(significantFindIds).delete();
        await db.media.where("permissionId").equals(id).delete();
        await db.finds.where("permissionId").equals(id).delete();
        await db.significantFinds.where("permissionId").equals(id).delete();
        if (sessionIds.length) await db.tracks.where("sessionId").anyOf(sessionIds).delete();
        await db.sessions.where("permissionId").equals(id).delete();
        await db.fields.where("permissionId").equals(id).delete();
        await db.permissions.delete(id);
        // Remove the join record so the member can re-scan the QR if needed
        if (perm?.sharedPermissionId) {
          const joinRecord = await db.importedPackages
            .filter(p => p.sharedPermissionId === perm.sharedPermissionId)
            .first();
          if (joinRecord) await db.importedPackages.delete(joinRecord.id);
        }
      });
      nav("/");
    } catch (e: any) {
      setError("Delete failed: " + e.message);
      setSaving(false);
    }
  }

  async function handleKeepClubDayAsPersonalRecord() {
    if (!id) return;
    if (!(await confirmAction({
      title: "Keep Rally Record?",
      message: "Your finds, photos, fields, sessions, and tracks will stay on this device, but this record will no longer be linked to the organiser's QR export.",
      confirmLabel: "Keep Record",
    }))) return;

    setSaving(true);
    try {
      const perm = await db.permissions.get(id);
      const now = new Date().toISOString();
      const sharedId = perm?.sharedPermissionId;

      await db.transaction("rw", [db.permissions, db.sessions, db.finds, db.importedPackages], async () => {
        await db.permissions.update(id, {
          isClubDayMember: false,
          isPersonalRallyRecord: true,
          isSharedPermission: false,
          sharedPermissionId: undefined,
          organiserContactNumber: undefined,
          organiserEmail: undefined,
          significantFindInstructions: undefined,
          clubDayPublicNotes: undefined,
          submittedAt: undefined,
          landownerPhone: perm?.landownerPhone || perm?.organiserContactNumber,
          landownerEmail: perm?.landownerEmail || perm?.organiserEmail,
          notes: perm?.notes || perm?.clubDayPublicNotes || "",
          updatedAt: now,
        } as Partial<Permission>);

        await db.sessions.where("permissionId").equals(id).modify((session: any) => {
          delete session.sharedPermissionId;
          delete session.recorderId;
          delete session.recorderName;
          session.updatedAt = now;
        });

        await db.finds.where("permissionId").equals(id).modify((find: any) => {
          delete find.sharedPermissionId;
          delete find.recorderId;
          delete find.recorderName;
          find.updatedAt = now;
        });

        if (sharedId) {
          await db.importedPackages
            .filter(p => p.sharedPermissionId === sharedId)
            .delete();
        }
      });

      setIsClubDayMember(false);
      setIsPersonalRallyRecord(true);
      setIsSharedPermission(false);
      setSharedPermissionId(undefined);
      setOrganiserContactNumber(undefined);
      setOrganiserEmail(undefined);
      setSignificantFindInstructions(undefined);
      setClubDayPublicNotes(undefined);
      setSubmittedAt(undefined);
      setLandownerPhone(prev => prev || perm?.organiserContactNumber || "");
      setLandownerEmail(prev => prev || perm?.organiserEmail || "");
      setNotes(perm?.notes || perm?.clubDayPublicNotes || "");
      setMilestoneMsg("Saved as a personal rally record");
      setTimeout(() => setMilestoneMsg(null), 4000);
      setSaving(false);
    } catch (e: any) {
      setError("Could not keep rally record: " + (e?.message ?? "Unknown error"));
      setSaving(false);
    }
  }

  async function handleDeleteField(fieldId: string) {
    const field = fields?.find(f => f.id === fieldId) || await db.fields.get(fieldId);
    const [sessionCount, findCount] = await Promise.all([
      db.sessions.where("fieldId").equals(fieldId).count(),
      db.finds.where("fieldId").equals(fieldId).count(),
    ]);

    if (!(await confirmAction({
      title: "Delete Field?",
      message: `Delete ${field?.name || "this field"}?\n\nThis will delete the field card and unlink:\n` +
      `- ${formatDeleteCount(sessionCount, "session")}\n` +
      `- ${formatDeleteCount(findCount, "find")}\n\n` +
      "The sessions and finds will remain on this device.",
      confirmLabel: "Delete Field",
      danger: true,
    }))) return;
    
    try {
      const now = new Date().toISOString();
      await db.transaction("rw", [db.fields, db.sessions, db.finds], async () => {
        await db.sessions.where("fieldId").equals(fieldId).modify({
          fieldId: null,
          updatedAt: now,
        });
        await db.finds.where("fieldId").equals(fieldId).modify({
          fieldId: null,
          updatedAt: now,
        });
        await db.fields.delete(fieldId);
      });
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
        organiserContactNumber: type === "rally" ? (landownerPhone || undefined) : undefined,
        organiserEmail:         type === "rally" ? (landownerEmail || undefined) : undefined,
        createdAt: now,
        updatedAt: now,
      };

      if (isEdit) {
        const { createdAt, ...updates } = permission;
        await db.permissions.update(id, updates);

        setIsEditing(false);
        setSaved(true);
      } else {
        await db.permissions.add(permission);

        setIsEditing(false);
        if (!localStorage.getItem('fs_first_permission')) {
          localStorage.setItem('fs_first_permission', '1');
          sessionStorage.setItem('fs_pending_toast', 'Nice — your first permission is set!');
        }
        if (organiserSetupParam && type === "rally") {
          nav(`/permission/${finalId}?openClubDay=true`);
        } else {
          props.onSaved(finalId);
        }
      }
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function uploadExistingAgreement(file: File | null | undefined) {
    if (!file || !id) return;
    setError(null);
    try {
      const now = new Date().toISOString();
      const mediaId = uuid();
      await db.transaction("rw", [db.media, db.permissions], async () => {
        await db.media.add({
          id: mediaId,
          projectId: props.projectId,
          permissionId: id,
          type: "document",
          filename: file.name || `${type === "rally" || isSharedPermission ? "club-rally-agreement" : "landowner-agreement"}-${now.slice(0, 10)}`,
          mime: file.type || "application/octet-stream",
          blob: file,
          caption: type === "rally" || isSharedPermission ? "Uploaded club/rally agreement" : "Uploaded landowner agreement",
          scalePresent: false,
          createdAt: now,
        });
        await db.permissions.update(id, {
          agreementId: mediaId,
          permissionGranted: true,
          updatedAt: now,
        });
      });
      setAgreementId(mediaId);
      setPermissionGranted(true);
      setSaved(true);
    } catch (e: any) {
      setError("Agreement upload failed: " + (e?.message ?? "Unknown error"));
    } finally {
      if (agreementUploadRef.current) agreementUploadRef.current.value = "";
    }
  }

  if (loading) return <div className="p-10 text-center opacity-50 font-medium">Loading details...</div>;

  const isRally = type === 'rally';
  const showStarterPermissionFlow = !id && type !== "rally";
  const showOptionalPermissionDetails = !showStarterPermissionFlow || showNewPermissionDetails;
  const canManageClubDayPack = isEdit && !isClubDayMember && !isPersonalRallyRecord && (isRally || isSharedPermission);
  const attendeeFieldCount = fields?.length ?? 0;
  const canPickAttendeeFields = attendeeFieldCount > 1;
  const attendeeSelectedField = fields?.find(f => f.id === selectedFieldId) ?? null;
  const attendeeSelectedFieldCenter = attendeeSelectedField?.boundary ? getBoundaryCenter(attendeeSelectedField.boundary) : null;
  const attendeeDefaultFieldId = attendeeFieldCount === 1 ? fields?.[0]?.id : undefined;
  const notesField = fields?.find(f => f.id === notesFieldId) ?? null;
  const hasPermissionContact = !!landownerName.trim();
  const hasPermissionAccessRecord = permissionGranted || !!validFrom || !!agreementId;
  const hasPermissionMappedArea = (lat != null && lon != null) || !!boundary || (fields?.some(f => !!f.boundary) ?? false);
  const canUseAgreement = isEdit && !isClubDayMember && !isPersonalRallyRecord;
  const agreementKindLabel = isRally || isSharedPermission ? "Club/Rally Agreement" : "Agreement";
  const generateAgreementLabel = agreementId ? `Update ${agreementKindLabel}` : `Generate ${agreementKindLabel}`;
  const uploadAgreementLabel = agreementId ? "Replace Agreement File" : "Upload Signed Agreement";
  const showOrganiserHub = isEdit && isRally && !isEditing && !isClubDayMember && !isPersonalRallyRecord;
  const organiserMemberCount = submittedMembers?.length ?? 0;
  const organiserFieldCount = fields?.length ?? 0;
  const organiserFindCount = finds?.length ?? 0;
  const organiserPendingFindCount = pendingFinds?.length ?? 0;
  const submittedMemberFindCounts = new Map<string, number>();
  (finds ?? []).forEach(find => {
    const key = find.recorderId || find.recorderName?.trim();
    if (!key) return;
    submittedMemberFindCounts.set(key, (submittedMemberFindCounts.get(key) ?? 0) + 1);
  });
  const permissionNeedsCompletion = isEdit && !isRally && !isClubDayMember && (
    !hasPermissionContact || !hasPermissionAccessRecord || !hasPermissionMappedArea
  );
  const saveButtonLabel = saving
    ? "Saving..."
    : isEdit
      ? (isRally ? "Update Rally" : "Update Details")
      : isRally
        ? (organiserSetupParam ? "Save & Generate Link" : "Save Rally")
        : "Create Record";
  const permissionCoachEnabled = !!isFirstPermission && isEditing && !isRally && !isClubDayMember;
  const permissionCoachTips: CoachTip[] = [
    {
      title: "Name first",
      body: "Add the farm or field name. That is all you need to create your first permission.",
      accent: "text-emerald-300",
      border: "border-emerald-400/35",
      position: "top-[128px] left-4 right-4 sm:left-1/2 sm:right-auto sm:w-[320px] sm:-translate-x-1/2",
    },
    {
      title: "Optional details",
      body: "Tap Add details now for landowner, GPS and boundaries, or keep the first record quick.",
      accent: "text-blue-300",
      border: "border-blue-400/35",
      button: "Show details",
      action: () => setShowNewPermissionDetails(true),
      position: "top-[42%] left-4 right-4 sm:left-6 sm:right-auto sm:max-w-[320px]",
    },
    {
      title: "Create record",
      body: "Save now. You can add sessions, finds, agreements and reports from the permission page.",
      accent: "text-amber-300",
      border: "border-amber-400/35",
      position: "bottom-[92px] left-4 right-4 sm:left-1/2 sm:right-auto sm:w-[320px] sm:-translate-x-1/2",
    },
  ];

  function completePermissionDetails() {
    setShowNewPermissionDetails(true);
    setIsEditing(true);
  }

  function goRecordFind(fieldId?: string | null) {
    if (!id) return;
    const params = new URLSearchParams();
    params.set("permissionId", id);
    if (fieldId) params.set("fieldId", fieldId);
    nav(`/find?${params.toString()}`);
  }

  const currentPermission: Permission | null = id ? {
    id, projectId: props.projectId, name, type, lat, lon, gpsAccuracyM: acc, collector,
    landownerName, landownerPhone, landownerEmail, landownerAddress,
    landType, permissionGranted, validFrom, agreementId, notes,
    isSharedPermission, sharedPermissionId,
    organiserContactNumber, organiserEmail,
    significantFindInstructions, clubDayPublicNotes,
    createdAt: "", updatedAt: ""
  } : null;

  return (
    <div className="max-w-4xl mx-auto pb-20 px-4">
      <CoachTips
        storageKey={PERMISSION_HELPERS_SEEN_KEY}
        tips={permissionCoachTips}
        enabled={permissionCoachEnabled}
        forceShow={searchParams.get("tips") === "1"}
        onDismiss={() => {
          setPermissionCoachActive(false);
          setPermissionCoachStep(0);
        }}
        onStepChange={(index) => {
          setPermissionCoachActive(true);
          setPermissionCoachStep(index);
        }}
      />
      {milestoneMsg && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-bold pointer-events-none whitespace-nowrap">
          {milestoneMsg}
        </div>
      )}
      <div className="no-print grid gap-8 mt-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100">
                      {isEdit ? (isRally ? "Rally Details" : "Land/Permission Details") : (isRally ? "New Rally / Club Dig" : "New Permission")}
                  </h2>
                  {canManageClubDayPack && !showOrganiserHub && !isEditing && (
                    <button
                      onClick={() => setShowCreatePack(true)}
                      className="text-[10px] text-amber-500 dark:text-amber-400 hover:text-amber-400 dark:hover:text-amber-300 transition-colors tracking-wide border-0 bg-transparent p-0 shrink-0"
                    >
                      {isSharedPermission ? "Share Link" : "Create Link"}
                    </button>
                  )}
                </div>
                {isEdit && !isEditing && !isClubDayMember && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 transition-colors border-0 bg-transparent p-0 self-start"
                  >
                    Edit Details
                  </button>
                )}
            </div>
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                {isEdit && (
                    <>
                        {/* Landowner report dropdown — individual permissions only */}
                        <div className={`relative flex-1 sm:flex-none ${isRally ? 'hidden' : ''}`}>
                            <button
                                onClick={() => setReportDropdownOpen(v => !v)}
                                className="w-full text-xs sm:text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-4 py-1.5 rounded-lg shadow-sm transition-all flex items-center justify-center gap-1.5"
                            >
                                Landowner Report
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
                                                    {field.name}
                                                </button>
                                            ))}
                                        </>
                                    )}
                                </div>
                                </>
                            )}
                        </div>
                        {/* Club Day buttons — shown for shared/club day permissions */}
                        {isClubDayMember && (
                          <button
                            onClick={handleDeleteClubDayPermission}
                            disabled={saving}
                            className="text-xs sm:text-sm font-medium text-red-400 hover:text-red-600 px-3 py-1.5 rounded-lg border border-transparent hover:border-red-200 dark:hover:border-red-800 transition-all disabled:opacity-50 flex-1 sm:flex-none"
                          >
                            Leave Event
                          </button>
                        )}
                        {canManageClubDayPack && !showOrganiserHub && (
                          <button
                            onClick={() => setShowCreatePack(true)}
                            className="text-xs sm:text-sm font-black text-white bg-teal-600 hover:bg-teal-500 px-3 py-1.5 rounded-lg border border-teal-600 transition-all flex-1 sm:flex-none"
                          >
                            {isSharedPermission ? "Share Join Link" : "Generate Share Link"}
                          </button>
                        )}
                        {!isClubDayMember && isEdit && isSharedPermission && !showOrganiserHub && (
                          <button
                            onClick={() => setShowImportClubDayData(true)}
                            className="text-xs sm:text-sm font-black text-teal-600 hover:text-white hover:bg-teal-600 px-3 py-1.5 rounded-lg border border-teal-200 dark:border-teal-800 transition-all flex-1 sm:flex-none"
                          >
                            Import Member Data
                          </button>
                        )}
                        {!isClubDayMember && (
                        <button
                            onClick={handleDelete}
                            disabled={saving}
                            className="text-xs sm:text-sm font-medium text-red-400 hover:text-red-600 px-3 py-1.5 rounded-lg border border-transparent hover:border-red-200 dark:hover:border-red-800 transition-all disabled:opacity-50 flex-1 sm:flex-none"
                        >
                            Delete
                        </button>
                        )}
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
            <div className="border-2 border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 p-4 rounded-xl shadow-sm flex flex-col gap-3">
                <div className="flex gap-3 items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-emerald-600 rounded-full flex items-center justify-center text-white font-black text-lg shrink-0">✓</div>
                        <div>
                            <div className="font-black text-emerald-700 dark:text-emerald-300">{isRally ? "Rally saved" : "Permission saved"}</div>
                            <div className="text-xs opacity-70 font-medium mt-0.5">
                                {boundary && (!fields || fields.length === 0)
                                    ? (isRally ? "Would you like to add field boundaries for this event?" : "Would you like to divide this into sub-fields?")
                                    : "Ready to use with finds, sessions, and coverage"}
                            </div>
                        </div>
                    </div>
                    <button onClick={() => setSaved(false)} className="text-xs opacity-60 hover:opacity-100 shrink-0">Dismiss</button>
                </div>
                {boundary && (!fields || fields.length === 0) && (
                    <div className="flex gap-2 pl-12">
                        <button
                            onClick={() => { setSaved(false); setIsAddingField(true); }}
                            className="text-xs font-black bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition-colors shadow-sm"
                        >
                            {isRally ? "+ Add Rally Fields" : "+ Add Sub-Fields"}
                        </button>
                        <button
                            onClick={() => setSaved(false)}
                            className="text-xs font-black text-emerald-700 dark:text-emerald-400 px-4 py-2 rounded-lg border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
                        >
                            Not now
                        </button>
                    </div>
                )}
            </div>
        )}

        <div className="grid lg:grid-cols-3 gap-8">
            {!isEditing && isClubDayMember && (
                <div className="lg:col-span-3">
                    <div className="bg-teal-50 dark:bg-teal-950/20 border border-teal-200 dark:border-teal-800 rounded-2xl p-5 sm:p-6 shadow-sm">
                        <div className="flex items-start justify-between gap-4 mb-5">
                            <div className="min-w-0">
                                <div className="text-[10px] font-black uppercase tracking-widest text-teal-500 mb-1">Day Record</div>
                                <h3 className="text-2xl font-black text-teal-950 dark:text-teal-50 break-words">{name || "Club / Rally Event"}</h3>
                                {validFrom && (
                                    <p className="text-xs font-bold text-teal-700/70 dark:text-teal-300/70 mt-1">
                                        {new Date(validFrom).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                                    </p>
                                )}
                            </div>
                            <div className="shrink-0 text-xs font-mono bg-white dark:bg-gray-900 px-2 py-1 rounded font-bold text-teal-700 dark:text-teal-300 border border-teal-100 dark:border-teal-800">
                                {finds?.length ?? 0} finds
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 mb-4">
                            <div className="bg-white dark:bg-gray-900/80 border border-teal-100 dark:border-teal-800 rounded-xl p-3">
                                <div className="text-lg font-black text-teal-700 dark:text-teal-300 leading-none">{finds?.length ?? 0}</div>
                                <div className="text-[9px] font-black uppercase tracking-widest text-teal-700/50 dark:text-teal-300/50 mt-1">Recorded</div>
                            </div>
                            <div className="bg-white dark:bg-gray-900/80 border border-teal-100 dark:border-teal-800 rounded-xl p-3">
                                <div className="text-lg font-black text-amber-600 dark:text-amber-300 leading-none">{pendingFinds?.length ?? 0}</div>
                                <div className="text-[9px] font-black uppercase tracking-widest text-teal-700/50 dark:text-teal-300/50 mt-1">Pending</div>
                            </div>
                            {canPickAttendeeFields ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowAttendeeFields(v => !v);
                                        if (!selectedFieldId && fields?.[0]) setSelectedFieldId(fields[0].id);
                                    }}
                                    className={`bg-white dark:bg-gray-900/80 border rounded-xl p-3 text-left transition-colors ${showAttendeeFields ? "border-teal-500 ring-2 ring-teal-200 dark:ring-teal-900/60" : "border-teal-100 dark:border-teal-800"}`}
                                >
                                    <div className="text-lg font-black text-teal-700 dark:text-teal-300 leading-none">{attendeeFieldCount}</div>
                                    <div className="text-[9px] font-black uppercase tracking-widest text-teal-700/50 dark:text-teal-300/50 mt-1">Fields</div>
                                </button>
                            ) : (
                                <div className="bg-white dark:bg-gray-900/80 border border-teal-100 dark:border-teal-800 rounded-xl p-3">
                                    <div className="text-lg font-black text-teal-700 dark:text-teal-300 leading-none">{attendeeFieldCount}</div>
                                    <div className="text-[9px] font-black uppercase tracking-widest text-teal-700/50 dark:text-teal-300/50 mt-1">Fields</div>
                                </div>
                            )}
                        </div>

                        {showAttendeeFields && canPickAttendeeFields && fields && fields.length > 0 && (
                            <div className="bg-white dark:bg-gray-900 border border-teal-100 dark:border-teal-800 rounded-2xl p-3 mb-4">
                                <div className="flex gap-2 overflow-x-auto pb-2">
                                    {fields.map(field => (
                                        <button
                                            key={field.id}
                                            type="button"
                                            onClick={() => setSelectedFieldId(field.id)}
                                            className={`shrink-0 px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-colors ${selectedFieldId === field.id ? "bg-teal-600 border-teal-600 text-white" : "bg-gray-50 dark:bg-gray-950 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}
                                        >
                                            {field.name}
                                        </button>
                                    ))}
                                </div>
                                {attendeeSelectedField && (
                                    <div className="grid gap-3 pt-2">
                                        {attendeeSelectedFieldCenter ? (
                                            <StaticMapPreview
                                                lat={attendeeSelectedFieldCenter.lat}
                                                lon={attendeeSelectedFieldCenter.lon}
                                                boundary={attendeeSelectedField.boundary}
                                                className="h-44 rounded-xl border border-gray-200 dark:border-gray-700"
                                            />
                                        ) : (
                                            <div className="h-24 rounded-xl border border-dashed border-gray-200 dark:border-gray-700 flex items-center justify-center text-[10px] font-bold text-gray-400">
                                                No mapped boundary
                                            </div>
                                        )}
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="font-black text-sm text-gray-900 dark:text-gray-100 truncate">{attendeeSelectedField.name}</div>
                                                {attendeeSelectedField.notes && (
                                                    <p className="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-2 mt-0.5">{attendeeSelectedField.notes}</p>
                                                )}
                                            </div>
                                            <div className="shrink-0 flex gap-2">
                                                {attendeeSelectedFieldCenter && (
                                                    <button
                                                        type="button"
                                                        onClick={() => window.open(`https://www.google.com/maps?q=${attendeeSelectedFieldCenter.lat},${attendeeSelectedFieldCenter.lon}`, "_blank")}
                                                        className="bg-white dark:bg-gray-950 border border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest"
                                                    >
                                                        Locate
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => goRecordFind(attendeeSelectedField.id)}
                                                    className="bg-teal-600 hover:bg-teal-500 text-white px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest"
                                                >
                                                    Record Here
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {submittedAt && (
                            <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 font-bold">
                                Data sent to organiser on {new Date(submittedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                            </div>
                        )}

	                        {significantFindInstructions && (
	                            <div className="mb-4 px-3 py-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-700 rounded-xl">
	                                <div className="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400 mb-1">Significant find</div>
	                                <p className="text-xs text-amber-800 dark:text-amber-300 font-medium leading-relaxed">{significantFindInstructions}</p>
	                            </div>
	                        )}

	                        {finds && finds.length > 0 && (
	                            <div className="mb-4 bg-white dark:bg-gray-900 border border-teal-100 dark:border-teal-800 rounded-2xl p-3">
	                                <div className="flex items-center justify-between gap-3 mb-2">
	                                    <div className="text-[10px] font-black uppercase tracking-widest text-teal-600 dark:text-teal-400">Finds recorded</div>
	                                    <div className="text-[10px] font-black text-teal-700 dark:text-teal-300">{finds.length}</div>
	                                </div>
	                                <div className={`grid gap-2 ${finds.length > 5 ? "max-h-56 overflow-y-auto pr-1" : ""}`}>
	                                    {finds.map((find: any) => (
	                                        <button
	                                            key={find.id}
	                                            type="button"
	                                            onClick={() => setOpenFindId(find.id)}
	                                            className="w-full text-left flex items-center justify-between gap-3 rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-2 hover:border-teal-400 transition-colors"
	                                        >
	                                            <div className="min-w-0">
	                                                <div className="text-sm font-black text-gray-800 dark:text-gray-100 truncate">{find.objectType || find.findCategory || "Unknown find"}</div>
	                                                <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{find.notes || find.findCode}</div>
	                                            </div>
	                                            <div className="text-[10px] font-bold text-gray-400 shrink-0">{new Date(find.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>
	                                        </button>
	                                    ))}
	                                </div>
	                            </div>
	                        )}

	                        <div className="grid gap-2">
	                            <button
                                onClick={() => goRecordFind(attendeeDefaultFieldId)}
                                className="w-full bg-teal-600 hover:bg-teal-500 text-white py-3.5 rounded-xl font-black shadow-sm transition-all uppercase tracking-widest text-xs"
                            >
                                Record Find
                            </button>
                            <button
                                onClick={() => setShowExportClubDay(true)}
                                className="w-full bg-white dark:bg-gray-900 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 py-3 rounded-xl font-black shadow-sm hover:bg-teal-50 dark:hover:bg-teal-900/30 transition-all uppercase tracking-widest text-xs"
                            >
                                Send Finds to Organiser
                            </button>
                            <button
                                onClick={handleKeepClubDayAsPersonalRecord}
                                disabled={saving}
                                className="w-full bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 py-3 rounded-xl font-black shadow-sm hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-all uppercase tracking-widest text-xs disabled:opacity-50"
                            >
                                Keep Rally Record
                            </button>
                            {organiserContactNumber && (
                                <a
                                    href={`tel:${organiserContactNumber}`}
                                    className="w-full bg-amber-600 hover:bg-amber-500 text-white py-3.5 rounded-xl font-black shadow-sm transition-all uppercase tracking-widest text-xs text-center"
                                >
                                    Call organiser: {organiserContactNumber}
                                </a>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {showOrganiserHub && (
                <div className="lg:col-span-3" role="region" aria-label="Organiser Hub">
                    <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-5 sm:p-6 shadow-sm">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
                            <div className="min-w-0">
                                <div className="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400 mb-1">Organiser Hub</div>
                                <h3 className="text-xl font-black text-gray-900 dark:text-gray-100 break-words">{name || "Unnamed Rally"}</h3>
                                {validFrom && (
                                    <p className="text-sm text-amber-800/70 dark:text-amber-200/70 mt-0.5">
                                        {new Date(validFrom).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric" })}
                                        {landownerName ? ` · ${landownerName}` : ""}
                                    </p>
                                )}
                            </div>
                            <div className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${isSharedPermission ? "bg-teal-600 text-white" : "bg-amber-200 dark:bg-amber-900 text-amber-800 dark:text-amber-200"}`}>
                                {isSharedPermission ? "Join link ready" : "Setup needed"}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
                            {[
                                { label: "Members", value: organiserMemberCount, highlight: true },
                                { label: "Fields", value: organiserFieldCount, highlight: false },
                                { label: "Finds", value: organiserFindCount, highlight: true },
                                { label: "Pending", value: organiserPendingFindCount, highlight: false },
                            ].map(stat => (
                                <div key={stat.label} className="bg-white dark:bg-gray-900/80 border border-amber-100 dark:border-amber-800/70 rounded-xl p-3">
                                    <div className={`text-xl font-black leading-none ${stat.highlight ? "text-teal-600 dark:text-teal-400" : "text-gray-900 dark:text-gray-100"}`}>{stat.value}</div>
                                    <div className="text-[9px] font-black uppercase tracking-widest text-amber-700/60 dark:text-amber-300/60 mt-1">{stat.label}</div>
                                </div>
                            ))}
                        </div>

                        {isSharedPermission && rallyDayReview && (rallyDayReview.totalFinds > 0 || organiserMemberCount > 0) ? (
                            <div className="mb-5">
                                <RallyDayReviewPanel review={rallyDayReview} />
                            </div>
                        ) : (
                            <div className="mb-5 flex items-center gap-4 rounded-xl bg-white/80 dark:bg-gray-900/70 border border-amber-100 dark:border-amber-800/70 p-4">
                                <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/60 flex items-center justify-center shrink-0 text-amber-600 dark:text-amber-400">
                                    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                                        <circle cx="12" cy="10" r="3" />
                                    </svg>
                                </div>
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-widest text-amber-700/70 dark:text-amber-300/70 mb-0.5">Day Summary</div>
                                    <p className="text-xs font-medium leading-relaxed text-gray-600 dark:text-gray-300 m-0">
                                        {isSharedPermission
                                          ? "Import member data to build the finds summary, activity zones and field signal for the day."
                                          : "Generate the join link first. Once members send exports back, the finds summary appears here in the hub."}
                                    </p>
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                            <button
                                type="button"
                                onClick={() => setShowCreatePack(true)}
                                className="flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-500 text-white px-4 py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors shadow-sm"
                            >
                                <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="3" y="3" width="7" height="7" />
                                    <rect x="14" y="3" width="7" height="7" />
                                    <rect x="14" y="14" width="7" height="7" />
                                    <rect x="3" y="14" width="7" height="7" />
                                </svg>
                                {isSharedPermission ? "Share join link" : "Generate join link"}
                            </button>
                            <button
                                type="button"
                                onClick={() => isSharedPermission ? setShowImportClubDayData(true) : setShowCreatePack(true)}
                                className={`flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors shadow-sm ${isSharedPermission ? "bg-teal-800 hover:bg-teal-700 text-white" : "bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30"}`}
                            >
                                <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                                {isSharedPermission ? "Import member data" : "Generate link first"}
                            </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <button
                                type="button"
                                onClick={() => setIsAddingField(true)}
                                className="flex min-h-10 items-center justify-center gap-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-teal-400 hover:text-teal-700 dark:hover:text-teal-300 px-2.5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest leading-tight transition-colors"
                            >
                                <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                                    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
                                </svg>
                                Add field
                            </button>
                            <button
                                type="button"
                                onClick={() => setReportTarget(undefined)}
                                className="flex min-h-10 items-center justify-center gap-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-teal-400 hover:text-teal-700 dark:hover:text-teal-300 px-2.5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest leading-tight transition-colors"
                            >
                                <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                    <polyline points="14 2 14 8 20 8" />
                                </svg>
                                Report
                            </button>
                            <button
                                type="button"
                                onClick={() => setAgreementModalOpen(true)}
                                className="flex min-h-10 items-center justify-center gap-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-teal-400 hover:text-teal-700 dark:hover:text-teal-300 px-2.5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest leading-tight transition-colors"
                            >
                                <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                                    <path d="M12 20h9" />
                                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                                </svg>
                                {agreementKindLabel}
                            </button>
                        </div>

                        {organiserMemberCount > 0 && submittedMembers && (
                            <div className="mt-5 pt-4 border-t border-amber-200/60 dark:border-amber-800/50">
                                <div className="text-[9px] font-black uppercase tracking-widest text-amber-700/60 dark:text-amber-300/60 mb-2">
                                    Submitted data · {organiserMemberCount}
                                </div>
                                <div className="space-y-1.5">
                                    {submittedMembers.map(member => {
                                        const initials = (member.recorderName || "?")
                                            .split(" ")
                                            .map((word: string) => word[0])
                                            .join("")
                                            .slice(0, 2)
                                            .toUpperCase();
                                        const memberKey = member.recorderId || member.recorderName?.trim();
                                        const memberFindCount = memberKey ? submittedMemberFindCounts.get(memberKey) ?? 0 : 0;
                                        return (
                                            <div key={member.id} className="flex items-center gap-3 bg-white/70 dark:bg-gray-900/50 border border-amber-100 dark:border-amber-800/50 rounded-xl px-3 py-2.5">
                                                <div className="w-7 h-7 rounded-full bg-teal-100 dark:bg-teal-900/60 flex items-center justify-center text-[10px] font-black text-teal-700 dark:text-teal-300 shrink-0">
                                                    {initials}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-bold text-gray-800 dark:text-gray-100 truncate m-0">
                                                        {member.recorderName || "Unnamed detectorist"}
                                                    </p>
                                                </div>
                                                <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                                                    <span className="text-[9px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                                                        {memberFindCount} {memberFindCount === 1 ? "find" : "finds"}
                                                    </span>
                                                    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/60 text-teal-700 dark:text-teal-300">
                                                        Data sent
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {isRally && isEdit && !isEditing && !isClubDayMember && (
            <div className="lg:col-span-3">
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 sm:p-6 shadow-sm">
                    <div className="flex items-start justify-between gap-4 mb-5">
                        <div className="min-w-0">
                            <div className="text-[10px] font-black uppercase tracking-widest text-amber-500 mb-1">Rally / Club Dig</div>
                            <h3 className="text-2xl font-black text-gray-800 dark:text-gray-100 break-words">{name || "Unnamed Rally"}</h3>
                            {validFrom && (
                                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 mt-1">
                                    {new Date(validFrom).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                                </p>
                            )}
                        </div>
                        <div className="shrink-0 text-xs font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded font-bold text-gray-600 dark:text-gray-300">
                            {finds?.length ?? 0} finds
                        </div>
                    </div>

                    {landownerName && (
                        <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-900/40 rounded-xl border border-gray-100 dark:border-gray-700">
                            <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 text-gray-500 dark:text-gray-400">Organiser / Club</div>
                            <p className="font-bold text-gray-700 dark:text-gray-300">{landownerName}</p>
                            {landownerPhone && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">📞 {landownerPhone}</p>}
                            {landownerEmail && <p className="text-sm text-gray-500 dark:text-gray-400">✉️ {landownerEmail}</p>}
                        </div>
                    )}

                    {(boundary || (lat != null && lon != null)) && (
                        <div className="mb-4">
                            {boundary && lat != null && lon != null ? (
                                <StaticMapPreview lat={lat} lon={lon} boundary={boundary} className="h-40 rounded-xl border border-gray-200 dark:border-gray-700" />
                            ) : lat != null && lon != null ? (
                                <img
                                    src={`https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lon}&zoom=13&size=600x150&markers=${lat},${lon}`}
                                    alt="Rally location"
                                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700"
                                />
                            ) : null}
                            {lat != null && lon != null && (
                                <button
                                    onClick={() => window.open(`https://www.google.com/maps?q=${lat},${lon}`, "_blank")}
                                    className="text-[10px] font-bold text-gray-400 hover:text-emerald-600 transition-colors flex items-center gap-1 mt-1.5"
                                >
                                    View on Google Maps ↗
                                </button>
                            )}
                        </div>
                    )}

                    {finds && finds.length > 0 ? (
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-2 text-gray-500 dark:text-gray-400">Finds</div>
                            <div className={`grid gap-1.5 ${finds.length > 6 ? 'max-h-64 overflow-y-auto' : ''}`}>
	                                {finds.map((f: any) => (
	                                    <button
	                                        key={f.id}
	                                        onClick={() => setOpenFindId(f.id)}
	                                        className="w-full text-left flex items-center gap-3 p-2.5 bg-gray-50 dark:bg-gray-900/40 rounded-xl border border-gray-100 dark:border-gray-700 hover:border-emerald-400 transition-all group"
	                                    >
	                                        <div className="min-w-0 flex-1">
	                                            <div className="text-xs font-black text-gray-800 dark:text-gray-100 truncate group-hover:text-emerald-600 transition-colors">{f.objectType || f.findCategory || "Unknown find"}</div>
	                                            {f.notes && <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{f.notes}</div>}
	                                        </div>
	                                        <div className="text-[10px] font-bold text-gray-400 shrink-0">{new Date(f.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>
	                                    </button>
	                                ))}
                            </div>
                        </div>
	                    ) : (
	                        <div className="text-center py-8 border-2 border-dashed border-gray-100 dark:border-gray-700 rounded-xl text-sm text-gray-400 italic">
	                            {isSharedPermission ? "No finds imported yet — use Import Member Data to bring in detectorist records." : "No finds recorded for this rally yet."}
	                        </div>
	                    )}
                </div>
            </div>
            )}

            {(!isClubDayMember || isEditing) && (!isRally || isEditing || !isEdit) && (
            <React.Fragment>
            {/* Left Column: Permission Info */}
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
	                            onClick={() => setShowNewPermissionDetails(true)}
	                            className="min-h-11 rounded-xl border border-emerald-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-emerald-700 transition-colors hover:border-emerald-500 hover:bg-emerald-600 hover:text-white dark:border-emerald-800 dark:bg-gray-900 dark:text-emerald-300"
	                          >
	                            Add details now
	                          </button>
	                          <button
	                            type="button"
	                            onClick={doGPS}
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
                                onClick={() => setIsPickingBoundary(true)}
                                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold border-2 shadow-sm transition-all ${boundary ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-emerald-400 hover:text-emerald-600'}`}
                            >
                                <span>{boundary ? (isRally ? "Site Boundary Set ✓" : "Boundary Set ✓") : (isRally ? "Define Site Boundary" : "Define Boundary")}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsPickingLocation(true)}
                                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-2 border-gray-200 dark:border-gray-700 shadow-sm hover:border-emerald-400 hover:text-emerald-600 transition-all"
                            >
                                <span>Pick Location</span>
                            </button>
                            <button
                                type="button"
                                onClick={doGPS}
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
                                        onClick={() => setIsAddingField(true)}
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
                                                        onClick={() => setNotesFieldId(f.id)}
                                                        className={`text-[10px] font-bold underline-offset-2 hover:underline transition-colors ${f.notes ? "text-amber-700 dark:text-amber-300" : "text-gray-500 dark:text-gray-400 hover:text-amber-700 dark:hover:text-amber-300"}`}
                                                    >
                                                        Notes
                                                    </button>
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
                                            onClick={() => setIsAddingField(true)}
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
                            onClick={save} 
                            disabled={saving || !name.trim()} 
                            className={`mt-4 flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-4 rounded-2xl font-black text-xl shadow-xl transition-all disabled:opacity-50 ${permissionCoachActive && permissionCoachStep === 2 ? "ring-4 ring-amber-300/40" : ""}`}
                        >
                            {saveButtonLabel}
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
                                  onClick={() => goRecordFind()}
                                  className="text-[10px] font-black bg-teal-600 hover:bg-teal-500 text-white px-3 py-2 rounded-lg transition-colors uppercase tracking-widest"
                                >
                                  Record Find
                                </button>
                                <button
                                  onClick={() => setShowExportClubDay(true)}
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
                                onChange={(event) => uploadExistingAgreement(event.target.files?.[0])}
                              />
                            )}
                            {permissionNeedsCompletion && (
                                <button
                                    onClick={completePermissionDetails}
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
                                onClick={() => setAgreementModalOpen(true)}
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
                                    onClick={() => setProofModalOpen(true)}
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
                                              onClick={() => setIsAddingField(true)}
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
                                                                onClick={() => setNotesFieldId(f.id)}
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
                                                        onClick={() => isClubDayMember ? goRecordFind(f.id) : nav(`/session/new?permissionId=${id}&fieldId=${f.id}`)}
                                                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black py-1.5 rounded-lg transition-colors shadow-sm"
                                                    >
                                                        {isClubDayMember ? "Record Find" : "Start Session"}
                                                    </button>
                                                    {!isClubDayMember && (
                                                      <>
                                                        <button
                                                            onClick={() => setEditingFieldId(f.id)}
                                                            className="px-2.5 py-1.5 text-[10px] font-bold text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors border border-emerald-100 dark:border-emerald-800"
                                                        >
                                                            Edit
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteField(f.id)}
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
                                    <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/50 rounded-lg flex items-center justify-center text-[9px] font-black uppercase tracking-wide text-amber-700 dark:text-amber-300">Quick</div>
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
                                {isClubDayMember ? "Tap to add details before exporting to the organiser." : "Tap to add details & assign to a session"}
                            </p>
                        </div>
                    </div>
                )}

                {/* Quick Finds Section (Recorded but no session) */}
                {isEdit && standaloneFinds && standaloneFinds.length > 0 && (
                    <div className="bg-sky-50 dark:bg-sky-900/10 border-2 border-sky-200 dark:border-sky-800/50 rounded-2xl p-6 shadow-sm">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-black text-sky-800 dark:text-sky-400 m-0 uppercase tracking-tight">{isClubDayMember ? "Recorded Finds" : "Quick Finds"}</h3>
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
                                                    <span className="text-[9px] font-black uppercase tracking-wide text-sky-700 dark:text-sky-300">Find</span>
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
                                            {isClubDayMember ? (
                                                <button
                                                    onClick={() => setOpenFindId(f.id)}
                                                    className="w-full bg-sky-600 text-white text-[9px] font-black py-2 rounded-lg shadow-sm hover:bg-sky-700 transition-all uppercase tracking-widest text-center"
                                                >
                                                    Review Find
                                                </button>
                                            ) : sessions && sessions.length > 0 ? (
                                                <div className="relative flex-1 group/link">
                                                    <button className="w-full bg-sky-600 text-white text-[9px] font-black py-2 rounded-lg shadow-sm hover:bg-sky-700 transition-all uppercase tracking-widest text-center flex items-center justify-center gap-1">
                                                        <span>Link to Visit</span>
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
                                                                        if (await confirmAction({
                                                                            title: "Link Find to Visit?",
                                                                            message: `Link this find to the session on ${new Date(s.date).toLocaleDateString()}?`,
                                                                            confirmLabel: "Link",
                                                                        })) {
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
                                                                        {new Date(s.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
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
                                {isClubDayMember ? "These finds will be included when you export your club day data." : "Tap find to view, or link to a visit below."}
                            </p>
                        </div>
                    </div>
                )}

                {isClubDayMember ? (
                <div className="bg-teal-50 dark:bg-teal-950/20 border border-teal-200 dark:border-teal-800 rounded-2xl p-6 shadow-sm">
                    <div className="flex justify-between items-start gap-4 mb-5">
                        <div>
                            <h3 className="text-xl font-bold text-teal-900 dark:text-teal-100 m-0">Day Record</h3>
                            <p className="text-xs text-teal-700/70 dark:text-teal-300/70 mt-1 leading-relaxed">Finds are saved against this event. Sessions are optional and not needed for club day export.</p>
                        </div>
                        <div className="text-xs font-mono bg-white dark:bg-gray-900 px-2 py-1 rounded font-bold text-teal-700 dark:text-teal-300 border border-teal-100 dark:border-teal-800">{finds?.length ?? 0} finds</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-4">
                        <div className="bg-white dark:bg-gray-900/80 border border-teal-100 dark:border-teal-800 rounded-xl p-3">
                            <div className="text-lg font-black text-teal-700 dark:text-teal-300 leading-none">{finds?.length ?? 0}</div>
                            <div className="text-[9px] font-black uppercase tracking-widest text-teal-700/50 dark:text-teal-300/50 mt-1">Recorded</div>
                        </div>
                        <div className="bg-white dark:bg-gray-900/80 border border-teal-100 dark:border-teal-800 rounded-xl p-3">
                            <div className="text-lg font-black text-amber-600 dark:text-amber-300 leading-none">{pendingFinds?.length ?? 0}</div>
                            <div className="text-[9px] font-black uppercase tracking-widest text-teal-700/50 dark:text-teal-300/50 mt-1">Pending</div>
                        </div>
                        <div className="bg-white dark:bg-gray-900/80 border border-teal-100 dark:border-teal-800 rounded-xl p-3">
                            <div className="text-lg font-black text-teal-700 dark:text-teal-300 leading-none">{fields?.length ?? 0}</div>
                            <div className="text-[9px] font-black uppercase tracking-widest text-teal-700/50 dark:text-teal-300/50 mt-1">Fields</div>
                        </div>
                    </div>
                    <div className="grid gap-2">
                        <button
                            onClick={() => goRecordFind()}
                            className="w-full bg-teal-600 hover:bg-teal-500 text-white py-3 rounded-xl font-black shadow-sm transition-all uppercase tracking-widest text-xs"
                        >
                            Record Find
                        </button>
                        <button
                            onClick={() => setShowExportClubDay(true)}
                            className="w-full bg-white dark:bg-gray-900 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 py-3 rounded-xl font-black shadow-sm hover:bg-teal-50 dark:hover:bg-teal-900/30 transition-all uppercase tracking-widest text-xs"
                        >
                            Send Finds to Organiser
                        </button>
                        <button
                            onClick={handleKeepClubDayAsPersonalRecord}
                            disabled={saving}
                            className="w-full bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 py-3 rounded-xl font-black shadow-sm hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-all uppercase tracking-widest text-xs disabled:opacity-50"
                        >
                            Keep Rally Record
                        </button>
                    </div>
                    <p className="text-[10px] text-teal-700/60 dark:text-teal-300/60 mt-3 leading-relaxed">
                        Keep Rally Record leaves the organiser event but keeps your finds, photos, fields, and sessions as your own local rally record.
                    </p>
                </div>
                ) : isRally ? (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm">
                    <div className="text-[10px] font-black uppercase tracking-widest text-amber-500 mb-1">Rally</div>
                    <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100 m-0 mb-5">{name || "Unnamed Rally"}</h3>
                    <div className="grid gap-4">
                        {landownerName && (
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-0.5 text-gray-500 dark:text-gray-400">Organiser / Club</div>
                                <p className="font-bold text-gray-700 dark:text-gray-300">{landownerName}</p>
                                {landownerPhone && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">📞 {landownerPhone}</p>}
                                {landownerEmail && <p className="text-sm text-gray-500 dark:text-gray-400">✉️ {landownerEmail}</p>}
                            </div>
                        )}
                        {validFrom && (
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-0.5 text-gray-500 dark:text-gray-400">Event Date</div>
                                <p className="font-bold text-gray-700 dark:text-gray-300">{new Date(validFrom).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                            </div>
                        )}
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-0.5 text-gray-500 dark:text-gray-400">Total Finds</div>
                            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{finds?.length ?? 0}</p>
                        </div>
                        {lat != null && lon != null && (
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1.5 text-gray-500 dark:text-gray-400">Location</div>
                                <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/70 px-3 py-3 mb-2">
                                    <p className="font-mono text-xs font-bold text-gray-700 dark:text-gray-300">{lat.toFixed(6)}, {lon.toFixed(6)}</p>
                                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Map opens only when you choose to view it.</p>
                                </div>
                                <button
                                    onClick={() => window.open(`https://www.google.com/maps?q=${lat},${lon}`, "_blank")}
                                    className="text-[10px] font-bold text-gray-400 hover:text-emerald-600 transition-colors flex items-center gap-1"
                                >
                                    View on Google Maps ↗
                                </button>
                            </div>
                        )}
                    </div>
                </div>
                ) : (
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
                                                    {s.recorderName && (
                                                        <div className="text-[10px] font-black text-teal-600 dark:text-teal-400 truncate">
                                                            {s.recorderName}
                                                        </div>
                                                    )}
                                                    <div className="font-black text-xs text-gray-900 dark:text-gray-100 group-hover:text-emerald-600 transition-colors">
                                                        {new Date(s.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <span className={`text-[10px] font-bold truncate ${s.fieldName ? 'text-emerald-600' : 'text-gray-400 italic'}`}>
                                                            {s.fieldName || "No specific field"}
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
                                                {s.durationMs > 0 && <span className="font-mono font-bold opacity-80 whitespace-nowrap">{formatDuration(s.durationMs)}</span>}
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
                )}
            </div>
            </React.Fragment>
                )}
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

      {notesField && (
        <FieldNotesModal
          field={notesField}
          readOnly={isClubDayMember}
          onClose={() => setNotesFieldId(null)}
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

      {showCreatePack && id && (
        <CreateClubDayPackModal
          permissionId={id}
          permissionName={name}
          organiserContactNumber={isRally ? (landownerPhone || organiserContactNumber) : organiserContactNumber}
          organiserEmail={isRally ? (landownerEmail || organiserEmail) : organiserEmail}
          significantFindInstructions={significantFindInstructions}
          clubDayPublicNotes={clubDayPublicNotes}
          eventDate={validFrom || undefined}
          fields={fields ?? []}
          onClose={() => {
            setShowCreatePack(false);
            // Reload shared permission state
            db.permissions.get(id).then(p => {
              if (p) {
                setName(p.name);
                setType(p.type || "individual");
                setValidFrom(p.validFrom || "");
                setIsSharedPermission(!!p.isSharedPermission);
                setSharedPermissionId(p.sharedPermissionId);
                setOrganiserContactNumber(p.organiserContactNumber);
                setOrganiserEmail(p.organiserEmail);
                setSignificantFindInstructions(p.significantFindInstructions);
                setClubDayPublicNotes(p.clubDayPublicNotes);
              }
            });
          }}
        />
      )}

      {showExportClubDay && id && sharedPermissionId && (
        <ExportClubDayModal
          permissionId={id}
          sharedPermissionId={sharedPermissionId}
          permissionName={name}
          organiserEmail={organiserEmail}
          onClose={() => setShowExportClubDay(false)}
        />
      )}

      {showImportClubDayData && (
        <ImportClubDayDataModal
          onClose={() => setShowImportClubDayData(false)}
        />
      )}

      {confirmDialog}

    </div>
  );
}
