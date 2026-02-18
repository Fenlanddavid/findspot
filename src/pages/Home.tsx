import React, { useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, Media } from "../db";
import { ScaledImage } from "../components/ScaledImage";
import { FindModal } from "../components/FindModal";

export default function Home(props: {
  projectId: string;
  goPermission: () => void;
  goPermissionWithParam: (type: string) => void;
  goPermissionEdit: (id: string) => void;
  goPermissions: () => void;
  goFind: (permissionId?: string) => void;
  goAllFinds: () => void;
  goFindsWithFilter: (filter: string) => void;
  goMap: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [openFindId, setOpenFindId] = useState<string | null>(null);
  
  const permissions = useLiveQuery(
    async () => {
      let collection = db.permissions.where("projectId").equals(props.projectId);
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return collection
          .filter(l => 
            l.name.toLowerCase().includes(query) || 
            (l.landownerName?.toLowerCase().includes(query) ?? false) ||
            (l.notes?.toLowerCase().includes(query) ?? false)
          )
          .reverse()
          .sortBy("createdAt");
      }
      return collection.reverse().sortBy("createdAt");
    },
    [props.projectId, searchQuery]
  );

  const finds = useLiveQuery(
    async () => db.finds.where("projectId").equals(props.projectId).reverse().sortBy("createdAt"),
    [props.projectId]
  );

  const findIds = useMemo(() => finds?.slice(0, 12).map(s => s.id) ?? [], [finds]);

  const firstMediaMap = useLiveQuery(async () => {
    if (findIds.length === 0) return new Map<string, Media>();
    const media = await db.media.where("findId").anyOf(findIds).toArray();
    const m = new Map<string, Media>();
    media.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const row of media) {
        if (!m.has(row.findId)) m.set(row.findId, row);
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

      <div className="flex flex-col gap-3 overflow-hidden">
        <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 ml-1">Quick View Finds</h3>
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1">
            <QuickFilterBtn label="All Finds" onClick={props.goAllFinds} />
            <QuickFilterBtn label="Hammered" onClick={() => props.goFindsWithFilter("type=Hammered")} />
            <QuickFilterBtn label="Bronze Age" onClick={() => props.goFindsWithFilter("period=Bronze Age")} />
            <QuickFilterBtn label="Roman" onClick={() => props.goFindsWithFilter("period=Roman")} />
            <QuickFilterBtn label="Celtic" onClick={() => props.goFindsWithFilter("period=Celtic")} />
            <QuickFilterBtn label="Anglo-Saxon" onClick={() => props.goFindsWithFilter("period=Anglo-Saxon")} />
        </div>
        <p className="text-[10px] text-gray-400 dark:text-gray-500 italic ml-1 -mt-1">Tip: Scroll for more filters</p>
      </div>

      <section className="overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-4">
            <div className="flex items-baseline gap-4">
                <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 whitespace-nowrap">Permissions & Rallies</h2>
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
            <div className="text-gray-500 italic bg-gray-50 dark:bg-gray-800/50 p-10 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 text-center">
                {searchQuery ? "No results found matching your search." : "No permissions recorded yet. Start by adding a new permission!"}
            </div>
        )}
        
        {permissions && permissions.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {permissions.slice(0, 12).map((l) => (
              <div key={l.id} className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-white dark:bg-gray-800 shadow-sm hover:shadow-md transition-all flex flex-col h-full group relative overflow-hidden">
                {l.type === 'rally' && <div className="absolute top-0 right-0 bg-teal-500 text-white text-[8px] font-black px-2 py-0.5 rounded-bl uppercase tracking-widest">Rally</div>}
                <div className="flex justify-between gap-3 mb-2">
                  <button 
                    onClick={() => props.goPermissionEdit(l.id)}
                    className="text-gray-900 dark:text-white truncate text-lg font-bold group-hover:text-emerald-600 dark:group-hover:text-emerald-400 text-left transition-colors"
                  >
                    {l.name || "(Unnamed)"}
                  </button>
                </div>
                
                <div className="text-sm opacity-70 mb-4 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                     <span className="text-xs font-mono bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-600 dark:text-gray-300">
                        {l.lat && l.lon ? `${l.lat.toFixed(4)}, ${l.lon.toFixed(4)}` : "No GPS"}
                     </span>
                     <span className="text-xs opacity-60">{new Date(l.createdAt).toLocaleDateString()}</span>
                  </div>
                  {l.landownerName && <div className="text-xs font-bold text-gray-600 dark:text-gray-400 mt-1 flex items-center gap-1">👤 {l.landownerName}</div>}
                  {l.landType && <div className="text-xs font-medium opacity-80 mt-1 truncate capitalize">{l.landType}</div>}
                  {l.permissionGranted ? (
                    <span className="text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded text-xs font-bold inline-block mt-1">✓ Permission</span>
                  ) : (
                    <span className="text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded text-xs font-bold inline-block mt-1">⚠️ Missing</span>
                  )}
                </div>
                
                <div className="pt-3 mt-auto border-t border-gray-100 dark:border-gray-700 flex gap-4 items-center">
                  <button onClick={() => props.goFind(l.id)} className="text-xs text-emerald-600 hover:text-emerald-800 font-bold hover:underline flex items-center gap-1">
                    Add find <span>→</span>
                  </button>
                  <button onClick={() => props.goPermissionEdit(l.id)} className="text-xs text-gray-500 hover:text-gray-700 font-medium ml-auto px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                    Edit Details
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Recent Finds</h2>
        </div>

        {(!finds || finds.length === 0) && <div className="text-gray-500 italic bg-gray-50 dark:bg-gray-800/50 p-10 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 text-center">No finds recorded yet.</div>}
        
        {finds && finds.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {finds.slice(0, 12).map((s) => {
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

function QuickFilterBtn({ label, onClick }: { label: string, onClick: () => void }) {
    return (
        <button 
            onClick={onClick}
            className="whitespace-nowrap px-5 py-2 rounded-xl text-xs font-bold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm transition-all hover:shadow-md hover:border-emerald-500 dark:hover:border-emerald-500 hover:-translate-y-0.5 active:translate-y-0 active:scale-95"
        >
            {label}
        </button>
    );
}