import React, { useEffect, useLayoutEffect, useState, useMemo, useRef } from "react";
import { useLiveQuery } from 'dexie-react-hooks';
import type { Permission, Session, Find, Media } from "../db";
import { pagePersistence } from "../services/pagePersistence";
import { v4 as uuid } from "uuid";
import { captureGPS } from "../services/gps";
import { getSetting, getOrCreateRecorderId } from "../services/data";
import { useParams, useNavigate, useSearchParams } from "react-router";
import { FindRow } from "../components/FindRow";
import { FindModal } from "../components/FindModal";
import FieldReportModal from "../components/FieldReportModal";
import PermissionReportModal from "../components/PermissionReportModal";
import { startTracking, stopTracking, isTrackingActiveForSession, isTrackCurrentlyRecording } from "../services/tracking";
import { FieldNotesModal } from "../components/FieldNotesModal";
import { ExportClubDayModal } from "../components/ClubDayModals";
import { TrackingOverlay } from "../components/TrackingOverlay";
import { UndugSignalSheet } from "../components/UndugSignalSheet";
import { useConfirmDialog } from "../components/ConfirmModal";
import { LandownerUpdateCard } from "../components/LandownerUpdateCard";
import { shareElementAsImage } from "../services/share";
import { getNotableFindScore } from "../components/ReportChrome";
import type { WorkflowState } from "../types/significantFind";
import { area as turfArea } from "@turf/turf";
import "maplibre-gl/dist/maplibre-gl.css";
import { ephemeralSession, setDurableSetting, useDurableSetting } from '../services/clientStorage';
import type { CompanionControlResult, PendingCompanionCommand } from '../services/companionControlState';
import { useSessionData } from '../hooks/useSessionData';
import { useSessionTracking } from '../hooks/useSessionTracking';
import { useSessionModalState } from '../hooks/useSessionModalState';
import { useSessionMap, type SessionMapMarker } from '../hooks/useSessionMap';
import type { SessionMapObjectRef } from '../hooks/useSessionMapSelection';
import { useReportedCoverageGeometries } from '../hooks/useReportedCoverageGeometries';
import {
  appendSessionNote,
  createSessionRecord,
  deleteSessionCascade,
  finishSessionRecord,
  recordSessionTrackingStart,
  reopenSessionRecord,
  setSessionGroundConditions,
  setSessionLocation,
  trimSessionTrack,
  updateSessionDetails,
} from '../services/sessionMutations';
import { prepareSessionSearchedAreas } from '../services/sessionCoverageCommands';
import { companionControlHref, isAndroidUserAgent } from '../services/companionLaunch';
import { SessionCoverageReview } from '../components/coverage/SessionCoverageReview';
import { RecordSurfaceFindButton } from '../components/surfaceScatter/ObservedByYouBlock';
import { createSavedPoint } from '../services/fieldGuideMutations';
import { sessionStartedAt } from '../services/session/activeSessionContext';
import { getSessionReview } from '../services/session/sessionReview';
import { ActiveSessionWorkspace, type ActiveWorkspaceTab } from '../components/session/ActiveSessionWorkspace';
import { SessionMapLayerPicker } from '../components/session/SessionMapLayerPicker';
import { getPermissionScanTarget } from '../outstandingQuestions/permissionScanTarget';
import { SessionReviewModal } from '../components/session/SessionReviewModal';
import { SessionQuickFindSheet } from '../components/session/SessionQuickFindSheet';
import { SessionSavedPointSheet } from '../components/session/SessionSavedPointSheet';
import { SessionMapObjectSheet } from '../components/session/SessionMapObjectSheet';
import type { FieldLocation } from '../services/session/sessionFieldPosition';
import type { SessionActivityItem } from '../services/session/sessionActivity';
import { useActiveSessionFieldContext } from '../hooks/useActiveSessionFieldContext';
import { buildActiveSessionGuideHref } from '../services/session/activeSessionGuideRoute';
import { NewSessionStartCard } from '../components/session/NewSessionStartCard';
const FIRST_SESSION_KEY = "fs_first_session";
function formatDeleteCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
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
  const finishRequested = searchParams.get("finish") === "1";
  const nav = useNavigate();
  const { confirm: confirmAction, dialog: confirmDialog } = useConfirmDialog();
  
  // Use a stable sessionId even if it's a new session (id is undefined)
  const [sessionId] = useState(id || uuid());
  const isEdit = !!id;
  const isAndroid = useMemo(() => isAndroidUserAgent(), []);
  const companionStartHref = useMemo(() => companionControlHref('start', sessionId), [sessionId]);
  const companionStopHref = useMemo(() => companionControlHref('stop', sessionId), [sessionId]);
  const companionStopAndFinishHref = useMemo(
    () => companionControlHref('stop', sessionId, true),
    [sessionId],
  );

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
  
  const [milestoneMsg, setMilestoneMsg] = useState<string | null>(null);
  const [hasStartedSessionBefore, setHasStartedSessionBefore] = useDurableSetting(FIRST_SESSION_KEY, false);
  const [companionActiveSessionId, setCompanionActiveSessionId, companionStateReady] = useDurableSetting(
    'fs_companion_active_session',
    '',
  );
  const [pendingCompanionCommand, setPendingCompanionCommand, companionCommandStateReady] = useDurableSetting<PendingCompanionCommand | null>(
    'fs_companion_pending_command',
    null,
  );
  const isCompanionTracking = companionActiveSessionId === sessionId;
  const sessionCompanionCommand = pendingCompanionCommand?.sessionId === sessionId
    ? pendingCompanionCommand
    : null;
  const isOtherCompanionTracking = (companionActiveSessionId !== '' && !isCompanionTracking)
    || (!!pendingCompanionCommand && pendingCompanionCommand.sessionId !== sessionId);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [workspaceTab, setWorkspaceTabState] = useState<ActiveWorkspaceTab>(() => {
    const saved = ephemeralSession.get(`fs_v5_workspace_tab:${sessionId}`);
    return saved === 'map' || saved === 'session' ? saved : 'record';
  });
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [showFieldTrails, setShowFieldTrails] = useState(false);
  const [showPastFinds, setShowPastFinds] = useState(false);
  const [showWorkspaceQuickFind, setShowWorkspaceQuickFind] = useState(false);
  const [showSavedPointSheet, setShowSavedPointSheet] = useState(false);
  const [savedPointDefaultLabel, setSavedPointDefaultLabel] = useState<string | undefined>();
  const [workspaceGpsLocation, setWorkspaceGpsLocation] = useState<FieldLocation | null>(null);
  const finishRequestHandledRef = useRef(false);

  useEffect(() => {
    const result = searchParams.get('companionResult') as CompanionControlResult | null;
    if (!result || !companionStateReady || !companionCommandStateReady) return;
    const pendingStart = pendingCompanionCommand?.action === 'start'
      && pendingCompanionCommand.sessionId === sessionId;
    const pendingStop = pendingCompanionCommand?.action === 'stop'
      && pendingCompanionCommand.sessionId === sessionId;

    async function acknowledgeResult() {
      if (result === 'started' && pendingStart) {
        await setDurableSetting('fs_companion_active_session', sessionId);
        await setDurableSetting('fs_companion_pending_command', null);
        setCompanionActiveSessionId(sessionId);
        setPendingCompanionCommand(null);
        setWorkspaceNotice('Companion confirmed recording');
      } else if ((result === 'start_cancelled' || result === 'start_failed') && pendingStart) {
        await setDurableSetting('fs_companion_pending_command', null);
        setPendingCompanionCommand(null);
        setError(result === 'start_cancelled'
          ? 'Companion start was cancelled. No recording was marked active.'
          : 'Companion could not start recording. Check its location permission and try again.');
      } else if (result === 'stop_failed' && pendingStop) {
        await setDurableSetting('fs_companion_pending_command', null);
        setPendingCompanionCommand(null);
        setError('Companion could not stop or return its trail. It is still marked active so you can retry safely.');
      }
      nav(`/session/${sessionId}`, { replace: true });
    }

    void acknowledgeResult();
  }, [companionCommandStateReady, companionStateReady, nav, pendingCompanionCommand, searchParams, sessionId, setCompanionActiveSessionId, setPendingCompanionCommand]);

  const [trimStartMins, setTrimStartMins] = useState(0);
  const [trimEndMins, setTrimEndMins] = useState(0);
  const [trimming, setTrimming] = useState(false);
  const {
    openFindId, setOpenFindId,
    showFieldNotes, setShowFieldNotes,
    showSignalSheet, setShowSignalSheet,
    showTrimUI, setShowTrimUI,
    showSummary, setShowSummary,
    showExportClubDay, setShowExportClubDay,
    summaryData, setSummaryData,
    showFieldReport, setShowFieldReport,
    showLandownerReport, setShowLandownerReport,
    landownerReportForField, setLandownerReportForField,
  } = useSessionModalState();
  const [detectoristName, setDetectoristName] = useState("Detectorist");
  const [highlightPhotoUrl, setHighlightPhotoUrl] = useState<string | null>(null);
  const landownerCardRef = useRef<HTMLDivElement>(null);
  const [isSharingLandowner, setIsSharingLandowner] = useState(false);
  const [landownerShareError, setLandownerShareError] = useState<string | null>(null);
  const [keyNotes, setKeyNotes] = useState<string[]>([]);
  const isActiveSessionMode = isEdit && !isEditing && !isFinished;

  function setWorkspaceTab(tab: ActiveWorkspaceTab) {
    ephemeralSession.set(`fs_v5_workspace_tab:${sessionId}`, tab);
    setWorkspaceTabState(tab);
  }

  useLayoutEffect(() => {
    if (isActiveSessionMode) window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [isActiveSessionMode, sessionId]);

  const { permission, fields, selectedField, session, finds, allMedia, tracks, fieldTracks, fieldSessions, fieldFinds } = useSessionData({
    sessionId, permissionId, fieldId,
  });
  useEffect(() => {
    if (!isEdit && !fieldId && fields?.length === 1) setFieldId(fields[0].id);
  }, [fieldId, fields, isEdit]);
  const reportedCoverage = useReportedCoverageGeometries(
    permission?.id ?? permissionId ?? undefined,
  );
  const reportedAreas = useMemo(
    () => reportedCoverage
      .filter(item => !selectedField || item.fieldId === selectedField.id)
      .map(item => item.geometry),
    [reportedCoverage, selectedField],
  );
  const {
    isTracking, setIsTracking,
    showTrackingOverlay, setShowTrackingOverlay,
    showCoverage, setShowCoverage,
    coverageResult, coverageError,
    activeDistanceKm, activeCoverage, trackingStatus,
  } = useSessionTracking(
    sessionId,
    selectedField?.boundary || permission?.boundary,
    tracks,
    reportedAreas,
    fieldTracks ?? tracks,
  );
  const isAnyTracking = isTracking || isCompanionTracking;

  useEffect(() => {
    if (!isActiveSessionMode) return;
    setNowTick(Date.now());
    const timer = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [isActiveSessionMode]);

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

      const media = await pagePersistence.media
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
  const activeBoundary = selectedField?.boundary || permission?.boundary;
  const activeFieldContext = useActiveSessionFieldContext({
    projectId: props.projectId, sessionId, finds, tracks,
    trackingPoint: trackingStatus.lastAcceptedPoint, trackFallbackEnabled: isCompanionTracking,
    manualLocation: workspaceGpsLocation, boundary: activeBoundary,
  });
  const {
    signals: activeSignals, observations: activeObservations, savedPoints: activeSavedPoints,
    liveLocation, markers: sessionMapMarkers, startPoint, startPointDistanceText,
    recentActivity: workspaceRecentActivity, findActivity: workspaceFindActivity, boundaryStatus,
    openSignalCount: activeOpenSignalCount, observationCount: activeObservationCount,
  } = activeFieldContext;
  const sessionMapCenter = useMemo(
    () => lat != null && lon != null
      ? { lat, lon }
      : permission
        ? getPermissionScanTarget(permission)
        : null,
    [lat, lon, permission],
  );
  const pastFieldFindMarkers = useMemo<SessionMapMarker[]>(
    () => (fieldFinds ?? []).flatMap(find =>
      find.sessionId !== sessionId && find.lat != null && find.lon != null
        ? [{ id: find.id, kind: 'find', lat: find.lat, lon: find.lon }]
        : [],
    ),
    [fieldFinds, sessionId],
  );
  const previousTrailsAvailable = useMemo(() => {
    const currentTrackIds = new Set((tracks ?? []).map(track => track.id));
    return !!fieldTracks?.some(track =>
      !currentTrackIds.has(track.id) && (track.points?.length ?? 0) >= 2
    );
  }, [fieldTracks, tracks]);
  const {
    mapDivRef,
    layerControl: sessionMapLayerControl,
    selection: sessionMapSelection,
    clearSelection: clearSessionMapSelection,
    chooseMapObject,
  } = useSessionMap({
    viewportKey: sessionId,
    enabled: !isActiveSessionMode || workspaceTab === 'map',
    center: sessionMapCenter,
    markers: sessionMapMarkers,
    liveLocation,
    boundary: selectedField?.boundary || permission?.boundary,
    boundaryReady: !loading && (fieldId ? selectedField !== undefined : permission !== undefined),
    tracks,
    fieldTracks,
    fieldFindMarkers: pastFieldFindMarkers,
    isTracking,
    isFinished,
    showFieldTrails,
    showPastFinds,
    showCoverage,
    coverageResult,
    mapObjectSheetsEnabled: isActiveSessionMode,
    onMarkerSelect: openWorkspaceMapObject,
  });

  useEffect(() => {
    if (!isActiveSessionMode || workspaceTab !== 'map' || isTracking || isCompanionTracking) return;
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      position => setWorkspaceGpsLocation({
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        accuracyM: position.coords.accuracy,
        headingDegrees: position.coords.heading,
      }),
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [isActiveSessionMode, isCompanionTracking, isTracking, workspaceTab]);

  useEffect(() => {
    if (sessionId) {
      pagePersistence.sessions.get(sessionId).then(s => {
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
    await setSessionGroundConditions(sessionId, { isStubble: val }, new Date().toISOString());
  }

  async function quickSetLandUse(val: string) {
    setLandUse(val);
    await setSessionGroundConditions(sessionId, { landUse: val }, new Date().toISOString());
  }

  async function doGPS() {
    setError(null);
    try {
      const fix = await captureGPS();
      setLat(fix.lat);
      setLon(fix.lon);
      setAcc(fix.accuracyM);
      if (isEdit && !isEditing) {
        await setSessionLocation(sessionId, {
          lat: fix.lat,
          lon: fix.lon,
          gpsAccuracyM: fix.accuracyM,
        }, new Date().toISOString());
      }
    } catch (e: any) {
      setError(e?.message ?? "GPS failed");
    }
  }

  async function handleDelete() {
    if (!isEdit) return;
    const sessionFinds = await pagePersistence.finds.where("sessionId").equals(sessionId).toArray();
    const findIds = sessionFinds.map(f => f.id);
    const significantFinds = await pagePersistence.significantFinds.where("sessionId").equals(sessionId).toArray();
    const significantFindIds = significantFinds.map(f => f.id);
    const findMediaCount = findIds.length ? await pagePersistence.media.where("findId").anyOf(findIds).count() : 0;
    const significantFindMediaCount = significantFindIds.length ? await pagePersistence.media.where("findId").anyOf(significantFindIds).count() : 0;
    const mediaCount = findMediaCount + significantFindMediaCount;
    const trackCount = await pagePersistence.tracks.where("sessionId").equals(sessionId).count();

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
      await deleteSessionCascade(sessionId);
      
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
      const now = new Date().toISOString();
      const isoDate = isEdit ? new Date(date).toISOString() : now;

      let resolvedPermissionId: string;
      if (isEdit) {
        const existing = await pagePersistence.sessions.get(sessionId);
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
        const perm = await pagePersistence.permissions.get(resolvedPermissionId);
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
        sessionStartedAt: now,
        activatedAt: now,
        createdAt: now,
      };

      if (isEdit) {
        await updateSessionDetails(sessionId, sessionFields);
        setIsEditing(false);
      } else {
        await createSessionRecord(newSessionRecord);
        setIsEditing(false);
        const isFirstSession = !hasStartedSessionBefore;
        if (isFirstSession) setHasStartedSessionBefore(true);
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
            if (isActiveSessionMode) {
              setWorkspaceNotice('Trail recording started');
              window.setTimeout(() => setWorkspaceNotice(null), 3000);
            } else {
              setShowTrackingOverlay(true);
            }

            // Record start time if not already set
            const s = await pagePersistence.sessions.get(sessionId);
            if (s && !s.startTime) {
                const startedAt = new Date().toISOString();
                await recordSessionTrackingStart(sessionId, startedAt);
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
    if (isCompanionTracking) {
        setError("Stop Companion tracking before finishing this session.");
        return;
    }
    if (isTrackingActiveForSession(sessionId)) {
        await stopTracking();
        setIsTracking(false);
    }
    
    const now = new Date();
    const endTimeIso = now.toISOString();

    // Completion is the authoritative write. Everything below is derived and
    // must be allowed to fail without leaving the visit open or blocking exit.
    try {
        await finishSessionRecord(sessionId, endTimeIso);
        setIsFinished(true);
    } catch (e: any) {
        setError("Could not finish session: " + (e?.message ?? "Unknown error"));
        setIsTracking(isTrackingActiveForSession(sessionId));
        return;
    }

    const count = await pagePersistence.finds.where("sessionId").equals(sessionId).count();

    // Session time starts when the session record was created. Tracking may
    // start later and must not shorten the detectorist's recorded session.
    let durationStr: string | null = null;
    let durationMins: number | null = null;
    const s = await pagePersistence.sessions.get(sessionId);
    const startT = s ? sessionStartedAt(s) : null;

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

    const openSignalCount = sessionId
        ? await pagePersistence.undugSignals.where('sessionId').equals(sessionId).filter(s => s.status === 'open').count()
        : 0;
    const durableReview = await getSessionReview(sessionId).catch(() => null);

    setSummaryData({
        findsCount: count,
        durationMins,
        totalTime: durationStr,
        openSignalCount,
        surfaceObservationCount: durableReview?.surfaceObservationCount ?? 0,
        walkedDistanceMetres: durableReview?.walkedDistanceMetres ?? null,
    });
    setLandownerShareError(null);
    setShowSummary(true);
    void prepareSessionSearchedAreas(sessionId).catch(() => {
      setError("Session finished, but ground coverage could not be prepared.");
    });
  }

  async function persistPendingCompanionCommand(command: PendingCompanionCommand | null) {
    await setDurableSetting('fs_companion_pending_command', command);
    setPendingCompanionCommand(command);
  }

  async function launchCompanionStart() {
    try {
      setError(null);
      await persistPendingCompanionCommand({
        action: 'start',
        sessionId,
        requestedAt: Date.now(),
      });
      window.location.assign(companionStartHref);
    } catch (cause) {
      setError(`Could not prepare Companion start: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  async function launchCompanionStop(finishAfterImport: boolean) {
    try {
      setError(null);
      await persistPendingCompanionCommand({
        action: 'stop',
        sessionId,
        requestedAt: Date.now(),
        finishAfterImport,
      });
      window.location.assign(finishAfterImport ? companionStopAndFinishHref : companionStopHref);
    } catch (cause) {
      setError(`Could not prepare Companion stop: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  async function confirmLegacyCompanionStart() {
    await setDurableSetting('fs_companion_active_session', sessionId);
    await setDurableSetting('fs_companion_pending_command', null);
    setCompanionActiveSessionId(sessionId);
    setPendingCompanionCommand(null);
    setWorkspaceNotice('Companion marked as recording');
  }

  async function cancelPendingCompanionCommand() {
    await persistPendingCompanionCommand(null);
    setWorkspaceNotice(isCompanionTracking
      ? 'Stop request cancelled; Companion remains marked active'
      : 'Companion start cancelled');
  }

  async function requestFinishSession() {
    if (sessionCompanionCommand?.action === 'start') {
      setWorkspaceTab('record');
      setError("Confirm that Companion started, or choose 'It didn't start', before finishing this visit.");
      return;
    }
    const confirmed = await confirmAction({
      title: 'Finish this visit?',
      message: `${activeFindCount} recorded find${activeFindCount === 1 ? '' : 's'}\n${activePendingCount} pending find${activePendingCount === 1 ? '' : 's'}\n${activeOpenSignalCount} open signal${activeOpenSignalCount === 1 ? '' : 's'}${isAnyTracking ? '\n\nTrail recording will stop.' : ''}`,
      confirmLabel: 'Finish visit',
      cancelLabel: 'Keep detecting',
      danger: true,
    });
    if (!confirmed) return;
    if (isCompanionTracking) {
      await launchCompanionStop(true);
      return;
    }
    await finishSession();
  }
  useEffect(() => {
    if (!finishRequested || finishRequestHandledRef.current || loading || !session || isFinished) return;
    finishRequestHandledRef.current = true;
    nav(`/session/${sessionId}`, { replace: true });
    void requestFinishSession();
  }, [finishRequested, loading, session?.id, isFinished]); // eslint-disable-line react-hooks/exhaustive-deps
  async function openDurableReview() {
    const review = await getSessionReview(sessionId);
    if (!review) {
      setError('This session review could not be reconstructed.');
      return;
    }
    const minutes = review.durationMinutes;
    const totalTime = minutes === null
      ? null
      : minutes >= 60
        ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : `${minutes}m`;
    setSummaryData({
      findsCount: review.findsCount,
      durationMins: minutes,
      totalTime,
      openSignalCount: review.openSignalCount,
      surfaceObservationCount: review.surfaceObservationCount,
      walkedDistanceMetres: review.walkedDistanceMetres,
    });
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
        await trimSessionTrack(track.id, trimmed, new Date().toISOString());
      }
      setTrimStartMins(0);
      setTrimEndMins(0);
      setShowTrimUI(false);
    } finally {
      setTrimming(false);
    }
  }
  const activeStartedAt = session ? sessionStartedAt(session) : nowTick;
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
    return liveLocation ? { lat: liveLocation.lat, lon: liveLocation.lon, gpsAccuracyM: liveLocation.accuracyM } : null;
  }, [liveLocation]);
  async function saveWorkspacePoint(label: string, pointNote: string) {
    const preferred = getLatestTrackLocation();
    const location = preferred ?? await captureGPS();
    const pointLat = preferred?.lat ?? location.lat;
    const pointLon = preferred?.lon ?? location.lon;
    await createSavedPoint({
      id: crypto.randomUUID(), projectId: props.projectId, label, lat: pointLat, lon: pointLon, zoom: 17,
      note: `Session ${sessionId}${pointNote ? ` · ${pointNote}` : ''}`, createdAt: new Date().toISOString(),
    });
    setWorkspaceNotice(`${label} saved`);
    window.setTimeout(() => setWorkspaceNotice(null), 3000);
  }
  function openWorkspaceMapObject(object: SessionMapObjectRef) {
    if (object.kind === 'find') nav(`/find?quickId=${object.id}`);
    else if (object.kind === 'signal') nav(`/finds-box?tab=signals&signal=${encodeURIComponent(object.id)}`);
    else if (object.kind === 'observation' && permission) nav(`/permission/${permission.id}`);
    else if (object.kind === 'trail') {
      if (object.sessionId && object.sessionId !== sessionId) nav(`/session/${object.sessionId}`);
    }
    else {
      const point = activeSavedPoints.find(candidate => candidate.id === object.id);
      if (point) nav(`/fieldguide?sessionId=${sessionId}&savedPoints=1&lat=${point.lat}&lng=${point.lon}`);
    }
  }

  function openWorkspaceActivity(item: SessionActivityItem) {
    if (item.kind === 'find') nav(`/find?quickId=${item.id}`);
    else if (item.kind === 'signal') nav(`/finds-box?tab=signals&signal=${encodeURIComponent(item.id)}`);
    else if (item.kind === 'observation' && permission) nav(`/permission/${permission.id}`);
    else {
      const point = activeSavedPoints.find(candidate => candidate.id === item.id);
      if (point) nav(`/fieldguide?sessionId=${sessionId}&savedPoints=1&lat=${point.lat}&lng=${point.lon}`);
    }
  }

  async function addWorkspaceNote(noteText: string) {
    const updated = await appendSessionNote(sessionId, noteText);
    setNotes(updated);
    setWorkspaceNotice('Session note added');
    window.setTimeout(() => setWorkspaceNotice(null), 3000);
  }

  function openActiveSessionGuide() {
    const permissionTarget = permission ? getPermissionScanTarget(permission) : null;
    const target = permissionTarget ?? (lat != null && lon != null ? { lat, lon } : null);
    nav(buildActiveSessionGuideHref({ sessionId, permissionId: permission?.id, fieldId: selectedField?.boundary ? selectedField.id : undefined, boundary: selectedField?.boundary ?? permission?.boundary, target }));
  }

  if (loading) return <div className="p-10 text-center opacity-50 font-medium">Loading session...</div>;

  if (isActiveSessionMode) {
    return (
      <>
        <ActiveSessionWorkspace key={sessionId}
          workspaceTab={workspaceTab}
          onSelectTab={setWorkspaceTab}
          mapDivRef={mapDivRef}
          mapLayerControl={<SessionMapLayerPicker control={sessionMapLayerControl} fieldHistory={{
            trailsAvailable: previousTrailsAvailable,
            trailsVisible: showFieldTrails,
            toggleTrails: () => setShowFieldTrails(current => !current),
            findsAvailable: pastFieldFindMarkers.length > 0,
            findsVisible: showPastFinds,
            toggleFinds: () => setShowPastFinds(current => !current),
          }} gaps={{
            available: !!activeBoundary,
            visible: showCoverage,
            toggle: () => setShowCoverage(current => !current),
          }} />}
          permissionName={permission?.name ?? 'Detecting session'}
          fieldName={selectedField?.name}
          durationText={activeDurationText}
          startedAt={activeStartedAt}
          findCount={activeFindCount}
          pendingCount={activePendingCount}
          observationCount={activeObservationCount ?? 0}
          openSignalCount={activeOpenSignalCount ?? 0}
          hasField={!!selectedField}
          hasFieldNotes={!!selectedField?.notes}
          landUse={landUse}
          isStubble={isStubble}
          distanceText={activeDistanceText}
          isTracking={isTracking}
          isCompanionTracking={isCompanionTracking}
          hasRecordedTrail={!!tracks?.some(track => (track.points?.length ?? 0) > 0)}
          isAndroid={isAndroid}
          companionStateReady={companionStateReady && companionCommandStateReady}
          isOtherCompanionTracking={isOtherCompanionTracking}
          companionPendingAction={sessionCompanionCommand?.action ?? null}
          trackingStatus={trackingStatus}
          boundaryStatus={boundaryStatus}
          startPointDistanceText={startPointDistanceText}
          hasStartPoint={!!startPoint}
          recentActivity={workspaceRecentActivity}
          findActivity={workspaceFindActivity}
          error={error}
          notice={workspaceNotice}
          recordSurfaceAction={<RecordSurfaceFindButton compact label="Surface observation" projectId={props.projectId} permissionId={permission?.id ?? null} sessionId={sessionId} getLocation={captureGPS} onRecorded={() => { setWorkspaceNotice('Surface observation saved'); navigator.vibrate?.(40); window.setTimeout(() => setWorkspaceNotice(null), 3000); }} />}
          onPermission={() => nav(permission ? `/permission/${permission.id}` : '/')}
          onFinish={requestFinishSession}
          onToggleTracking={toggleTracking}
          onCompanionStart={() => void launchCompanionStart()}
          onCompanionStop={() => void launchCompanionStop(false)}
          onCompanionConfirmStart={() => void confirmLegacyCompanionStart()}
          onCompanionCancel={() => void cancelPendingCompanionCommand()}
          onImportTrail={() => nav(`/companion-import?session=${sessionId}`)}
          onLowDistraction={() => setShowTrackingOverlay(true)}
          onQuickFind={() => setShowWorkspaceQuickFind(true)}
          onSignal={() => setShowSignalSheet(true)}
          onSavePoint={() => { setSavedPointDefaultLabel(undefined); setShowSavedPointSheet(true); }}
          onMarkStartPoint={() => { setSavedPointDefaultLabel('Start point'); setShowSavedPointSheet(true); }}
          onFieldNotes={() => setShowFieldNotes(true)}
          onToggleStubble={() => void quickSetStubble(!isStubble)}
          onToggleLandUse={condition => void quickSetLandUse(landUse === condition ? '' : condition)}
          onActivity={openWorkspaceActivity}
          onOpenObservations={() => permission && nav(`/permission/${permission.id}`)}
          onOpenSignals={() => nav('/finds-box?tab=signals')}
          onTrailDetails={() => setWorkspaceTab('record')}
          onAddNote={addWorkspaceNote}
          onSignificantFind={() => props.onSignificantFind?.({ permissionId: permission?.id ?? permissionId, sessionId, lat: liveLocation?.lat ?? lat, lon: liveLocation?.lon ?? lon, gpsAccuracyM: liveLocation?.accuracyM ?? acc })}
          onPending={() => nav('/pending')}
          onGuide={openActiveSessionGuide}
        />
        {sessionMapSelection && <SessionMapObjectSheet selection={sessionMapSelection} records={{ finds: [...(finds ?? []), ...(fieldFinds ?? [])], signals: activeSignals, observations: activeObservations, savedPoints: activeSavedPoints, tracks: [...(tracks ?? []), ...(fieldTracks ?? [])], sessions: [...(fieldSessions ?? []), ...(session ? [session] : [])] }} activeSessionId={sessionId} onChoose={chooseMapObject} onClose={clearSessionMapSelection} onOpenFullRecord={openWorkspaceMapObject} />}
        {showWorkspaceQuickFind && permission && <SessionQuickFindSheet projectId={props.projectId} permissionId={permission.id} sessionId={sessionId} fieldId={fieldId} permissionName={permission.name} getPreferredLocation={getLatestTrackLocation} onClose={() => setShowWorkspaceQuickFind(false)} onSaved={(_findId, pending) => { setShowWorkspaceQuickFind(false); setWorkspaceNotice(pending ? 'Find saved for later' : 'Find saved'); window.setTimeout(() => setWorkspaceNotice(null), 3000); }} onAddDetails={findId => nav(`/find?quickId=${findId}`)} />}
        {showSavedPointSheet && <SessionSavedPointSheet defaultLabel={savedPointDefaultLabel} onClose={() => setShowSavedPointSheet(false)} onSave={saveWorkspacePoint} />}
        {showSignalSheet && <UndugSignalSheet sessionId={sessionId} permissionId={permission?.id ?? permissionId} onSaved={(_signalId, openCount) => { setShowSignalSheet(false); setWorkspaceNotice(`Signal saved${openCount ? ` · ${openCount} open here` : ''}`); navigator.vibrate?.(40); window.setTimeout(() => setWorkspaceNotice(null), 3000); }} onClose={() => setShowSignalSheet(false)} />}
        <TrackingOverlay
          isVisible={showTrackingOverlay}
          onClose={() => setShowTrackingOverlay(false)}
          projectId={props.projectId}
          sessionContext={fullscreenQuickFindSession}
          stats={{ durationText: activeDurationText, findsCount: activeHudFindCount, distanceText: activeDistanceText, coveragePercent: null, hasBoundary: !!(selectedField?.boundary || permission?.boundary) }}
          getPreferredLocation={getLatestTrackLocation}
        />
        {confirmDialog}
      </>
    );
  }

  return (
    <div className="max-w-4xl mx-auto pb-20 px-4">
      {milestoneMsg && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-bold pointer-events-none whitespace-nowrap">
          {milestoneMsg}
        </div>
      )}
      <div className="mt-4 grid gap-8">
        {isEdit && (
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex flex-wrap gap-3 items-center">
                  <>
                    <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100">
                        Session Details
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
        )}

        {error && (
            <div className="border-2 border-red-200 bg-red-50 text-red-800 p-4 rounded-xl shadow-sm flex gap-3 items-center">
                <span className="text-xl">⚠️</span> {error}
            </div>
        )}

        {isEdit && isFinished && !showSummary && (
          <SessionCoverageReview sessionId={sessionId} />
        )}

        <div className="grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-3">
            <div className={`${isEdit ? 'lg:col-span-2' : 'lg:col-span-3'} min-w-0 ${!isEdit ? '' : 'overflow-hidden bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm'} grid h-fit ${isEdit ? 'gap-6 p-6' : ''}`}>
                {!isEditing && (
                  <div className="flex flex-col gap-6">
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
                                        onClick={openDurableReview}
                                        className="flex-1 bg-gray-900 hover:bg-gray-800 text-white px-3 py-2 rounded-lg text-2xs font-black uppercase tracking-widest transition-all dark:bg-gray-100 dark:text-gray-900"
                                    >
                                        View Review
                                    </button>
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
                                            await reopenSessionRecord(sessionId);
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

                    {notes && (
                        <div className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
                            <h4 className="text-2xs font-black uppercase tracking-widest opacity-60 mb-1">Notes</h4>
                            <p className="text-sm opacity-80 whitespace-pre-wrap">{notes}</p>
                        </div>
                    )}
                  </div>
                )}

                {isEditing && !isEdit && (
                  <NewSessionStartCard
                    permissionName={permission?.name ?? 'Detecting permission'}
                    fields={fields ?? []}
                    fieldId={fieldId}
                    landUse={landUse}
                    isStubble={isStubble}
                    notes={notes}
                    saving={saving}
                    onFieldChange={setFieldId}
                    onLandUseChange={setLandUse}
                    onStubbleChange={setIsStubble}
                    onNotesChange={setNotes}
                    onStart={() => void save()}
                    onBack={() => nav(permission ? `/permission/${permission.id}` : '/')}
                  />
                )}

                {isEditing && isEdit && (
                  <>
                    <label className="block rounded-2xl">
                        <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Date & Time</div>
                        <input 
                            type="datetime-local" 
                            value={date} 
                            onChange={(e) => setDate(e.target.value)} 
                            className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
                        />
                    </label>

                    <label className="block rounded-2xl">
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

                    <div className="flex flex-wrap gap-4 items-center bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
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
                            <div className="text-xs font-black uppercase tracking-widest opacity-50">Tracking</div>
                            <div className="flex gap-2">
                                {isEdit ? (
                                    <>
                                        {isTracking ? (
                                          <button
                                              type="button"
                                              onClick={toggleTracking}
                                              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm transition-all active:scale-95"
                                          >
                                              <span>Stop Tracking</span>
                                          </button>
                                        ) : isAndroid && isCompanionTracking ? (
                                          <>
                                            <button
                                                type="button"
                                                onClick={() => void launchCompanionStop(false)}
                                                className="flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-1.5 text-xs font-bold text-red-700 shadow-sm transition-all active:scale-95 dark:border-red-800 dark:bg-gray-800 dark:text-red-300"
                                            >
                                                <span>Stop Tracking</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void requestFinishSession()}
                                                className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm transition-all active:scale-95"
                                            >
                                                <span>Stop Tracking &amp; Finish Session</span>
                                            </button>
                                          </>
                                        ) : isAndroid ? (
                                          <button
                                              type="button"
                                              onClick={() => {
                                                if (companionStateReady && !isOtherCompanionTracking) {
                                                  void launchCompanionStart();
                                                }
                                              }}
                                              aria-disabled={!companionStateReady || isOtherCompanionTracking}
                                              className={`flex items-center gap-2 rounded-lg border px-4 py-1.5 text-xs font-bold shadow-sm transition-all active:scale-95 ${!companionStateReady || isOtherCompanionTracking ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400 dark:border-gray-700 dark:bg-gray-800' : 'border-emerald-200 bg-white text-emerald-600 dark:border-emerald-700 dark:bg-gray-800 dark:text-emerald-400'}`}
                                          >
                                              <span>{isOtherCompanionTracking ? 'Tracking another session' : 'Track Session'}</span>
                                          </button>
                                        ) : (
                                          <button
                                              type="button"
                                              onClick={toggleTracking}
                                              className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 py-1.5 text-xs font-bold text-emerald-600 shadow-sm transition-all active:scale-95 dark:border-emerald-700 dark:bg-gray-800 dark:text-emerald-400"
                                          >
                                              <span>Track Session</span>
                                          </button>
                                        )}
                                        {!isAnyTracking && (
                                          <button
                                            type="button"
                                            onClick={() => nav(`/companion-import?session=${sessionId}`)}
                                            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                                          >
                                            Import trail
                                          </button>
                                        )}
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
                                    <span className="text-2xs opacity-60 italic">Start session to enable tracking</span>
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
                            {saving ? "Saving..." : "Save Details"}
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
                                        <span>{showCoverage ? (coverageResult && coverageResult.percentUndetected <= 1 ? 'No Gaps' : 'Gaps On') : 'Show Gaps'}</span>
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

            {isEdit && <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 h-fit">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-sm font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 m-0">Session Finds</h3>
                    {(finds?.length ?? 0) > 0 && (
                        <div className="text-2xs font-black bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full">{finds!.length} found</div>
                    )}
                </div>

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
                                <button
                                    onClick={() => goSessionFind("full")}
                                    className={`mt-1 w-full ${isFinished ? 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700' : 'bg-emerald-600 hover:bg-emerald-700 text-white'} py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all`}
                                >
                                    Add Find {isFinished && <span className="opacity-60 font-normal normal-case tracking-normal">(closed session)</span>}
                                </button>
                            </>
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
            </div>}
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
        <SessionReviewModal
          sessionId={sessionId}
          findsCount={summaryData.findsCount}
          pendingCount={finds?.filter(f => f.isPending).length ?? 0}
          durationMins={summaryData.durationMins}
          totalTime={summaryData.totalTime}
          permissionId={permission?.id ?? null}
          sharedPermissionId={permission?.sharedPermissionId}
          isClubDayMember={!!permission?.isClubDayMember}
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
          openSignalCount={summaryData.openSignalCount}
          walkedDistanceMetres={summaryData.walkedDistanceMetres}
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
      {showSignalSheet && (
        <UndugSignalSheet
          sessionId={sessionId}
          permissionId={permission?.id ?? permissionId}
          onSaved={() => setShowSignalSheet(false)}
          onClose={() => setShowSignalSheet(false)}
        />
      )}
      <TrackingOverlay
        isVisible={showTrackingOverlay}
        onClose={() => setShowTrackingOverlay(false)}
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
