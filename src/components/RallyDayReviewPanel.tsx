import React from "react";
import { RallyDayReview, RallyReviewConfidence } from "../engines/session/rallyDayReviewEngine";

function confidenceClass(confidence: RallyReviewConfidence) {
  if (confidence === "strong") return "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800";
  if (confidence === "developing") return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800";
  return "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700";
}

function formatMeters(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(1)} km`;
  return `${Math.round(value)} m`;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function RallyDayReviewPanel({
  review,
  compact = false,
}: {
  review: RallyDayReview | null | undefined;
  compact?: boolean;
}) {
  if (!review) return null;

  const topZones = compact ? review.zones.slice(0, 2) : review.zones;
  const topLinear = compact ? review.linearPatterns.slice(0, 1) : review.linearPatterns;
  const statClass = "rounded-lg bg-white/70 dark:bg-gray-950/20 border border-teal-100 dark:border-teal-900/50 px-3 py-2";

  return (
    <section className="rounded-xl border border-teal-200 dark:border-teal-900/70 bg-teal-50/70 dark:bg-teal-950/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-teal-600 dark:text-teal-400">What did today reveal?</p>
          <h3 className="text-base font-black text-gray-900 dark:text-gray-100 mt-0.5">{review.title}</h3>
        </div>
        <span className="shrink-0 rounded-full border border-teal-200 dark:border-teal-800 bg-white/70 dark:bg-gray-950/30 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-teal-700 dark:text-teal-300">
          {review.status === "ready" ? "Live" : "Waiting"}
        </span>
      </div>

      <p className="mt-2 text-xs sm:text-sm font-medium leading-relaxed text-gray-600 dark:text-gray-300">
        {review.summary}
      </p>

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className={statClass}>
          <div className="text-lg font-black text-teal-700 dark:text-teal-300 leading-none">{review.totalFinds}</div>
          <div className="mt-1 text-[8px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Finds</div>
        </div>
        <div className={statClass}>
          <div className="text-lg font-black text-teal-700 dark:text-teal-300 leading-none">{review.geolocatedFinds}</div>
          <div className="mt-1 text-[8px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Mapped</div>
        </div>
        <div className={statClass}>
          <div className="text-lg font-black text-teal-700 dark:text-teal-300 leading-none">{review.recorderCount}</div>
          <div className="mt-1 text-[8px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Recorders</div>
        </div>
        <div className={statClass}>
          <div className="text-lg font-black text-teal-700 dark:text-teal-300 leading-none">{review.zones.length}</div>
          <div className="mt-1 text-[8px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Zones</div>
        </div>
      </div>

      {(topZones.length > 0 || topLinear.length > 0) && (
        <div className="mt-4 space-y-2">
          {topZones.map(zone => (
            <div key={zone.id} className="rounded-lg border border-white/70 dark:border-white/10 bg-white/80 dark:bg-gray-950/30 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-sm font-black text-gray-900 dark:text-gray-100 leading-tight">{zone.label}</p>
                    <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest ${confidenceClass(zone.confidence)}`}>
                      {zone.confidence}
                    </span>
                  </div>
                  {zone.fieldName && (
                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">{zone.fieldName}</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-black text-teal-700 dark:text-teal-300">{zone.findCount}</div>
                  <div className="text-[8px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Finds</div>
                </div>
              </div>
              <p className="mt-2 text-xs font-medium leading-relaxed text-gray-600 dark:text-gray-300">{zone.summary}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-1 text-[9px] font-bold text-gray-600 dark:text-gray-300">
                  {zone.recorderCount} recorder{zone.recorderCount === 1 ? "" : "s"}
                </span>
                <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-1 text-[9px] font-bold text-gray-600 dark:text-gray-300">
                  radius {formatMeters(zone.radiusM)}
                </span>
                {zone.topPeriod && (
                  <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-1 text-[9px] font-bold text-gray-600 dark:text-gray-300">
                    {zone.topPeriod.value} {formatPercent(zone.topPeriod.share)}
                  </span>
                )}
                {zone.topMaterial && (
                  <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-1 text-[9px] font-bold text-gray-600 dark:text-gray-300">
                    {zone.topMaterial.value} {formatPercent(zone.topMaterial.share)}
                  </span>
                )}
              </div>
              {zone.caveat && (
                <p className="mt-2 text-[10px] font-medium leading-relaxed text-amber-700 dark:text-amber-300">{zone.caveat}</p>
              )}
            </div>
          ))}

          {topLinear.map(pattern => (
            <div key={pattern.id} className="rounded-lg border border-white/70 dark:border-white/10 bg-white/80 dark:bg-gray-950/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-gray-900 dark:text-gray-100">{pattern.label}</p>
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-300 mt-1">{pattern.summary}</p>
                </div>
                <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest ${confidenceClass(pattern.confidence)}`}>
                  {pattern.confidence}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-1 text-[9px] font-bold text-gray-600 dark:text-gray-300">
                  {formatMeters(pattern.lengthM)}
                </span>
                <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-1 text-[9px] font-bold text-gray-600 dark:text-gray-300">
                  bearing {Math.round(pattern.bearingDeg)} deg
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {!compact && review.quietAreas.length > 0 && (
        <div className="mt-4">
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2">Quiet searched fields</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {review.quietAreas.map(area => (
              <div key={area.fieldId} className="rounded-lg bg-white/70 dark:bg-gray-950/20 border border-white/70 dark:border-white/10 p-3">
                <p className="text-xs font-black text-gray-800 dark:text-gray-100">{area.fieldName}</p>
                <p className="mt-1 text-[10px] font-medium leading-relaxed text-gray-500 dark:text-gray-400">{area.summary}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!compact && review.fieldSummaries.length > 0 && (
        <div className="mt-4">
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2">Field signal</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {review.fieldSummaries.slice(0, 4).map(field => (
              <div key={field.fieldId ?? "unassigned"} className="flex items-center justify-between gap-3 rounded-lg bg-white/70 dark:bg-gray-950/20 border border-white/70 dark:border-white/10 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-black text-gray-800 dark:text-gray-100">{field.fieldName}</p>
                  {field.topPeriod && (
                    <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400">{field.topPeriod.value} leads</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-black text-teal-700 dark:text-teal-300">{field.findCount}</p>
                  <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Finds</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!compact && review.caveats.length > 0 && (
        <div className="mt-4 space-y-1">
          {review.caveats.map(caveat => (
            <p key={caveat} className="text-[10px] font-medium leading-relaxed text-gray-500 dark:text-gray-400">{caveat}</p>
          ))}
        </div>
      )}
    </section>
  );
}
