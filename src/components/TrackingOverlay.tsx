import React, { useState, useEffect } from "react";
import QuickFindFab, { QuickFindLocation } from "./QuickFindFab";
import { getTrackingStatus, type TrackingStatus, isWakeLockSupported } from "../services/tracking";

interface TrackingOverlayProps {
  isVisible: boolean;
  onClose: () => void;
  projectId: string;
  sessionContext: {
    id: string;
    projectId: string;
    permissionId: string;
    fieldId: string | null;
  } | null;
  stats: {
    durationText: string;
    findsCount: number;
    distanceText: string | null;
    coveragePercent: number | null;
    hasBoundary: boolean;
  };
  getPreferredLocation?: () => QuickFindLocation | null;
}

function SoftStat({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.035] px-3 py-2">
      <div className={`truncate text-sm font-black leading-none ${muted ? "text-white/60" : "text-white/80"}`}>{value}</div>
      <div className="mt-1 truncate text-2xs font-black uppercase tracking-widest text-white/60">{label}</div>
    </div>
  );
}

type ChipState = {
  color: "green" | "amber" | "red";
  label: string;
  pulse: boolean;
};

function getChipState(status: TrackingStatus): ChipState {
  const now = Date.now();
  const acceptedAge = status.lastAcceptedFixAt ? now - status.lastAcceptedFixAt : null;
  const fixAge = status.lastFixAt ? now - status.lastFixAt : null;

  // RED: explicit watch error
  if (status.watchError) {
    return { color: "red", label: "GPS ERROR", pulse: false };
  }

  // RED: no accepted fix and raw fixes gone >120s (or never arrived)
  if (acceptedAge === null && (fixAge === null || fixAge > 120_000)) {
    return { color: "red", label: `GPS LOST${fixAge !== null ? ` \u00b7 ${Math.round(fixAge / 1000)}s` : ""}`, pulse: false };
  }

  // AMBER: raw fixes arriving but no accepted fix yet (accuracy consistently poor)
  if (acceptedAge === null && fixAge !== null && fixAge <= 10_000) {
    return { color: "amber", label: "GPS POOR ACCURACY", pulse: false };
  }

  // AMBER: raw fix fresh but accepted fix stale — accuracy degraded (hedge line, tree cover)
  if (acceptedAge !== null && acceptedAge > 10_000 && fixAge !== null && fixAge <= 10_000) {
    return { color: "amber", label: "GPS POOR ACCURACY", pulse: false };
  }

  // RED: accepted fix gone >120s (and raw fixes not fresh — otherwise caught above)
  if (acceptedAge !== null && acceptedAge > 120_000) {
    return { color: "red", label: `GPS LOST \u00b7 ${Math.round(acceptedAge / 1000)}s`, pulse: false };
  }

  // AMBER: accepted fix stale >10s but <=120s
  if (acceptedAge !== null && acceptedAge > 10_000 && acceptedAge <= 120_000) {
    return { color: "amber", label: `GPS STALE \u00b7 ${Math.round(acceptedAge / 1000)}s`, pulse: false };
  }

  // GREEN: accepted fix within 10s
  return { color: "green", label: "GPS LIVE", pulse: true };
}

const chipColors = {
  green: "text-emerald-400",
  amber: "text-amber-400",
  red: "text-red-400",
} as const;

const dotColors = {
  green: "bg-emerald-400",
  amber: "bg-amber-400",
  red: "bg-red-400",
} as const;

export function TrackingOverlay({
  isVisible,
  onClose,
  projectId,
  sessionContext,
  stats,
  getPreferredLocation,
}: TrackingOverlayProps) {
  const [status, setStatus] = useState<TrackingStatus>(getTrackingStatus());

  useEffect(() => {
    if (!isVisible) return;
    const id = window.setInterval(() => setStatus(getTrackingStatus()), 2000);
    return () => window.clearInterval(id);
  }, [isVisible]);

  if (!isVisible) return null;

  const chip = getChipState(status);
  const wakeLockSupported = isWakeLockSupported();

  return (
    <div className="fixed inset-0 bg-black text-white z-[9999] flex flex-col items-center justify-center p-8 text-center select-none overflow-hidden">
      <div className="absolute top-5 left-4 right-4 z-10 flex justify-center pointer-events-none">
        <div className="grid w-full max-w-md grid-cols-2 gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-2 shadow-2xl shadow-black/30 backdrop-blur-sm min-[420px]:grid-cols-4">
          <SoftStat label="Time" value={stats.durationText} />
          <SoftStat label="Finds" value={String(stats.findsCount)} />
          <SoftStat
            label="Covered"
            value={stats.coveragePercent !== null ? `${Math.round(stats.coveragePercent)}%` : "--"}
            muted={!stats.hasBoundary}
          />
          <SoftStat label="Walked" value={stats.distanceText ?? "--"} />
        </div>
      </div>

      {/* GPS liveness chip */}
      <div className="absolute left-6 right-6 top-[9.75rem] flex flex-col items-center gap-1 min-[420px]:top-[6.25rem]">
        <div className={`flex items-center gap-1.5 ${chipColors[chip.color]}`}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColors[chip.color]} ${chip.pulse ? "animate-pulse" : ""}`} />
          <span className="text-2xs font-black uppercase tracking-widest">{chip.label}</span>
        </div>

        {/* Wake-lock line */}
        {wakeLockSupported && !status.wakeLockHeld && (
          <p className="text-2xs font-bold leading-snug text-amber-300 tracking-widest">
            SCREEN LOCK PROTECTION OFF — KEEP SCREEN ON
          </p>
        )}
        {!wakeLockSupported && (
          <p className="text-2xs font-bold leading-snug text-amber-300 tracking-widest">
            Keep the screen on and FindSpot open — GPS stops if the phone locks.
          </p>
        )}

        {/* Gap count */}
        {status.gapCount > 0 && (
          <p className="text-3xs font-medium text-white/40 tracking-widest uppercase">
            {status.gapCount} tracking gap{status.gapCount !== 1 ? "s" : ""} this session
          </p>
        )}
      </div>

      <div className="max-w-xs text-gray-400">
        <div className="w-12 h-12 bg-gray-900 rounded-full flex items-center justify-center mx-auto mb-4 border border-gray-800">
          <span className="text-xl grayscale opacity-50">👣</span>
        </div>
        <h2 className="text-lg font-bold mb-2 uppercase tracking-widest text-gray-400">Tracking Active</h2>
        <p className="text-2xs mb-8 font-medium">
          {wakeLockSupported && status.wakeLockHeld
            ? "Screen will stay awake for high-precision GPS tracking."
            : wakeLockSupported
              ? "Screen lock protection could not be acquired."
              : "Keep the screen on and FindSpot open — GPS stops if the phone locks."}
        </p>
      </div>

      <button
        onClick={onClose}
        type="button"
        className="mt-2 px-4 py-2 bg-gray-900 text-gray-500 border border-gray-800 rounded-lg font-bold text-2xs uppercase tracking-widest active:bg-gray-800 transition-colors"
      >
        Return to FindSpot
      </button>

      {sessionContext && (
        <QuickFindFab
          projectId={projectId}
          activeSession={sessionContext}
          allowPermissionFallback={false}
          getPreferredLocation={getPreferredLocation}
          containerClassName="absolute bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-4 z-20 flex flex-col items-end gap-3 pointer-events-none sm:right-6"
        />
      )}

      <div className="absolute bottom-6 left-6 opacity-10 text-left text-3xs font-black uppercase tracking-[0.3em]">
        Low Distraction Mode
      </div>
    </div>
  );
}
