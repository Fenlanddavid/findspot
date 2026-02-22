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
  const filterMonth = searchParams.get("month"); // 0-11
  
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
            
            // Check for range search (e.g. "15-30")
            const rangeMatch = q.match(/^(\d+)-(\d+)$/);
            if (rangeMatch && s.targetId !== undefined) {
              const min = parseInt(rangeMatch[1]);
              const max = parseInt(rangeMatch[2]);
              if (s.targetId < min || s.targetId > max) return false;
              return true; // Match range
            }

            const matchesSearch = s.objectType.toLowerCase().includes(q) || 
                                 s.findCode.toLowerCase().includes(q) ||
                                 s.notes.toLowerCase().includes(q) ||
                                 s.period.toLowerCase().includes(q) ||
                                 (s.detector || "").toLowerCase().includes(q) ||
                                 (s.targetId !== undefined && s.targetId.toString() === q);
            if (!matchesSearch) return false;
        }

        // Apply URL filters
        if (filterPeriod && s.period !== filterPeriod) return false;
        if (filterType && s.coinType !== filterType) return false;
        
        if (filterMonth !== null) {
          const date = new Date(s.createdAt);
          if (date.getMonth().toString() !== filterMonth) return false;
        }

        return true;
      });
    },
    [props.projectId, searchQuery, filterPeriod, filterType, filterMonth]
  );

  const clearFilters = () => {
    setSearchQuery("");
    setSearchParams({});
  };

  const setMonthFilter = (m: number | null) => {
    const newParams = new URLSearchParams(searchParams);
    if (m === null) {
      newParams.delete("month");
    } else {
      newParams.set("month", m.toString());
    }
    setSearchParams(newParams);
  };

  const findIds = useMemo(() => finds?.map(s => s.id) ?? [], [finds]);

  // Months available in the full dataset (not just filtered)
  const allFinds = useLiveQuery(() => db.finds.where("projectId").equals(props.projectId).toArray(), [props.projectId]);
  const availableMonths = useMemo(() => {
    const months = new Set<number>();
    allFinds?.forEach(f => months.add(new Date(f.createdAt).getMonth()));
    return Array.from(months).sort((a, b) => a - b);
  }, [allFinds]);

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const stats = useMemo(() => {
    if (!finds) return null;
    const s = {
      total: finds.length,
      coins: finds.filter(f => f.objectType.toLowerCase().includes("coin")).length,
      artifacts: finds.filter(f => !f.objectType.toLowerCase().includes("coin")).length,
      roman: finds.filter(f => f.period === "Roman").length,
      medieval: finds.filter(f => f.period === "Medieval").length,
      highId: finds.filter(f => (f.targetId ?? 0) >= 70).length,
      midId: finds.filter(f => (f.targetId ?? 0) >= 20 && (f.targetId ?? 0) < 70).length,
      lowId: finds.filter(f => (f.targetId ?? 0) > 0 && (f.targetId ?? 0) < 20).length,
    };
    return s;
  }, [finds]);

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
                    placeholder="Search (e.g. Roman, 13, 15-30)..."
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

      {availableMonths.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1 mb-4 border-b border-gray-100 dark:border-gray-800">
          <button 
            onClick={() => setMonthFilter(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${filterMonth === null ? 'bg-emerald-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500'}`}
          >
            All Year
          </button>
          {availableMonths.map(m => (
            <button 
              key={m}
              onClick={() => setMonthFilter(m)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${filterMonth === m.toString() ? 'bg-emerald-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
            >
              {monthNames[m]}
            </button>
          ))}
        </div>
      )}

      {stats && stats.total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-2 mb-6">
          <StatBubble label="All" value={stats.total} color="bg-gray-100 dark:bg-gray-800" onClick={() => setSearchQuery("")} />
          {stats.coins > 0 && <StatBubble label="Coins" value={stats.coins} color="bg-emerald-100 text-emerald-700" onClick={() => setSearchQuery("coin")} />}
          {stats.artifacts > 0 && <StatBubble label="Artifacts" value={stats.artifacts} color="bg-blue-100 text-blue-700" onClick={() => setSearchQuery("")} />}
          {stats.roman > 0 && <StatBubble label="Roman" value={stats.roman} color="bg-red-100 text-red-700" onClick={() => setSearchQuery("Roman")} />}
          {stats.medieval > 0 && <StatBubble label="Medieval" value={stats.medieval} color="bg-amber-100 text-amber-700" onClick={() => setSearchQuery("Medieval")} />}
          {stats.highId > 0 && <StatBubble label="High ID (70+)" value={stats.highId} color="bg-sky-100 text-sky-700" onClick={() => setSearchQuery("70-100")} />}
          {stats.midId > 0 && <StatBubble label="Mid ID (20-70)" value={stats.midId} color="bg-green-100 text-green-700" onClick={() => setSearchQuery("20-70")} />}
          {stats.lowId > 0 && <StatBubble label="Low ID (<20)" value={stats.lowId} color="bg-orange-100 text-orange-700" onClick={() => setSearchQuery("0-20")} />}
        </div>
      )}

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
                  <div className="absolute top-3 left-3 flex flex-col gap-1">
                    <span className="font-mono text-[10px] font-bold bg-black/60 backdrop-blur-md text-white px-2 py-1 rounded shadow-sm">
                      {s.findCode}
                    </span>
                    {s.targetId !== undefined && (
                      <span className={`font-mono text-[10px] font-bold backdrop-blur-md text-white px-2 py-1 rounded shadow-sm w-fit ${
                        s.targetId >= 70 ? 'bg-blue-600/80 ring-1 ring-blue-400' : 
                        s.targetId >= 20 ? 'bg-emerald-600/80 ring-1 ring-emerald-400' : 
                        'bg-orange-600/80 ring-1 ring-orange-400'
                      }`}>
                        ID: {s.targetId}
                      </span>
                    )}
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

function StatBubble({ label, value, color, onClick }: { label: string; value: number; color: string; onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`flex items-center gap-2 whitespace-nowrap px-4 py-2 rounded-2xl text-xs font-bold transition-all hover:scale-105 active:scale-95 shadow-sm border border-black/5 dark:border-white/5 ${color}`}
    >
      <span className="opacity-70">{label}:</span>
      <span className="text-sm">{value}</span>
    </button>
  );
}
