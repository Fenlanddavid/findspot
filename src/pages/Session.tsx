import React, { useEffect, useState, useMemo, useRef } from "react";
import { computeSessionOutcomeResult, SessionOutcomeResult } from "../utils/sessionOutcomeEngine";
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
import { startTracking, stopTracking, isTrackingActiveForSession, isTrackCurrentlyRecording, isWakeLockSupported } from "../services/tracking";
import { calculateCoverage, CoverageResult } from "../services/coverage";
import { Modal } from "../components/Modal";
import { FieldNotesModal } from "../components/FieldNotesModal";
import { ExportClubDayModal } from "../components/ClubDayModals";
import { TrackingOverlay } from "../components/TrackingOverlay";
import { useConfirmDialog } from "../components/ConfirmModal";
import { LandownerUpdateCard } from "../components/LandownerUpdateCard";
import { shareElementAsImage } from "../services/share";
import { CoachTip, CoachTips } from "../components/CoachTips";
import { getNotableFindScore } from "../components/ReportChrome";
import type { WorkflowState } from "../types/significantFind";
import { area as turfArea } from "@turf/turf";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const FIRST_SESSION_KEY = "fs_first_session";
const SESSION_HELPERS_SEEN_KEY = "fs_session_helpers_seen";

function SessionSummary({
  coverage,
  findsCount,
  pendingCount,
  durationMins,
  totalTime,
  permissionId,
  sharedPermissionId,
  isClubDayMember,
  outcomeResult,
  onClose,
  onFieldReport,
  onLandownerReport,
  onShareLandownerUpdate,
  isSharingLandowner,
  landownerShareError,
  onExportClubDay,
}: {
  coverage: number,
  findsCount: number,
  pendingCount: number,
  durationMins: number | null,
  totalTime: string | null,
  permissionId: string | null,
  sharedPermissionId: string | undefined,
  isClubDayMember: boolean,
  outcomeResult: SessionOutcomeResult | null,
  onClose: () => void,
  onFieldReport: () => void,
  onLandownerReport: (forField: boolean) => void,
  onShareLandownerUpdate: () => void,
  isSharingLandowner: boolean,
  landownerShareError: string | null,
  onExportClubDay: () => void,
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

  const outcomeColours = {
    emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-800', label: 'text-emerald-700 dark:text-emerald-300', sub: 'text-emerald-600 dark:text-emerald-400' },
    amber:   { bg: 'bg-amber-50 dark:bg-amber-950/30',   border: 'border-amber-200 dark:border-amber-800',   label: 'text-amber-700 dark:text-amber-300',   sub: 'text-amber-600 dark:text-amber-400' },
    gray:    { bg: 'bg-gray-50 dark:bg-gray-900/30',     border: 'border-gray-200 dark:border-gray-700',     label: 'text-gray-700 dark:text-gray-300',     sub: 'text-gray-500 dark:text-gray-400' },
  };

  return (
      <Modal title="Session Complete" onClose={onClose}>
          <div className="flex flex-col gap-5 py-2">
              {/* Phase 2 — Session Outcome card */}
              {outcomeResult && (
                <div className={`rounded-2xl border p-4 ${outcomeColours[outcomeResult.outcome.colour].bg} ${outcomeColours[outcomeResult.outcome.colour].border}`}>
                  <p className={`text-xs font-black uppercase tracking-widest opacity-50 mb-1`}>Session result</p>
                  <p className={`text-lg font-black leading-tight mb-1 ${outcomeColours[outcomeResult.outcome.colour].label}`}>{outcomeResult.outcome.label}</p>
                  <p className={`text-xs font-bold leading-snug ${outcomeColours[outcomeResult.outcome.colour].sub}`}>{outcomeResult.outcome.subtitle}</p>
                  {outcomeResult.spread && outcomeResult.spread !== null && (
                    <p className="text-2xs font-black uppercase tracking-widest opacity-60 mt-2">
                      Spread: {outcomeResult.spread === 'clustered' ? 'Finds clustered' : outcomeResult.spread === 'linear' ? 'Linear pattern' : 'Spread across field'}
                    </p>
                  )}
                </div>
              )}

              {/* Stats grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-gray-50 dark:bg-gray-900/50 p-3 rounded-xl border border-gray-100 dark:border-gray-800 text-center flex flex-col gap-1">
                      <span className="text-2xs font-black uppercase tracking-widest opacity-60">Finds</span>
                      <span className="text-sm font-black text-emerald-600">{findsCount}</span>
                  </div>
                  {totalTime && (
                    <div className="bg-gray-50 dark:bg-gray-900/50 p-3 rounded-xl border border-gray-100 dark:border-gray-800 text-center flex flex-col gap-1">
                        <span className="text-2xs font-black uppercase tracking-widest opacity-60">Duration</span>
                        <span className="text-sm font-black text-emerald-600">{totalTime}</span>
                    </div>
                  )}
                  {fourthStat && (
                    <div className="bg-gray-50 dark:bg-gray-900/50 p-3 rounded-xl border border-gray-100 dark:border-gray-800 text-center flex flex-col gap-1">
                        <span className="text-2xs font-black uppercase tracking-widest opacity-60">{fourthStat.label}</span>
                        <span className="text-sm font-black text-emerald-600">{fourthStat.value}</span>
                    </div>
                  )}
              </div>

              {/* Phase 3 — Next Move */}
              {outcomeResult?.nextMove && (
                <div className="border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 rounded-2xl p-4">
                  <p className="text-2xs font-black uppercase tracking-widest opacity-60 mb-1">Next move</p>
                  <p className="text-sm font-black text-gray-800 dark:text-gray-100 mb-1">{outcomeResult.nextMove.action}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">{outcomeResult.nextMove.reason}</p>
                </div>
              )}

              {permissionId && isClubDayMember && sharedPermissionId && (
                <div className="border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 flex flex-col gap-3">
                    <div>
                        <p className="text-2xs font-black uppercase tracking-widest opacity-60 mb-1">Club / Rally</p>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                            {pendingCount > 0
                                ? `You have ${pendingCount} pending ${pendingCount === 1 ? 'find' : 'finds'}. Finish those before sending your data to the organiser.`
                                : "Send your sessions and finds to the organiser."}
                        </p>
                    </div>
                    <button
                        onClick={onExportClubDay}
                        className="w-full bg-amber-500 hover:bg-amber-400 text-white font-black py-2 rounded-xl transition-all uppercase tracking-widest text-2xs"
                    >
                        Send to Organiser
                    </button>
                </div>
              )}
              {permissionId && !isClubDayMember && (
                <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex flex-col gap-3">
                    <p className="text-2xs font-black uppercase tracking-widest opacity-60">Landowner Report</p>
                    <button
                        onClick={onShareLandownerUpdate}
                        disabled={isSharingLandowner}
                        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-2.5 rounded-xl transition-all uppercase tracking-widest text-2xs flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {isSharingLandowner ? 'Preparing…' : 'Share with Landowner'}
                    </button>
                    {landownerShareError && (
                        <p className="text-xs font-semibold text-red-600 dark:text-red-400 leading-snug">
                            {landownerShareError}
                        </p>
                    )}
                    <button
                        onClick={() => onLandownerReport(false)}
                        className="w-full border border-emerald-600 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 font-black py-2.5 rounded-xl transition-all uppercase tracking-widest text-2xs"
                    >
                        Full Report (PDF)
                    </button>
                </div>
              )}

              {!isClubDayMember && (
                <button
                    onClick={onFieldReport}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-3 rounded-xl shadow-lg shadow-emerald-600/20 transition-all uppercase tracking-widest text-2xs flex items-center justify-center gap-2"
                >
                    Generate Field Report
                </button>
              )}
              <button
                  onClick={onClose}
                  className="w-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 font-black py-3 rounded-xl transition-all uppercase tracking-widest text-2xs"
              >
                  Close & Finish
              </button>
          </div>
      </Modal>
  );
}

const DEFAULT_CENTER: [number, number] = [-2.0, 54.5];
const DEFAULT_ZOOM = 13;

function formatDeleteCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const mins = Math.floor(ms / 60000);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  return `${mins}m`;
}

export default function SessionPage(props: {
  projectId: string;
  onSignificantFind?: (initialContext?: Partial<WorkflowState>) => void;
}) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const permissionId = searchParams.get("permissionId");
  const urlFieldId = searchParams.get("fieldId");
  const nav = useNavigate();
  const { confirm: confirmAction, dialog: confirmDialog } = useConfirmDialog();
  
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
  const [startTime, setStartTime] = useState<string | null>(null);
  const [isFinished, setIsFinished] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [isEditing, setIsEditing] = useState(!isEdit);
  
  const [openFindId, setOpenFindId] = useState<string | null>(null);
  
  const [isTracking, setIsTracking] = useState(isTrackingActiveForSession(sessionId));
  const [showTrackingOverlay, setShowTrackingOverlay] = useState(false);
  const [showCoverage, setShowCoverage] = useState(false);
  const [coverageResult, setCoverageResult] = useState<CoverageResult | null>(null);
  const [coverageError, setCoverageError] = useState(false);
  const [milestoneMsg, setMilestoneMsg] = useState<string | null>(null);
  const [hasStartedSessionBefore, setHasStartedSessionBefore] = useState(() => {
    try { return localStorage.getItem(FIRST_SESSION_KEY) === "1"; } catch { return false; }
  });
  const [sessionCoachActive, setSessionCoachActive] = useState(false);
  const [sessionCoachStep, setSessionCoachStep] = useState(0);
  const [showFieldNotes, setShowFieldNotes] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const [showTrimUI, setShowTrimUI] = useState(false);
  const [trimStartMins, setTrimStartMins] = useState(0);
  const [trimEndMins, setTrimEndMins] = useState(0);
  const [trimming, setTrimming] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [showExportClubDay, setShowExportClubDay] = useState(false);
  const [summaryData, setSummaryData] = useState<{ coverage: number, findsCount: number, durationMins: number | null, totalTime: string | null, outcomeResult: SessionOutcomeResult | null }>({ coverage: 0, findsCount: 0, durationMins: null, totalTime: null, outcomeResult: null });
  const [showFieldReport, setShowFieldReport] = useState(false);
  const [showLandownerReport, setShowLandownerReport] = useState(false);
  const [landownerReportForField, setLandownerReportForField] = useState(false);
  const [detectoristName, setDetectoristName] = useState("Detectorist");
  const [highlightPhotoUrl, setHighlightPhotoUrl] = useState<string | null>(null);
  const landownerCardRef = useRef<HTMLDivElement>(null);
  const [isSharingLandowner, setIsSharingLandowner] = useState(false);
  const [landownerShareError, setLandownerShareError] = useState<string | null>(null);
  const [keyNotes, setKeyNotes] = useState<string[]>([]);
  const isActiveSessionMode = isEdit && !isEditing && !isFinished;

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

  const session = useLiveQuery(async () => {
    if (!sessionId) return null;
    return db.sessions.get(sessionId);
  }, [sessionId]);

  const finds = useLiveQuery(async () => {
    if (!sessionId) return [];
    return db.finds.where("sessionId").equals(sessionId).filter(f => !f.scatterId && !f.isNotableFind).reverse().sortBy("createdAt");
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
    setIsTracking(isTrackingActiveForSession(sessionId));
  }, [sessionId, tracks]);

  useEffect(() => {
    if (!isActiveSessionMode) return;
    setNowTick(Date.now());
    const timer = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [isActiveSessionMode]);

  useEffect(() => {
    const boundary = selectedField?.boundary || permission?.boundary;
    if (!showCoverage || !boundary) {
        setCoverageResult(null);
        setCoverageError(false);
        return;
    }
    const result = calculateCoverage(boundary, tracks || []);
    setCoverageResult(result);
    setCoverageError(result === null);
  }, [showCoverage, selectedField, permission, tracks]);

  // Load the landowner-facing detectorist name for the update card.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getSetting<string>("detectorist", ""),
      getSetting<string>("recorderName", ""),
    ]).then(([detectorist, recorderName]) => {
      if (cancelled) return;
      setDetectoristName(
        detectorist?.trim() ||
        permission?.collector?.trim() ||
        recorderName?.trim() ||
        "Detectorist"
      );
    });
    return () => { cancelled = true; };
  }, [permission?.collector]);

  // Resolve highlight photo: pick top-scored find's first media blob
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setHighlightPhotoUrl(null);

    async function resolvePhoto() {
      const completed = (finds ?? []).filter(f => !f.isPending);
      const top = [...completed].sort((a, b) => getNotableFindScore(b) - getNotableFindScore(a))[0];
      if (!top) return;

      const media = await db.media
        .where("findId")
        .equals(top.id)
        .filter(m => m.type === "photo" && !!m.blob)
        .first();
      if (cancelled) return;
      if (!media?.blob) return;
      objectUrl = URL.createObjectURL(media.blob);
      setHighlightPhotoUrl(objectUrl);
    }

    resolvePhoto();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [finds]);

  async function handleShareLandownerUpdate() {
    if (!landownerCardRef.current || isSharingLandowner) return;
    setIsSharingLandowner(true);
    setLandownerShareError(null);
    try {
      await shareElementAsImage(
        landownerCardRef.current,
        `findspot-update-${session?.date?.slice(0, 10) ?? date.slice(0, 10)}`,
        "Session Update",
        `${(finds ?? []).filter(f => !f.isPending).length} finds recorded at ${permission?.name ?? "your land"} — recorded using FindSpot.`,
        { scale: 2, width: 540, height: 720, backgroundColor: "#f8f6f0" },
      );
    } catch (err) {
      console.error("Landowner share failed", err);
      setLandownerShareError("Could not create the quick update image. Try the full report instead.");
    } finally {
      setIsSharingLandowner(false);
    }
  }

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

  const activeDistanceKm = useMemo(() => {
    if (!tracks || tracks.length === 0) return null;
    let total = 0;
    for (const track of tracks) {
      if (!track.points || track.points.length < 2) continue;
      const sorted = [...track.points].sort((a, b) => a.timestamp - b.timestamp);
      for (let i = 1; i < sorted.length; i++) {
        total += haversineKm(sorted[i - 1].lat, sorted[i - 1].lon, sorted[i].lat, sorted[i].lon);
      }
    }
    return total > 0 ? total : null;
  }, [tracks]);

  const activeCoverage = useMemo(() => {
    const boundary = selectedField?.boundary || permission?.boundary;
    if (!boundary || !tracks || tracks.length === 0) return null;
    return calculateCoverage(boundary, tracks);
  }, [selectedField, permission, tracks]);

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
    const boundary = selectedField?.boundary || permission?.boundary;
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
            layout: { "visibility": "none" },
            paint: {
              "fill-color": "#ea580c",
              "fill-opacity": 0.68,
              "fill-outline-color": "#ea580c"
            }
        });

        map.addLayer({
            id: "undetected-outline",
            type: "line",
            source: "coverage",
            layout: { "visibility": "none" },
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
      const boundary = selectedField?.boundary || permission?.boundary;
      if (boundarySource && boundary) {
          boundarySource.setData(boundary);
      }

      // Fit bounds
      const allPoints = (tracksData || []).flatMap(t => t.points || []).filter(p => !!p && typeof p.lat === 'number');
      const bounds = new maplibregl.LngLatBounds();
      
      let hasDataForBounds = false;
      if (boundary && boundary.coordinates?.[0] && Array.isArray(boundary.coordinates[0])) {
          boundary.coordinates[0].forEach((p) => {
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
    if (!map) return;

    const syncCoverage = () => {
      const src = map.getSource("coverage") as maplibregl.GeoJSONSource | undefined;
      if (!src) return;

        if (showCoverage && coverageResult) {
            src.setData(coverageResult.undetectionsGeoJSON);
        } else {
            src.setData({ type: "FeatureCollection", features: [] });
        }

      if (map.getLayer("undetected-fill")) {
        map.setLayoutProperty("undetected-fill", "visibility", showCoverage ? "visible" : "none");
        if (showCoverage) map.moveLayer("undetected-fill");
      }
      if (map.getLayer("undetected-outline")) {
        map.setLayoutProperty("undetected-outline", "visibility", showCoverage ? "visible" : "none");
        if (showCoverage) map.moveLayer("undetected-outline");
      }
      if (map.getLayer("tracks-line")) {
        map.setPaintProperty("tracks-line", "line-opacity", showCoverage ? 0.35 : 0.8);
      }
      if (map.getLayer("boundary-outline") && showCoverage) {
        map.moveLayer("boundary-outline");
      }
    };

    if (map.getSource("coverage")) {
      syncCoverage();
      return;
    }

    map.once("idle", syncCoverage);
    return () => {
      map.off("idle", syncCoverage);
    };
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
        setStartTime(s.startTime ?? null);
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

  function goSessionFind(mode: "quick" | "full") {
    if (!permission?.id) return;
    const params = new URLSearchParams();
    params.set("permissionId", permission.id);
    params.set("sessionId", sessionId);
    params.set("mode", mode);
    if (fieldId) params.set("fieldId", fieldId);
    nav(`/find?${params.toString()}`);
  }

  async function quickSetStubble(val: boolean) {
    setIsStubble(val);
    await db.sessions.update(sessionId, { isStubble: val, updatedAt: new Date().toISOString() });
  }

  async function quickSetLandUse(val: string) {
    setLandUse(val);
    await db.sessions.update(sessionId, { landUse: val, updatedAt: new Date().toISOString() });
  }

  async function doGPS() {
    setError(null);
    try {
      const fix = await captureGPS();
      setLat(fix.lat);
      setLon(fix.lon);
      setAcc(fix.accuracyM);
      if (isEdit && !isEditing) {
        await db.sessions.update(sessionId, {
          lat: fix.lat,
          lon: fix.lon,
          gpsAccuracyM: fix.accuracyM,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (e: any) {
      setError(e?.message ?? "GPS failed");
    }
  }

  async function handleDelete() {
    if (!isEdit) return;
    const sessionFinds = await db.finds.where("sessionId").equals(sessionId).toArray();
    const findIds = sessionFinds.map(f => f.id);
    const significantFinds = await db.significantFinds.where("sessionId").equals(sessionId).toArray();
    const significantFindIds = significantFinds.map(f => f.id);
    const findMediaCount = findIds.length ? await db.media.where("findId").anyOf(findIds).count() : 0;
    const significantFindMediaCount = significantFindIds.length ? await db.media.where("findId").anyOf(significantFindIds).count() : 0;
    const mediaCount = findMediaCount + significantFindMediaCount;
    const trackCount = await db.tracks.where("sessionId").equals(sessionId).count();

    if (!(await confirmAction({
      title: "Delete Session?",
      message: `Delete this session?\n\nThis will permanently delete:\n` +
      `- ${formatDeleteCount(sessionFinds.length, "find")}\n` +
      `- ${formatDeleteCount(significantFinds.length, "significant find")}\n` +
      `- ${formatDeleteCount(mediaCount, "photo/document", "photos/documents")}\n` +
      `- ${formatDeleteCount(trackCount, "GPS track")}`,
      confirmLabel: "Delete",
      danger: true,
    }))) return;
    
    setSaving(true);
    try {
      await db.transaction("rw", [db.sessions, db.finds, db.significantFinds, db.media, db.tracks], async () => {
        // Delete all media for those finds
        if (findIds.length > 0) {
          await db.media.where("findId").anyOf(findIds).delete();
        }
        if (significantFindIds.length > 0) {
          await db.media.where("findId").anyOf(significantFindIds).delete();
        }
        
        // Delete the finds
        await db.finds.where("sessionId").equals(sessionId).delete();
        await db.significantFinds.where("sessionId").equals(sessionId).delete();
        
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

      const newSessionRecord: Session = {
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
        await db.sessions.add(newSessionRecord);
        setIsEditing(false);
        let isFirstSession = !hasStartedSessionBefore;
        try {
          isFirstSession = !localStorage.getItem(FIRST_SESSION_KEY);
          if (isFirstSession) localStorage.setItem(FIRST_SESSION_KEY, "1");
        } catch {}
        if (isFirstSession) {
          setHasStartedSessionBefore(true);
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
    if (isTrackingActiveForSession(sessionId)) {
        await stopTracking();
        setIsTracking(false);
        setShowTrackingOverlay(false);
    } else {
        try {
            await startTracking(props.projectId, sessionId, permission?.name ? `Hunt @ ${permission.name}` : "New Hunt");
            setIsTracking(true);
            setShowTrackingOverlay(true);

            // Record start time if not already set
            const s = await db.sessions.get(sessionId);
            if (s && !s.startTime) {
                const startedAt = new Date().toISOString();
                await db.sessions.update(sessionId, { startTime: startedAt });
                setStartTime(startedAt);
            } else if (s?.startTime) {
                setStartTime(s.startTime);
            }
        } catch (e: any) {
            setError(e?.message ?? "Could not start tracking — check location permissions");
        }
    }
  }

  async function finishSession() {
    if (isTrackingActiveForSession(sessionId)) {
        await stopTracking();
        setIsTracking(false);
    }
    
    const now = new Date();
    const endTimeIso = now.toISOString();

    // Calculate final stats for summary
    const boundary = selectedField?.boundary || permission?.boundary;
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

    // Phase 2+3 — compute outcome + next move
    const sessionFinds = await db.finds.where("sessionId").equals(sessionId).toArray();
    const findPoints = sessionFinds
        .filter(f => f.lat !== null && f.lon !== null)
        .map(f => ({ lat: f.lat!, lon: f.lon! }));

    let prevSessionSummaries: { findsCount: number }[] = [];
    const currentSession = await db.sessions.get(sessionId);
    const resolvedPermId = currentSession?.permissionId;
    if (resolvedPermId) {
        const prevSessions = await db.sessions
            .where("permissionId").equals(resolvedPermId)
            .filter(s => s.id !== sessionId && !!s.isFinished)
            .toArray();
        prevSessionSummaries = await Promise.all(
            prevSessions.map(async ps => ({
                findsCount: await db.finds.where("sessionId").equals(ps.id).count(),
            }))
        );
    }

    const outcomeResult = computeSessionOutcomeResult(count, finalCoverage, durationMins, findPoints, prevSessionSummaries);

    setSummaryData({
        coverage: finalCoverage,
        findsCount: count,
        durationMins,
        totalTime: durationStr,
        outcomeResult,
    });
    setLandownerShareError(null);
    
    if (sessionId) {
        try {
            await db.sessions.update(sessionId, {
                isFinished: true,
                endTime: endTimeIso
            });
        } catch (e: any) {
            setError("Could not finish session: " + (e?.message ?? "Unknown error"));
            setIsTracking(isTrackingActiveForSession(sessionId));
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

  const sessionDateMs = new Date(date).getTime();
  const trackingStartMs = startTime ? new Date(startTime).getTime() : NaN;
  const activeStartedAt = Number.isFinite(trackingStartMs)
    ? trackingStartMs
    : Number.isFinite(sessionDateMs)
      ? sessionDateMs
      : nowTick;
  const activeDurationText = formatElapsed(nowTick - activeStartedAt);
  const activeFindCount = finds?.filter(f => !f.isPending).length ?? 0;
  const activeHudFindCount = finds?.length ?? 0;
  const activePendingCount = finds?.filter(f => f.isPending).length ?? 0;
  const activeCoveragePercent = activeCoverage?.percentCovered ?? null;
  const activeDistanceText = activeDistanceKm !== null
    ? (activeDistanceKm < 1 ? `${Math.round(activeDistanceKm * 1000)}m` : `${activeDistanceKm.toFixed(1)}km`)
    : null;
  const activeAcres = selectedField?.boundary
    ? turfArea(selectedField.boundary) / 4046.86
    : permission?.boundary
      ? turfArea(permission.boundary) / 4046.86
      : null;
  const fullscreenQuickFindSession = permission
    ? { id: sessionId, projectId: props.projectId, permissionId: permission.id, fieldId }
    : null;
  const getLatestTrackLocation = React.useCallback(() => {
    const latest = (tracks || [])
      .flatMap(track => track.points || [])
      .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon))
      .sort((a, b) => a.timestamp - b.timestamp)
      .at(-1);
    if (!latest) return null;
    return {
      lat: latest.lat,
      lon: latest.lon,
      gpsAccuracyM: latest.accuracy ?? null,
    };
  }, [tracks]);

  if (loading) return <div className="p-10 text-center opacity-50 font-medium">Loading session...</div>;

  const sessionCoachEnabled = !hasStartedSessionBefore && !isEdit && isEditing;
  const sessionCoachTips: CoachTip[] = [
    {
      title: "Session basics",
      body: "The date is already set. Pick a field if you know it, or leave it as the whole permission.",
      accent: "text-emerald-300",
      border: "border-emerald-400/35",
      position: "bottom-[calc(5.75rem+env(safe-area-inset-bottom))] left-4 right-4 sm:top-[136px] sm:bottom-auto sm:left-1/2 sm:right-auto sm:w-[330px] sm:-translate-x-1/2",
    },
    {
      title: "Location and ground",
      body: "GPS and ground condition help later reports, but they are optional when starting quickly.",
      accent: "text-blue-300",
      border: "border-blue-400/35",
      position: "bottom-[calc(5.75rem+env(safe-area-inset-bottom))] left-4 right-4 sm:top-[43%] sm:bottom-auto sm:left-6 sm:right-auto sm:max-w-[320px]",
    },
    {
      title: "Start detecting",
      body: "Start the session first. Mapping and find recording are available once it is saved.",
      accent: "text-amber-300",
      border: "border-amber-400/35",
      position: "bottom-[calc(5.75rem+env(safe-area-inset-bottom))] left-4 right-4 sm:bottom-[92px] sm:left-1/2 sm:right-auto sm:w-[330px] sm:-translate-x-1/2",
    },
  ];

  return (
    <div className="max-w-4xl mx-auto pb-20 px-4">
      <CoachTips
        storageKey={SESSION_HELPERS_SEEN_KEY}
        tips={sessionCoachTips}
        enabled={sessionCoachEnabled}
        forceShow={searchParams.get("tips") === "1"}
        mobileInline
        onDismiss={() => {
          setSessionCoachActive(false);
          setSessionCoachStep(0);
        }}
        onStepChange={(index) => {
          setSessionCoachActive(true);
          setSessionCoachStep(index);
        }}
      />
      {milestoneMsg && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-bold pointer-events-none whitespace-nowrap">
          {milestoneMsg}
        </div>
      )}
      <div className="grid gap-8 mt-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex flex-wrap gap-3 items-center">
                {isActiveSessionMode ? (
                  <div>
                    <h2 className="m-0 text-sm font-black uppercase tracking-widest text-gray-800 dark:text-gray-100">Session Details</h2>
                    <p className="mt-1 text-base font-bold text-gray-500 dark:text-gray-400">
                      {new Date(date + ':00Z').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                  </div>
                ) : (
                  <>
                    <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100">
                        {isEdit ? "Session Details" : "New Session"}
                    </h2>
                    {isEdit && !isEditing && (
                        <button
                            onClick={() => setIsEditing(true)}
                            className="text-xs font-bold text-emerald-600 hover:text-white hover:bg-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800 transition-all"
                        >
                            Edit Details
                        </button>
                    )}
                  </>
                )}
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
                {!isActiveSessionMode && isEdit && (
                    <button
                        onClick={handleDelete}
                        disabled={saving}
                        className="text-xs sm:text-sm font-bold text-red-600 hover:text-white hover:bg-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-1 rounded-lg border border-red-200 dark:border-red-800 transition-all disabled:opacity-50 flex-1 sm:flex-none"
                    >
                        Delete
                    </button>
                )}
                {isActiveSessionMode ? (
                  <button onClick={() => nav(permission ? `/permission/${permission.id}` : "/")} className="text-xs font-medium text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors">
                    ← Back
                  </button>
                ) : (
                  <button onClick={() => nav(permission ? `/permission/${permission.id}` : "/")} className="text-xs sm:text-sm font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 bg-gray-50 dark:bg-gray-800 px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-700 transition-colors flex-1 sm:flex-none">Back</button>
                )}
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
                    {isActiveSessionMode ? (
                      <>
                        <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-md shadow-emerald-900/5 dark:border-emerald-900/70 dark:bg-gray-900">
                          <div className="grid grid-cols-[5px_1fr]">
                            <div className={`${isTracking ? "bg-red-500" : "bg-emerald-500"}`} />
                            <div className="p-4 sm:p-5">
                              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0 flex-1">
                                  <div className="mb-3 flex flex-wrap items-center gap-2">
                                    <span className={`h-2.5 w-2.5 rounded-full ${isTracking ? "animate-pulse bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.12)]" : "bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]"}`} />
                                    <span className={`rounded-full px-2.5 py-1 text-2xs font-black uppercase tracking-widest ${isTracking ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"}`}>
                                      {isTracking ? "Mapping live" : selectedField ? "Field mode" : "Active session"}
                                    </span>
                                    <span className="text-2xs font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">Started {new Date(date + ':00Z').toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                  </div>
                                  <h3 className="m-0 truncate text-3xl font-black leading-none tracking-tight text-gray-950 dark:text-gray-50">
                                    {selectedField?.name || permission?.name || "Active Session"}
                                  </h3>
                                  {selectedField && (
                                    <p className="mt-2 truncate text-sm font-bold text-gray-500 dark:text-gray-400">{permission?.name}</p>
                                  )}

                                  <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                                    <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/40">
                                      <div className="text-base font-black leading-none text-gray-900 dark:text-gray-100">{activeDurationText}</div>
                                      <div className="mt-1 text-2xs font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">Live time</div>
                                    </div>
                                    <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/40">
                                      <div className="text-base font-black leading-none text-gray-900 dark:text-gray-100">{activeFindCount}</div>
                                      <div className="mt-1 text-2xs font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">{activeFindCount === 1 ? "Find" : "Finds"}</div>
                                    </div>
                                    <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/40">
                                      <div className="truncate text-base font-black leading-none text-gray-900 dark:text-gray-100">{activeDistanceText ?? "--"}</div>
                                      <div className="mt-1 text-2xs font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">Walked</div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={lat == null ? doGPS : undefined}
                                      className={`rounded-xl border px-3 py-2 text-left transition-colors ${lat != null && lon != null ? "border-emerald-100 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/25" : "border-gray-100 bg-gray-50 hover:border-emerald-200 hover:bg-emerald-50 dark:border-gray-800 dark:bg-gray-950/40 dark:hover:border-emerald-900"}`}
                                    >
                                      <div className={`truncate text-base font-black leading-none ${lat != null && lon != null ? "text-emerald-700 dark:text-emerald-300" : "text-gray-500 dark:text-gray-400"}`}>{lat != null && lon != null ? (acc ? `+/-${Math.round(acc)}m` : "Saved") : "Tap to set"}</div>
                                      <div className="mt-1 text-2xs font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">GPS</div>
                                    </button>
                                  </div>

                                  {activePendingCount > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => nav("/pending")}
                                      className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-2xs font-black uppercase tracking-widest text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                                    >
                                      {activePendingCount} pending find{activePendingCount === 1 ? "" : "s"} to finish
                                    </button>
                                  )}
                                </div>
                                <div className="grid w-full grid-cols-2 gap-2 sm:w-44 sm:grid-cols-1">
                                  <button
                                    type="button"
                                    onClick={toggleTracking}
                                    className={`rounded-xl px-4 py-3 text-sm font-black transition-all active:scale-[0.98] ${isTracking ? "bg-red-600 text-white shadow-md shadow-red-600/20" : "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-950/50"}`}
                                  >
                                    {isTracking ? "Stop Mapping" : "Map Session"}
                                  </button>
                                  {isTracking && (
                                    <button
                                      type="button"
                                      onClick={() => setShowTrackingOverlay(true)}
                                      className="rounded-xl border border-gray-800 bg-gray-950 px-4 py-3 text-2xs font-black uppercase tracking-widest text-white transition-all active:scale-[0.98]"
                                    >
                                      Fullscreen
                                    </button>
                                  )}
                                </div>
                              </div>
                              {isTracking && (
                                <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-2xs font-bold text-amber-700 dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-300">
                                  Keep screen awake while mapping. Locking the phone can stop GPS recording.
                                </p>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
	                            onClick={() => goSessionFind("quick")}
                            aria-label="Add Find to Session"
                            className="flex min-h-[5.5rem] w-full items-center justify-center rounded-2xl bg-emerald-600 px-4 py-4 text-center text-white shadow-lg shadow-emerald-600/20 transition-all hover:bg-emerald-500 active:scale-[0.99] focus:outline-none focus:ring-4 focus:ring-emerald-500/20"
                          >
                            <span className="text-xl font-black">Add Find</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => props.onSignificantFind?.({
                              permissionId: permission?.id ?? permissionId,
                              sessionId,
                              lat,
                              lon,
                              gpsAccuracyM: acc,
                            })}
                            className="w-full rounded-2xl border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-black uppercase tracking-widest text-red-700 shadow-sm transition-all hover:border-red-300 hover:bg-red-100 active:scale-[0.99] dark:border-red-900/60 dark:bg-red-950/25 dark:text-red-300 dark:hover:border-red-700"
                          >
                            Significant Find
                          </button>
                          <button
                            type="button"
                            onClick={finishSession}
                            className="w-full rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-sm font-black uppercase tracking-widest text-amber-800 shadow-sm transition-all hover:border-amber-400 hover:bg-amber-100 active:scale-[0.99] dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:border-amber-600 dark:hover:bg-amber-950/50"
                          >
                            Finish Session
                          </button>
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <h4 className="text-2xs font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">Session Data</h4>
                              {selectedField && (
                                <button
                                  type="button"
                                  onClick={() => setShowFieldNotes(true)}
                                  className={`text-2xs font-bold underline-offset-2 hover:underline transition-colors ${selectedField.notes ? "text-amber-700 dark:text-amber-300" : "text-gray-500 dark:text-gray-400 hover:text-amber-700 dark:hover:text-amber-300"}`}
                                >
                                  Notes
                                </button>
                              )}
                            </div>
                            <div className="divide-y divide-gray-100 text-xs dark:divide-gray-800">
                              {selectedField && (
                                <div className="flex items-center justify-between gap-3 py-2 first:pt-0">
                                  <span className="font-bold text-gray-400">Field</span>
                                  <span className="truncate font-black text-gray-800 dark:text-gray-100">{selectedField.name}</span>
                                </div>
                              )}
                              {activeAcres !== null && (
                                <div className="flex items-center justify-between gap-3 py-2 first:pt-0">
                                  <span className="font-bold text-gray-400">Area</span>
                                  <span className="font-black text-gray-800 dark:text-gray-100">{activeAcres.toFixed(1)} acres</span>
                                </div>
                              )}
                              <div className="flex items-center justify-between gap-3 py-2 first:pt-0">
                                <span className="font-bold text-gray-400">Rate</span>
                                <span className="font-black text-gray-800 dark:text-gray-100">
                                  {activeFindCount > 0 && (nowTick - activeStartedAt) > 60000
                                    ? `${(activeFindCount / ((nowTick - activeStartedAt) / 3600000)).toFixed(1)}/hr`
                                    : "--"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-3 py-2 last:pb-0">
                                <span className="font-bold text-gray-400">GPS</span>
                                {lat != null && lon != null ? (
                                  <span className="truncate font-mono text-2xs font-bold text-emerald-600">{lat.toFixed(5)}, {lon.toFixed(5)}</span>
                                ) : (
                                  <button type="button" onClick={doGPS} className="text-2xs font-black uppercase tracking-widest text-emerald-600 hover:underline">Get GPS</button>
                                )}
                              </div>
                            </div>
                            <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-800">
                              <div className="mb-2 text-2xs font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">Ground</div>
                              <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                onClick={() => quickSetStubble(!isStubble)}
                                className={`rounded-lg border px-2 py-1 text-2xs font-bold transition-all ${isStubble ? "border-amber-300 bg-amber-100 text-amber-800" : "border-gray-200 bg-white text-gray-500 hover:border-amber-300 hover:text-amber-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-amber-700"}`}
                              >
                                Stubble
                              </button>
                              <button
                                type="button"
                                onClick={() => quickSetLandUse(landUse === "Ploughed" ? "" : "Ploughed")}
                                className={`rounded-lg border px-2 py-1 text-2xs font-bold transition-all ${landUse === "Ploughed" ? "border-orange-300 bg-orange-100 text-orange-800" : "border-gray-200 bg-white text-gray-500 hover:border-orange-300 hover:text-orange-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-orange-700"}`}
                              >
                                Ploughed
                              </button>
                              <button
                                type="button"
                                onClick={() => quickSetLandUse(landUse === "Pasture" ? "" : "Pasture")}
                                className={`rounded-lg border px-2 py-1 text-2xs font-bold transition-all ${landUse === "Pasture" ? "border-emerald-300 bg-emerald-100 text-emerald-800" : "border-gray-200 bg-white text-gray-500 hover:border-emerald-300 hover:text-emerald-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-emerald-700"}`}
                              >
                                Pasture
                              </button>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
                            <h4 className="mb-3 text-2xs font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">Mapping</h4>
                            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-center dark:border-gray-800 dark:bg-gray-950/50">
                              <div className="text-lg font-black text-gray-900 dark:text-gray-100">{activeCoveragePercent !== null ? `${Math.round(activeCoveragePercent)}%` : "--"}</div>
                              <div className="text-2xs font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">Area covered</div>
                            </div>
                            {(selectedField?.boundary || permission?.boundary) && (
                              <button
                                type="button"
                                onClick={() => setShowCoverage(!showCoverage)}
                                className={`mt-3 w-full rounded-lg border px-3 py-2 text-2xs font-black uppercase tracking-widest transition-all ${showCoverage ? "border-orange-600 bg-orange-600 text-white" : "border-orange-200 bg-white text-orange-700 hover:border-orange-400 dark:border-orange-900 dark:bg-gray-950/50 dark:text-orange-400"}`}
                              >
                                {showCoverage ? (activeCoverage && activeCoverage.percentUndetected <= 1 ? "No Gaps" : "Gaps On") : "Show Gaps"}
                              </button>
                            )}
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex flex-col sm:flex-row justify-between items-start gap-6">
                          <div className="min-w-0 flex-1">
                            <p className="text-emerald-600 font-black text-xs uppercase tracking-widest mb-1 truncate">{permission?.name || "Unknown Location"}</p>
                            <div className="flex flex-wrap items-center gap-3">
                              <h3 className="text-xl sm:text-2xl font-black text-gray-800 dark:text-gray-100 break-words">{new Date(date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</h3>
                              {isFinished && (
                                <span className="bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-2xs font-black px-2 py-0.5 rounded uppercase tracking-widest border border-gray-200 dark:border-gray-600 whitespace-nowrap">Finished</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="bg-gray-100 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col items-stretch justify-center gap-2 group">
                            <div className="text-center opacity-70">
                              <span className="text-2xs font-black uppercase tracking-widest">Session Closed</span>
                                </div>
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <button
                                        onClick={() => setShowFieldReport(true)}
                                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-2xs font-black uppercase tracking-widest transition-all"
                                    >
                                        Field Report
                                    </button>
                                    {permission && (
                                        <button
                                            onClick={() => { setLandownerReportForField(false); setShowLandownerReport(true); }}
                                            className="flex-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 px-3 py-2 rounded-lg text-2xs font-black uppercase tracking-widest transition-all hover:border-emerald-400"
                                        >
                                            Landowner
                                        </button>
                                    )}
                                </div>
                                <button
                                    onClick={async () => {
                                        if (sessionId && await confirmAction({
                                            title: "Re-open Session?",
                                            message: "This will move the session back into your active session queue.",
                                            confirmLabel: "Re-open",
                                        })) {
                                            await db.sessions.update(sessionId, { isFinished: false });
                                            setIsFinished(false);
                                        }
                                    }}
                                    className="mt-2 text-2xs font-black uppercase tracking-widest text-emerald-600 hover:underline"
                                >
                                    Re-open Session
                                </button>
                            </div>
                          <div className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
                            <div className="flex items-center justify-between gap-3 mb-2">
                              <h4 className="text-2xs font-black uppercase tracking-widest opacity-60">Session Data</h4>
                              {selectedField && (
                                <button
                                  type="button"
                                  onClick={() => setShowFieldNotes(true)}
                                  className={`text-2xs font-bold underline-offset-2 hover:underline transition-colors ${selectedField.notes ? "text-amber-700 dark:text-amber-300" : "text-gray-500 dark:text-gray-400 hover:text-amber-700 dark:hover:text-amber-300"}`}
                                >
                                  Notes
                                </button>
                              )}
                            </div>
                            <div className="flex flex-col gap-2">
                              {selectedField && (
                                <p className="text-2xs font-bold text-gray-500 dark:text-gray-400 truncate">
                                  Field: <span className="text-gray-700 dark:text-gray-200">{selectedField.name}</span>
                                </p>
                              )}
                              <div className="flex flex-wrap gap-1 min-h-[1.25rem]">
                                {isStubble && <span className="bg-amber-100 text-amber-800 text-3xs font-bold px-1.5 py-0.5 rounded">Stubble</span>}
                                {landUse && <span className="bg-orange-100 text-orange-800 text-3xs font-bold px-1.5 py-0.5 rounded">{landUse}</span>}
                                {!isStubble && !landUse && <span className="text-2xs text-gray-500 dark:text-gray-400 font-bold">No ground condition set</span>}
                              </div>
                              {lat != null && lon != null ? (
                                <p className="font-mono font-bold text-2xs text-emerald-600 truncate">{lat.toFixed(6)}, {lon.toFixed(6)}</p>
                              ) : (
                                <button onClick={doGPS} className="text-2xs font-bold text-emerald-600 hover:underline">Get GPS</button>
                              )}
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {notes && (
                        <div className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
                            <h4 className="text-2xs font-black uppercase tracking-widest opacity-60 mb-1">Notes</h4>
                            <p className="text-sm opacity-80 whitespace-pre-wrap">{notes}</p>
                        </div>
                    )}
                  </div>
                )}

                {isEditing && (
                  <>
                    <label className={`block rounded-2xl ${sessionCoachActive && sessionCoachStep === 0 ? "ring-4 ring-emerald-400/25" : ""}`}>
                        <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Date & Time</div>
                        <input 
                            type="datetime-local" 
                            value={date} 
                            onChange={(e) => setDate(e.target.value)} 
                            className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
                        />
                    </label>

                    <label className={`block rounded-2xl ${sessionCoachActive && sessionCoachStep === 0 ? "ring-4 ring-emerald-400/25" : ""}`}>
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

                    <div className={`bg-emerald-50/50 dark:bg-emerald-900/20 p-5 rounded-2xl border-2 border-emerald-100/50 dark:border-emerald-800/30 flex flex-col sm:flex-row gap-4 items-center justify-between ${sessionCoachActive && sessionCoachStep === 1 ? "ring-4 ring-blue-400/25" : ""}`}>
                        <div className="flex flex-col gap-1">
                            <div className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">GPS Location</div>
                            <div className="text-lg font-mono font-bold text-gray-800 dark:text-gray-100">
                                {lat != null && lon != null ? (
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
                            {lat != null ? "Update GPS" : "Get Current GPS"}
                        </button>
                    </div>

                    <div className={`flex flex-wrap gap-4 items-center bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800 ${sessionCoachActive && sessionCoachStep === 1 ? "ring-4 ring-blue-400/25" : ""}`}>
                        <div className="flex flex-col gap-2">
                            <div className="text-xs font-black uppercase tracking-widest opacity-50">Ground Condition</div>
                            <div className="flex flex-wrap gap-2">
                                <button 
                                    type="button"
                                    onClick={() => setIsStubble(!isStubble)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${isStubble ? 'bg-amber-100 border-amber-300 text-amber-800' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500'}`}
                                >
                                    Stubble
                                </button>
                                <button 
                                    type="button"
                                    onClick={() => setLandUse(landUse === 'Ploughed' ? '' : 'Ploughed')}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${landUse === 'Ploughed' ? 'bg-orange-100 border-orange-300 text-orange-800' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500'}`}
                                >
                                    Ploughed
                                </button>
                                <button 
                                    type="button"
                                    onClick={() => setLandUse(landUse === 'Pasture' ? '' : 'Pasture')}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${landUse === 'Pasture' ? 'bg-emerald-100 border-emerald-300 text-emerald-800' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500'}`}
                                >
                                    Pasture
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
                                            <span>{isTracking ? 'Stop Mapping' : 'Map Session'}</span>
                                        </button>
                                        {isTracking && (
                                            <button 
                                                type="button"
                                                onClick={() => setShowTrackingOverlay(true)}
                                                className="bg-black text-white px-3 py-1.5 rounded-lg font-bold shadow-sm transition-all transform active:scale-95 text-xs border border-gray-700"
                                                title="Fullscreen Tracking Mode"
                                            >
                                                <span>Fullscreen</span>
                                            </button>
                                        )}
                                    </>
                                ) : (
                                    <span className="text-2xs opacity-60 italic">Start session to enable mapping</span>
                                )}
                            </div>
                        </div>
                    </div>
                    <label className="block">
                        <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Session Notes</div>
                        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium" />
                    </label>

                    <div className="flex gap-4">
                        <button onClick={save} disabled={saving} className={`mt-4 flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-4 rounded-2xl font-black text-xl shadow-xl transition-all disabled:opacity-50 ${sessionCoachActive && sessionCoachStep === 2 ? "ring-4 ring-amber-300/40" : ""}`}>
                            {saving ? "Saving..." : isEdit ? "Save Details" : "Start Session"}
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
                                        className={`flex items-center gap-2 px-3 py-1 rounded-lg font-bold shadow-sm transition-all transform active:scale-95 text-2xs border ${showCoverage ? 'bg-orange-600 border-orange-600 text-white' : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-orange-700 dark:text-orange-400'}`}
                                    >
                                        <span>{showCoverage ? (activeCoverage && activeCoverage.percentUndetected <= 1 ? 'No Gaps' : 'Gaps On') : 'Show Gaps'}</span>
                                        {showCoverage && coverageResult && (
                                            <span className="bg-white/20 px-1 rounded text-3xs">
                                                {Math.round(100 - coverageResult.percentCovered)}%
                                            </span>
                                        )}
                                        {showCoverage && coverageError && (
                                            <span className="text-3xs">Failed</span>
                                        )}
                                    </button>
                                )}
                                {isFinished && tracks && tracks.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setShowTrimUI(!showTrimUI)}
                                        className={`px-3 py-1 rounded-lg font-bold text-2xs border transition-all ${showTrimUI ? 'bg-gray-800 border-gray-700 text-gray-300' : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-400'}`}
                                    >
                                        Trim
                                    </button>
                                )}
                                {tracks && tracks.map(t => (
                                    <div key={t.id} className="flex items-center gap-2 bg-white dark:bg-gray-900 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-2xs font-bold">
                                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
                                        <span>{t.points.length} pts</span>
                                        {isTrackCurrentlyRecording(t.id) && <span className="ml-1 text-3xs bg-red-600 text-white px-1 rounded animate-pulse">LIVE</span>}
                                    </div>
                                ))}
                            </div>
                        </div>
                        
                        {/* Map Preview */}
                        <div className="relative h-64 w-full rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-inner bg-gray-100 dark:bg-gray-900">
                            <div ref={mapDivRef} className="absolute inset-0" />
                            {isTracking && (
                                <div className="absolute top-2 left-2 z-10 bg-red-600 text-white text-3xs font-black px-2 py-1 rounded-full animate-pulse shadow-lg">
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
                                  <div className="flex items-center justify-between text-2xs text-gray-500 dark:text-gray-400 font-mono">
                                    <span>Track: {totalMins}m total</span>
                                    <span className={remainMins < 5 ? 'text-red-500 font-bold' : 'text-emerald-500 font-bold'}>→ {remainMins}m after trim</span>
                                  </div>
                                  <div className="grid gap-3">
                                    {[{ label: 'Remove from start', value: trimStartMins, set: setTrimStartMins }, { label: 'Remove from end', value: trimEndMins, set: setTrimEndMins }].map(({ label, value, set }) => (
                                      <div key={label}>
                                        <p className="text-2xs font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1.5">{label} {value > 0 && <span className="text-amber-500">— {value}m</span>}</p>
                                        <div className="flex gap-1.5">
                                          {[0, 5, 10, 15, 30].map(m => (
                                            <button
                                              key={m}
                                              type="button"
                                              onClick={() => set(m)}
                                              className={`flex-1 py-1.5 rounded-lg text-2xs font-black border transition-all ${value === m ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-400'}`}
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
                                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-black text-2xs uppercase tracking-widest py-2.5 rounded-xl transition-all"
                                    >
                                      {trimming ? 'Trimming…' : 'Apply Trim'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => { setShowTrimUI(false); setTrimStartMins(0); setTrimEndMins(0); }}
                                      className="px-4 bg-gray-100 dark:bg-gray-800 text-gray-500 font-black text-2xs uppercase tracking-widest py-2.5 rounded-xl transition-all"
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

            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 h-fit">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-sm font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 m-0">Session Finds</h3>
                    {(finds?.length ?? 0) > 0 && (
                        <div className="text-2xs font-black bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full">{finds!.length} found</div>
                    )}
                </div>

                {!isEdit && (
                    <div className="text-center py-8 text-sm text-gray-400 dark:text-gray-600 italic">
                        Save this session first to record finds.
                    </div>
                )}

                {isEdit && (
                    <div className="grid gap-2">
                        {finds && finds.length > 0 ? (
                            <>
                                {finds.map((s) => (
                                    <FindRow
                                        key={s.id}
                                        find={s}
                                        thumbMedia={findThumbMedia?.get(s.id) ?? null}
                                        onOpen={() => setOpenFindId(s.id)}
                                    />
                                ))}
                                {!isActiveSessionMode && (
                                    <button
                                        onClick={() => goSessionFind("full")}
                                        className={`mt-1 w-full ${isFinished ? 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700' : 'bg-emerald-600 hover:bg-emerald-700 text-white'} py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all`}
                                    >
                                        Add Find {isFinished && <span className="opacity-60 font-normal normal-case tracking-normal">(closed session)</span>}
                                    </button>
                                )}
                            </>
                        ) : isActiveSessionMode ? (
                            <div className="text-center py-8">
                                <p className="text-sm text-gray-400 dark:text-gray-500 mb-3">No finds yet.</p>
                                <button
                                    onClick={() => goSessionFind("full")}
                                    className="text-xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
                                >
                                    + Add first find
                                </button>
                            </div>
                        ) : (
                            <>
                                <div className="text-center py-6 text-sm text-gray-400 dark:text-gray-600 italic">
                                    No finds yet for this session.
                                </div>
                                <button
                                    onClick={() => goSessionFind("full")}
                                    className={`w-full ${isFinished ? 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700' : 'bg-emerald-600 hover:bg-emerald-700 text-white'} py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all`}
                                >
                                    Add Find to Session
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
      </div>
      {/* Off-screen landowner update card — always mounted so html2canvas can read it synchronously */}
      {session && (
        <div style={{ position: "fixed", left: -9999, top: 0, width: 540, pointerEvents: "none", zIndex: -1 }}>
          <LandownerUpdateCard
            ref={landownerCardRef}
            session={session}
            permission={permission}
            field={selectedField ?? null}
            finds={finds ?? []}
            detectoristName={detectoristName}
            highlightPhotoUrl={highlightPhotoUrl}
          />
        </div>
      )}
      {openFindId && <FindModal findId={openFindId} onClose={() => setOpenFindId(null)} />}
      {showSummary && (
        <SessionSummary
          coverage={summaryData.coverage}
          findsCount={summaryData.findsCount}
          pendingCount={finds?.filter(f => f.isPending).length ?? 0}
          durationMins={summaryData.durationMins}
          totalTime={summaryData.totalTime}
          permissionId={permission?.id ?? null}
          sharedPermissionId={permission?.sharedPermissionId}
          isClubDayMember={!!permission?.isClubDayMember}
          outcomeResult={summaryData.outcomeResult}
          onClose={() => nav(permission ? `/permission/${permission.id}` : "/")}
          onFieldReport={() => { setShowSummary(false); setShowFieldReport(true); }}
          onLandownerReport={(forField) => {
            setLandownerReportForField(forField);
            setShowSummary(false);
            setShowLandownerReport(true);
          }}
          onShareLandownerUpdate={handleShareLandownerUpdate}
          isSharingLandowner={isSharingLandowner}
          landownerShareError={landownerShareError}
          onExportClubDay={() => { setShowSummary(false); setShowExportClubDay(true); }}
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
      {showExportClubDay && permission && permission.sharedPermissionId && (
        <ExportClubDayModal
          permissionId={permission.id}
          sharedPermissionId={permission.sharedPermissionId}
          permissionName={permission.name}
          organiserEmail={permission.organiserEmail}
          onClose={() => setShowExportClubDay(false)}
        />
      )}
      {showFieldNotes && selectedField && (
        <FieldNotesModal
          field={selectedField}
          readOnly={!!permission?.isClubDayMember}
          onClose={() => setShowFieldNotes(false)}
        />
      )}
      <TrackingOverlay
        isVisible={showTrackingOverlay}
        onClose={() => setShowTrackingOverlay(false)}
        wakeLockSupported={isWakeLockSupported()}
        projectId={props.projectId}
        sessionContext={fullscreenQuickFindSession}
        stats={{
          durationText: activeDurationText,
          findsCount: activeHudFindCount,
          distanceText: activeDistanceText,
          coveragePercent: activeCoveragePercent,
          hasBoundary: !!(selectedField?.boundary || permission?.boundary),
        }}
        getPreferredLocation={getLatestTrackLocation}
      />
      {confirmDialog}
    </div>
  );
}
