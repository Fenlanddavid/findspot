import React from "react";
import { Find, Media } from "../db";
import { ScaledImage } from "./ScaledImage";

export function FindRow(props: { 
  find: Find; 
  thumbMedia?: Media | null;
  onOpen: () => void 
}) {
  const s = props.find;
  return (
    <button
      onClick={props.onOpen}
      className="w-full text-left flex gap-3 items-center border border-gray-200 dark:border-gray-700 rounded-xl p-2.5 bg-transparent hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
    >
      <div className="relative">
        {props.thumbMedia ? (
          <ScaledImage 
            media={props.thumbMedia} 
            className="w-14 h-14 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700" 
            imgClassName="object-cover"
          />
        ) : (
          <div className="w-14 h-14 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 grid place-items-center opacity-70 text-xs bg-gray-50 dark:bg-gray-800">
            no photo
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex gap-2 items-baseline flex-wrap">
          <strong className="text-sm font-semibold group-hover:text-emerald-600 transition-colors">{s.findCode}</strong>
          <span className="opacity-75 text-xs">{new Date(s.createdAt).toLocaleDateString()}</span>
        </div>
        <div className="opacity-90 mt-0.5 text-sm">
          {s.objectType || "(Object TBD)"} {s.coinType ? `(${s.coinType})` : ""} <span className="opacity-60">• {s.period}</span>
        </div>
      </div>
    </button>
  );
}
