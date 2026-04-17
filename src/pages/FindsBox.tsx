import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, Media } from "../db";
import { ScaledImage } from "../components/ScaledImage";
import { FindModal } from "../components/FindModal";

export default function FindsBox(props: { projectId: string }) {
  const navigate = useNavigate();
  const [openFindId, setOpenFindId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const finds = useLiveQuery(
    async () => {
      return db.finds
        .where("projectId")
        .equals(props.projectId)
        .filter(f => !!f.isFavorite)
        .reverse()
        .sortBy("createdAt");
    },
    [props.projectId]
  );

  const findIds = useMemo(() => finds?.map(s => s.id) ?? [], [finds]);

  const firstMediaMap = useLiveQuery(async () => {
    if (findIds.length === 0) return new Map<string, Media>();
    const media = await db.media.where("findId").anyOf(findIds).toArray();
    const m = new Map<string, Media>();
    media.sort((a, b) => {
        const aDate = a?.createdAt || "";
        const bDate = b?.createdAt || "";
        return aDate.localeCompare(bDate);
    });
    for (const row of media) {
        if (row.findId && !m.has(row.findId)) m.set(row.findId, row);
    }
    return m;
  }, [findIds]);

  return (
    <div className="max-w-6xl mx-auto pb-20 px-4">

      {/* Search your finds */}
      <section className="pt-8 mt-4 mb-10">
        <h3 className="text-2xl font-black text-gray-900 dark:text-gray-100 mb-1">Search Finds</h3>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">Browse everything you've recorded across all permissions</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigate(searchQuery.trim() ? `/finds?q=${encodeURIComponent(searchQuery.trim())}` : "/finds");
          }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search objects, periods, notes…"
              className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl pl-9 pr-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
            />
          </div>
          <button
            type="submit"
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[10px] uppercase tracking-widest px-5 rounded-xl transition-colors shrink-0"
          >
            Search
          </button>
        </form>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => navigate("/finds")}
            className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition-all"
          >
            Browse All Finds →
          </button>
          <button
            onClick={() => navigate("/finds?view=map")}
            className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest hover:border-emerald-400 transition-all"
          >
            Map View
          </button>
        </div>
      </section>

      {/* Header + Starred finds */}
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-xl sm:text-2xl">⭐</span>
          <h1 className="text-xl sm:text-2xl font-black bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent uppercase tracking-tight">Top Finds</h1>
        </div>
        <p className="text-gray-500 dark:text-gray-400 font-medium max-w-xl leading-relaxed">
          Tap the star on any find to showcase it here.
        </p>
      </header>

      {(!finds || finds.length === 0) ? (
        <div className="text-center py-24 bg-white dark:bg-gray-800/40 rounded-3xl border-2 border-dashed border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="text-6xl mb-6 opacity-20">⭐</div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200 mb-2">Your box is empty</h2>
          <p className="text-gray-500 dark:text-gray-400 max-w-xs mx-auto italic">
            "Every field has a story. Go out and find yours."
          </p>
          <div className="mt-8 flex justify-center">
            <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-2 rounded-full border border-emerald-100 dark:border-emerald-800 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                <span>Tip: Tap the</span>
                <span className="text-amber-500">☆</span>
                <span>on a find to add it here.</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {finds.map((s) => {
            const media = firstMediaMap?.get(s.id);
            return (
              <div 
                key={s.id} 
                onClick={() => setOpenFindId(s.id)}
                className="group relative aspect-square bg-white dark:bg-gray-800 rounded-2xl overflow-hidden shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer border border-gray-100 dark:border-gray-800 hover:border-emerald-200 dark:hover:border-emerald-900"
              >
                {media ? (
                  <ScaledImage 
                    media={media} 
                    className="w-full h-full" 
                    imgClassName="object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center opacity-30 italic text-[10px] bg-gray-50 dark:bg-gray-900">
                    No photo
                  </div>
                )}
                
                {/* Overlay with details */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
                    <p className="text-white font-black text-sm mb-0.5 transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300">{s.objectType || "Unidentified"}</p>
                    <div className="flex justify-between items-center transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300 delay-75">
                        <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest">{s.period}</span>
                        <span className="text-[10px] text-white/60 font-mono">{s.findCode}</span>
                    </div>
                </div>

                {/* Always visible material tag if interesting */}
                {s.material !== "Other" && (
                    <div className="absolute top-2 left-2 pointer-events-none">
                        <span className="text-[8px] font-black uppercase tracking-widest bg-white/90 dark:bg-gray-900/90 text-gray-800 dark:text-gray-100 px-1.5 py-0.5 rounded shadow-sm border border-gray-100 dark:border-gray-800">
                            {s.material}
                        </span>
                    </div>
                )}
                
                {/* Star indicator */}
                <div className="absolute top-2 right-2">
                    <span className="drop-shadow-md text-amber-400 text-sm">⭐</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openFindId && (
        <FindModal findId={openFindId} onClose={() => setOpenFindId(null)} />
      )}
    </div>
  );
}
