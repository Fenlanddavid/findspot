import React from "react";
import { Find, Media } from "../db";
import { ScaledImage } from "./ScaledImage";

const PERIOD_COLORS: Record<string, string> = {
  "Prehistoric": "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  "Bronze Age": "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400",
  "Iron Age": "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  "Celtic": "bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400",
  "Roman": "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
  "Anglo-Saxon": "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  "Early Medieval": "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  "Medieval": "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  "Post-medieval": "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400",
  "Modern": "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",
  "Unknown": "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

export function FindRow(props: { 
  find: Find; 
  thumbMedia?: Media | null;
  onOpen: () => void 
}) {
  const s = props.find;
  const colorClass = PERIOD_COLORS[s.period] || PERIOD_COLORS["Unknown"];

  const timeStr = (() => {
    const raw = s.foundAt ?? s.createdAt;
    if (!raw) return null;
    try {
      return new Date(raw).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return null;
    }
  })();

  return (
    <button
      onClick={props.onOpen}
      className={`w-full text-left flex gap-2.5 items-center border rounded-xl p-2 bg-transparent hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors group ${s.isPending ? 'border-amber-300 dark:border-amber-700 border-2' : 'border-gray-100 dark:border-gray-800'}`}
    >
      <div className="shrink-0">
        {props.thumbMedia ? (
          <ScaledImage
            media={props.thumbMedia}
            className="w-11 h-11 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700"
            imgClassName="object-cover"
          />
        ) : (
          <div className="w-11 h-11 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 grid place-items-center bg-gray-50 dark:bg-gray-800/60">
            {s.isPending
              ? <span className="text-[8px] font-black text-amber-500 leading-tight text-center px-0.5">📸<br/>PEND</span>
              : <span className="text-[8px] font-black text-gray-300 dark:text-gray-600 uppercase tracking-tight">No<br/>photo</span>
            }
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex gap-1.5 items-center flex-wrap mb-0.5">
          <strong className="text-xs font-black text-gray-700 dark:text-gray-200 group-hover:text-emerald-600 transition-colors">{s.findCode}</strong>
          <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${colorClass}`}>
            {s.period}
          </span>
          {s.isPending && (
            <span className="bg-amber-500 text-white px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest animate-pulse">
              Pending
            </span>
          )}
        </div>
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 flex-1 break-words text-xs leading-snug text-gray-500 dark:text-gray-400">
            {s.objectType || "Object TBD"}{s.coinType ? ` (${s.coinType})` : ""}
          </span>
          {timeStr && (
            <span className="shrink-0 text-[10px] font-mono text-gray-400 dark:text-gray-600">{timeStr}</span>
          )}
        </div>
      </div>
    </button>
  );
}
