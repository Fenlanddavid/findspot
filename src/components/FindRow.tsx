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

  return (
    <button
      onClick={props.onOpen}
      className={`w-full text-left flex gap-3 items-center border rounded-xl p-2.5 bg-transparent hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group ${s.isPending ? 'border-amber-400 dark:border-amber-700 border-2' : 'border-gray-200 dark:border-gray-700'}`}
    >
      <div className="relative">
        {props.thumbMedia ? (
          <ScaledImage 
            media={props.thumbMedia} 
            className="w-14 h-14 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700" 
            imgClassName="object-cover"
          />
        ) : (
          <div className="w-14 h-14 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 grid place-items-center opacity-70 text-xs bg-gray-50 dark:bg-gray-800 uppercase font-black tracking-tighter">
            {s.isPending ? "📸 PENDING" : "no photo"}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex gap-2 items-center flex-wrap">
          <strong className="text-sm font-semibold group-hover:text-emerald-600 transition-colors">{s.findCode}</strong>
          <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${colorClass}`}>
            {s.period}
          </span>
          {s.isPending && (
             <span className="bg-amber-500 text-white px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest animate-pulse">
                Pending
             </span>
          )}
        </div>
        <div className="opacity-90 mt-0.5 text-sm flex items-center gap-2">
          {s.objectType || "(Object TBD)"} {s.coinType ? `(${s.coinType})` : ""} 
          {s.targetId && <span className="text-[10px] font-mono font-bold bg-gray-100 dark:bg-gray-900 px-1 rounded">TID: {s.targetId}</span>}
        </div>
      </div>
    </button>
  );
}
