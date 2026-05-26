import React from "react";
import { WorkflowPath } from "../../types/significantFind";

type Props = {
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
}[] = [
  {
    path: "stop_secure",
    dot: "🔴",
    dotClass: "bg-red-500/20 border border-red-500/40",
    title: "Secure Find",
    subtitle: "Something may still be in the ground",
    hint: "Objects close together, possibly in original context, or you think there's more below. Stop and record before any further disturbance.",
    borderClass: "border-red-500/30 hover:border-red-500/60",
    bgClass: "hover:bg-red-500/5",
  },
  {
    path: "map_scatter",
    dot: "🟡",
    dotClass: "bg-amber-500/20 border border-amber-500/40",
    title: "Map Scatter",
    subtitle: "Objects spread across an area",
    hint: "Finds are 10 metres or more apart. Likely moved by ploughing over time. Nothing appears to be in its original context.",
    borderClass: "border-amber-500/30 hover:border-amber-500/60",
    bgClass: "hover:bg-amber-500/5",
  },
  {
    path: "notable_find",
    dot: "🟢",
    dotClass: "bg-emerald-500/20 border border-emerald-500/40",
    title: "Notable Find",
    subtitle: "One exceptional single object",
    hint: "A single find that deserves a thorough record — enhanced photos, full context, and a route to your FLO.",
    borderClass: "border-emerald-500/30 hover:border-emerald-500/60",
    bgClass: "hover:bg-emerald-500/5",
  },
];

export default function BranchScreen({ onSelect }: Props) {
  return (
    <div className="flex flex-col gap-6 max-w-xl mx-auto">
      <div className="text-center">
        <p className="text-base font-black text-gray-900 dark:text-gray-100 mb-2">
          Let's make sure this find is recorded properly.
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
          Whatever you've found, the next few minutes matter more than the next few hours. Choose the option that fits.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {paths.map(({ path, dot, dotClass, title, subtitle, hint, borderClass, bgClass }) => (
          <button
            key={path}
            onClick={() => onSelect(path)}
            className={`text-left w-full rounded-2xl border p-4 transition-all duration-150 active:scale-[0.98] ${borderClass} ${bgClass} dark:border-opacity-60`}
          >
            <div className="flex items-start gap-3">
              <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg ${dotClass}`}>
                {dot}
              </div>
              <div className="min-w-0">
                <div className="font-black text-base text-gray-900 dark:text-gray-100">{title}</div>
                <div className="text-sm font-semibold text-gray-600 dark:text-gray-400 mt-0.5">{subtitle}</div>
                <div className="text-xs text-gray-500 dark:text-gray-500 mt-1.5 leading-relaxed">{hint}</div>
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
