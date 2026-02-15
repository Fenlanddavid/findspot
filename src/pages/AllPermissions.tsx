import React, { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useNavigate } from "react-router-dom";

export default function AllPermissions(props: { projectId: string }) {
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();

  const permissions = useLiveQuery(
    async () => {
      let collection = db.permissions.where("projectId").equals(props.projectId);
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return collection
          .filter(p => 
            p.name.toLowerCase().includes(q) || 
            (p.landUse?.toLowerCase().includes(q) ?? false) ||
            (p.notes?.toLowerCase().includes(q) ?? false) ||
            (p.landownerName?.toLowerCase().includes(q) ?? false)
          )
          .reverse()
          .sortBy("createdAt");
      }
      return collection.reverse().sortBy("createdAt");
    },
    [props.projectId, searchQuery]
  );

  return (
    <div className="max-w-5xl mx-auto pb-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">All Permissions</h2>
          <p className="text-gray-500 text-sm">Browse and search every recorded permission or rally.</p>
        </div>
        
        <div className="relative flex-1 max-w-md">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40">🔍</span>
          <input 
            type="text"
            placeholder="Search by name, landowner, or notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl py-3 pl-10 pr-4 shadow-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
          />
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
          {permissions.map((p) => (
            <div 
              key={p.id} 
              onClick={() => navigate(`/permission/${p.id}`)}
              className="group border border-gray-200 dark:border-gray-700 rounded-2xl p-5 bg-white dark:bg-gray-800 shadow-sm hover:shadow-md hover:border-emerald-200 dark:hover:border-emerald-900 transition-all cursor-pointer flex flex-col"
            >
              <div className="flex justify-between items-start mb-3">
                <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 group-hover:text-emerald-600 transition-colors line-clamp-1">
                  {p.name || "(Unnamed)"}
                </h3>
                {p.type === "rally" && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 uppercase">Rally</span>
                )}
              </div>
              
              <div className="text-sm opacity-70 space-y-2 mb-4">
                <div className="flex items-center gap-2">
                   <span className="text-xs font-mono bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-600 dark:text-gray-300">
                      {p.lat && p.lon ? `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}` : "No GPS"}
                   </span>
                </div>
                {p.landownerName && (
                    <div className="text-xs flex items-center gap-1">
                        <span className="opacity-50">👤</span> {p.landownerName}
                    </div>
                )}
                {p.landType && <div className="text-xs font-medium capitalize">{p.landType} - {p.landUse}</div>}
              </div>

              <div className="mt-auto pt-3 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center">
                <span className="text-[10px] opacity-40 font-medium">
                  {new Date(p.createdAt).toLocaleDateString()}
                </span>
                {p.permissionGranted ? (
                  <span className="text-[10px] font-bold text-emerald-600">✓ Permission</span>
                ) : (
                  <span className="text-[10px] font-bold text-amber-600">⚠️ Missing</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
