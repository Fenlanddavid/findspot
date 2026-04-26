import React, { useEffect, useState, useMemo } from "react";
import { db, Permission, Session, Find, Media, Track } from "../db";
import { v4 as uuid } from "uuid";
import { captureGPS } from "../services/gps";
import { getSetting, getOrCreateRecorderId } from "../services/data";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { FindRow } from "../components/FindRow";
import { FindModal } from "../components/FindModal";
import FieldReportModal from "../components/FieldReportModal";
import PermissionReportModal from "../components/PermissionReportModal";
import { startTracking, stopTracking, isTrackingActive, getCurrentTrackId, isWakeLockSupported } from "../services/tracking";
import { calculateCoverage, CoverageResult } from "../services/coverage";
import { Modal } from "../components/Modal";
import { TrackingOverlay } from "../components/TrackingOverlay";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

function SessionSummary({
  coverage,
  findsCount,
  pendingCount,
  durationMins,
  totalTime,
  permissionId,
  fieldId,
  onClose,
  onFieldReport,
  onLandownerReport,
}: {
  coverage: number,
  findsCount: number,
  pendingCount: number,
  durationMins: number | null,
  totalTime: string | null,
  permissionId: string | null,
  fieldId: string | null,
  onClose: () => void,
  onFieldReport: () => void,
  onLandownerReport: (forField: boolean) => void,
}) {
  // Fourth stat: % detected if tracked, finds/hr if untracked + duration, else win phrase
  let fourthStat: { label: string; value: string } | null = null;
  if (coverage > 0) {
    fourthStat = { label: "Field Detected", value: `${Math.round(coverage)}%` };
  } else if (durationMins && durationMins > 0 && findsCount > 0) {
    const rate = (findsCount / durationMins) * 60;
    fourthStat = { label: "Find Rate", value: `${rate.toFixed(1)}/hr` };
  } else if (findsCount >= 5) {
    fourthStat = { label: "Result", value: "Cracking!" };
  } else if (findsCount > 0) {
    fourthStat = { label: "Result", value: "Good hunt" };
  }

  return (
      <Modal title="Session Complete" onClose={onClose}>
          <div className="flex flex-col gap-6 py-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-gray-50 dark:bg-gray-900/50 p-3 rounded-xl border border-gray-100 dark:border-gray-800 text-center flex flex-col gap-1">
                      <span className="text-[9px] font-black uppercase tracking-widest opacity-40">Finds</span>
                      <span className="text-sm font-black text-emerald-600">{findsCount}</span>
                  </div>
                  {totalTime && (
                    <div className="bg-gray-50 dark:bg-gray-900/50 p-3 rounded-xl border border-gray-100 dark:border-gray-800 text-center flex flex-col gap-1">
                        <span className="text-[9px] font-black uppercase tracking-widest opacity-40">Duration</span>
                        <span className="text-sm font-black text-emerald-600">{totalTime}</span>
                    </div>
                  )}
                  {fourthStat && (
                    <div className="bg-gray-50 dark:bg-gray-900/50 p-3 rounded-xl border border-gray-100 dark:border-gray-800 text-center flex flex-col gap-1">
                        <span className="text-[9px] font-black uppercase tracking-widest opacity-40">{fourthStat.label}</span>
                        <span className="text-sm font-black text-emerald-600">{fourthStat.value}</span>
                    </div>
                  )}
              </div>

              {permissionId && (
                <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex flex-col gap-3">
                    <div>
                        <p className="text-[9px] font-black uppercase tracking-widest opacity-40 mb-1">Landowner Report</p>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                            {pendingCount > 0
                                ? `You have ${pendingCount} pending ${pendingCount === 1 ? 'find' : 'finds'}. For the most complete report, finish those records first.`
                                : "Generate a report to share with the landowner."}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => onLandownerReport(false)}
                            className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-emerald-600 hover:text-white text-gray-700 dark:text-gray-300 font-black py-2 rounded-xl transition-all uppercase tracking-widest text-[10px]"
                        >
                            Whole Permission
                        </button>
                        {fieldId && (
                            <button
                                onClick={() => onLandownerReport(true)}
                                className="flex-1 bg-gray-100 dark:bg-gray-800 hover:bg-emerald-600 hover:text-white text-gray-700 dark:text-gray-300 font-black py-2 rounded-xl transition-all uppercase tracking-widest text-[10px]"
                            >
                                This Field
                            </button>
                        )}
                    </div>
                </div>
              )}

              <button
                  onClick={onFieldReport}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-3 rounded-xl shadow-lg shadow-emerald-600/20 transition-all uppercase tracking-widest text-[10px] flex items-center justify-center gap-2"
              >
                  Generate Field Report
              </button>
              <button
                  onClick={onClose}
                  className="w-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 font-black py-3 rounded-xl transition-all uppercase tracking-widest text-[10px]"
              >
                  Close & Finish
              </button>
          </div>
      </Modal>
  );
}

const DEFAULT_CENTER: [number, number] = [-2.0, 54.5];
const DEFAULT_ZOOM = 13;

export default function SessionPage(props: {
  projectId: string;
}) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const permissionId = searchParams.get("permissionId");
  const urlFieldId = searchParams.get("fieldId");
  const nav = useNavigate();
  
  // Use a stable sessionId even if it's a new session (id is undefined)
  const [sessionId] = useState(id || uuid());
  const isEdit = !!id;

  const [date, setDate] = useState(new Date().toISOString().slice(0, 16));
  const [lat, setLat] = useState<number | null>(null);
  const [lon, setLon] = useState<number | null>(null);
  const [acc, setAcc] = useState<number | null>(null);

  const [fieldId, setFieldId] = useState<string | null>(urlFieldId || null);
  const [landUse, setLandUse] = useState("");
  const [cropType, setCropType] = useState("");
  const [isStubble, setIsStubble] = useState(false);
  const [notes, setNotes] = useState("");
  const [isFinished, setIsFinished] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [isEditing, setIsEditing] = useState(!isEdit);
  
  const [openFindId, setOpenFindId] = useState<string | null>(null);
  
  const [isTracking, setIsTracking] = useState(isTrackingActive());
  const [showTrackingOverlay, setShowTrackingOverlay] = useState(false);
  const [showCoverage, setShowCoverage] = useState(false);
  const [coverageResult, setCoverageResult] = useState<CoverageResult | null>(null);
  const [coverageError, setCoverageError] = useState(false);
  const [milestoneMsg, setMilestoneMsg] = useState<string | null>(null);

  const [showTrimUI, setShowTrimUI] = useState(false);
  const [trimStartMins, setTrimStartMins] = useState(0);
  const [trimEndMins, setTrimEndMins] = useState(0);
  const [trimming, setTrimming] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryData, setSummaryData] = useState<{ coverage: number, findsCount: number, durationMins: number | null, totalTime: string | null }>({ coverage: 0, findsCount: 0, durationMins: null, totalTime: null });
  const [showFieldReport, setShowFieldReport] = useState(false);
  const [showLandownerReport, setShowLandownerReport] = useState(false);
  const [landownerReportForField, setLandownerReportForField] = useState(false);
  const [keyNotes, setKeyNotes] = useState<string[]>([]);

  const permission = useLiveQuery(
    async () => (permissionId ? db.permissions.get(permissionId) : (sessionId ? db.sessions.get(sessionId).then(s => s ? db.permissions.get(s.permissionId) : null) : null)),
    [permissionId, sessionId]
  );

  const fields = useLiveQuery(async () => {
    const pId = permissionId || (sessionId ? await db.sessions.get(sessionId).then(s => s?.permissionId) : null);
    if (!pId) return [];
    return db.fields.where("permissionId").equals(pId).toArray();
  }, [permissionId, sessionId]);

  const selectedField = useLiveQuery(async () => {
    if (!fieldId) return null;
    return db.fields.get(fieldId);
  }, [fieldId]);

  const finds = useLiveQuery(async () => {
    if (!sessionId) return [];
    return db.finds.where("sessionId").equals(sessionId).reverse().sortBy("createdAt");
  }, [sessionId]);

  const allMedia = useLiveQuery(async () => {
    if (!sessionId || !finds) return [];
    const ids = finds.map(s => s.id);
    return db.media.where("findId").anyOf(ids).toArray();
  }, [sessionId, finds]);

  const tracks = useLiveQuery(async () => {
    if (!sessionId) return [];
    return db.tracks.where("sessionId").equals(sessionId).toArray();
  }, [sessionId]);

  useEffect(() => {
    const boundary = selectedField?.boundary || (permission as any)?.boundary;
    if (!showCoverage || !boundary) {
        setCoverageResult(null);
        setCoverageError(false);
        return;
    }
    const result = calculateCoverage(boundary, tracks || []);
    setCoverageResult(result);
    setCoverageError(result === null);
  }, [showCoverage, selectedField, permission, tracks]);

  const findThumbMedia = useMemo(() => {
    const info = new Map<string, Media>();
    if (!allMedia || !finds) return info;
    const sortedMedia = [...allMedia].sort((a, b) => {
        const aDate = a?.createdAt || "";
        const bDate = b?.createdAt || "";
        return aDate.localeCompare(bDate);
    });
    for (const row of sortedMedia) {
      if (row.findId && !info.has(row.findId)) info.set(row.findId, row);
    }
    return info;
  }, [allMedia, finds]);

  const mapDivRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);

  // Destroy the map when the component unmounts to prevent memory leaks
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const boundary = selectedField?.boundary || (permission as any)?.boundary;
    const hasBoundary = !!boundary;
    if (!mapDivRef.current || (!hasBoundary && (!tracks || tracks.length === 0) && !isTracking)) return;

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
                tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"],
                tileSize: 256,
                attribution: "© OpenStreetMap"
              }
            },
            layers: [{ id: "simple-tiles", type: "raster", source: "raster-tiles", minzoom: 0, maxzoom: 22 }]
          },
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
        });
      } catch (mapErr) {
        console.error("Map init failed:", mapErr);
        return;
      }

      map.on("load", () => {
        map.addSource("boundary", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] }
        });

        map.addLayer({
            id: "boundary-outline",
            type: "line",
            source: "boundary",
            paint: { "line-color": "#10b981", "line-width": 2, "line-dasharray": [2, 1] }
        });

        map.addSource("tracks", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] }
        });

        map.addSource("coverage", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] }
        });

        map.addLayer({
            id: "undetected-fill",
            type: "fill",
            source: "coverage",
            paint: {
              "fill-color": "#ea580c",
              "fill-opacity": 0.6,
              "fill-outline-color": "#ea580c"
            }
        });

        map.addLayer({
            id: "undetected-outline",
            type: "line",
            source: "coverage",
            paint: {
              "line-color": "#ea580c",
              "line-width": 2,
              "line-opacity": 0.8
            }
        });

        map.addLayer({
          id: "tracks-line",
          type: "line",
          source: "tracks",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-width": 4,
            "line-opacity": 0.8
          }
        });

        if (showCoverage && coverageResult) {
            const src = map.getSource("coverage") as maplibregl.GeoJSONSource;
            if (src) src.setData(coverageResult.undetectionsGeoJSON);
        }

        // Initial fit when data arrives
        updateMapData(map, tracks || []);
      });
      mapRef.current = map;
    } else {
      const map = mapRef.current;
      if (map.isStyleLoaded()) {
        updateMapData(map, tracks || []);
      }
    }

    function updateMapData(map: maplibregl.Map, tracksData: Track[]) {
      const source = map.getSource("tracks") as maplibregl.GeoJSONSource;
      if (source) {
        const geojson = {
          type: "FeatureCollection",
          features: tracksData
            .filter(t => t.points && Array.isArray(t.points) && t.points.length >= 2)
            .map(t => ({
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: t.points.map(p => [p.lon, p.lat])
              },
              properties: { color: t.color }
            }))
        };
        source.setData(geojson as any);
      }

      const boundarySource = map.getSource("boundary") as maplibregl.GeoJSONSource;
      const boundary = selectedField?.boundary || (permission as any)?.boundary;
      if (boundarySource && boundary) {
          boundarySource.setData(boundary);
      }

      // Fit bounds
      const allPoints = (tracksData || []).flatMap(t => t.points || []).filter(p => !!p && typeof p.lat === 'number');
      const bounds = new maplibregl.LngLatBounds();
      
      let hasDataForBounds = false;
      if (boundary && boundary.coordinates?.[0] && Array.isArray(boundary.coordinates[0])) {
          boundary.coordinates[0].forEach((p: [number, number]) => {
              if (Array.isArray(p) && p.length >= 2) {
                  bounds.extend(p as [number, number]);
                  hasDataForBounds = true;
              }
          });
      }
      
      if (allPoints.length > 0) {
          allPoints.forEach(p => {
              bounds.extend([p.lon, p.lat]);
              hasDataForBounds = true;
          });
      }

      if (hasDataForBounds && !bounds.isEmpty()) {
          map.fitBounds(bounds, { padding: 40, duration: isFinished ? 0 : 1000, animate: !isFinished, maxZoom: 18 });
      }
    }
  }, [tracks, isFinished, selectedField, permission]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource("coverage") as maplibregl.GeoJSONSource | undefined;
    if (src) {
        if (showCoverage && coverageResult) {
            src.setData(coverageResult.undetectionsGeoJSON);
        } else {
            src.setData({ type: "FeatureCollection", features: [] });
        }
    }
    if (map.getLayer("undetected-fill")) {
        map.setLayoutProperty("undetected-fill", "visibility", showCoverage ? "visible" : "none");
        if (map.getLayer("undetected-outline")) {
            map.setLayoutProperty("undetected-outline", "visibility", showCoverage ? "visible" : "none");
        }
    }
  }, [showCoverage, coverageResult]);

  useEffect(() => {
    if (sessionId) {
      db.sessions.get(sessionId).then(s => {
        if (!s) {
          if (isEdit) {
            // Session not found — it may have been deleted; redirect to home
            nav("/");
            return;
          }
          setLoading(false);
          return;
        }
        setDate(new Date(s.date).toISOString().slice(0, 16));
        setLat(s.lat);
        setLon(s.lon);
        setAcc(s.gpsAccuracyM);
        setFieldId(s.fieldId || null);
        setLandUse(s.landUse);
        setCropType(s.cropType);
        setIsStubble(s.isStubble);
        setNotes(s.notes);
        setIsFinished(!!s.isFinished);
        setKeyNotes(s.keyNotes ?? []);
        setLoading(false);
      }).catch(err => {
        console.error("Failed to load session:", err);
        setError("Could not load session details.");
        setLoading(false);
      });
    }
  }, [sessionId]);

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
    if (!isEdit) return;
    if (!confirm("Are you sure? This will permanently delete this session, all finds within it, and all tracking data.")) return;
    
    setSaving(true);
    try {
      await db.transaction("rw", [db.sessions, db.finds, db.media, db.tracks], async () => {
        // Find all finds in this session
        const sessionFinds = await db.finds.where("sessionId").equals(sessionId).toArray();
        const findIds = sessionFinds.map(f => f.id);
        
        // Delete all media for those finds
        if (findIds.length > 0) {
          await db.media.where("findId").anyOf(findIds).delete();
        }
        
        // Delete the finds
        await db.finds.where("sessionId").equals(sessionId).delete();
        
        // Delete all tracks for this session
        await db.tracks.where("sessionId").equals(sessionId).delete();
        
        // Delete the session itself
        await db.sessions.delete(sessionId);
      });
      
      nav(permission ? `/permission/${permission.id}` : "/");
    } catch (e: any) {
      setError("Delete failed: " + e.message);
      setSaving(false);
    }
  }

  async function save() {
    if (!permissionId && !isEdit) {
        setError("Missing permission ID");
        return;
    }
    setSaving(true);
    setError(null);
    try {
      const isoDate = new Date(date).toISOString();
      const now = new Date().toISOString();

      let resolvedPermissionId: string;
      if (isEdit) {
        const existing = await db.sessions.get(sessionId);
        if (!existing) {
          setError("Session not found — it may have been deleted.");
          setSaving(false);
          return;
        }
        resolvedPermissionId = existing.permissionId;
      } else {
        resolvedPermissionId = permissionId!;
      }

      let clubDayAttribution: { sharedPermissionId?: string; recorderId?: string; recorderName?: string } = {};
      if (!isEdit) {
        const perm = await db.permissions.get(resolvedPermissionId);
        const sharedId = perm?.sharedPermissionId || (perm?.isClubDayMember ? perm.id : undefined);
        if (sharedId) {
          const [recorderId, recorderName] = await Promise.all([
            getOrCreateRecorderId(),
            getSetting<string>("recorderName", "Unnamed detectorist"),
          ]);
          clubDayAttribution = { sharedPermissionId: sharedId, recorderId, recorderName };
        }
      }

      const sessionFields = {
        fieldId,
        date: isoDate,
        lat,
        lon,
        gpsAccuracyM: acc,
        landUse,
        cropType,
        isStubble,
        notes,
        isFinished,
        keyNotes,
        updatedAt: now,
      };

      const session: Session = {
        id: sessionId,
        projectId: props.projectId,
        permissionId: resolvedPermissionId,
        ...clubDayAttribution,
        ...sessionFields,
        createdAt: now,
      };

      if (isEdit) {
        await db.sessions.update(sessionId, sessionFields);
        setIsEditing(false);
      } else {
        await db.sessions.add(session);
        setIsEditing(false);
        if (!localStorage.getItem('fs_first_session')) {
          localStorage.setItem('fs_first_session', '1');
          setMilestoneMsg('First session started — enjoy the dig!');
          setTimeout(() => setMilestoneMsg(null), 4000);
        }
        nav(`/session/${sessionId}`, { replace: true });
      }
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleTracking() {
    if (isTracking) {
        await stopTracking();
        setIsTracking(false);
        setShowTrackingOverlay(false);
    } else {
        await startTracking(props.projectId, sessionId, permission?.name ? `Hunt @ ${permission.name}` : "New Hunt");
        setIsTracking(true);
        setShowTrackingOverlay(true);

        // Record start time if not already set
        const s = await db.sessions.get(sessionId);
        if (s && !s.startTime) {
            await db.sessions.update(sessionId, { startTime: new Date().toISOString() });
        }
    }
  }

  async function finishSession() {
    if (isTracking) {
        await stopTracking();
    }
    
    const now = new Date();
    const endTimeIso = now.toISOString();

    // Calculate final stats for summary
    const boundary = selectedField?.boundary || (permission as any)?.boundary;
    let finalCoverage = 0;
    if (boundary && tracks && tracks.length > 0) {
        const result = calculateCoverage(boundary, tracks);
        if (result) finalCoverage = result.percentCovered;
    }
    
    const count = await db.finds.where("sessionId").equals(sessionId).count();

    // Duration calculation - use startTime if available
    let durationStr: string | null = null;
    let durationMins: number | null = null;
    const s = await db.sessions.get(sessionId);
    const startT = s?.startTime ? new Date(s.startTime).getTime() : null;

    if (startT) {
        const ms = now.getTime() - startT;
        const mins = Math.floor(ms / 60000);
        durationMins = mins;
        const hrs = Math.floor(mins / 60);
        if (hrs > 0) durationStr = `${hrs}h ${mins % 60}m`;
        else durationStr = `${mins}m`;
    } else if (tracks && tracks.length > 0) {
        // Fallback to tracks
        const allPoints = tracks
            .flatMap(t => t.points || [])
            .filter(p => !!p && typeof p.timestamp === 'number')
            .sort((a, b) => a.timestamp - b.timestamp);

        if (allPoints.length > 1) {
            const ms = allPoints[allPoints.length - 1].timestamp - allPoints[0].timestamp;
            const mins = Math.floor(ms / 60000);
            durationMins = mins;
            const hrs = Math.floor(mins / 60);
            if (hrs > 0) durationStr = `${hrs}h ${mins % 60}m`;
            else durationStr = `${mins}m`;
        }
    }

    setSummaryData({
        coverage: finalCoverage,
        findsCount: count,
        durationMins,
        totalTime: durationStr
    });
    
    if (sessionId) {
        try {
            await db.sessions.update(sessionId, {
                isFinished: true,
                endTime: endTimeIso
            });
        } catch (e: any) {
            setError("Could not finish session: " + (e?.message ?? "Unknown error"));
            setIsTracking(isTrackingActive());
            return;
        }
        setIsFinished(true);
    }

    setShowSummary(true);
  }

  async function applyTrim() {
    if (!tracks || tracks.length === 0) return;
    setTrimming(true);
    try {
      for (const track of tracks) {
        if (!track.points || track.points.length < 2) continue;
        const sorted = [...track.points].sort((a, b) => a.timestamp - b.timestamp);
        const first = sorted[0].timestamp;
        const last = sorted[sorted.length - 1].timestamp;
        const startCut = first + trimStartMins * 60 * 1000;
        const endCut = last - trimEndMins * 60 * 1000;
        const trimmed = sorted.filter(p => p.timestamp >= startCut && p.timestamp <= endCut);
        await db.tracks.update(track.id, { points: trimmed, updatedAt: new Date().toISOString() });
      }
      setTrimStartMins(0);
      setTrimEndMins(0);
      setShowTrimUI(false);
    } finally {
      setTrimming(false);
    }
  }

  if (loading) return <div className="p-10 text-center opacity-50 font-medium">Loading session...</div>;

  return (
    <div className="max-w-4xl mx-auto pb-20 px-4">
      {milestoneMsg && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-bold pointer-events-none whitespace-nowrap">
          {milestoneMsg}
        </div>
      )}
      <div className="grid gap-8 mt-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex flex-wrap gap-3 items-center">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100">
                    {isEdit ? "Session Details" : "New Session"}
                </h2>
                {isEdit && !isEditing && (
                    <button 
                        onClick={() => setIsEditing(true)}
                        className="text-xs font-bold text-emerald-600 hover:text-white hover:bg-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800 transition-all"
                    >
                        ✎ Edit Details
                    </button>
                )}
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
                {isEdit && (
                    <button 
                        onClick={handleDelete}
                        disabled={saving}
                        className="text-xs sm:text-sm font-bold text-red-600 hover:text-white hover:bg-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-1 rounded-lg border border-red-200 dark:border-red-800 transition-all disabled:opacity-50 flex-1 sm:flex-none"
                    >
                        Delete
                    </button>
                )}
                <button onClick={() => nav(permission ? `/permission/${permission.id}` : "/")} className="text-xs sm:text-sm font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 bg-gray-50 dark:bg-gray-800 px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-700 transition-colors flex-1 sm:flex-none">Back</button>
            </div>
        </div>

        {error && (
            <div className="border-2 border-red-200 bg-red-50 text-red-800 p-4 rounded-xl shadow-sm flex gap-3 items-center">
                <span className="text-xl">⚠️</span> {error}
            </div>
        )}

        <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm grid gap-6 h-fit">
                {!isEditing && (
                  <div className="flex flex-col gap-6">
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-6">
                        <div className="min-w-0 flex-1">
                            <p className="text-emerald-600 font-black text-xs uppercase tracking-widest mb-1 truncate">📍 {permission?.name || "Unknown Location"}</p>
                            <div className="flex flex-wrap items-center gap-3">
                                <h3 className="text-xl sm:text-2xl font-black text-gray-800 dark:text-gray-100 break-words">{new Date(date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</h3>
                                {isFinished && (
                                    <span className="bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-widest border border-gray-200 dark:border-gray-600 whitespace-nowrap">Finished</span>
                                )}
                            </div>
                        </div>
                        {!isFinished && (
                            <>
                                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                                    <button
                                        onClick={toggleTracking}
                                        className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-2xl font-black shadow-lg transition-all transform active:scale-95 ${isTracking ? 'bg-red-600 text-white animate-pulse' : 'bg-white dark:bg-gray-800 text-emerald-600 dark:text-emerald-400 border-2 border-emerald-100 dark:border-emerald-900'}`}
                                    >
                                        <span className="text-sm">{isTracking ? '⏹️ STOP MAPPING' : '👣 MAP SESSION'}</span>
                                    </button>
                                    {isTracking && (
                                        <button
                                            onClick={() => setShowTrackingOverlay(true)}
                                            className="bg-black text-white px-4 py-3 rounded-2xl font-black shadow-lg transition-all transform active:scale-95 flex items-center justify-center gap-2 border-2 border-gray-800"
                                            title="Fullscreen Tracking Mode"
                                        >
                                            <span className="text-lg">📱</span>
                                            <span className="sm:hidden text-xs uppercase tracking-widest">Fullscreen</span>
                                        </button>
                                    )}
                                </div>
                                {isTracking && (
                                    <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 mt-1">
                                        ⚠️ Keep your screen on — locking it will stop GPS recording
                                    </p>
                                )}
                            </>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        {!isFinished ? (
                            <button 
                                onClick={finishSession}
                                className="bg-emerald-50 dark:bg-emerald-950/20 border-2 border-emerald-100 dark:border-emerald-800 p-4 rounded-xl flex flex-col items-center justify-center gap-1 group hover:bg-emerald-600 hover:border-emerald-600 transition-all shadow-sm"
                            >
                                <span className="text-xl group-hover:scale-110 transition-transform">✓</span>
                                <span className="text-xs font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400 group-hover:text-white">Finish Session</span>
                            </button>
                        ) : (
                            <div className="bg-gray-100 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col items-center justify-center gap-1 group">
                                <div className="flex flex-col items-center justify-center opacity-60">
                                    <span className="text-xl">🔒</span>
                                    <span className="text-[10px] font-black uppercase tracking-widest">Session Closed</span>
                                </div>
                                <button
                                    onClick={() => setShowFieldReport(true)}
                                    className="mt-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all"
                                >
                                    Field Report
                                </button>
                                <button
                                    onClick={async () => {
                                        if (sessionId && confirm("Re-open this session?")) {
                                            await db.sessions.update(sessionId, { isFinished: false });
                                            setIsFinished(false);
                                        }
                                    }}
                                    className="mt-2 text-[8px] font-black uppercase tracking-widest text-emerald-600 hover:underline"
                                >
                                    Re-open Session
                                </button>
                            </div>
                        )}

                        <div className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
                            <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1">Session Data</h4>
                            <div className="flex flex-col gap-2 mt-2">
                                <div className="flex flex-wrap gap-1">
                                    {isStubble && <span className="bg-amber-100 text-amber-800 text-[8px] font-bold px-1.5 py-0.5 rounded">🌾 Stubble</span>}
                                    {landUse && <span className="bg-orange-100 text-orange-800 text-[8px] font-bold px-1.5 py-0.5 rounded">🚜 {landUse}</span>}
                                </div>
                                {lat && lon ? (
                                    <p className="font-mono font-bold text-[10px] text-emerald-600 truncate">{lat.toFixed(6)}, {lon.toFixed(6)}</p>
                                ) : (
                                    <button onClick={doGPS} className="text-[10px] font-bold text-emerald-600 hover:underline">📍 Get GPS</button>
                                )}
                            </div>
                        </div>
                    </div>

                    {notes && (
                        <div className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
                            <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1">Notes</h4>
                            <p className="text-sm opacity-80 whitespace-pre-wrap">{notes}</p>
                        </div>
                    )}
                  </div>
                )}

                {isEditing && (
                  <>
                    <label className="block">
                        <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Date & Time</div>
                        <input 
                            type="datetime-local" 
                            value={date} 
                            onChange={(e) => setDate(e.target.value)} 
                            className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
                        />
                    </label>

                    <label className="block">
                      <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Field / Area</div>
                      <select 
                        value={fieldId ?? ""} 
                        onChange={(e) => setFieldId(e.target.value || null)}
                        className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all appearance-none font-medium"
                      >
                        <option value="">(No specific field)</option>
                        {fields?.map(f => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                    </label>

                    <div className="bg-emerald-50/50 dark:bg-emerald-900/20 p-5 rounded-2xl border-2 border-emerald-100/50 dark:border-emerald-800/30 flex flex-col sm:flex-row gap-4 items-center justify-between">
                        <div className="flex flex-col gap-1">
                            <div className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">GPS Location</div>
                            <div className="text-lg font-mono font-bold text-gray-800 dark:text-gray-100">
                                {lat && lon ? (
                                <div className="flex items-center gap-2">
                                    {lat.toFixed(6)}, {lon.toFixed(6)}
                                    {acc ? <span className="text-xs bg-emerald-600 text-white px-2 py-0.5 rounded-full">±{Math.round(acc)}m</span> : ""}
                                </div>
                                ) : (
                                <span className="opacity-40 italic">Coordinates not set</span>
                                )}
                            </div>
                        </div>
                        <button type="button" onClick={doGPS} className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl font-bold shadow-md flex items-center gap-2 whitespace-nowrap">
                            📍 {lat ? "Update GPS" : "Get Current GPS"}
                        </button>
                    </div>

                    <div className="flex flex-wrap gap-4 items-center bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
                        <div className="flex flex-col gap-2">
                            <div className="text-xs font-black uppercase tracking-widest opacity-50">Ground Condition</div>
                            <div className="flex flex-wrap gap-2">
                                <button 
                                    type="button"
                                    onClick={() => setIsStubble(!isStubble)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${isStubble ? 'bg-amber-100 border-amber-300 text-amber-800' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500'}`}
                                >
                                    {isStubble ? '🌾 Stubble ✓' : '🌾 Stubble'}
                                </button>
                                <button 
                                    type="button"
                                    onClick={() => setLandUse(landUse === 'Ploughed' ? '' : 'Ploughed')}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${landUse === 'Ploughed' ? 'bg-orange-100 border-orange-300 text-orange-800' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500'}`}
                                >
                                    {landUse === 'Ploughed' ? '🚜 Ploughed ✓' : '🚜 Ploughed'}
                                </button>
                                <button 
                                    type="button"
                                    onClick={() => setLandUse(landUse === 'Pasture' ? '' : 'Pasture')}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${landUse === 'Pasture' ? 'bg-emerald-100 border-emerald-300 text-emerald-800' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500'}`}
                                >
                                    {landUse === 'Pasture' ? '🍃 Pasture ✓' : '🍃 Pasture'}
                                </button>
                            </div>
                        </div>

                        <div className="flex flex-col gap-2 ml-auto">
                            <div className="text-xs font-black uppercase tracking-widest opacity-50">Mapping</div>
                            <div className="flex gap-2">
                                {isEdit ? (
                                    <>
                                        <button 
                                            type="button"
                                            onClick={toggleTracking}
                                            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg font-bold shadow-sm transition-all transform active:scale-95 text-xs ${isTracking ? 'bg-red-600 text-white animate-pulse' : 'bg-white dark:bg-gray-800 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700'}`}
                                        >
                                            <span>{isTracking ? '⏹️ Stop' : '👣 Map Session'}</span>
                                        </button>
                                        {isTracking && (
                                            <button 
                                                type="button"
                                                onClick={() => setShowTrackingOverlay(true)}
                                                className="bg-black text-white px-3 py-1.5 rounded-lg font-bold shadow-sm transition-all transform active:scale-95 text-xs border border-gray-700"
                                                title="Fullscreen Tracking Mode"
                                            >
                                                <span>📱</span>
                                            </button>
                                        )}
                                    </>
                                ) : (
                                    <span className="text-[10px] opacity-40 italic">Start session to enable mapping</span>
                                )}
                            </div>
                        </div>
                    </div>
                    <label className="block">
                        <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Session Notes</div>
                        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium" />
                    </label>

                    <div className="flex gap-4">
                        <button onClick={save} disabled={saving} className="mt-4 flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-4 rounded-2xl font-black text-xl shadow-xl transition-all disabled:opacity-50">
                            {saving ? "Saving..." : isEdit ? "Save Details ✓" : "Start Session →"}
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
                )}

                {((tracks && tracks.length > 0) || isTracking || (selectedField && selectedField.boundary)) && (
                    <div className="bg-emerald-50/30 dark:bg-emerald-900/10 p-4 rounded-xl border border-emerald-100 dark:border-emerald-800/30 mt-6">
                        <div className="flex justify-between items-center mb-2 flex-wrap gap-2">
                            <h4 className="text-xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                                {selectedField ? `Recorded Trail: ${selectedField.name}` : "Recorded Trail Tracks"}
                            </h4>
                            <div className="flex items-center gap-2">
                                {!isFinished && (selectedField && selectedField.boundary) && (
                                    <button 
                                        type="button"
                                        onClick={() => setShowCoverage(!showCoverage)}
                                        className={`flex items-center gap-2 px-3 py-1 rounded-lg font-bold shadow-sm transition-all transform active:scale-95 text-[10px] border ${showCoverage ? 'bg-orange-600 border-orange-600 text-white' : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-orange-700 dark:text-orange-400'}`}
                                    >
                                        <span>{showCoverage ? '🧭 Gaps On' : '🧭 Show Gaps'}</span>
                                        {showCoverage && coverageResult && (
                                            <span className="bg-white/20 px-1 rounded text-[8px]">
                                                {Math.round(100 - coverageResult.percentCovered)}%
                                            </span>
                                        )}
                                        {showCoverage && coverageError && (
                                            <span className="text-[8px]">⚠️ Failed</span>
                                        )}
                                    </button>
                                )}
                                {isFinished && tracks && tracks.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setShowTrimUI(!showTrimUI)}
                                        className={`px-3 py-1 rounded-lg font-bold text-[10px] border transition-all ${showTrimUI ? 'bg-gray-800 border-gray-700 text-gray-300' : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-400'}`}
                                    >
                                        ✂️ Trim
                                    </button>
                                )}
                                {tracks && tracks.map(t => (
                                    <div key={t.id} className="flex items-center gap-2 bg-white dark:bg-gray-900 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[10px] font-bold">
                                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
                                        <span>{t.points.length} pts</span>
                                        {t.isActive && <span className="ml-1 text-[8px] bg-red-600 text-white px-1 rounded animate-pulse">LIVE</span>}
                                    </div>
                                ))}
                            </div>
                        </div>
                        
                        {/* Map Preview */}
                        <div className="relative h-64 w-full rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-inner bg-gray-100 dark:bg-gray-900">
                            <div ref={mapDivRef} className="absolute inset-0" />
                            {isTracking && (
                                <div className="absolute top-2 left-2 z-10 bg-red-600 text-white text-[8px] font-black px-2 py-1 rounded-full animate-pulse shadow-lg">
                                    RECORDING LIVE TRAIL...
                                </div>
                            )}
                        </div>

                        {/* Trim panel */}
                        {showTrimUI && isFinished && (
                          <div className="mt-3 p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col gap-4">
                            {(() => {
                              const allPts = (tracks || []).flatMap(t => t.points || []).sort((a, b) => a.timestamp - b.timestamp);
                              const totalMins = allPts.length > 1 ? Math.round((allPts[allPts.length - 1].timestamp - allPts[0].timestamp) / 60000) : 0;
                              const remainMins = Math.max(0, totalMins - trimStartMins - trimEndMins);
                              return (
                                <>
                                  <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono">
                                    <span>Track: {totalMins}m total</span>
                                    <span className={remainMins < 5 ? 'text-red-500 font-bold' : 'text-emerald-500 font-bold'}>→ {remainMins}m after trim</span>
                                  </div>
                                  <div className="grid gap-3">
                                    {[{ label: 'Remove from start', value: trimStartMins, set: setTrimStartMins }, { label: 'Remove from end', value: trimEndMins, set: setTrimEndMins }].map(({ label, value, set }) => (
                                      <div key={label}>
                                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5">{label} {value > 0 && <span className="text-amber-500">— {value}m</span>}</p>
                                        <div className="flex gap-1.5">
                                          {[0, 5, 10, 15, 30].map(m => (
                                            <button
                                              key={m}
                                              type="button"
                                              onClick={() => set(m)}
                                              className={`flex-1 py-1.5 rounded-lg text-[10px] font-black border transition-all ${value === m ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-400'}`}
                                            >
                                              {m === 0 ? 'None' : `${m}m`}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  <div className="flex gap-2 pt-1">
                                    <button
                                      type="button"
                                      onClick={applyTrim}
                                      disabled={trimming || (trimStartMins === 0 && trimEndMins === 0) || remainMins < 1}
                                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-black text-[10px] uppercase tracking-widest py-2.5 rounded-xl transition-all"
                                    >
                                      {trimming ? 'Trimming…' : 'Apply Trim'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => { setShowTrimUI(false); setTrimStartMins(0); setTrimEndMins(0); }}
                                      className="px-4 bg-gray-100 dark:bg-gray-800 text-gray-500 font-black text-[10px] uppercase tracking-widest py-2.5 rounded-xl transition-all"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        )}
                    </div>
                )}
            </div>

            <div className="bg-gray-50 dark:bg-gray-900/30 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-inner h-fit">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100 m-0">Finds</h3>
                    <div className="text-xs font-mono bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded font-bold">{finds?.length ?? 0} total</div>
                </div>

                {!isEdit && (
                    <div className="text-center py-10 opacity-50 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl italic text-sm">
                        Save this session first to start recording finds!
                    </div>
                )}

                {isEdit && (
                    <div className="grid gap-3">
                        <button 
                            onClick={() => nav(`/find?permissionId=${permission?.id}&sessionId=${sessionId}`)}
                            className={`w-full ${isFinished ? 'bg-gray-600 hover:bg-gray-700' : 'bg-emerald-600 hover:bg-emerald-700'} text-white py-3 rounded-xl font-bold shadow-md transition-all flex items-center justify-center gap-2 mb-2`}
                        >
                            Add Find to Session {isFinished && <span className="text-[10px] opacity-75 font-normal ml-1">(Closed Session)</span>}
                        </button>

                        {finds && finds.length > 0 ? (
                            finds.map((s) => (
                                <FindRow 
                                    key={s.id} 
                                    find={s} 
                                    thumbMedia={findThumbMedia?.get(s.id) ?? null} 
                                    onOpen={() => setOpenFindId(s.id)} 
                                />
                            ))
                        ) : (
                            <div className="text-center py-10 opacity-50 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl italic text-sm">
                                No finds yet for this session.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
      </div>
      {openFindId && <FindModal findId={openFindId} onClose={() => setOpenFindId(null)} />}
      {showSummary && (
        <SessionSummary
          coverage={summaryData.coverage}
          findsCount={summaryData.findsCount}
          pendingCount={finds?.filter(f => f.isPending).length ?? 0}
          durationMins={summaryData.durationMins}
          totalTime={summaryData.totalTime}
          permissionId={permission?.id ?? null}
          fieldId={fieldId}
          onClose={() => nav(permission ? `/permission/${permission.id}` : "/")}
          onFieldReport={() => { setShowSummary(false); setShowFieldReport(true); }}
          onLandownerReport={(forField) => {
            setLandownerReportForField(forField);
            setShowSummary(false);
            setShowLandownerReport(true);
          }}
        />
      )}
      {showFieldReport && (
        <FieldReportModal
          sessionId={sessionId}
          onClose={() => setShowFieldReport(false)}
        />
      )}
      {showLandownerReport && permission && (
        <PermissionReportModal
          permissionId={permission.id}
          fieldId={landownerReportForField && fieldId ? fieldId : undefined}
          onClose={() => setShowLandownerReport(false)}
        />
      )}
      <TrackingOverlay 
        isVisible={showTrackingOverlay} 
        onClose={() => setShowTrackingOverlay(false)} 
        wakeLockSupported={isWakeLockSupported()} 
      />
    </div>
  );
}
