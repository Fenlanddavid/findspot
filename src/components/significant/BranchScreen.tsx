import React from "react";
import { WorkflowPath, WorkflowState } from "../../types/significantFind";
import OrganiserInstructionCard from "./OrganiserInstructionCard";

type Props = {
  workflowState: WorkflowState;
  onSelect: (path: WorkflowPath) => void;
};

const paths: {
  path: WorkflowPath;
  dot: string;
  dotClass: string;
  title: string;
  subtitle: string;
  hint: string;
  borderClass: string;
  bgClass: string;
  primary?: boolean;
}[] = [
  {
    path: "stop_secure",
    dot: "🔴",
    dotClass: "bg-red-500/20 border border-red-500/40",
    title: "Stop & Secure",
    subtitle: "Something may still be in the ground",
    hint: "Objects close together, possibly in original context, or you think there may be more below. Stop digging, protect the spot, then record it.",
    borderClass: "border-red-500/30 hover:border-red-500/60",
    bgClass: "hover:bg-red-500/5",
    primary: true,
  },
  {
    path: "map_scatter",
    dot: "🟡",
    dotClass: "bg-amber-500/20 border border-amber-500/40",
    title: "Map Scatter",
    subtitle: "Objects spread across an area",
    hint: "Spread 10m+ apart, with nothing apparently in original context. Log each point before the pattern is lost.",
    borderClass: "border-amber-500/30 hover:border-amber-500/60",
    bgClass: "hover:bg-amber-500/5",
  },
  {
    path: "notable_find",
    dot: "🟢",
    dotClass: "bg-emerald-500/20 border border-emerald-500/40",
    title: "Notable Find",
    subtitle: "One exceptional single object",
    hint: "Already recovered single object needing fuller photos, exact context, and a clear follow-up trail.",
    borderClass: "border-emerald-500/30 hover:border-emerald-500/60",
    bgClass: "hover:bg-emerald-500/5",
  },
];

function formatLocation(state: WorkflowState) {
  if (state.osGridRef) return state.osGridRef;
  if (state.lat != null && state.lon != null) return `${state.lat.toFixed(5)}, ${state.lon.toFixed(5)}`;
  return "Location will be captured in the next steps";
}

function formatPermission(state: WorkflowState) {
  if (!state.permissionName) return "Current permission will be selected automatically";
  const type = state.isClubDayMember
    ? "Club/rally"
    : state.permissionType === "rally"
    ? "Rally"
    : "Permission";
  return `${type}: ${state.permissionName}`;
}

export default function BranchScreen({ workflowState, onSelect }: Props) {
  return (
    <div className="flex flex-col gap-4 max-w-xl mx-auto">
      <div className="text-center">
        <p className="text-lg font-black text-gray-900 dark:text-gray-100 mb-1.5 leading-tight">
          What are you looking at?
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed max-w-md mx-auto">
          If anything may still be in place, choose Stop &amp; Secure. You can downgrade later.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Field context</p>
        <div className="grid gap-1.5 text-xs text-gray-600 dark:text-gray-300">
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold text-gray-500 dark:text-gray-400">Permission</span>
            <span className="text-right font-bold text-gray-900 dark:text-gray-100">{formatPermission(workflowState)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold text-gray-500 dark:text-gray-400">Location</span>
            <span className="text-right font-mono text-gray-900 dark:text-gray-100">{formatLocation(workflowState)}</span>
          </div>
        </div>
      </div>

      <OrganiserInstructionCard workflowState={workflowState} />

      <div className="flex flex-col gap-3">
        {paths.map(({ path, dot, dotClass, title, subtitle, hint, borderClass, bgClass, primary }) => (
          <button
            key={path}
            onClick={() => onSelect(path)}
            className={`text-left w-full rounded-2xl border transition-all duration-150 active:scale-[0.98] ${primary ? "p-4 shadow-sm" : "p-3"} ${borderClass} ${bgClass} dark:border-opacity-60`}
          >
            <div className="flex items-start gap-3">
              <div className={`shrink-0 rounded-full flex items-center justify-center text-lg ${primary ? "w-10 h-10" : "w-9 h-9"} ${dotClass}`}>
                {dot}
              </div>
              <div className="min-w-0">
                <div className={`${primary ? "text-base" : "text-sm"} font-black text-gray-900 dark:text-gray-100`}>{title}</div>
                <div className="text-sm font-semibold text-gray-600 dark:text-gray-400 mt-0.5">{subtitle}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-1.5 leading-relaxed">{hint}</div>
              </div>
              <div className="shrink-0 self-center text-gray-400 dark:text-gray-600 ml-auto">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="text-center">
        <button
          onClick={() => onSelect("stop_secure")}
          className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 underline underline-offset-2 transition-colors"
        >
          Not sure — treat it as in situ (safest option)
        </button>
      </div>
    </div>
  );
}
