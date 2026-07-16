import React, { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { computeScanAccuracy } from "../services/fieldguide/scanAccuracy";

function pct(value: number | null): string {
  if (value === null) return "--";
  return `${Math.round(value * 100)}%`;
}

function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-sm font-bold text-gray-800 dark:text-gray-200 tabular-nums">
        {value}
        {sub && <span className="ml-1 text-3xs font-normal text-gray-400 dark:text-gray-500">{sub}</span>}
      </span>
    </div>
  );
}

function MiniBar({ fraction, color }: { fraction: number | null; color: string }) {
  if (fraction === null) return null;
  const widthPct = Math.max(2, Math.round(fraction * 100));
  return (
    <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden mt-1">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${widthPct}%` }} />
    </div>
  );
}

export function ScanAccuracyCard({ permissionId }: { permissionId: string }) {
  const hotspotSignals = useLiveQuery(
    () => db.findHotspotSignals.where("permissionId").equals(permissionId).toArray(),
    [permissionId],
  );

  const undugSignals = useLiveQuery(
    () => db.undugSignals.where("permissionId").equals(permissionId).toArray(),
    [permissionId],
  );

  const gpsFindIds = useLiveQuery(
    () => db.finds.where("permissionId").equals(permissionId).toArray()
      .then(finds => finds.filter(f => f.lat != null && f.lon != null).map(f => f.id)),
    [permissionId],
  );

  const result = useMemo(() => {
    if (!hotspotSignals || !undugSignals || gpsFindIds === undefined) return null;
    return computeScanAccuracy({ hotspotSignals, undugSignals, gpsFindIds });
  }, [hotspotSignals, undugSignals, gpsFindIds]);

  // Don't render if no data at all (no hotspot signals AND no undug signals AND no finds)
  if (!result) return null;
  if (result.totalFindsWithGps === 0 && result.undugTotal === 0 && result.corroboratedCells === 0) return null;

  const calibrationLabel = result.calibrationReliable
    ? result.calibrationFactor > 1.02 ? "Under-predicted" : result.calibrationFactor < 0.98 ? "Over-predicted" : "Well calibrated"
    : "Gathering data";

  const calibrationColor = result.calibrationReliable
    ? result.calibrationFactor > 1.02 ? "text-blue-500" : result.calibrationFactor < 0.98 ? "text-amber-500" : "text-emerald-500"
    : "text-gray-400 dark:text-gray-500";

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 sm:p-6 shadow-sm">
      <div className="text-3xs font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1">
        Scan Accuracy
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        How FieldGuide predictions compared against your actual finds on this permission.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
        {/* Spatial hit rate */}
        <div>
          <div className="text-3xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-0.5">
            Hotspot Accuracy
          </div>
          <StatRow
            label="Finds in predicted hotspots"
            value={result.spatialHitRate === null ? "--" : String(result.findsInHotspots)}
            sub={`of ${result.totalFindsWithGps}`}
          />
          <StatRow label="Hit rate" value={pct(result.spatialHitRate)} />
          <StatRow label="Cells corroborated" value={String(result.corroboratedCells)} />
          <MiniBar
            fraction={result.spatialHitRate}
            color={result.spatialHitRate !== null && result.spatialHitRate >= 0.4 ? "bg-emerald-500" : "bg-amber-400"}
          />
        </div>

        {/* Undug signals */}
        {result.undugTotal > 0 && (
          <div>
            <div className="text-3xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-0.5">
              Signal Discipline
            </div>
            <StatRow label="Signals logged" value={String(result.undugTotal)} />
            <StatRow label="Resolved" value={String(result.undugResolved)} sub={result.undugOpen > 0 ? `${result.undugOpen} open` : undefined} />
            <StatRow label="Conversion rate" value={pct(result.undugConversionRate)} sub="dug & found" />
            <MiniBar
              fraction={result.undugConversionRate}
              color={result.undugConversionRate !== null && result.undugConversionRate >= 0.3 ? "bg-emerald-500" : "bg-amber-400"}
            />
          </div>
        )}
      </div>

      {/* Calibration summary */}
      <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700/50 flex items-center justify-between">
        <span className="text-3xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">Engine Calibration</span>
        <span className={`text-xs font-bold ${calibrationColor}`}>
          {calibrationLabel}
          {result.calibrationReliable && (
            <span className="ml-1 font-normal text-gray-400 dark:text-gray-500">
              ({result.calibrationFactor > 1 ? "+" : ""}{Math.round((result.calibrationFactor - 1) * 100)}%)
            </span>
          )}
        </span>
      </div>
      {!result.calibrationReliable && (
        <p className="text-3xs text-gray-400 dark:text-gray-500 mt-1">
          At least {5} GPS-located finds and {2} corroborated hotspot cells needed for calibration.
        </p>
      )}
    </div>
  );
}
