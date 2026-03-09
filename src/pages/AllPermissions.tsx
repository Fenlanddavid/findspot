import React, { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useNavigate } from "react-router-dom";
import { StaticMapPreview } from "../components/StaticMapPreview";
import { calculateCoverage } from "../services/coverage";

export default function AllPermissions(props: { projectId: string }) {
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();

  const permissions = useLiveQuery(
    async () => {
      let collection = db.permissions.where("projectId").equals(props.projectId);
      let rows = [];
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        rows = await collection
          .filter(p => 
            p.name.toLowerCase().includes(q) || 
            (p.notes?.toLowerCase().includes(q) ?? false) ||
            (p.landownerName?.toLowerCase().includes(q) ?? false)
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

  return (
    <div className="max-w-5xl mx-auto pb-20 px-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8 mt-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100">All Permissions</h2>
          <p className="text-gray-500 text-sm">Browse and search every recorded permission or rally.</p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3 flex-1 max-w-xl lg:justify-end">
          <div className="relative flex-1 max-w-md">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40">🔍</span>
            <input 
              type="text"
              placeholder="Search by name, landowner, or notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl py-2.5 sm:py-3 pl-10 pr-4 shadow-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all text-sm"
            />
          </div>
          <button 
            onClick={() => navigate("/permission")}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 sm:py-3 rounded-xl font-bold shadow-md transition-all whitespace-nowrap text-sm flex items-center gap-2"
          >
            <span>📍</span> New Permission
          </button>
        </div>
      </div>

      {(!permissions || permissions.length === 0) ? (
        <div className="text-center py-20 bg-gray-50 dark:bg-gray-800/50 rounded-3xl border-2 border-dashed border-gray-200 dark:border-gray-700">
          <div className="text-4xl mb-4">📍</div>
          <p className="text-gray-500 italic">
            {searchQuery ? "No permissions match your search." : "No permissions recorded yet."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {permissions.map((l) => (
              <div key={l.id} className="border border-gray-200 dark:border-gray-700 rounded-2xl p-4 bg-white dark:bg-gray-800 shadow-sm hover:shadow-md transition-all flex flex-col h-full group relative overflow-hidden">
                {l.type === 'rally' && <div className="absolute top-0 right-0 bg-teal-500 text-white text-[8px] font-black px-2 py-1 rounded-bl uppercase tracking-widest z-10">Rally</div>}
                
                {/* Header */}
                <div className="flex justify-between items-start gap-3 mb-3">
                  <div className="min-w-0">
                    <button 
                        onClick={() => navigate(`/permission/${l.id}`)}
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
                <div className="relative aspect-video -mx-4 mb-4 cursor-pointer" onClick={() => navigate(`/permission/${l.id}`)}>
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
                  <button onClick={() => navigate(`/find?permissionId=${l.id}`)} className="flex-1 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 text-[10px] font-black py-2 rounded-lg hover:bg-emerald-600 hover:text-white transition-all border border-emerald-100 dark:border-emerald-900/50 uppercase tracking-wider">
                    Add find
                  </button>
                  <button onClick={() => navigate(`/permission/${l.id}`)} className="px-3 bg-gray-50 dark:bg-gray-800 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 text-[10px] font-bold py-2 rounded-lg transition-colors border border-gray-100 dark:border-gray-700 uppercase">
                    Details
                  </button>
                </div>
              </div>
          ))}
        </div>
      )}
    </div>
  );
}
