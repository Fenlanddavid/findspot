import React, { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useNavigate } from "react-router-dom";
import { StaticMapPreview } from "../components/StaticMapPreview";
import { enrichPermissions } from "../services/permissions";

export default function AllPermissions(props: { projectId: string }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"permissions" | "rallies">("permissions");
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

      return enrichPermissions(props.projectId, rows);
    },
    [props.projectId, searchQuery]
  );

  const filteredByMode = permissions
    ?.filter(p => viewMode === "rallies" ? p.type === "rally" : p.type !== "rally")
    .sort((a, b) => {
      if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
      if (!!a.isDefault !== !!b.isDefault) return a.isDefault ? 1 : -1;
      return 0;
    });

  return (
    <div className="max-w-5xl mx-auto pb-20 px-4">
      <div className="flex flex-col gap-4 mb-6 mt-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100">
              {viewMode === "rallies" ? "Rallies & Club Digs" : "All Permissions"}
            </h2>
            <p className="text-gray-500 text-sm">
              {viewMode === "rallies" ? "Events you've recorded or plan to attend." : "Browse and search your land permissions."}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => navigate(viewMode === "rallies" ? "/permission?type=rally" : "/permission")}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl font-bold shadow-md transition-all whitespace-nowrap text-sm flex items-center gap-2"
            >
              <span>{viewMode === "rallies" ? "🏟️" : "📍"}</span>
              {viewMode === "rallies" ? "New Rally" : "New Permission"}
            </button>
          </div>
        </div>

        <div className="flex gap-2 items-center">
          <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-1">
            <button
              onClick={() => setViewMode("permissions")}
              className={`px-4 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${viewMode === "permissions" ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"}`}
            >
              📍 Permissions
            </button>
            <button
              onClick={() => setViewMode("rallies")}
              className={`px-4 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${viewMode === "rallies" ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"}`}
            >
              🏟️ Rallies
            </button>
          </div>
          <div className="relative flex-1 max-w-md">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40">🔍</span>
            <input
              type="text"
              placeholder={viewMode === "rallies" ? "Search rallies..." : "Search by name, landowner, or notes..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl py-2 pl-10 pr-4 shadow-sm focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400 outline-none transition-all text-sm"
            />
          </div>
        </div>
      </div>

      {(!filteredByMode || filteredByMode.length === 0) ? (
        <div className="text-center py-20 bg-gray-50 dark:bg-gray-800/50 rounded-3xl border-2 border-dashed border-gray-200 dark:border-gray-700">
          <div className="text-4xl mb-4">{viewMode === "rallies" ? "🏟️" : "📍"}</div>
          <p className="text-gray-500 italic">
            {searchQuery
              ? `No ${viewMode === "rallies" ? "rallies" : "permissions"} match your search.`
              : viewMode === "rallies"
                ? "No rallies recorded yet. Find one in Discover and add it."
                : "No permissions recorded yet."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredByMode.map((l) => {
            const isRally = l.type === "rally";
            return (
              <div key={l.id} className="border border-gray-200 dark:border-gray-700 rounded-2xl p-4 bg-white dark:bg-gray-800 shadow-sm hover:shadow-lg hover:-translate-y-[1px] hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-200 ease-out flex flex-col h-full group relative overflow-hidden cursor-pointer" onClick={() => navigate(`/permission/${l.id}`)}>
                {isRally && <div className="absolute top-0 right-0 bg-teal-500 text-white text-[8px] font-black px-2 py-1 rounded-bl uppercase tracking-widest z-10">Rally</div>}
                {l.isDefault && <div className="absolute top-0 right-0 bg-gray-400 dark:bg-gray-600 text-white text-[8px] font-black px-2 py-1 rounded-bl uppercase tracking-widest z-10">General</div>}

                {/* Header */}
                <div className="flex justify-between items-start gap-3 mb-3">
                  <div className="min-w-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/permission/${l.id}`); }}
                      className="text-gray-900 dark:text-white truncate text-lg font-black group-hover:text-emerald-600 dark:group-hover:text-emerald-400 text-left transition-colors leading-tight"
                    >
                      {l.name || "(Unnamed)"}
                    </button>
                    <div className="text-[10px] opacity-40 font-mono mt-0.5">
                      {isRally && l.validFrom
                        ? new Date(l.validFrom).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                        : l.createdAt ? new Date(l.createdAt).toLocaleDateString() : ""}
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-[9px] font-semibold text-amber-500 dark:text-amber-400 whitespace-nowrap shrink-0 bg-transparent border border-amber-200/50 dark:border-amber-700/50 px-1.5 py-0.5 rounded-md">
                    <span className="text-[8px]">◈</span>{l.findCount} <span className="opacity-50">finds</span>
                  </span>
                </div>

                {/* Satellite Preview */}
                <div className="relative aspect-video -mx-4 mb-4 overflow-hidden rounded-lg">
                  <StaticMapPreview
                    lat={l.lat}
                    lon={l.lon}
                    boundary={l.boundary || l.fields?.[0]?.boundary}
                    tracks={l.tracks}
                    className="h-full w-full rounded-none"
                  />
                  {!isRally && l.cumulativePercent !== null && (
                    <div className="absolute bottom-2 left-2 flex flex-col gap-1">
                      <div className="px-2 py-1 rounded-lg backdrop-blur-md border border-white/20 bg-black/50 shadow-md flex flex-col items-center">
                        <span className="text-[8px] font-black uppercase leading-none opacity-60 mb-0.5">Undetected</span>
                        <span className={`text-[10px] font-black leading-none ${l.cumulativePercent < 90 ? 'text-orange-400' : 'text-emerald-400'}`}>{Math.round(100 - l.cumulativePercent)}%</span>
                      </div>
                    </div>
                  )}
                  <div className="absolute bottom-2 right-2 bg-black/50 backdrop-blur-sm border border-white/20 px-1.5 py-0.5 rounded text-[8px] font-mono text-white/60">
                    {l.lat && l.lon ? `${l.lat.toFixed(3)}, ${l.lon.toFixed(3)}` : "No GPS"}
                  </div>
                </div>

                <div className="grid gap-2 mb-4 flex-1">
                  {l.landownerName && (
                    <div className="text-xs font-bold text-gray-600 dark:text-gray-400 flex items-center gap-1.5 italic">
                      {isRally ? "🏟️" : "👤"} {l.landownerName}
                    </div>
                  )}
                  {!isRally && (
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">
                        {l.fields?.length || 0} {l.fields?.length === 1 ? 'Field' : 'Fields'}
                      </div>
                      {l.landType && <div className="text-[10px] font-medium opacity-40 uppercase tracking-tighter">{l.landType}</div>}
                    </div>
                  )}
                </div>

                <div className="pt-3 mt-auto border-t border-gray-200 dark:border-gray-700 flex gap-2 items-center">
                  {!isRally && (
                    <button onClick={(e) => { e.stopPropagation(); navigate(`/find?permissionId=${l.id}`); }} className="flex-1 bg-emerald-600/90 dark:bg-emerald-700/90 text-white text-[10px] font-black py-1.5 rounded-lg hover:bg-emerald-500 dark:hover:bg-emerald-600 transition-all duration-200 ease-out uppercase tracking-wider shadow-sm">
                      Add find
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); navigate(`/permission/${l.id}`); }} className="flex-1 px-3 bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 hover:text-emerald-600 dark:hover:text-emerald-400 text-[10px] font-bold py-1.5 rounded-lg transition-all duration-200 ease-out border border-gray-200 dark:border-gray-700 uppercase">
                    View
                  </button>
                  {l.lat && l.lon && (
                    <button
                      title="Open in Field Guide"
                      onClick={(e) => { e.stopPropagation(); navigate(`/fieldguide?lat=${l.lat}&lng=${l.lon}`); }}
                      className="px-3 bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 hover:text-emerald-600 dark:hover:text-emerald-400 text-[10px] font-bold py-1.5 rounded-lg transition-all duration-200 ease-out border border-gray-200 dark:border-gray-700"
                    >
                      🗺
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); db.permissions.update(l.id, { isPinned: !l.isPinned }); }}
                    title={l.isPinned ? "Unpin" : "Pin to top"}
                    className={`px-2 py-1.5 rounded-lg text-[13px] transition-all duration-200 ease-out border ${l.isPinned ? "bg-amber-50 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700" : "bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-700 opacity-40 hover:opacity-100"}`}
                  >
                    📌
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
