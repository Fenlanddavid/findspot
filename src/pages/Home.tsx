import React, { useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, Media } from "../db";
import { ScaledImage } from "../components/ScaledImage";
import { FindModal } from "../components/FindModal";
import { StaticMapPreview } from "../components/StaticMapPreview";
import { enrichPermissions, EnrichedPermission } from "../services/permissions";

export default function Home(props: {
  projectId: string;
  goPermission: () => void;
  goPermissionWithParam: (type: string) => void;
  goPermissionEdit: (id: string) => void;
  goPermissions: () => void;
  goFind: (permissionId?: string, quickId?: string) => void;
  goAllFinds: () => void;
  goFindsWithFilter: (filter: string) => void;
  goFindsBox: () => void;
  goFieldGuide: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [openFindId, setOpenFindId] = useState<string | null>(null);
  
  const permissions = useLiveQuery(
    async () => {
      let rows = await db.permissions.where("projectId").equals(props.projectId).toArray();
      
      let enriched = await enrichPermissions(props.projectId, rows);

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        enriched = enriched.filter(l => 
          l.name.toLowerCase().includes(query) || 
          (l.landownerName?.toLowerCase().includes(query) ?? false) ||
          (l.notes?.toLowerCase().includes(query) ?? false)
        );
      }

      // Sort by session count descending, then by last session date, then by creation date
      enriched.sort((a, b) => {
        if (b.sessionCount !== a.sessionCount) {
          return b.sessionCount - a.sessionCount;
        }
        const bDate = b.lastSessionDate || b.createdAt || "";
        const aDate = a.lastSessionDate || a.createdAt || "";
        return bDate.localeCompare(aDate);
      });

      return enriched.slice(0, 3);
    },
    [props.projectId, searchQuery]
  );

  const finds = useLiveQuery(
    async () => db.finds.where("projectId").equals(props.projectId).reverse().sortBy("createdAt"),
    [props.projectId]
  );

  const pendingFinds = useMemo(() => finds?.filter(f => f.isPending), [finds]);
  const recentFinds = useMemo(() => finds?.filter(f => !f.isPending), [finds]);

  const finds2026Stats = useMemo(() => {
    if (!finds) return null;
    const thisYear = finds.filter(f => !f.isPending && (f.createdAt || "").startsWith("2026"));
    if (thisYear.length === 0) return null;

    const gold = thisYear.filter(f => f.material === "Gold").length;
    const silver = thisYear.filter(f => f.material === "Silver").length;
    const hammered = thisYear.filter(f =>
      (f.objectType || "").toLowerCase().includes("hammered") ||
      (f.coinType || "").toLowerCase().includes("hammered")
    ).length;

    const periodOrder = ["Prehistoric", "Bronze Age", "Iron Age", "Celtic", "Roman", "Anglo-Saxon", "Early Medieval", "Medieval", "Post-medieval", "Modern", "Unknown"];
    const periodCounts: { period: string; count: number }[] = [];
    for (const period of periodOrder) {
      const count = thisYear.filter(f => f.period === period).length;
      if (count > 0) periodCounts.push({ period, count });
    }

    return { total: thisYear.length, gold, silver, hammered, periodCounts };
  }, [finds]);

  const findIds = useMemo(() => recentFinds?.slice(0, 3).map(s => s.id) ?? [], [recentFinds]);

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
    <div className="grid gap-8 max-w-5xl mx-auto overflow-hidden px-4 pb-20 mt-4">
      <div className="flex items-start gap-2 py-2 px-1">
        <span className="text-sm mt-0.5">🔒</span>
        <p className="text-xs sm:text-sm font-normal text-black dark:text-white m-0 opacity-80 flex-1">
            Your data is private. All find spots, GPS coordinates, and landowner details are stored locally on this device. Nothing is ever uploaded or shared.
        </p>
      </div>

      <div className="flex gap-3 flex-wrap">
        <button onClick={props.goPermission} className="bg-gradient-to-br from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white px-4 sm:px-6 py-3 rounded-xl font-bold shadow-lg transition-all flex items-center gap-2 transform hover:-translate-y-0.5 active:translate-y-0 text-sm sm:text-base">
            <span>📍</span> <span className="hidden xs:inline">New</span> Permission
        </button>
        <button onClick={() => props.goPermissionWithParam("rally")} className="bg-gradient-to-br from-teal-500 to-teal-600 hover:from-teal-400 hover:to-teal-500 text-white px-4 sm:px-6 py-3 rounded-xl font-bold shadow-lg transition-all flex items-center gap-2 transform hover:-translate-y-0.5 active:translate-y-0 text-sm sm:text-base">
            <span>🏟️</span> Club/Rally
        </button>
      </div>

      {pendingFinds && pendingFinds.length > 0 && (
        <section className="bg-amber-50 dark:bg-amber-900/10 border-2 border-amber-200 dark:border-amber-800 rounded-2xl p-4 animate-in slide-in-from-top-4">
            <div className="flex justify-between items-center mb-3 px-1">
                <h3 className="text-sm font-black uppercase tracking-widest text-amber-700 dark:text-amber-400 flex items-center gap-2">
                    <span className="animate-pulse">🟠</span> {pendingFinds.length} Pending Finds
                </h3>
                <button onClick={() => props.goFindsWithFilter("filter=pending")} className="text-[10px] font-black uppercase text-amber-600 hover:underline">View Queue</button>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1">
                {pendingFinds.map(f => (
                    <div
                        key={f.id}
                        className="min-w-[140px] bg-white dark:bg-gray-800 p-3 rounded-xl border border-amber-200 dark:border-amber-700 shadow-sm transition-all"
                    >
                        <div className="text-[10px] font-black text-amber-600 uppercase mb-1">{f.findCode}</div>
                        <div className="text-[8px] opacity-40 font-mono mb-2">{new Date(f.createdAt).toLocaleTimeString()}</div>
                        <button
                            onClick={() => props.goFind(f.permissionId, f.id)}
                            className="w-full bg-amber-600 text-white py-1 rounded-lg text-[10px] font-black uppercase tracking-tight mb-1.5"
                        >Finish Record</button>
                        <button
                            onClick={() => { if (window.confirm("Delete this pending find?")) db.finds.delete(f.id); }}
                            className="w-full bg-transparent border border-red-200 dark:border-red-800 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 py-1 rounded-lg text-[10px] font-black uppercase tracking-tight transition-colors"
                        >Delete</button>
                    </div>
                ))}
            </div>
        </section>
      )}

      {finds2026Stats && (
        <section>
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 ml-1">Finds 2026</h3>
            <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">{finds2026Stats.total} Total</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide -mx-1 px-1" title="Scroll to see more">

            {finds2026Stats.gold > 0 && (
              <button onClick={() => props.goFindsWithFilter("material=Gold")} className="whitespace-nowrap flex items-baseline gap-1.5 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg px-3 py-1.5 hover:border-yellow-500 transition-colors shrink-0">
                <span className="text-sm font-black text-yellow-700 dark:text-yellow-400">{finds2026Stats.gold}</span>
                <span className="text-[9px] font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500">Gold</span>
              </button>
            )}
            {finds2026Stats.silver > 0 && (
              <button onClick={() => props.goFindsWithFilter("material=Silver")} className="whitespace-nowrap flex items-baseline gap-1.5 bg-gray-50 dark:bg-gray-700/40 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 hover:border-gray-500 transition-colors shrink-0">
                <span className="text-sm font-black text-gray-600 dark:text-gray-300">{finds2026Stats.silver}</span>
                <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">Silver</span>
              </button>
            )}
            {finds2026Stats.hammered > 0 && (
              <button onClick={() => props.goFindsWithFilter("type=Hammered")} className="whitespace-nowrap flex items-baseline gap-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 hover:border-emerald-500 transition-colors shadow-sm shrink-0">
                <span className="text-sm font-black text-gray-800 dark:text-gray-100">{finds2026Stats.hammered}</span>
                <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">Hammered</span>
              </button>
            )}
            {finds2026Stats.periodCounts.map(({ period, count }) => (
              <button key={period} onClick={() => props.goFindsWithFilter(`period=${period}`)} className="whitespace-nowrap flex items-baseline gap-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 hover:border-emerald-500 transition-colors shadow-sm shrink-0">
                <span className="text-sm font-black text-gray-800 dark:text-gray-100">{count}</span>
                <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">{period}</span>
              </button>
            ))}
          </div>
          {(finds2026Stats.periodCounts.length + (finds2026Stats.gold > 0 ? 1 : 0) + (finds2026Stats.silver > 0 ? 1 : 0) + (finds2026Stats.hammered > 0 ? 1 : 0)) > 4 && (
            <p className="text-[9px] text-gray-400 dark:text-gray-500 italic ml-1 mt-1">Scroll for more</p>
          )}
        </section>
      )}

      <section className="overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-4">
            <div className="flex items-baseline gap-4">
                <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 whitespace-nowrap">Permissions</h2>
                <button onClick={props.goPermissions} className="text-sm text-emerald-600 font-bold hover:underline">View All</button>
            </div>
            <div className="flex items-center gap-3 w-full md:max-w-md">
                <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40">🔍</span>
                    <input 
                        type="text"
                        placeholder="Search permissions..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg py-2 pl-9 pr-4 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                </div>
                <div className="text-sm text-gray-500 font-mono hidden sm:block whitespace-nowrap">{permissions?.length ?? 0} total</div>
            </div>
        </div>
        
        {(!permissions || permissions.length === 0) && (
            <div className="bg-emerald-50 dark:bg-emerald-950/20 p-12 rounded-3xl border-4 border-dashed border-emerald-200 dark:border-emerald-800 text-center animate-in zoom-in-95 duration-500">
                <div className="text-5xl mb-4">🗺️</div>
                <h3 className="text-xl font-black text-emerald-800 dark:text-emerald-300 uppercase tracking-tight">Ready to start?</h3>
                <p className="text-sm text-emerald-700 dark:text-emerald-400 mb-6 max-w-xs mx-auto">
                    {searchQuery ? "No results found matching your search." : "Welcome! Add your first permission or start a club rally to begin recording finds."}
                </p>
                {!searchQuery && (
                    <div className="flex flex-col gap-3 max-w-xs mx-auto">
                        <button onClick={props.goPermission} className="bg-emerald-600 text-white py-3 rounded-xl font-black uppercase tracking-widest shadow-lg active:translate-y-1 transition-all">
                            Add Permission
                        </button>
                        <button onClick={() => props.goPermissionWithParam("rally")} className="bg-teal-600 text-white py-3 rounded-xl font-black uppercase tracking-widest shadow-lg active:translate-y-1 transition-all">
                            Join a Rally
                        </button>
                    </div>
                )}
            </div>
        )}
        
        {permissions && permissions.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {permissions.map((l) => (
              <div key={l.id} className="border border-gray-200 dark:border-gray-700 rounded-2xl p-4 bg-white dark:bg-gray-800 shadow-sm hover:shadow-md transition-all flex flex-col h-full group relative overflow-hidden">
                {l.type === 'rally' && <div className="absolute top-0 right-0 bg-teal-500 text-white text-[8px] font-black px-2 py-1 rounded-bl uppercase tracking-widest z-10">Rally</div>}
                
                {/* Header */}
                <div className="flex justify-between items-start gap-3 mb-3">
                  <div className="min-w-0">
                    <button 
                        onClick={() => props.goPermissionEdit(l.id)}
                        className="text-gray-900 dark:text-white truncate text-lg font-black group-hover:text-emerald-600 dark:group-hover:text-emerald-400 text-left transition-colors leading-tight"
                    >
                        {l.name || "(Unnamed)"}
                    </button>
                    {l.createdAt && (
                        <div className="text-[10px] opacity-40 font-mono mt-0.5">
                            {new Date(l.createdAt).toLocaleDateString()}
                        </div>
                    )}
                  </div>
                  {l.permissionGranted ? (
                    <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter shrink-0">✓ OK</span>
                  ) : (
                    <span className="bg-red-50 text-red-700 border border-red-100 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter shrink-0">⚠️ NO</span>
                  )}
                </div>

                {/* Satellite Preview with Progress Overlay */}
                <div className="relative aspect-video -mx-4 mb-4 cursor-pointer" onClick={() => props.goPermissionEdit(l.id)}>
                    <StaticMapPreview
                        lat={l.lat}
                        lon={l.lon}
                        boundary={l.boundary || l.fields?.[0]?.boundary}
                        tracks={l.tracks}
                        className="h-full w-full rounded-none"
                    />

                    {l.cumulativePercent !== null && (
                        <div className="absolute bottom-2 left-2 flex flex-col gap-1">
                            <div className={`px-2 py-1 rounded-lg backdrop-blur-md border shadow-lg flex flex-col items-center ${ l.cumulativePercent < 90 ? 'bg-orange-600/80 border-orange-400 text-white' : 'bg-emerald-600/80 border-emerald-400 text-white'}`}>
                                <span className="text-[7px] font-black uppercase leading-none opacity-80 mb-0.5">Undetected</span>
                                <span className="text-xs font-black leading-none">{Math.round(100 - l.cumulativePercent)}%</span>
                            </div>
                        </div>
                    )}

                    <div className="absolute bottom-2 right-2 bg-black/40 backdrop-blur-sm px-1.5 py-0.5 rounded text-[8px] font-mono text-white/80">
                        {l.lat && l.lon ? `${l.lat.toFixed(3)}, ${l.lon.toFixed(3)}` : "No GPS"}
                    </div>
                </div>
                
                <div className="grid gap-2 mb-4 flex-1">
                  {l.landownerName && <div className="text-xs font-bold text-gray-600 dark:text-gray-400 flex items-center gap-1.5 italic">👤 {l.landownerName}</div>}
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">
                        {l.sessionCount} {l.sessionCount === 1 ? 'Visit' : 'Visits'}
                    </div>
                    {l.landType && <div className="text-[10px] font-medium opacity-40 uppercase tracking-tighter">{l.landType}</div>}
                  </div>
                </div>
                
                <div className="pt-3 mt-auto border-t border-gray-100 dark:border-gray-700 flex gap-2 items-center">
                  <button onClick={() => props.goFind(l.id)} className="flex-1 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 text-[10px] font-black py-2 rounded-lg hover:bg-emerald-600 hover:text-white transition-all border border-emerald-100 dark:border-emerald-900/50 uppercase tracking-wider">
                    Add find
                  </button>
                  <button onClick={() => props.goPermissionEdit(l.id)} className="px-3 bg-gray-50 dark:bg-gray-800 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 text-[10px] font-bold py-2 rounded-lg transition-colors border border-gray-100 dark:border-gray-700 uppercase">
                    Details
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Latest Finds</h2>
            <button onClick={props.goAllFinds} className="text-sm text-emerald-600 font-bold hover:underline">View All</button>
        </div>

        {(!recentFinds || recentFinds.length === 0) && <div className="text-gray-500 italic bg-gray-50 dark:bg-gray-800/50 p-10 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 text-center">No finds recorded yet.</div>}
        
        {recentFinds && recentFinds.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recentFinds.slice(0, 3).map((s) => {
              const media = firstMediaMap?.get(s.id);
              return (
                <div key={s.id} className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-800 shadow-sm hover:shadow-md transition-all flex flex-col h-full group cursor-pointer" onClick={() => setOpenFindId(s.id)}>
                  <div className="aspect-square bg-gray-100 dark:bg-gray-900 relative">
                    {media ? (
                      <ScaledImage 
                        media={media} 
                        className="w-full h-full" 
                        imgClassName="object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center opacity-30 italic text-[10px]">
                        No photo
                      </div>
                    )}
                    <div className="absolute top-2 left-2">
                        <strong className="text-white font-mono text-[9px] bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded uppercase tracking-tighter">{s.findCode}</strong>
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="font-bold text-gray-800 dark:text-gray-200 truncate leading-tight group-hover:text-emerald-600 transition-colors" title={s.objectType}>{s.objectType || "(Object TBD)"}</div>
                    <div className="opacity-60 text-[10px] mt-1 flex justify-between items-center">
                      <div className="flex gap-2">
                        <span className="bg-gray-50 dark:bg-gray-900 px-1 rounded border border-gray-100 dark:border-gray-800 uppercase font-bold">{s.period}</span>
                        {s.material !== "Other" && <span className="capitalize">{s.material}</span>}
                      </div>
                      <span className="opacity-60">{new Date(s.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {openFindId && (
        <FindModal findId={openFindId} onClose={() => setOpenFindId(null)} />
      )}
    </div>
  );
}

