import React from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, Session } from "../db";
import { captureGPS } from "../services/gps";
import { fileToBlob } from "../services/photos";
import { v4 as uuid } from "uuid";
import type { WorkflowState } from "../types/significantFind";
import { UndugSignalSheet } from "./UndugSignalSheet";
import { useDurableSetting } from '../services/clientStorage';
import { attachQuickFindPhoto, createQuickFind, discardFindDraft } from '../services/findMutations';

export type QuickFindLocation = {
  lat: number;
  lon: number;
  gpsAccuracyM?: number | null;
};

type QuickFindSessionContext = Pick<Session, "id" | "projectId" | "permissionId" | "fieldId">;

type QuickFindFabProps = {
  projectId: string;
  activeSession?: QuickFindSessionContext | null;
  allowPermissionFallback?: boolean;
  showPendingBadge?: boolean;
  showSignalButton?: boolean;
  containerClassName?: string;
  getPreferredLocation?: () => QuickFindLocation | null;
  onRecorded?: (findId: string) => void;
  onSignificantFind?: (initialContext?: Partial<WorkflowState>) => void;
};

function SignalMarkerIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M10 2.25c-2.42 0-4.4 1.9-4.4 4.25 0 3.15 3.35 6.35 4.05 6.98.2.18.5.18.7 0 .7-.63 4.05-3.83 4.05-6.98 0-2.35-1.98-4.25-4.4-4.25Z" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10" cy="6.6" r="1.35" fill="currentColor" />
      <path d="M5.1 14.5c1.22.78 2.9 1.25 4.9 1.25s3.68-.47 4.9-1.25M7.65 12.85c.68.26 1.48.4 2.35.4s1.67-.14 2.35-.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function QuickFindFab({
  projectId,
  activeSession: activeSessionOverride,
  allowPermissionFallback = true,
  showPendingBadge = false,
  showSignalButton = true,
  containerClassName = "fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] right-4 z-40 flex flex-col items-end gap-3 pointer-events-none sm:bottom-6 sm:right-6",
  getPreferredLocation,
  onRecorded,
  onSignificantFind,
}: QuickFindFabProps) {
  const navigate = useNavigate();
  const [isCapturing, setIsCapturing] = React.useState(false);
  const [showSuccess, setShowSuccess] = React.useState(false);
  const [lastQuickId, setLastQuickId] = React.useState<string | null>(null);
  const [lastPermName, setLastPermName] = React.useState<string | null>(null);
  const [noGpsWarning, setNoGpsWarning] = React.useState(false);
  const [fabError, setFabError] = React.useState<string | null>(null);
  const [confirmSignificant, setConfirmSignificant] = React.useState(false);
  const [fabUsed, setFabUsed] = useDurableSetting('fs_fab_used', false);
  const [onboardingDone] = useDurableSetting('fs_onboarding_done', false);
  const fabIntroduced = fabUsed || onboardingDone;
  const [showSignalSheet, setShowSignalSheet] = React.useState(false);
  const [signalToast, setSignalToast] = React.useState<{ openCount: number } | null>(null);
  const signalToastTimerRef = React.useRef<number | null>(null);
  const successTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      if (successTimerRef.current !== null) window.clearTimeout(successTimerRef.current);
      if (signalToastTimerRef.current !== null) window.clearTimeout(signalToastTimerRef.current);
    };
  }, []);

  const liveActiveSession = useLiveQuery(
    () => db.sessions
      .where("projectId").equals(projectId)
      .filter(s => !s.isFinished)
      .sortBy("updatedAt")
      .then(arr => arr[arr.length - 1]),
    [projectId]
  );

  const pendingCount = useLiveQuery(
    () => {
      if (!showPendingBadge) return Promise.resolve(0);
      return db.finds
        .where("projectId").equals(projectId)
        .filter(f => !!f.isPending)
        .count();
    },
    [projectId, showPendingBadge]
  );

  const activeSession = activeSessionOverride === undefined ? liveActiveSession : activeSessionOverride;

  async function quickFind() {
    if (isCapturing) return;
    setIsCapturing(true);
    setFabError(null);
    setNoGpsWarning(false);

    try {
      if (navigator.vibrate) navigator.vibrate(50);

      if (!fabIntroduced) {
        setFabUsed(true);
      }

      const id = uuid();
      const now = new Date().toISOString();
      let lat: number | null = null;
      let lon: number | null = null;
      let acc: number | null = null;

      const preferredLocation = getPreferredLocation?.();
      if (
        preferredLocation &&
        Number.isFinite(preferredLocation.lat) &&
        Number.isFinite(preferredLocation.lon)
      ) {
        lat = preferredLocation.lat;
        lon = preferredLocation.lon;
        acc = preferredLocation.gpsAccuracyM ?? null;
        if (acc != null && acc > 50) setNoGpsWarning(true);
      } else {
        try {
          const fix = await captureGPS();
          lat = fix.lat;
          lon = fix.lon;
          acc = fix.accuracyM;
          if (acc != null && acc > 50) setNoGpsWarning(true);
        } catch {
          setNoGpsWarning(true);
        }
      }

      const sessionForFind = activeSession?.projectId === projectId ? activeSession : null;
      let targetPerm = sessionForFind?.permissionId
        ? await db.permissions.get(sessionForFind.permissionId)
        : undefined;
      if (targetPerm?.projectId !== projectId) targetPerm = undefined;

      if (!targetPerm && allowPermissionFallback) {
        targetPerm = await db.permissions
          .where("projectId").equals(projectId)
          .reverse()
          .sortBy("createdAt")
          .then(arr => arr.find(p => !p.isDefault) ?? arr[0]);
      }

      if (!targetPerm) {
        setFabError("No permission found. Please try again.");
        return;
      }

      await createQuickFind({
        id,
        projectId,
        permissionId: targetPerm.id,
        sessionId: sessionForFind ? sessionForFind.id : null,
        fieldId: sessionForFind ? sessionForFind.fieldId : null,
        findCode: `QUICK-${Date.now().toString().slice(-6)}`,
        objectType: "Pending Quick Find",
        lat,
        lon,
        gpsAccuracyM: acc,
        osGridRef: "",
        w3w: "",
        period: "Unknown",
        material: "Other",
        weightG: null,
        widthMm: null,
        heightMm: null,
        depthMm: null,
        decoration: "",
        completeness: "Complete",
        findContext: "",
        storageLocation: "",
        notes: "Quick recorded via FAB",
        isPending: true,
        createdAt: now,
        updatedAt: now,
      });

      setLastQuickId(id);
      setLastPermName(targetPerm.name || null);
      setConfirmSignificant(false);
      setShowSuccess(true);
      onRecorded?.(id);

      if (successTimerRef.current !== null) window.clearTimeout(successTimerRef.current);
      successTimerRef.current = window.setTimeout(() => setShowSuccess(false), 10000);
    } catch (err) {
      setFabError("Quick find failed. Please try again.");
      console.error("Quick find failed:", err);
    } finally {
      setIsCapturing(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.currentTarget.value = "";
    if (!file || !lastQuickId) return;

    try {
      const blob = await fileToBlob(file);
      const now = new Date().toISOString();
      await attachQuickFindPhoto({
        id: uuid(),
        projectId,
        findId: lastQuickId,
        type: "photo",
        photoType: "in-situ",
        filename: file.name,
        mime: file.type || "application/octet-stream",
        blob,
        caption: "Quick Capture",
        scalePresent: false,
        createdAt: now,
      });
      setShowSuccess(false);
      setConfirmSignificant(false);
      if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
    } catch (err) {
      setFabError("Failed to save photo: " + err);
    } finally {
      setLastQuickId(null);
    }
  }

  async function openQuickAsSignificant() {
    const pendingId = lastQuickId;
    const pendingFind = pendingId ? await db.finds.get(pendingId) : undefined;
    setShowSuccess(false);
    setConfirmSignificant(false);
    setLastQuickId(null);
    if (pendingId) {
      await discardFindDraft(pendingId);
    }
    onSignificantFind?.(pendingFind ? {
      permissionId: pendingFind.permissionId,
      sessionId: pendingFind.sessionId,
      lat: pendingFind.lat,
      lon: pendingFind.lon,
      gpsAccuracyM: pendingFind.gpsAccuracyM,
      osGridRef: pendingFind.osGridRef,
      w3w: pendingFind.w3w,
      findDescription: pendingFind.objectType === "Pending Quick Find" ? "" : pendingFind.objectType,
    } : undefined);
  }

  function handleSignalSaved(_signalId: string, openCount: number) {
    setShowSignalSheet(false);
    setSignalToast({ openCount });
    if (signalToastTimerRef.current !== null) window.clearTimeout(signalToastTimerRef.current);
    signalToastTimerRef.current = window.setTimeout(() => setSignalToast(null), 4000);
  }

  return (
    <>
    {showSignalSheet && (
      <UndugSignalSheet
        sessionId={activeSession?.id ?? null}
        permissionId={activeSession?.permissionId ?? null}
        onSaved={handleSignalSaved}
        onClose={() => setShowSignalSheet(false)}
      />
    )}
    <div className={containerClassName}>
      {signalToast && (
        <div className="pointer-events-auto bg-gray-950/95 backdrop-blur-md text-white px-3 py-2 rounded-2xl shadow-2xl flex items-center gap-2 border border-emerald-500/30 animate-in slide-in-from-right-4">
          <div className="w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center shrink-0 text-emerald-300">
            <SignalMarkerIcon className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs text-emerald-100">
            {signalToast.openCount > 0
              ? `Signal logged · ${signalToast.openCount} open on this permission`
              : 'Signal logged'}
          </span>
        </div>
      )}
      {fabError && (
        <div className="pointer-events-auto bg-red-900/95 backdrop-blur-md text-white p-3 rounded-2xl shadow-2xl flex items-center justify-between gap-3 border border-red-500/50 min-w-[200px]">
          <span className="text-xs">{fabError}</span>
          <button onClick={() => setFabError(null)} className="opacity-60 hover:opacity-100 text-xs shrink-0">✕</button>
        </div>
      )}
      {showSuccess && (
        <div className="pointer-events-auto bg-gray-900/95 backdrop-blur-md text-white p-3 rounded-2xl shadow-2xl flex flex-col gap-2 animate-in slide-in-from-right-4 border border-emerald-500/30 mb-2 w-52">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-[9px] font-black">✓</div>
              <span className="text-xs font-black uppercase tracking-widest text-emerald-400">Recorded</span>
            </div>
            <button onClick={() => { setShowSuccess(false); setConfirmSignificant(false); }} className="opacity-40 hover:opacity-100 text-xs leading-none">✕</button>
          </div>
          {lastPermName && (
            <div className="text-xs text-gray-300 truncate">→ {lastPermName}</div>
          )}
          {noGpsWarning && (
            <div className="text-xs text-amber-300 flex items-center gap-1 bg-amber-900/30 px-2 py-1 rounded-lg leading-tight">
              ⚠️ No GPS — edit to add location
            </div>
          )}
          <label className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest cursor-pointer active:scale-95 transition-all flex items-center justify-center gap-1.5">
            📸 Photo
            <input type="file" accept="image/*" capture="environment" onChange={handleFileChange} className="hidden" />
          </label>
          <div className="flex gap-1.5">
            <button
              onClick={() => { if (lastQuickId) { setShowSuccess(false); navigate(`/find?quickId=${lastQuickId}`); } }}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all"
            >
              Edit →
            </button>
            <button
              onClick={() => { setShowSuccess(false); setConfirmSignificant(false); }}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all"
            >
              Done
            </button>
          </div>
          {onSignificantFind && (
            confirmSignificant ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-2">
                <p className="text-2xs leading-snug text-amber-100">
                  Use this for suspected Treasure, in-situ groups, scatters, or an exceptional find that needs a fuller record.
                </p>
                <div className="mt-2 flex gap-1.5">
                  <button
                    type="button"
                    onClick={openQuickAsSignificant}
                    className="flex-1 rounded-lg bg-amber-500 px-2 py-2 text-[10px] font-black uppercase tracking-widest text-gray-950"
                  >
                    Start
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmSignificant(false)}
                    className="flex-1 rounded-lg bg-gray-800 px-2 py-2 text-[10px] font-black uppercase tracking-widest text-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmSignificant(true)}
                className="w-full text-xs text-amber-300 hover:text-amber-200 border border-amber-500/30 hover:border-amber-500/60 rounded-xl py-2 text-center transition-all font-semibold"
              >
                Mark as Significant
              </button>
            )
          )}
          <button
            onClick={async () => {
              if (!lastQuickId) return;
              await discardFindDraft(lastQuickId);
              setLastQuickId(null);
              setShowSuccess(false);
              setConfirmSignificant(false);
            }}
            className="text-xs text-red-300 hover:text-red-200 opacity-75 hover:opacity-100 text-center transition-all"
          >
            Undo
          </button>
        </div>
      )}

      {showSignalButton && (
        <button
          type="button"
          onClick={() => setShowSignalSheet(true)}
          className="pointer-events-auto w-9 h-9 rounded-full border-2 border-gray-400/40 bg-gray-900/70 text-emerald-300 hover:border-emerald-400/60 hover:text-emerald-200 flex items-center justify-center transition-all active:scale-95 backdrop-blur-sm shadow-md"
          aria-label="Log un-dug signal"
          title="Log un-dug signal"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="opacity-65">
            <path d="M4.2 4.2l5.6 5.6M9.8 4.2L4.2 9.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      )}

      <div className="flex gap-3 pointer-events-auto relative">
        {showPendingBadge && !!pendingCount && pendingCount > 0 && (
          <button
            onClick={() => navigate("/pending")}
            className="absolute -top-2 -right-2 z-10 bg-amber-500 text-white min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black flex items-center justify-center shadow-md border border-white/30 leading-none"
            aria-label={`${pendingCount} pending finds`}
          >
            {pendingCount}
          </button>
        )}
        <button
          onClick={quickFind}
          disabled={isCapturing}
          className={`bg-gradient-to-br ${isCapturing ? "from-gray-400 to-gray-600 animate-pulse" : "from-emerald-500 to-emerald-700"} text-white shadow-lg hover:shadow-emerald-500/30 active:scale-95 transition-all flex items-center justify-center relative border border-white/20
            ${fabIntroduced ? "w-12 h-12 rounded-full" : "rounded-full px-4 h-12"}`}
          aria-label="Record Find"
        >
          {isCapturing ? (
            <svg className="animate-spin h-5 w-5 text-white shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : fabIntroduced ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          ) : (
            <span className="text-xs sm:text-sm font-medium whitespace-nowrap">Add Find</span>
          )}
        </button>
      </div>
    </div>
    </>
  );
}

export default QuickFindFab;
