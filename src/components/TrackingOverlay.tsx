import React from "react";
import QuickFindFab, { QuickFindLocation } from "./QuickFindFab";

interface TrackingOverlayProps {
  isVisible: boolean;
  onClose: () => void;
  wakeLockSupported: boolean;
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
      <div className={`truncate text-sm font-black leading-none ${muted ? "text-white/25" : "text-white/72"}`}>{value}</div>
      <div className="mt-1 truncate text-[8px] font-black uppercase tracking-widest text-white/20">{label}</div>
    </div>
  );
}

export function TrackingOverlay({
  isVisible,
  onClose,
  wakeLockSupported,
  projectId,
  sessionContext,
  stats,
  getPreferredLocation,
}: TrackingOverlayProps) {
  if (!isVisible) return null;

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

      <p className="absolute top-[8.75rem] text-[10px] font-bold text-amber-400/70 tracking-widest min-[420px]:top-[5.75rem]">
        ⚠️ Keep your screen on — locking it will stop GPS recording
      </p>

      <div className="max-w-xs opacity-40">
        <div className="w-12 h-12 bg-gray-900 rounded-full flex items-center justify-center mx-auto mb-4 border border-gray-800">
          <span className="text-xl grayscale opacity-50">👣</span>
        </div>
        <h2 className="text-lg font-bold mb-2 uppercase tracking-widest text-gray-400">Tracking Active</h2>
        <p className="text-[10px] opacity-40 mb-8 font-medium">
          {wakeLockSupported
            ? "Screen will stay awake for high-precision GPS tracking."
            : "GPS is recording your trail in the background."}
        </p>
      </div>

      <button
        onClick={onClose}
        type="button"
        className="mt-2 px-4 py-2 bg-gray-900 text-gray-500 border border-gray-800 rounded-lg font-bold text-[10px] uppercase tracking-widest active:bg-gray-800 transition-colors"
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

      <div className="absolute bottom-6 left-6 opacity-10 text-left text-[8px] font-black uppercase tracking-[0.3em]">
        Low Distraction Mode
      </div>
    </div>
  );
}
