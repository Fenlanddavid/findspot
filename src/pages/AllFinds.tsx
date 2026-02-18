import React, { useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, Media } from "../db";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ScaledImage } from "../components/ScaledImage";
import { FindModal } from "../components/FindModal";

export default function AllFinds(props: { projectId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filterPeriod = searchParams.get("period");
  const filterType = searchParams.get("type");
  
  const [searchQuery, setSearchQuery] = useState("");
  const [openFindId, setOpenFindId] = useState<string | null>(null);
  const navigate = useNavigate();

  const finds = useLiveQuery(
    async () => {
      let collection = db.finds.where("projectId").equals(props.projectId);
      
      const results = await collection.reverse().sortBy("createdAt");
      
      return results.filter(s => {
        // Apply text search if present
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            const matchesSearch = s.objectType.toLowerCase().includes(q) || 
                                 s.findCode.toLowerCase().includes(q) ||
                                 s.notes.toLowerCase().includes(q);
            if (!matchesSearch) return false;
        }

        // Apply URL filters
        if (filterPeriod && s.period !== filterPeriod) return false;
        if (filterType && s.coinType !== filterType) return false;

        return true;
      });
    },
    [props.projectId, searchQuery, filterPeriod, filterType]
  );

  const clearFilters = () => {
    setSearchQuery("");
    setSearchParams({});
  };

  const findIds = useMemo(() => finds?.map(s => s.id) ?? [], [finds]);

  const firstMediaMap = useLiveQuery(async () => {
    if (findIds.length === 0) return new Map<string, Media>();
    const media = await db.media.where("findId").anyOf(findIds).toArray();
    const m = new Map<string, Media>();
    // Sort by createdAt to get the first photo
    media.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const row of media) {
        if (!m.has(row.findId)) m.set(row.findId, row);
    }
    return m;
  }, [findIds]);

  return (
    <div className="max-w-5xl mx-auto pb-10 px-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8 mt-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100">
            {filterPeriod ? `${filterPeriod} Finds` : filterType ? `${filterType} Finds` : "All Finds"}
          </h2>
          <p className="text-gray-500 text-sm">Browse and search every recorded find.</p>
        </div>
        
        <div className="flex flex-col gap-2 flex-1 max-w-md lg:items-end">
            <div className="relative w-full">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40">🔍</span>
                <input 
                    type="text"
                    placeholder="Search by object type, code, or notes..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl py-2.5 sm:py-3 pl-10 pr-4 shadow-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all text-sm"
                />
            </div>
            {(filterPeriod || filterType || searchQuery) && (
                <div className="flex flex-wrap gap-2 items-center lg:justify-end">
                    {filterPeriod && <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-1 rounded-full uppercase">Period: {filterPeriod}</span>}
                    {filterType && <span className="bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-1 rounded-full uppercase">Type: {filterType}</span>}
                    <button onClick={clearFilters} className="text-[10px] font-bold text-gray-400 hover:text-red-500 underline transition-colors">Clear all filters</button>
                </div>
            )}
        </div>
      </div>

      {(!finds || finds.length === 0) ? (
        <div className="text-center py-20 bg-gray-50 dark:bg-gray-800/50 rounded-3xl border-2 border-dashed border-gray-200 dark:border-gray-700">
          <div className="text-4xl mb-4">🔍</div>
          <p className="text-gray-500 italic">
            {searchQuery ? "No finds match your search." : "No finds recorded yet."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {finds.map((s) => {
            const media = firstMediaMap?.get(s.id);
            return (
              <div 
                key={s.id} 
                onClick={() => setOpenFindId(s.id)}
                className="group border border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden bg-white dark:bg-gray-800 shadow-sm hover:shadow-md hover:border-emerald-200 dark:hover:border-emerald-900 transition-all cursor-pointer flex flex-col"
              >
                <div className="aspect-video bg-gray-100 dark:bg-gray-900 relative border-b border-gray-100 dark:border-gray-700">
                  {media ? (
                    <ScaledImage 
                      media={media} 
                      className="w-full h-full" 
                      imgClassName="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center opacity-30 italic text-xs">
                      No photo
                    </div>
                  )}
                  <div className="absolute top-3 left-3">
                    <span className="font-mono text-[10px] font-bold bg-black/60 backdrop-blur-md text-white px-2 py-1 rounded shadow-sm">
                      {s.findCode}
                    </span>
                  </div>
                </div>

                <div className="p-5 flex-1 flex flex-col">
                  <div className="flex justify-between items-start mb-1">
                    <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 group-hover:text-emerald-600 transition-colors line-clamp-1">
                      {s.objectType || "Unidentified"}
                    </h3>
                  </div>
                  
                  <div className="flex flex-wrap gap-2 mt-auto pt-3">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase border bg-emerald-50 border-emerald-100 text-emerald-700`}>
                      {s.period}
                    </span>
                    {s.material !== "Other" && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600">
                        {s.material}
                      </span>
                    )}
                    <span className="ml-auto text-[10px] opacity-40 font-medium self-center">
                      {new Date(s.createdAt).toLocaleDateString()}
                    </span>
                  </div>

                  {s.notes && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-3 line-clamp-2 italic">
                      "{s.notes}"
                    </p>
                  )}
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