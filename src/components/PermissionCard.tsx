import type { EnrichedPermission } from "../services/permissions";
import { rallyPersona } from "../utils/rallyPersona";
import { RallyPersonaChip } from "./RallyPersonaChip";
import { StaticMapPreview } from "./StaticMapPreview";

type PermissionCardProps = {
  permission: EnrichedPermission;
  onOpen: () => void;
  onAddFind?: () => void;
  onOpenFieldGuide?: () => void;
  onTogglePin: () => void | Promise<unknown>;
};

export function PermissionCard({ permission, onOpen, onAddFind, onOpenFieldGuide, onTogglePin }: PermissionCardProps) {
  const isRally = permission.type === "rally";
  const persona = isRally ? rallyPersona(permission) : "not_rally";
  const dateLabel = isRally && permission.validFrom
    ? new Date(permission.validFrom).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : permission.createdAt
      ? new Date(permission.createdAt).toLocaleDateString("en-GB")
      : "";

  return (
    <article
      className="group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-all duration-200 ease-out hover:-translate-y-[1px] hover:border-gray-300 hover:shadow-lg dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
      onClick={onOpen}
    >
      {isRally && !permission.submittedAt && persona !== "not_rally" && (
        <div className="absolute right-0 top-0 z-10 overflow-hidden rounded-bl">
          <RallyPersonaChip persona={persona} />
        </div>
      )}
      {permission.submittedAt && (
        <div className="absolute right-0 top-0 z-10 rounded-bl bg-emerald-500 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-white">
          Data sent ✓
        </div>
      )}
      {permission.isDefault && (
        <div className="absolute right-0 top-0 z-10 rounded-bl bg-gray-400 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-white dark:bg-gray-600">
          General
        </div>
      )}

      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-black leading-tight">
            <button
              type="button"
              className="max-w-full truncate text-left text-gray-900 transition-colors group-hover:text-emerald-600 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-white dark:group-hover:text-emerald-400"
              title={permission.name || "Unnamed permission"}
              onClick={(event) => { event.stopPropagation(); onOpen(); }}
            >
              {permission.name || "(Unnamed)"}
            </button>
          </h3>
          <div className="mt-0.5 font-mono text-[10px] opacity-40">{dateLabel}</div>
        </div>
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-amber-200/50 bg-transparent px-1.5 py-0.5 text-xs font-semibold text-amber-500 dark:border-amber-700/50 dark:text-amber-400">
          {permission.findCount} <span className="opacity-50">{permission.findCount === 1 ? "find" : "finds"}</span>
        </span>
      </div>

      <div className="relative -mx-4 mb-4 aspect-video overflow-hidden rounded-lg">
        <StaticMapPreview
          lat={permission.lat}
          lon={permission.lon}
          boundary={permission.boundary || permission.fields?.[0]?.boundary}
          tracks={permission.tracks}
          className="h-full w-full rounded-none"
        />
        {!isRally && permission.cumulativePercent !== null && (
          <div className="absolute bottom-2 left-2">
            <div className="flex flex-col items-center rounded-lg border border-white/20 bg-black/50 px-2 py-1 shadow-md backdrop-blur-md">
              <span className="mb-0.5 text-[8px] font-black uppercase leading-none text-white/60">Undetected</span>
              <span className={`text-[10px] font-black leading-none ${permission.cumulativePercent < 90 ? "text-orange-400" : "text-emerald-400"}`}>
                {Math.round(100 - permission.cumulativePercent)}%
              </span>
            </div>
          </div>
        )}
        <div className="absolute bottom-2 right-2 rounded border border-white/20 bg-black/50 px-1.5 py-0.5 font-mono text-[8px] text-white/60 backdrop-blur-sm">
          {permission.lat != null && permission.lon != null
            ? `${permission.lat.toFixed(3)}, ${permission.lon.toFixed(3)}`
            : "No GPS"}
        </div>
      </div>

      <div className="mb-4 grid flex-1 gap-2">
        {permission.activeQuestionCount > 0 && (
          <div className="text-2xs font-semibold text-sky-600 dark:text-sky-400">
            {permission.activeQuestionCount} active {permission.activeQuestionCount === 1 ? "question" : "questions"}
          </div>
        )}
        {permission.openSignalCount > 0 && (
          <div className="flex items-center gap-1.5 text-2xs font-semibold text-sky-500 dark:text-sky-400">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="12" r="1.5" fill="currentColor" />
              <path d="M4.5 8.5 A5 5 0 0 1 11.5 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M1.5 5.5 A9 9 0 0 1 14.5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            {permission.openSignalCount} {permission.openSignalCount === 1 ? "signal" : "signals"} to revisit
          </div>
        )}
        {permission.landownerName && (
          <div className="text-xs font-bold italic text-gray-600 dark:text-gray-400">{permission.landownerName}</div>
        )}
        {!isRally && (
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
              {permission.fields?.length || 0} {permission.fields?.length === 1 ? "Field" : "Fields"}
            </div>
            <div className="flex flex-col items-end gap-1">
              {permission.totalAcres !== null && (
                <div className="text-xs font-bold text-emerald-700/70 dark:text-emerald-400/80">{permission.totalAcres.toFixed(1)} acres</div>
              )}
              {permission.landType && <div className="text-xs font-medium uppercase tracking-tighter opacity-70">{permission.landType}</div>}
            </div>
          </div>
        )}
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-gray-200 pt-3 dark:border-gray-700">
        {onAddFind && !isRally && (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onAddFind(); }}
            className="flex-1 rounded-lg bg-emerald-600/90 py-1.5 text-xs font-black uppercase tracking-wider text-white shadow-sm transition-all duration-200 ease-out hover:bg-emerald-500 dark:bg-emerald-700/90 dark:hover:bg-emerald-600"
          >
            Add find
          </button>
        )}
        {onOpenFieldGuide && (
          <button
            type="button"
            title="Open in FieldGuide"
            onClick={(event) => { event.stopPropagation(); onOpenFieldGuide(); }}
            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-bold uppercase text-gray-600 transition-all duration-200 ease-out hover:text-emerald-600 dark:border-gray-700 dark:bg-gray-700/50 dark:text-gray-300 dark:hover:text-emerald-400"
          >
            FieldGuide
          </button>
        )}
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); void onTogglePin(); }}
          title={permission.isPinned ? "Unpin" : "Pin to top"}
          className={`rounded-lg border px-2 py-1.5 text-[13px] transition-all duration-200 ease-out ${permission.isPinned ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/30" : "border-gray-200 bg-gray-50 opacity-40 hover:opacity-100 dark:border-gray-700 dark:bg-gray-700/50"}`}
        >
          {permission.isPinned ? "Pinned" : "Pin"}
        </button>
      </div>
    </article>
  );
}
