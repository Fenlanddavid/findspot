import React, { useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, Media } from "../db";
import { ScaledImage } from "../components/ScaledImage";
import { FindModal } from "../components/FindModal";
import { StaticMapPreview } from "../components/StaticMapPreview";
import { calculateCoverage } from "../services/coverage";

export default function Home(props: {
  projectId: string;
  goPermission: () => void;
  goPermissionWithParam: (type: string) => void;
  goPermissionEdit: (id: string) => void;
  goPermissions: () => void;
  goFind: (permissionId?: string) => void;
  goAllFinds: () => void;
  goFindsWithFilter: (filter: string) => void;
  goFindsBox: () => void;
  goMap: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [openFindId, setOpenFindId] = useState<string | null>(null);
  
  const permissions = useLiveQuery(
    async () => {
      let collection = db.permissions.where("projectId").equals(props.projectId);
      let rows = [];
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        rows = await collection
          .filter(l => 
            l.name.toLowerCase().includes(query) || 
            (l.landownerName?.toLowerCase().includes(query) ?? false) ||
            (l.notes?.toLowerCase().includes(query) ?? false)
          )
          .reverse()
          .sortBy("createdAt");
      } else {
        rows = await collection.reverse().sortBy("createdAt");
      }

      // Enhance with cumulative coverage
      const allTracks = await db.tracks.where("projectId").equals(props.projectId).toArray();

      return Promise.all(rows.map(async (p) => {
        const fields = await db.fields.where("permissionId").equals(p.id).toArray();
        const sessions = await db.sessions.where("permissionId").equals(p.id).toArray();
        const sessionIds = new Set(sessions.map(s => s.id));
        const permissionTracks = allTracks.filter(t => t.sessionId && sessionIds.has(t.sessionId));
        
        // Tracks that are for this permission but not assigned to any specific field
        const unassignedSessionIds = new Set(sessions.filter(s => !s.fieldId).map(s => s.id));

        let totalAreaM2 = 0;
        let totalDetectedM2 = 0;

        for (const f of fields) {
            const fieldSessionIds = new Set(sessions.filter(s => s.fieldId === f.id).map(s => s.id));
            
            // Include tracks assigned to this field OR unassigned tracks (which might overlap)
            const fieldTracks = permissionTracks.filter(t => 
                t.sessionId && (fieldSessionIds.has(t.sessionId) || unassignedSessionIds.has(t.sessionId))
            );

            const result = calculateCoverage(f.boundary, fieldTracks);
            if (result) {
                totalAreaM2 += result.totalAreaM2;
                totalDetectedM2 += result.detectedAreaM2;
            }
        }

        const cumulativePercent = totalAreaM2 > 0 ? (totalDetectedM2 / totalAreaM2) * 100 : null;

        // Multi-layered coordinate fallback
        let lat = typeof p.lat === 'number' ? p.lat : null;
        let lon = typeof p.lon === 'number' ? p.lon : null;

        // Fallback 1: Use first field boundary center
        if ((!lat || !lon) && fields.length > 0 && fields[0].boundary?.coordinates?.[0]) {
            const coords = fields[0].boundary.coordinates[0];
            lat = coords[0][1];
            lon = coords[0][0];
        }

        // Fallback 2: Use most recent find spot
        if (!lat || !lon) {
            const recentFind = await db.finds.where("permissionId").equals(p.id).reverse().sortBy("createdAt").then(arr => arr[0]);
            if (recentFind && recentFind.lat && recentFind.lon) {
                lat = recentFind.lat;
                lon = recentFind.lon;
            }
        }

        return { ...p, lat, lon, fields, cumulativePercent, tracks: permissionTracks };
      }));
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

      <div className="flex flex-col gap-3 overflow-hidden">
        <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 ml-1">Quick View Finds</h3>
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1">
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
                        boundary={l.boundary || (l as any).fields?.[0]?.boundary} 
                        tracks={(l as any).tracks}
                        className="h-full w-full rounded-none" 
                    />
                    
                    {(l as any).cumulativePercent !== null && (
                        <div className="absolute bottom-2 left-2 flex flex-col gap-1">
                            <div className={`px-2 py-1 rounded-lg backdrop-blur-md border shadow-lg flex flex-col items-center ${ (l as any).cumulativePercent < 90 ? 'bg-orange-600/80 border-orange-400 text-white' : 'bg-emerald-600/80 border-emerald-400 text-white'}`}>
                                <span className="text-[7px] font-black uppercase leading-none opacity-80 mb-0.5">Undetected</span>
                                <span className="text-xs font-black leading-none">{Math.round(100 - (l as any).cumulativePercent)}%</span>
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
                        {(l as any).fields?.length || 0} {(l as any).fields?.length === 1 ? 'Field' : 'Fields'}
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